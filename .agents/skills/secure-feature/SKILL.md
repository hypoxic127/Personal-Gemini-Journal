---
name: secure-feature
description: Use when adding or changing any feature in the Personal Gemini Journal repo. Enforces the order — threat model first, failing negative tests second, implementation third — and walks the definition of done at the end. Triggers on new routes, new Firestore paths, new external services, new secrets, or any permission change.
---

# Secure Feature Workflow (TDD × Threat Modeling)

The repo's rules live in `AGENTS.md`. This skill governs the **order** — get the order wrong and security becomes a patch applied afterwards.

> Companion skills: the concrete attack catalogue is in `security-tdd`; per-layer detail is in `firestore-isolation`, `gemini-secure-calls`, `google-maps-integration`, `admin-rbac`, `stability-hardening`. This skill covers process; those cover content.

## The mandatory order

```
① threat model → ② negative tests (red first) → ③ rules + backend → ④ frontend → ⑤ definition of done
```

**Never start with the frontend.** A UI developed against a permissive rule set hides the very authorization bug you need to find — because it *works*.

---

## ① Threat model (goes in the commit body, not a formality)

Fill this table for the new attack surface, one sentence per cell:

| | Question | Your answer |
|---|---|---|
| S | How is identity proven **server-side**? | |
| T | Which field can the client forge (`uid`/`role`/`createdAt`/score)? | |
| R | Is the privileged action written to an audit log? | |
| I | Can user A reach user B's data via a query, an aggregate, an error, or a log? | |
| D | What are the rate limit, payload cap, and token cap? | |
| E | Where is the role checked, and can that check be bypassed? | |

**If the feature introduces a new external service**, first add its directive to the "Per-integration directives" section of `AGENTS.md` (key ownership, trust boundary, failure modes, data minimization), then continue.

## ② Negative tests first (do not skip this)

Before writing any implementation, add the negative cases to `test/firestore.rules.test.ts` and **confirm they are red**:

- unauthenticated access to the new path → denied
- user B reads / lists / writes user A's new path → denied
- user A writes their own new path directly (client writes are always denied) → denied
- **a user holding a `role: "admin"` claim reads `users/{otherUid}/**`** → denied
- a new collection with no explicit rule is denied by default

API-layer negative cases go in `api/test/`:

- no token → `401`
- plain user hits an admin endpoint → `403`
- path uid ≠ token uid → `403`
- request body carries an unknown field → `400` (Zod `.strict()`)
- model returns an out-of-range value (e.g. `moodScore: 99`) → rejected and logged, never stored

Watch them fail, then implement. A test suite that is green from the start usually is not testing anything.

## ③ Rules and backend

Order: `shared/schemas.ts` (Zod) → `firestore.rules` → middleware → routes → services.

Keep these in view while writing:

- data access keys only on `req.user.uid`, never on a uid from the body, query string, or path
- client writes are always `allow write: if false`; every write goes through the Admin SDK
- model output is **re-validated with Zod** before storage (`responseSchema` is best-effort, not a security boundary)
- user text entering a prompt is delimited and declared as data
- server-authoritative fields — `uid`, `role`, ids, timestamps, scores — are stripped before write
- every new model-backed route gets a per-uid rate limit and a payload cap

Do not move on until the negative tests are green.

## ④ Frontend

Every data view needs loading / empty / error states. A `429` shows a friendly message with a retry countdown, never a silent failure. A route guard is a usability feature — the server-side guard must already exist.

## ⑤ Definition of done

State each item explicitly. Do not say "done" in the aggregate.

- [ ] STRIDE table written
- [ ] every new route has `requireAuth` (plus `requireAdmin` where needed)
- [ ] Zod on every new input **and** every new model output
- [ ] rules updated, cross-user negative test added and passing
- [ ] no new secret in code; new keys in Secret Manager and injected via `--set-secrets`
- [ ] rate limit and payload cap on model-backed routes
- [ ] client errors are generic; server logs carry no content, tokens, or secrets
- [ ] UI has all three states; no unhandled promise rejection, no infinite spinner
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:rules` all green

## Stop and explain rather than continuing

- A key needs to be handed to the browser → first state why it cannot be hidden and what restriction replaces concealment
- An admin needs to read user content → refuse; build the aggregate version
- Model output would become a Firestore path, a target user, or a request URL → refuse; that is injection / SSRF
- A rule needs loosening "just to get it running" → no. The rule stands first, the feature follows
