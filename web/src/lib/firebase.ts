import { initializeApp, getApps, getApp, FirebaseApp, FirebaseOptions } from 'firebase/app';
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

  // The Firebase Web config is a public identifier, not a credential — but it is still
  // fetched at runtime rather than inlined at build time, so the same container image can
  // serve any project and no key-shaped string is ever baked into the bundle.
  let config: FirebaseOptions = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  // If not present in build env, fetch at runtime from backend. This is the path the
  // deployed build always takes.
  if (!config.apiKey || !config.projectId) {
    const res = await fetch('/api/config/public');
    if (!res.ok) {
      throw new Error(`Runtime configuration unavailable (${res.status})`);
    }
    const json = await res.json();
    if (!json?.data?.firebase?.apiKey || !json?.data?.firebase?.projectId) {
      throw new Error('Runtime configuration is incomplete');
    }
    config = json.data.firebase as FirebaseOptions;
  }

  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  return { app, auth, db };
}

export { app, auth, db, googleProvider };