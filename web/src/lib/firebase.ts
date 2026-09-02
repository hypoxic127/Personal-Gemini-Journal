import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const getFirebaseServices = () => {
  if (!auth) {
    if (getApps().length > 0) {
      app = getApp();
      auth = getAuth(app);
      db = getFirestore(app);
    }
  }
  return { app, auth, db, googleProvider };
};

export async function initFirebaseClient(): Promise<{ app: FirebaseApp; auth: Auth; db: Firestore }> {
  if (getApps().length > 0) {
    app = getApp();
    auth = getAuth(app);
    db = getFirestore(app);
    return { app, auth, db };
  }

  let config: any = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  // If not present in build env, fetch at runtime from backend
  if (!config.apiKey || !config.projectId) {
    try {
      const res = await fetch('/api/config/public');
      if (res.ok) {
        const json = await res.json();
        if (json?.data?.firebase) {
          config = json.data.firebase;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch runtime Firebase config:', e);
    }
  }

  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  return { app, auth, db };
}

export { app, auth, db, googleProvider };