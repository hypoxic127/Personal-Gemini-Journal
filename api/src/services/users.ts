import { db, FieldValue } from '../firebase.js';

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