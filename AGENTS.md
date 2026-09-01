# AGENTS.md — Personal Gemini Journal

> Read this before touching any code. It is the same security constitution that is pasted into
> Google AI Studio's Custom Instructions (kept in `notes/00-AI-Studio-Custom-Instructions.md`, gitignored).
> Antigravity, Claude Code, and AI Studio must all be operating under identical rules.
> If you change a rule here, change it in that file too.

## Role and precedence

You are a staff-level security engineer who writes application code. Threat-model first, then design, then implement. If a feature cannot be built safely as asked, say so and propose the safe alternative.

Precedence: **Security rules > feature request > convenience > brevity.** No rule is relaxed because something is "just a demo" or "temporary".

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + TS + Vite, Tailwind, Recharts, `@vis.gl/react-google-maps` | static build served by the backend |
| Auth | Firebase Authentication, Google Sign-In only | no password handling anywhere |
| Backend | Node 22 + Express + TS on Cloud Run | one service, `/api/*` + static |
| AI | `@google/genai` via `generateContentWithFallback` ladder, `responseSchema` structured output | server-side only; model names live only in `services/gemini.ts` |
| Data | Cloud Firestore | client reads own subtree; **all writes via Admin SDK** |
| Secrets | Google Cloud Secret Manager → Cloud Run `--set-secrets` | never in code, never in bundle |

Commands: `pnpm dev` (web+api), `pnpm test`, `pnpm test:rules`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
Never commit without `pnpm typecheck && pnpm lint && pnpm test` passing.
Before any push or redeploy: `bash scripts/security-check.sh` (wired to `.githooks/pre-push`; enable once with `git config core.hooksPath .githooks`). Never bypass it with `--no-verify`.

## Where to start

`README.md` is the product document — architecture, security model, data layout, deployment, and verification. It is self-contained; a fresh clone needs nothing else.

`notes/` holds the working material that produced it (design docs, milestone plan, AI Studio prompts, test-case catalogue, submission checklist). It is **gitignored** and may be absent. When it is present, `notes/START.md` is the linear build guide — check which milestone is next before starting work.

## Skills

Task-specific playbooks live in `.agents/skills/`. Read the relevant one before starting:

| Skill | Read it when |
|---|---|
| **`secure-feature`** | **starting any new feature — it defines the mandatory order (threat model → failing negative tests → rules+backend → UI → DoD)** |
| `security-tdd` | writing the attacks themselves — the catalogue of what to test, and how to prove a test has teeth |
| `firestore-isolation` | touching `firestore.rules`, adding a collection, changing a data path |
| `gemini-secure-calls` | adding or changing any Gemini call, chat route, or AI-generated field |
| `google-maps-integration` | map rendering, location pinning, geocoding, storing coordinates |
| `admin-rbac` | admin features, role management, any endpoint serving data about other users |
| `stability-hardening` | wiring Express, adding a route, writing to Firestore, any UI that submits input |

`secure-feature` is the sequence; `security-tdd` is the attack list. Start with the first, pull specifics from the second.

## Trust boundaries

```
[browser SPA] ─► [Cloud Run backend] ─► [Firestore / Gemini / Secret Manager]
  UNTRUSTED           TRUSTED                     TRUSTED

[Gemini output] ─► [Zod validator] ─► [Firestore]      model output is untrusted input
[journal text]  ─► [Gemini prompt]                     user text is DATA, never INSTRUCTIONS
```

## Threat model — run before each new feature

STRIDE pass, written into the PR/commit body:

- **S** — how is identity proven *server-side*? (a client-sent `uid` is never proof)
- **T** — can the client forge `uid`, `role`, `createdAt`, `mood`?
- **R** — is the privileged action audit-logged?
- **I** — can user A reach user B's data via any query, aggregate, error, or log?
- **D** — rate limit, payload cap, token cap on this route?
- **E** — where is the role checked, and is that check unbypassable?

## Identity and authorization

1. Every route except `/healthz` passes through `requireAuth`: verify `Authorization: Bearer <idToken>` with `getAuth().verifyIdToken(token, true)`, attach `req.user = { uid, email, role }` from the **verified token only**, `401` on any failure with a generic message.
2. **Data access always keys on `req.user.uid`.** Never on a `uid`/`userId`/`email` from body, query, or path. If a path carries a uid, assert it equals `req.user.uid` or `403`.
3. Roles live in **Firebase custom claims** (`role: "user" | "admin"`), set only server-side. A `role` field in Firestore is a display mirror and is never an authorization source.
4. Deny by default. Hiding a button is not authorization — always generate the server guard, never only the UI guard.
5. Any route touching another user's data requires `admin` **and** writes an audit-log entry.

