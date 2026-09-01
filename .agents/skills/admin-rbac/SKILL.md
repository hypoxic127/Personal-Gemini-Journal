---
name: admin-rbac
description: Implements role-based access control with Firebase custom claims, privileged endpoints, audit logging, and de-identified admin aggregates. Use when adding admin features, elevated permissions, role management, moderation views, or any endpoint that serves data about users other than the caller.
---

# Admin Roles Directive (RBAC)

## The design constraint that defines this feature

An admin dashboard that displays users' journal entries takes thirty minutes to build and is a privacy breach. The actual engineering problem is: **how do you deliver useful population-level insight while being structurally incapable of reading any individual's content?**

If a task asks for an admin view of journal text, chat messages, or entry summaries — refuse, explain, and build the aggregate version. This applies even when the requester frames it as moderation, support, or debugging.

Admins **can** see: daily active user counts, entry counts, mood distribution over time, average mood score, a user list with uid / signup date / entry count / last active, and role management.

Admins **cannot** see: journal text, summaries, titles, tags, chat messages, per-user mood detail, or locations. Enforced in `firestore.rules`, not by backend convention — there is a negative test proving an `admin`-claim token is denied on `users/A/entries/e1`.

## Roles live in custom claims

Not in a Firestore field. A document field is data; a custom claim is inside a signed token and cannot be forged.

```ts
// Authorization reads this and only this:
request.auth.token.role == 'admin'     // rules
req.user.role                          // backend, from verifyIdToken
```

A `role` field in `users/{uid}` is permitted **as a display mirror only** — so the UI can render a badge without a token round-trip. It is never read for an authorization decision. If you find code branching on `userDoc.role`, that is a bug.

## Granting a role

```ts
router.post('/users/:uid/role',
  requireAuth, requireAdmin,                          // server guards, both of them
  async (req, res) => {
    const { role } = RoleSchema.parse(req.body);      // enum, never a free string
    const target = req.params.uid;

    if (target === req.user.uid && role !== 'admin')  // don't let the last admin lock everyone out
      throw new AppError('CANNOT_DEMOTE_SELF', 400);

    await getAuth().setCustomUserClaims(target, { role });
    await getAuth().revokeRefreshTokens(target);      // make it take effect now, not in an hour
    await db.doc(`users/${target}`).update({ role }); // display mirror
    await writeAuditLog({ actorUid: req.user.uid,
                          action: role === 'admin' ? 'role.grant' : 'role.revoke',
                          targetUid: target });
    res.json({ data: { ok: true } });
  });
```

### The claim propagation trap

A changed custom claim does not reach an already-issued ID token. Without handling, a revoked admin keeps admin access for up to an hour — and you will discover this live, on stage, while demonstrating revocation.

Two measures, both required:

1. `verifyIdToken(token, /* checkRevoked */ true)` in `requireAuth`
2. `revokeRefreshTokens(uid)` immediately after `setCustomUserClaims`

Then tell the user in the UI: "Role changes take effect on the target's next token refresh; they have been signed out."

### Bootstrapping the first admin

Cannot come from the UI — nobody is an admin yet. Use a one-off local script (`scripts/grant-admin.ts`) run with local ADC credentials. **Do not ship this script in the container image.** After running it, sign out and back in so your own token carries the claim.

## Aggregates

Written server-side at entry-finalize time, atomically:

```ts
await db.doc(`aggregates/daily_${today}`).set({
  date: today,
  totalEntries: FieldValue.increment(1),
  moodDistribution: { [mood]: FieldValue.increment(1) },   // nested object — NOT a dotted key
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
```

Note the nested object. Inside `set(..., { merge: true })`, a dotted key like `"moodDistribution.joyful"` is treated as a **literal field name**, not a path — you get a top-level field with a dot in its name. Dotted paths only resolve in `update()`, which requires the document to already exist. The nested form is the one that composes correctly with `merge` and `increment`.

`aggregates/*` documents contain no uid, no email, no title, no text. If any identifying field appears there, the "admins cannot see content" guarantee is false.

**Small-sample suppression:** when a day has fewer than 5 active users, return `moodDistribution: null` with `suppressed: true`. A distribution over three people, combined with knowing who was active, reconstructs individuals. Render this as "insufficient sample" rather than an empty chart.

## Audit logging

Every `role.grant`, `role.revoke`, `admin.stats.view`, and `admin.users.list` writes to `audit_logs`. That collection is `allow read, write: if false` for all clients **including admins** — an audit log an admin can edit is not an audit log. Read it via backend queries or `gcloud firestore` only.

## Checklist

- [ ] Role from custom claim; no authorization branches on a document field
- [ ] `requireAuth` + `requireAdmin` on every privileged route (server-side, not just hidden UI)
- [ ] `checkRevoked` + `revokeRefreshTokens` so changes are immediate
- [ ] Self-demotion guarded
- [ ] Admin endpoints return zero content fields — verify by reading the response shape, not by trusting intent
- [ ] Negative rules test: admin token denied on another user's entries
- [ ] Aggregates de-identified; small samples suppressed
- [ ] Audit log written and client-unreadable
- [ ] Bootstrap script excluded from the image
