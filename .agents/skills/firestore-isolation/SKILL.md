---
name: firestore-isolation
description: Writes and tests Firestore security rules that guarantee per-user data isolation with zero cross-user leakage. Use when creating or modifying firestore.rules, adding a new Firestore collection, changing a data path, or writing rules unit tests. Always use before shipping any change that touches how data is read or written.
---

# Firestore Isolation Skill

Every rule you write must hold **even if the backend did not exist**. Rules are the last line of defense, not a formality behind the API.

## The layout is the isolation

Per-user data lives under a path rooted at the owner's uid:

```
users/{uid}
users/{uid}/sessions/{sessionId}
users/{uid}/sessions/{sessionId}/messages/{messageId}
users/{uid}/entries/{entryId}
```

Never use a flat top-level collection with a `userId` field for private content. With a flat layout, isolation depends on every single query remembering its filter — one forgotten `.where()` is a breach. With subcollections, `users/A` and `users/B` are physically distinct trees and the rule is a single path comparison.

## The four rules that matter

1. **Client writes are disabled everywhere on user content.** `allow write: if false`. All writes go through the Cloud Run backend via Admin SDK after Zod validation. This is not paranoia — it is what lets the backend strip `uid`, `role`, timestamps, and model-generated scores before they land.
2. **Client reads are scoped to the caller's own subtree**: `request.auth != null && request.auth.uid == uid`.
3. **Roles come from the signed token**, never from a document: `request.auth.token.role == 'admin'`. A `role` field inside a Firestore document is a display mirror only.
4. **Default deny at the end**: `match /{document=**} { allow read, write: if false; }`. A new collection with no explicit rule must be unreachable, not open.

## Never write these

```javascript
allow read, write: if true;                    // never, not even as a draft
allow read: if request.auth != null;            // "logged in" ≠ "authorized" — this leaks everything
match /{document=**} { allow write: if ...; }   // unbounded write recursion
allow read: if resource.data.role == 'admin';   // reads role from the document, forgeable
```

The second one is the classic false-security bug: it looks like it requires login, and it lets any logged-in user read every other user's data.

## Test-driven: write the negative test first

Never write a rule and then a test that confirms it. Write the **attack** first, watch it succeed against permissive rules, then tighten the rule until the attack fails. Use `@firebase/rules-unit-testing`.

Required negative cases — a rules change is not done until all of these pass:

| Attack | Expected |
|---|---|
| unauthenticated read of `users/A` | denied |
| user B reads `users/A/entries/e1` | denied |
| user B lists `users/A/entries` | denied |
| user A writes `users/A/entries/e1` (own data!) | denied |
| user A sets `users/A.role = 'admin'` | denied |
| plain user reads `aggregates/daily_*` | denied |
| **admin reads `users/A/entries/e1`** | **denied** |
| anyone reads `audit_logs/*` | denied |
| anyone touches `unlisted_collection/x` | denied |

The admin case is the one people get wrong. An admin who can read journal content is a privacy breach, not a feature. If a task asks for it, refuse and build the aggregate view instead.

Run with `firebase emulators:exec --only firestore "pnpm test:rules"`. Never test rules against the production database.

## Adding a new collection — checklist

- [ ] Does it hold per-user private content? → put it under `users/{uid}/`
- [ ] Explicit rule added (never rely on a parent match)
- [ ] `allow write: if false` unless there is a written reason otherwise
- [ ] Negative cross-user test added
- [ ] Composite index added to `firestore.indexes.json` if it is queried with a filter + sort
- [ ] Query is bounded with `.limit(n)` and a hard server-side maximum