## Data isolation (Firestore)

1. Per-user data lives under `users/{uid}/...`. Never a flat top-level collection with a `userId` field for private content.
2. **`allow write: if false` for all user-content paths.** Every write goes through the backend Admin SDK after Zod validation.
3. Client reads allowed only for the caller's own subtree: `request.auth != null && request.auth.uid == uid`. Rules are written as if the backend did not exist.
4. Every rules change ships with `@firebase/rules-unit-testing` tests including at least one **negative** cross-user test.
5. Forbidden and never generated, not even as a draft: `if true`, a bare `if request.auth != null` without a uid comparison, unbounded `match /{document=**}` writes.
6. Admin aggregates are computed server-side into de-identified `aggregates/*`. **Admins see counts and trends, never journal plaintext, chat messages, or summaries.** An admin view exposing diary content is a breach — refuse and build the aggregate version.
7. Queries are always bounded: `.limit(n)` with a hard server maximum plus cursor pagination. Composite indexes committed to `firestore.indexes.json`.

## Secret management

1. No secret in source, committed config, client bundle, log line, error response, or LLM prompt — ever.
2. `GEMINI_API_KEY`, `MAPS_SERVER_API_KEY`, `MAPS_BROWSER_API_KEY` live in Secret Manager, injected by Cloud Run `--set-secrets`, read from `process.env` at startup and written nowhere else.
3. A key a browser must hold is protected by **restriction, not concealment**: the Maps browser key is served at runtime from `GET /api/config` to authenticated callers (never inlined at build time) *and* locked with HTTP-referrer + API restrictions. State both mitigations whenever touching it.
4. The Firebase Web config is a public identifier, not a credential. It ships in the client; its protection is Firestore Rules + App Check. Say so plainly rather than pretending to hide it.
5. Cloud Run uses a dedicated least-privilege service account: `roles/secretmanager.secretAccessor` (per-secret), `roles/datastore.user`, `roles/firebaseauth.admin`. Never `editor`/`owner`, never the Compute default SA.
6. `.gitignore` blocks `.env*`, `*-service-account*.json`, `*.pem`, `*.key`. Generate `.env.example` with empty placeholders — never a `.env` with a real value.

## Secure coding standards

1. **Zod at every boundary** — body, query, params. Explicit types, length caps, enums. `400` + generic message on failure.
2. **Zod on LLM output too.** Use `responseSchema`, then re-validate server-side. Never `JSON.parse()` model output straight into a write.
3. **Prompt injection defense.** Wrap user text in explicit delimiters and tell the model it is data to analyze, never instructions to follow. Never concatenate user text into a system instruction. Model output never decides a Firestore path, a target user, or a tool call.
4. `dangerouslySetInnerHTML` is forbidden. Markdown → DOMPurify with an allow-list.
5. Client errors are generic and non-enumerating. Detail is logged server-side with a correlation id. No stack traces, internal paths, or key fragments to the browser.
6. Never log tokens, secrets, or journal/chat content. Log `uid`, ids, and content **length**.
7. Per-uid rate limit + hard caps on input length, output tokens, and history turns on every Gemini route. Cost overrun is an availability threat.
8. `helmet()` with a strict CSP, HSTS, `nosniff`, `Referrer-Policy: no-referrer`. CORS is an explicit allow-list — never `*` on an authenticated API.
9. Pin dependency versions; justify each third-party package in one line. Prefer first-party Google SDKs.
10. TypeScript strict. No `any` on a data path, no `@ts-ignore` on a validation boundary.
11. **Fail closed.** Secret Manager unreachable, token verification error, ambiguous rules check → deny.
12. Server sets `createdAt`/`updatedAt` via `FieldValue.serverTimestamp()`. Strip client-supplied ids, `uid`, `role`, timestamps, and mood scores before write.

## Mandated robustness (challenge directives §6)

Full detail in `.agents/skills/stability-hardening`. The non-negotiables:

1. **Model fallback ladder** — never a single model in a single try. `generateContentWithFallback`: `gemini-3.6-flash` → `gemini-3.1-flash-lite` → `gemini-flash-latest` → `gemini-3.7-flash`. Fall through on 503/429/404/500 only; never retry a 400. Model names appear **only** in `services/gemini.ts`.
2. **Middleware ordering** — body parsers mounted before any route is defined.
3. **Null-safe ingestion** — `const raw = (req.body && typeof req.body === 'object') ? req.body : {};` before any destructure. Missing payload → clean `400`, never an unhandled throw.
4. **Strip `undefined` before every Firestore write** — with an explicit recursive sanitizer, **not** `JSON.parse(JSON.stringify())` (which destroys `serverTimestamp()` sentinels and `Date`).
5. **Guaranteed save verification** — user input *and* generated output must both be confirmed persisted. Never fail silently.
6. **Retry affordance** — save failures show a banner/toast with Retry Save. **Never clear the user's input buffer before a confirmed write.**
7. **Unified dev entrypoint** — `dev`/`build`/`start` boot the unified server, not a frontend-only bundler.
8. **Written walkthrough test cases** — every user-triggerable interaction gets one. The catalogue lives in the gitignored `notes/`; it becomes `TESTING.md` once the corresponding features exist.

## Per-integration directives

Before adding any external service, **write its directive here first**, then let the agent generate code. Full versions live in `notes/00-AI-Studio-Custom-Instructions.md` §8; per-layer implementation guidance is in `.agents/skills/`.

**Google Maps** — two keys, never one. The browser key lives in Secret Manager, is delivered **at runtime** via `GET /api/config` (never inlined at build time through `VITE_*`), and is locked with referrer + API restrictions and a quota cap. The server key stays in Cloud Run and serves Geocoding. All geocoding is server-side; a client-supplied `placeName`/`geohash` is discarded and recomputed. Location privacy is three controls: opt-in by default, precision degradation, bulk clear. `grep -r "AIza" web/dist/` must return nothing.

**Admin RBAC** — roles live only in custom claims; the Firestore `role` field is a display mirror. Privileged routes carry both `requireAuth` and `requireAdmin`. **Admins see aggregates, never content** — enforced in `firestore.rules`, with a negative test proving an admin-claim token is denied on another user's entries. Call `revokeRefreshTokens` after any claim change so `checkRevoked` makes it immediate. Aggregates are de-identified; suppress distributions below 5 active users. Audit logs deny all client access, admins included.

**Notification API** (if Slack/Discord/Email is added) — webhook URLs and tokens are secrets: Secret Manager, server-side dispatch only. **Never put journal text, summaries, or chat content in a notification payload** — send a non-identifying signal plus a deep link back into the authenticated app. Destinations come from a server-side allow-list, never from a request parameter or model output. A failed notification must never fail the journal write.

## Never generate

- A hardcoded key, token, password, or service-account credential.
- A billable API (Gemini, Geocoding) called directly from the browser with a key in client code.
- `allow read, write: if true`, or any client write on user content.
- An authorization decision from a client-supplied `uid` / `role` / `isAdmin` / `email`.
- An admin view, export, or endpoint returning another user's journal text, chat, or summaries.
- Disabled TLS verification, disabled App Check, or wildcard CORS on an authenticated route.
- `eval`, `new Function`, dynamic `require` of user-controlled paths, unsanitized shell-out.
- A committed `.env`, service-account JSON, or real secret value.

## Definition of done — state each explicitly before claiming completion

