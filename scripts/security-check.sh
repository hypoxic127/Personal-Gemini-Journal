#!/usr/bin/env bash
# Pre-deploy security gate. Invoked by .githooks/pre-push; also runnable by hand.
# Any failing check blocks the push. Do not work around it with --no-verify.
#
#   enable:  git config core.hooksPath .githooks
#   manual:  bash scripts/security-check.sh

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

FAIL=0
pass() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; FAIL=1; }
# Named `section`, not `head`: a function called `head` shadows the `head` command for the
# whole script, which silently breaks every `head -c` / `head -n` used by a check below.
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

section "1 · Secret leakage"

# 1a — no Google API key in the built bundle
if [ -d web/dist ]; then
  if grep -rq "AIza" web/dist/ 2>/dev/null; then
    fail "found an AIza-prefixed key in web/dist/ — a secret was bundled into the frontend"
    grep -rl "AIza" web/dist/ | head -5 | sed 's/^/        /'
  else
    pass "no API key in build output"
  fi
else
  printf '  \033[33m–\033[0m web/dist not present — skipped (run pnpm build before deploying, then re-run)\n'
fi

# 1b — no hardcoded key in source. No exemptions, including for tests: the fixtures in
# api/test/config.test.ts assemble their key-shaped strings at runtime for this reason.
if grep -rn "AIza[0-9A-Za-z_-]\{20,\}" --include="*.ts" --include="*.tsx" \
     --include="*.js" --include="*.json" api/ web/ shared/ 2>/dev/null | grep -v node_modules; then
  fail "hardcoded API key found in source"
else
  pass "no hardcoded key in source"
fi

# 1c — no sensitive file tracked by git
if git ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.|service-account|serviceAccount|\.pem$|\.key$|\.p12$' \
     | grep -v '\.env\.example$' | grep -q .; then
  fail "these sensitive files are tracked by git:"
  git ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.|service-account|serviceAccount|\.pem$|\.key$|\.p12$' \
    | grep -v '\.env\.example$' | sed 's/^/        /'
else
  pass "no sensitive files tracked"
fi

# 1d — no key introduced anywhere in the commits being pushed
RANGE="${1:-origin/HEAD..HEAD}"
if git rev-parse --verify --quiet "${RANGE%%..*}" >/dev/null 2>&1; then
  if git diff "$RANGE" 2>/dev/null | grep -E '^\+' | grep -q "AIza[0-9A-Za-z_-]\{20,\}"; then
    fail "the diff being pushed contains an API key"
  else
    pass "no key in the diff being pushed"
  fi
fi

section "2 · Firestore rules"

# 2a — no permissive rule
if grep -nE 'allow[[:space:]]+(read|write|read,[[:space:]]*write)[[:space:]]*:[[:space:]]*if[[:space:]]+true' \
     firestore.rules 2>/dev/null; then
  fail "firestore.rules contains an 'if true' rule"
else
  pass "no 'if true' rule"
fi

# 2b — explicit default deny must exist
if grep -q 'match /{document=\*\*}' firestore.rules 2>/dev/null; then
  pass "explicit default-deny catch-all present"
else
  fail "firestore.rules is missing the match /{document=**} default deny"
fi

# 2c — rules tests, including cross-user negative cases, must pass
if [ -f test/firestore.rules.test.ts ]; then
  FIREBASE_BIN="firebase"
  if ! command -v "$FIREBASE_BIN" >/dev/null 2>&1 && command -v firebase.cmd >/dev/null 2>&1; then
    FIREBASE_BIN="firebase.cmd"
  fi
  if command -v "$FIREBASE_BIN" >/dev/null 2>&1; then
    if "$FIREBASE_BIN" emulators:exec --only firestore "pnpm test:rules" </dev/null >/tmp/rules.log 2>&1; then
      pass "rules tests pass (including cross-user negative cases)"
    else
      fail "rules tests failed — see /tmp/rules.log"
      tail -20 /tmp/rules.log | sed 's/^/        /'
    fi
  else
    fail "firebase CLI not installed — cannot run rules tests"
  fi
else
  fail "test/firestore.rules.test.ts is missing — isolation has no test coverage at all"
fi

# 2d — get and list are separate Firestore operations. A suite that only exercises
# doc().get() proves nothing about whether a collection can be enumerated.
if grep -q "collection('users/userA/entries')" test/firestore.rules.test.ts 2>/dev/null; then
  pass "rules suite covers list (collection enumeration), not just get"
