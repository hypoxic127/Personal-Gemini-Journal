import { db, FieldValue } from '../firebase.js';
import type { AdminUserSummary } from '@journal/shared';

export interface EnsureUserInput {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string | null;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  lastActiveAt: string;
  entryCount: number;
}

export const ensureUserDoc = async (input: EnsureUserInput): Promise<UserProfile> => {
  const userRef = db.doc(`users/${input.uid}`);
  const snap = await userRef.get();

  if (!snap.exists) {
    const newUserData = {
      email: input.email || null,
      displayName: input.displayName || null,
      photoURL: input.photoURL || null,
      role: 'user', // Display mirror only; authorization always keys on verified token custom claims
      createdAt: FieldValue.serverTimestamp(),
      lastActiveAt: FieldValue.serverTimestamp(),
      entryCount: 0,
    };

    await userRef.set(newUserData);

    return {
      uid: input.uid,
      email: input.email || null,
      displayName: input.displayName || null,
      photoURL: input.photoURL || null,
      role: 'user',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      entryCount: 0,
    };
  }

  // If already exists, update lastActiveAt
  await userRef.update({
    lastActiveAt: FieldValue.serverTimestamp(),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.photoURL !== undefined ? { photoURL: input.photoURL } : {}),
  });

  const data = snap.data() || {};
  return {
    uid: input.uid,
    email: (data.email as string) || input.email || null,
    displayName: (data.displayName as string) || input.displayName || null,
    photoURL: (data.photoURL as string) || input.photoURL || null,
    role: (data.role as 'user' | 'admin') || 'user',
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    entryCount: (data.entryCount as number) || 0,
  };
};

export const getUserDoc = async (uid: string): Promise<UserProfile | null> => {
  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  return {
    uid,
    email: (data.email as string) || null,
    displayName: (data.displayName as string) || null,
    photoURL: (data.photoURL as string) || null,
    role: (data.role as 'user' | 'admin') || 'user',
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    lastActiveAt: data.lastActiveAt?.toDate ? data.lastActiveAt.toDate().toISOString() : new Date().toISOString(),
    entryCount: (data.entryCount as number) || 0,
  };
};

export interface ListUsersOptions {
  limit?: number;
  cursor?: string;
}

export const listUsers = async (
  opts: ListUsersOptions = {}
): Promise<{ items: AdminUserSummary[]; nextCursor: string | null }> => {
  const limit = Math.min(Math.max(1, opts.limit || 20), 50);
  let query = db.collection('users').orderBy('createdAt', 'desc').limit(limit + 1);

  if (opts.cursor) {
    const cursorDoc = await db.doc(`users/${opts.cursor}`).get();
    if (cursorDoc.exists) {
      query = (query as any).startAfter(cursorDoc);
    }
  }

  const snap = await query.get();
  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;

  const items: AdminUserSummary[] = pageDocs.map((doc) => {
    const data = doc.data() || {};
    let createdAt = new Date().toISOString();
    if (data.createdAt?.toDate) {
      createdAt = data.createdAt.toDate().toISOString();
    } else if (typeof data.createdAt === 'string') {
      createdAt = data.createdAt;
    }

    let lastActiveAt: string | null = null;
    if (data.lastActiveAt?.toDate) {
      lastActiveAt = data.lastActiveAt.toDate().toISOString();
    } else if (typeof data.lastActiveAt === 'string') {
      lastActiveAt = data.lastActiveAt;
    }

    return {
      uid: doc.id,
      role: data.role === 'admin' ? 'admin' : 'user',
      createdAt,
      lastActiveAt,
      entryCount:
        typeof data.entryCount === 'number' && Number.isFinite(data.entryCount)
          ? Math.max(0, Math.floor(data.entryCount))
          : 0,
    };
  });

  const nextCursor = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;

  return {
    items,
    nextCursor,
  };
};

export const updateUserRole = async (uid: string, role: 'user' | 'admin'): Promise<void> => {
  const userRef = db.doc(`users/${uid}`);
  await userRef.set(
    {
      role,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
};