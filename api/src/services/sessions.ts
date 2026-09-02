import { Timestamp, type Query, type DocumentSnapshot } from 'firebase-admin/firestore';
import {
  MAX_PAGE_SIZE,
  type EntryDoc,
  type GeminiFinalizeOutput,
  type LocationData,
  type MessageDoc,
  type Page,
  type SessionDoc,
} from '@journal/shared';
import { db, FieldValue } from '../firebase.js';
import { stripUndefined } from '../lib/sanitize.js';
import { AppError } from '../lib/errors.js';
import { logAuditEvent } from './audit.js';
import { recordEntryAggregate } from './aggregates.js';

/**
 * Every path in this file is built from the `uid` argument, which callers take from the
 * verified token and nowhere else. There is no function here that accepts a uid from a
 * request body, and no query that spans users: `users/{uid}/…` is the only shape.
 *
 * Client writes to these paths are denied outright by firestore.rules. This module — the
 * Admin SDK — is the only writer, which is what makes stripping server-authoritative fields
 * meaningful rather than decorative.
 */

const sessionsCol = (uid: string) => db.collection(`users/${uid}/sessions`);
const messagesCol = (uid: string, sessionId: string) =>
  db.collection(`users/${uid}/sessions/${sessionId}/messages`);
const entriesCol = (uid: string) => db.collection(`users/${uid}/entries`);

const toIso = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString() : new Date().toISOString();

const toSession = (id: string, data: FirebaseFirestore.DocumentData): SessionDoc => ({
  id,
  title: (data.title as string) || 'Untitled reflection',
  status: data.status === 'finalized' ? 'finalized' : 'active',
  messageCount: (data.messageCount as number) || 0,
  entryId: (data.entryId as string) || null,
  createdAt: toIso(data.createdAt),
  updatedAt: toIso(data.updatedAt),
});

const toMessage = (id: string, data: FirebaseFirestore.DocumentData): MessageDoc => ({
  id,
  role: data.role === 'model' ? 'model' : 'user',
  text: (data.text as string) || '',
  createdAt: toIso(data.createdAt),
});

const toEntry = (id: string, data: FirebaseFirestore.DocumentData): EntryDoc => ({
  id,
  sessionId: (data.sessionId as string) || '',
  title: (data.title as string) || '',
  summary: (data.summary as string) || '',
  mood: data.mood,
  moodScore: (data.moodScore as number) ?? 0,
  moodReason: (data.moodReason as string) || '',
  tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
  location: (data.location as EntryDoc['location']) ?? null,
  createdAt: toIso(data.createdAt),
  updatedAt: toIso(data.updatedAt),
});

/**
 * Cursor pagination. The cursor is a document id under the caller's own subtree — resolved
 * with `.doc(id)` on that collection, so a forged cursor cannot address anything outside it.
 * Every query is bounded; there is no unlimited read path in this module.
 */
async function paginate<T>(
  query: Query,
  collection: FirebaseFirestore.CollectionReference,
  limit: number,
  cursor: string | undefined,
  map: (id: string, data: FirebaseFirestore.DocumentData) => T
): Promise<Page<T>> {
  const capped = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
  let q = query.limit(capped + 1);

  if (cursor) {
    const cursorSnap: DocumentSnapshot = await collection.doc(cursor).get();
    if (cursorSnap.exists) q = q.startAfter(cursorSnap);
  }

  const snap = await q.get();
  const docs = snap.docs.slice(0, capped);

  return {
    items: docs.map((doc) => map(doc.id, doc.data())),
    nextCursor: snap.docs.length > capped ? (docs[docs.length - 1]?.id ?? null) : null,
  };
}

// --------------------------------------------------------------------------------------
// Sessions
// --------------------------------------------------------------------------------------

const deriveTitle = (text: string): string => {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const clipped = firstLine.slice(0, 40);
  return clipped.length > 0 ? `${clipped}${firstLine.length > 40 ? '…' : ''}` : 'Untitled reflection';
};

