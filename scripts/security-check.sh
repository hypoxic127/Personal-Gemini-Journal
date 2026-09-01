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
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head "1 · Secret leakage"

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

# 1b — no hardcoded key in source
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

head "2 · Firestore rules"

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
  if command -v firebase >/dev/null 2>&1; then
    if firebase emulators:exec --only firestore "pnpm test:rules" >/tmp/rules.log 2>&1; then
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

head "3 · Types and static analysis"

if command -v pnpm >/dev/null 2>&1; then
  pnpm typecheck >/dev/null 2>&1 && pass "typecheck"    || fail "typecheck failed"
  pnpm lint      >/dev/null 2>&1 && pass "lint"         || fail "lint failed"
  pnpm test      >/dev/null 2>&1 && pass "unit tests"   || fail "unit tests failed"
else
  fail "pnpm not found"
fi

head "4 · Dangerous patterns"

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
