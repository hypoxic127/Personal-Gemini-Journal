import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { auth, db } from '../src/firebase.js';

async function main() {
  console.log('Testing ADC and Firebase project:', process.env.GCP_PROJECT_ID);
  const uid = 'test_token_user_' + Date.now();
  const customToken = await auth.createCustomToken(uid);
  console.log('Custom token generated successfully. Length:', customToken.length);

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await res.json();
  if (data.idToken) {
    console.log('Successfully acquired real Firebase ID Token via signInWithCustomToken!');
    const decoded = await auth.verifyIdToken(data.idToken, true);
    console.log('Decoded verified token UID:', decoded.uid);
  } else {
    console.log('Exchange response error:', res.status, data);
  }
}

main().catch((err) => {
  console.error('Error in test-token:', err);
  process.exit(1);
});