export async function createSession(uid: string, initialMessage?: string): Promise<SessionDoc> {
  const ref = sessionsCol(uid).doc();
  const now = new Date().toISOString();

  // Note what is NOT here: nothing from the request body other than validated text. `status`,
  // `messageCount`, `entryId` and both timestamps are server-authoritative by construction.
  await ref.set(
    stripUndefined({
      title: initialMessage ? deriveTitle(initialMessage) : 'New reflection',
      status: 'active',
      messageCount: 0,
      entryId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  );

  return {
    id: ref.id,
    title: initialMessage ? deriveTitle(initialMessage) : 'New reflection',
    status: 'active',
    messageCount: 0,
    entryId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSession(uid: string, sessionId: string): Promise<SessionDoc | null> {
  const snap = await sessionsCol(uid).doc(sessionId).get();
  if (!snap.exists) return null;
  return toSession(snap.id, snap.data() ?? {});
}

export async function listSessions(
  uid: string,
  opts: { limit: number; cursor?: string }
): Promise<Page<SessionDoc>> {
  return paginate(
    sessionsCol(uid).orderBy('updatedAt', 'desc'),
    sessionsCol(uid),
    opts.limit,
    opts.cursor,
    toSession
  );
}

/** Deletes the session, its messages, and the entry it produced. Own data only. */
export async function deleteSession(uid: string, sessionId: string): Promise<void> {
  const sessionRef = sessionsCol(uid).doc(sessionId);
  const snap = await sessionRef.get();
  if (!snap.exists) return;

  const entryId = snap.data()?.entryId as string | undefined;

  // Bounded batches: a runaway conversation must not turn a delete into an unbounded write.
  for (;;) {
    const batchSnap = await messagesCol(uid, sessionId).limit(200).get();
    if (batchSnap.empty) break;
    const batch = db.batch();
    batchSnap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (batchSnap.size < 200) break;
  }

  const batch = db.batch();
  batch.delete(sessionRef);
  if (entryId) {
    batch.delete(entriesCol(uid).doc(entryId));
    batch.update(db.doc(`users/${uid}`), { entryCount: FieldValue.increment(-1) });
  }
  await batch.commit();
}

// --------------------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------------------

async function appendMessage(
  uid: string,
  sessionId: string,
  role: 'user' | 'model',
  text: string,
  model?: string,
  titleFromText = false
): Promise<MessageDoc> {
  const ref = messagesCol(uid, sessionId).doc();

  // `role` is set here, from the caller's own code path — never from the request. A client
  // that could label its own turn `model` could fabricate an assistant reply in its history.
  await ref.set(
    stripUndefined({
      role,
      text,
      model,
      createdAt: FieldValue.serverTimestamp(),
    })
  );

  // The first user message names the reflection, in the same write that counts it — a
  // sidebar full of "New reflection" is a sidebar nobody can navigate.
  await sessionsCol(uid).doc(sessionId).update(
    stripUndefined({
      messageCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      title: titleFromText ? deriveTitle(text) : undefined,
    })
  );

  return { id: ref.id, role, text, createdAt: new Date().toISOString() };
}

export const appendUserMessage = (
  uid: string,
  sessionId: string,
  text: string,
  opts: { titleFromText?: boolean } = {}
) => appendMessage(uid, sessionId, 'user', text, undefined, opts.titleFromText ?? false);

export const appendModelMessage = (uid: string, sessionId: string, text: string, model: string) =>
  appendMessage(uid, sessionId, 'model', text, model);

export async function listMessages(
  uid: string,
  sessionId: string,
  opts: { limit: number; cursor?: string }
): Promise<Page<MessageDoc>> {
  return paginate(
    messagesCol(uid, sessionId).orderBy('createdAt', 'asc'),
    messagesCol(uid, sessionId),
    opts.limit,
    opts.cursor,
    toMessage
  );
}

/**
 * The last N turns, oldest first. Hard-capped: history length drives both prompt cost and
 * latency, and an unbounded conversation is a bill that grows with every message.
 */
export async function recentHistory(
  uid: string,
  sessionId: string,
  maxTurns: number
): Promise<Array<{ role: 'user' | 'model'; text: string }>> {
  const snap = await messagesCol(uid, sessionId)
    .orderBy('createdAt', 'desc')
    .limit(maxTurns)
    .get();

  return snap.docs
    .map((doc) => toMessage(doc.id, doc.data()))
    .reverse()
    .map((message) => ({ role: message.role, text: message.text }));
}

// --------------------------------------------------------------------------------------
// Finalize
// --------------------------------------------------------------------------------------

/**
 * One transaction for the entry, the session's new state, and the user's entry count.
 * Either the reflection became a durable record or it did not — a summary the user can see
 * but that is gone after a refresh is worse than an honest failure.
 */
export async function finalizeSession(
  uid: string,
  sessionId: string,
  draft: GeminiFinalizeOutput,
  model: string,
  location: LocationData | null = null
): Promise<EntryDoc> {
  const sessionRef = sessionsCol(uid).doc(sessionId);
  const entryRef = entriesCol(uid).doc();
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new AppError(404, 'NOT_FOUND', 'Reflection not found.');
    }
    if (sessionSnap.data()?.status === 'finalized') {
      throw new AppError(409, 'ALREADY_FINALIZED', 'This reflection has already been saved.');
    }

    tx.set(
      entryRef,
      stripUndefined({
        sessionId,
        title: draft.title,
        summary: draft.summary,
        mood: draft.mood,
        moodScore: draft.moodScore,
        moodReason: draft.moodReason,
        tags: draft.tags,
        location: location ?? null,
        model,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    );

    tx.update(sessionRef, {
      status: 'finalized',
      entryId: entryRef.id,
      title: draft.title,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(userRef, { entryCount: FieldValue.increment(1) }, { merge: true });
  });

  // Record atomic population statistics (non-blocking for session finalization response)
  try {
    await recordEntryAggregate(draft.mood);
  } catch (aggErr) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'AGGREGATE_RECORD_WARNING',
        errorMessage: (aggErr as any)?.message,
      })
    );
  }

  const now = new Date().toISOString();
  return {
    id: entryRef.id,
    sessionId,
    ...draft,
    location: location ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Bulk clear all location data across historical entries belonging to the user.
 * Performs bounded batched updates and logs an immutable audit event.
 */
export async function clearUserLocations(uid: string): Promise<number> {
  const entriesRef = entriesCol(uid);
  const snapshot = await entriesRef.get();

  if (snapshot.empty) {
    await logAuditEvent({
      actorUid: uid,
      action: 'LOCATION_BULK_CLEAR',
      targetUid: uid,
      meta: { clearedCount: 0 },
    });
    return 0;
  }

  const docsToUpdate = snapshot.docs.filter((doc) => {
    const loc = doc.data().location;
    return loc !== null && loc !== undefined;
  });

  const BATCH_SIZE = 500;
  let clearedCount = 0;

  for (let i = 0; i < docsToUpdate.length; i += BATCH_SIZE) {
    const chunk = docsToUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.update(doc.ref, {
        location: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      clearedCount++;
    }
    await batch.commit();
  }

  await logAuditEvent({
    actorUid: uid,
    action: 'LOCATION_BULK_CLEAR',
    targetUid: uid,
    meta: { clearedCount },
  });

  return clearedCount;
}

// --------------------------------------------------------------------------------------
// Entries
// --------------------------------------------------------------------------------------

export async function listEntries(
  uid: string,
  opts: { limit: number; cursor?: string }
): Promise<Page<EntryDoc>> {
  return paginate(
    entriesCol(uid).orderBy('createdAt', 'desc'),
    entriesCol(uid),
    opts.limit,
    opts.cursor,
    toEntry
  );
}

export async function getEntry(uid: string, entryId: string): Promise<EntryDoc | null> {
  const snap = await entriesCol(uid).doc(entryId).get();
  if (!snap.exists) return null;
  return toEntry(snap.id, snap.data() ?? {});
}
