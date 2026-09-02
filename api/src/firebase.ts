import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { env } from './config.js';

let app: App;
if (getApps().length === 0) {
  // Initialized via Application Default Credentials (ADC), never a hardcoded service account JSON.
  app = initializeApp({
    projectId: env.GCP_PROJECT_ID,
  });
} else {
  app = getApps()[0]!;
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export { FieldValue, Timestamp };