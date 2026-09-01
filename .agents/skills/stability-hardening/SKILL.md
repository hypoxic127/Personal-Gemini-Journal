---
name: stability-hardening
description: Applies the challenge's mandated robustness standards — Gemini model fallback ladder, middleware ordering, null-safe payload ingestion, undefined-stripping before database writes, guaranteed save verification, and retry affordances. Use when wiring an Express app, adding a route, writing to Firestore, calling Gemini, or building any UI that submits user input.
---

# Stability Hardening Skill

These come from the challenge's own Production Directives §6. They read like nitpicks; each one is a crash that would otherwise happen live during judging. **Stability is one of the four scored criteria** — and unlike the other three, most of it is mechanical.

## 1 · Model fallback ladder

Never a single model in a single try. See `gemini-secure-calls` for the full `generateContentWithFallback` implementation.

```
gemini-3.6-flash → gemini-3.1-flash-lite → gemini-flash-latest → gemini-3.7-flash
```

Fall through on `503 UNAVAILABLE`, `429 RESOURCE_EXHAUSTED`, `404 NOT_FOUND`, `500 INTERNAL`. Never on `400` — a malformed request fails identically on every rung and burns four calls' worth of quota.

## 2 · Middleware ordering guarantee

Body parsers and payload middleware are mounted **before** any route is defined. A handler registered upstream of `express.json()` receives `undefined` for `req.body` and throws on destructure.

```ts
const app = express();

app.use(helmet({ contentSecurityPolicy: { /* strict */ } }));
app.use(express.json({ limit: '256kb' }));       // ← BEFORE routes, always
app.use(express.urlencoded({ extended: false }));

app.use('/api/sessions', sessionsRouter);         // routes come after
app.use('/api/entries', entriesRouter);
```

This is one of those bugs that works locally (because you happened to define things in the right order) and breaks after a refactor.

## 3 · Null-safe payload ingestion

Never assume `req.body`, `req.query`, or a header exists.

```ts
// ✘ throws on an empty POST, a wrong content-type, or a proxy that drops the body
const { sessionId, text } = req.body;

// ✔ guard, then validate
const raw = (req.body && typeof req.body === 'object') ? req.body : {};
const parsed = MessageSchema.safeParse(raw);
if (!parsed.success) return next(new AppError('INVALID_INPUT', 400));
const { sessionId, text } = parsed.data;
```

A missing payload is a clean `400`, never an unhandled runtime exception.

## 4 · Strip `undefined` before every database write

Firestore rejects `undefined` field values outright. One optional field left unset crashes the whole write.

```ts
// ✘ silently destroys Date, Timestamp, and FieldValue.serverTimestamp() sentinels
const clean = JSON.parse(JSON.stringify(payload));

// ✔ explicit recursive sanitizer that leaves sentinels alone
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  if (isFirestoreSentinel(value) || value instanceof Date) return value;   // keep as-is
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = stripUndefined(v);
  }
  return out as T;
}
```

The `JSON.parse(JSON.stringify())` shortcut is worse than the bug it fixes: it turns `serverTimestamp()` sentinels into `{}` and `Date` objects into strings, so your timestamps silently stop working.

## 5 · Guaranteed save verification

When a user submits anything, **both** their input and the generated output must be confirmed persisted. Never fail silently.

```ts
// finalize: write user turn, model turn, and entry — or report which step failed
try {
  await db.runTransaction(async (tx) => { /* messages + entry together */ });
} catch (err) {
  logger.error({ err, uid, sessionId, correlationId }, 'persistence failed');
  throw new AppError('SAVE_FAILED', 503);   // surfaces to the UI, does not vanish
}
```

If generation succeeds but the write fails, the user must be told — a reply that appears on screen and is gone after refresh is worse than an honest error.

## 6 · Retry affordance, and never clear the buffer

```tsx
// ✘ optimistic clear — user's text is gone if the save fails
setInput('');
await save(input);

// ✔ clear only after a confirmed write
const result = await save(input);
if (result.ok) setInput('');
else setError({ message: 'Could not save', onRetry: () => save(input) });
```

Every save failure shows an accessible banner or toast with a **Retry Save** action. The input buffer is never cleared and UI state is never reset until persistence settles successfully. Losing someone's journal entry to a transient 503 is the single worst thing this app can do.

## 7 · Unified dev entrypoint

`dev`, `build`, and `start` all boot the **unified server**, not a frontend-only bundler. If `pnpm dev` serves only Vite, you develop against a world where `/api/*` doesn't exist, and every integration bug surfaces for the first time in production.

```json
{
  "dev":   "concurrently \"pnpm -F api dev\" \"pnpm -F web dev\"",
  "build": "pnpm -F web build && pnpm -F api build",
  "start": "node api/dist/index.js"
}
```

Vite's dev server proxies `/api` to the local Express port, so the browser sees the same origin in dev as in production.

## 8 · Process lifecycle

```ts
// fail fast: a container that won't start beats one serving half a config
const config = ConfigSchema.parse(process.env);   // Zod, at import time

// drain on shutdown: Cloud Run scale-down must not sever a live conversation
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
```

## 9 · UI states, everywhere

Every data view: **loading / empty / error**. A `429` renders a friendly message with a `Retry-After` countdown, never a silent no-op. Every route is wrapped in a React `ErrorBoundary` so one crashing page does not white-screen the app. Empty states are the thing judges click first — an onboarding hint beats a blank panel.

## Checklist

- [ ] All model calls via `generateContentWithFallback`
- [ ] Body parsers mounted before every route
- [ ] Every handler guards `req.body` before destructuring
- [ ] `stripUndefined` applied before every Firestore write; sentinels preserved
- [ ] Save failures surface with a Retry action; input buffer never cleared early
- [ ] `dev`/`build`/`start` boot the unified server
- [ ] Config validated at startup with `exit(1)` on missing vars
- [ ] `SIGTERM` drains in-flight requests
- [ ] Loading / empty / error states on every view; `ErrorBoundary` per route