else
  fail "rules suite has no cross-user list/enumeration case — get-only coverage is a gap"
fi

section "3 · Types and static analysis"

if command -v pnpm >/dev/null 2>&1; then
  pnpm typecheck >/dev/null 2>&1 && pass "typecheck"    || fail "typecheck failed"
  pnpm lint      >/dev/null 2>&1 && pass "lint"         || fail "lint failed"
  pnpm test      >/dev/null 2>&1 && pass "unit tests"   || fail "unit tests failed"
else
  fail "pnpm not found"
fi

section "4 · Config hygiene"

# 4a — a UTF-8 BOM (EF BB BF) makes dotenv read the first key as U+FEFF + "NODE_ENV", so
# NODE_ENV comes back unset and the process silently runs in development mode. An afternoon
# to diagnose, three bytes to prevent.
BOM_FOUND=0
for f in $(git ls-files | grep -E '(^|/)\.env\.example$'); do
  if [ "$(head -c 3 "$f" | od -An -tx1 | tr -d '[:space:]')" = "efbbbf" ]; then
    fail "$f starts with a UTF-8 BOM — dotenv would fold it into the first key name"
    BOM_FOUND=1
  fi
done
[ "$BOM_FOUND" -eq 0 ] && pass "no BOM in any .env.example"

# 4b — the Firestore emulator and the API must not share a port. If they do, running
# `pnpm test:rules` while `pnpm dev` is up points the rules suite at Express: it either
# fails for a reason unrelated to the rules, or passes without having tested them.
EMU_PORT=$(grep -A3 '"emulators"' firebase.json | grep '"port"' | grep -oE '[0-9]+' | head -1)
API_PORT=$(grep -E '^PORT=' api/.env.example | cut -d= -f2 | tr -d '[:space:]')
if [ -z "$EMU_PORT" ]; then
  fail "could not read the Firestore emulator port from firebase.json"
elif [ "$EMU_PORT" = "$API_PORT" ]; then
  fail "Firestore emulator and API both use port $EMU_PORT — the rules suite would hit the API"
else
  pass "emulator port ($EMU_PORT) and API port ($API_PORT) do not collide"
fi

# 4c — GET /api/config/public is unauthenticated by necessity: the SPA needs the Firebase
# Web config before it can sign anyone in. Only that public identifier may be served there.
# A Maps key reached through a `||` fallback is how a restricted, billable credential ends
# up on an anonymous endpoint wearing someone else's name.
if awk '
  index($0, "router.get(") && index($0, "/public") { inblock = 1 }
  inblock && index($0, "MAPS_")                    { found = 1 }
  inblock && index($0, "});") == 1                 { inblock = 0 }
  END { exit !found }
' api/src/routes/config.ts; then
  fail "GET /api/config/public can reach a Maps key — that route is unauthenticated"
else
  pass "public config route cannot reach a Maps key"
fi

# 4d — model names belong in exactly one file. A model id that leaks into a route, a
# component, or marketing copy is one that gets missed when the fallback ladder changes.
STRAY_MODELS=$(grep -rlniE "gemini[- ][0-9]" --include="*.ts" --include="*.tsx" --include="*.json"   api/src web/src shared/src 2>/dev/null | grep -v "^api/src/services/gemini.ts$")
if [ -n "$STRAY_MODELS" ]; then
  fail "model names appear outside api/src/services/gemini.ts:"
  echo "$STRAY_MODELS" | sed 's/^/        /'
else
  pass "model names confined to api/src/services/gemini.ts"
fi

# 4e — the browser must never call a model provider directly.
if grep -rn "@google/genai\|generativelanguage.googleapis.com" --include="*.ts" --include="*.tsx" web/src 2>/dev/null; then
  fail "the web bundle references the model SDK or endpoint directly"
else
  pass "no direct model calls from the browser"
fi

section "5 · Dangerous patterns"

if grep -rn "dangerouslySetInnerHTML" --include="*.tsx" web/src 2>/dev/null; then
  fail "dangerouslySetInnerHTML is in use"
else
  pass "no dangerouslySetInnerHTML"
fi

if grep -rn "origin:[[:space:]]*['\"]\*['\"]" --include="*.ts" api/src 2>/dev/null; then
  fail "CORS is configured with a wildcard origin"
else
  pass "CORS is not a wildcard"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mSecurity gate passed — safe to push and deploy\033[0m\n\n'
  exit 0
else
  printf '\033[31mSecurity gate failed — fix the findings above (do not use --no-verify)\033[0m\n\n'
  exit 1
fi
