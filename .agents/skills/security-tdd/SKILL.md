---
name: security-tdd
description: Test-driven workflow for security-relevant changes — write the attack first, watch it succeed, then close it. Use when changing Firestore rules, auth middleware, role checks, secret handling, or any code path that decides who can read or write what. Also use before pushing or redeploying to Cloud Run.
---

# Security TDD Skill

> **Ordering lives in `secure-feature`** — threat model → failing negative tests → rules+backend → UI → definition of done. This skill is the *attack catalogue*: what to write in step ②, and how to know the test actually bites.

## The inversion

Normal TDD: write a test for the behavior you want, watch it fail, implement.

Security TDD: **write the attack you want to fail, watch it succeed, then close the hole.** A test that only confirms the happy path proves nothing about isolation — it passes just as well against `allow read, write: if true`.

If you cannot make the attack succeed first, your test is probably not testing what you think it is. That is the most common way a security test suite ends up green and worthless.

## The loop

1. **Name the attacker and the goal.** "User B wants to read user A's entries." Be concrete — a vague threat produces a vague test.
2. **Write the attack as a test.** Assert it is *denied*.
3. **Temporarily loosen the rule** (locally, never committed) and confirm the test *fails*. This proves the test has teeth.
4. **Restore the rule.** Test passes.
5. **Commit rule + test together.** Never in separate commits — a rule without its test is unreviewable.

## Attack catalogue for this project

Work through these when touching the relevant layer.

**Data isolation** (`firestore.rules`)
- unauthenticated read of any user document
- user B reads / lists / writes user A's entries, sessions, messages
- user A writes their own entry directly, bypassing backend validation
- user A escalates by writing `role: 'admin'` into their own user doc
- **admin-claim token reads another user's entry** ← the one people miss
- anyone reads `audit_logs`
- anyone touches an unlisted collection (proves default-deny)

**Identity** (`requireAuth`)
- no `Authorization` header → 401
- malformed / expired / wrong-project token → 401
- token from a revoked session → 401 (requires `checkRevoked: true`)
- valid token but body carries `uid` of another user → the body `uid` is ignored entirely

**Privilege** (`requireAdmin`)
- plain user calls every admin route → 403 on each
- admin route response inspected field-by-field for content leakage
- demoted admin's existing token → 403 immediately, not in an hour

**Secrets**
- `grep -r "AIza" web/dist/` → empty
- `git ls-files | grep -E '\.env$|service-account|\.pem$|\.key$'` → empty
- error responses contain no stack trace, path, or key fragment
- logs contain no journal text, no token

**Model boundary**
- Gemini returns out-of-range `moodScore` → Zod rejects, nothing written, no crash
- Gemini returns malformed JSON → handled, generic error, no unhandled rejection
- a journal entry containing "ignore previous instructions…" → no behavioral change

## Running

```bash
firebase emulators:exec --only firestore "pnpm test:rules"   # never against production
pnpm test                                                     # unit + integration
pnpm typecheck && pnpm lint
bash scripts/security-check.sh                                # the full gate
```

## The pre-push gate

`scripts/security-check.sh` runs the secret-leak greps, rules tests, typecheck, and lint. It is wired to `.githooks/pre-push` so a redeploy cannot happen with a leaked key or a failing isolation test.

Enable once per clone:

```bash
git config core.hooksPath .githooks
```

If the hook blocks you, fix the finding. Do not `--no-verify`. The one time you bypass it will be the time it was right.

## Definition of done for a security change

- [ ] Attack written as a test **before** the fix
- [ ] Attack verified to fail against loosened rules (test has teeth)
- [ ] Rule/code and test committed together
- [ ] `scripts/security-check.sh` green
- [ ] STRIDE note in the commit body naming what changed and what it closes