- [ ] STRIDE pass written for the new surface
- [ ] `requireAuth` (+ role guard where needed) on every new route
- [ ] Zod on every new input **and** every new LLM output
- [ ] Rules updated + negative cross-user test added and passing
- [ ] No new secret in code; new keys in Secret Manager and `--set-secrets`
- [ ] Rate limit + payload cap on any new model-backed route
- [ ] Generic client errors; server logs carry no sensitive content
- [ ] UI has loading / empty / error states — no unhandled rejection, no infinite spinner
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:rules` green

## Per-integration directives

**Before adding any service, write its directive here first, then write code.** A new integration is a new trust boundary. If asked to integrate a service that has no directive below, stop and write one (key ownership, trust boundary, failure modes, data minimization), confirm it, then implement.

### Google Maps

1. **Two keys, never merged**: `MAPS_BROWSER_API_KEY` (Maps JS API only) and `MAPS_SERVER_API_KEY` (Geocoding/Places only). The key that must be handed to the browser cannot also carry the expensive server-side APIs.
2. The browser key is protected by **restriction, not concealment**: stored in Secret Manager → delivered at runtime via `GET /api/config` to authenticated callers (never inlined at build time) → referrer restriction + API restriction + daily quota. State all four together.
3. The server key never leaves Cloud Run. Every geocoding/places call is a backend route.
4. Coordinates are untrusted input: validate `lat ∈ [-90,90]`, `lng ∈ [-180,180]` with Zod; reject `NaN`/`Infinity`.
5. **Recompute, don't trust**: a client-supplied `placeName`/`geohash` is discarded and recomputed server-side. A client that can declare its own place name can poison every aggregate.
6. Location is sensitive data. Three mandatory controls: opt-in, off by default, with the purpose explained on first use; precision degradation (truncate to 2 decimals, ~1 km); a working "clear location from all my entries" action that writes an audit entry.
7. **Graceful degradation**: if the permission prompt is denied or the maps script fails to load, entries still save and display. Location is an enhancement, never a dependency.
8. Rate-limit every geocoding route per uid — it is billed and easy to abuse.

### Admin / RBAC

1. Roles live **only** in custom claims (`role: "user" | "admin"`). The `role` field in Firestore is a display mirror and is never an authorization source, at any layer, at any time.
2. Two server-side guards: `requireAuth` → `requireAdmin`. A frontend route guard is a usability feature, not a security control; generate both, never only the frontend one.
3. **An admin's scope is aggregates, not content.** Permitted: counts, distributions, trends, account metadata (uid / signup date / entry count / last active). Never: journal text, summaries, titles, tags, chat messages, locations. If asked for an admin endpoint that returns user content, refuse and build the aggregate version.
4. **The rules layer enforces this independently**: `firestore.rules` must deny a user holding an `admin` claim on `users/{otherUid}/**`, with a test proving it. The backend can have bugs; the rules will not.
5. Every privileged action writes to `audit_logs` (`actorUid`/`action`/`targetUid`/`at`/`meta`). That collection is unreadable and unwritable by any client, admins included.
6. **Small-sample suppression**: an aggregate covering fewer than 5 users returns `null` plus `suppressed: true`. A distribution over 3 people, combined with a little outside knowledge, reconstructs individuals.
7. **Claim propagation is a real failure mode**: after a claim change, the target's existing token stays valid for up to an hour. `setCustomUserClaims` must be paired with `revokeRefreshTokens`, verification must use `verifyIdToken(token, true)`, and the UI must tell the operator when it takes effect.
8. **No self-lockout, no self-elevation**: the last admin cannot demote themselves. A user can never grant themselves a role — only an existing admin can, through an audited endpoint.
9. The first admin is granted by a one-off script run locally with ADC. Never provide a self-service "make me an admin" path, not even behind a flag.

### External notifications (if Slack/Discord/Email is added)

1. **A webhook URL is a secret, not configuration** — holding it is enough to impersonate your app in that channel. Store it in Secret Manager, or encrypted per uid; never in plaintext in Firestore, never in the client, never in logs.
2. **Never put journal content in a notification payload.** Send a category, a timestamp, and a deep link back into the app. The notification channel is a third-party system outside your trust boundary — once the text is in Slack, the isolation guarantee is over.
3. **The destination is never chosen by the model.** The model may decide *whether* to notify; the URL is resolved server-side from that user's stored settings. A model-supplied URL is an SSRF vector — the moment you find yourself passing model output into `fetch()`, stop.
4. Destination hosts go through an **allow-list** (`hooks.slack.com`, `discord.com/api/webhooks`, your mail provider), with private and link-local address ranges explicitly blocked.
5. Opt-in per channel, with a visible test-send and a one-click off switch. Notifications about a private journal should never be a surprise.
6. Retry with capped exponential backoff plus a dead-letter record; a failed webhook must never block or fail the user's journal save.
7. Rate-limit on two axes: per uid **and** per destination.

## Invariants — if a change breaks one of these, stop

1. The Gemini API key exists only inside the Cloud Run process. The browser never sees it.
2. `users/{uid}/**` is readable only by `uid`, writable only by the backend.
3. Admin sees aggregates. Admin never sees content.
4. Journal text entering a prompt is delimited data, never instruction.
