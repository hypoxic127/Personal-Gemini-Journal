import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db, FieldValue } from '../src/firebase.js';
import { generateChatReply, generateEntryDraft } from '../src/services/gemini.js';

async function main() {
  console.log('--- 1. Testing Live Firestore Connectivity ---');
  const testUid = 'connectivity_test_' + Date.now();
  const docRef = db.doc(`users/${testUid}`);
  await docRef.set({
    uid: testUid,
    test: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  const snap = await docRef.get();
  console.log('Firestore Live Read successfully:', snap.exists, snap.data());
  await docRef.delete();
  console.log('Firestore document cleaned up.');

  console.log('\n--- 2. Testing Live Gemini 3.6 Flash Chat Generation ---');
  const chatReply = await generateChatReply({
    history: [],
    userText: 'Hello Gemini! I am testing live E2E connectivity for my journal reflection app.',
    correlationId: 'test-conn-' + Date.now(),
  });
  console.log('Gemini Live Model:', chatReply.model);
  console.log('Gemini Live Reply:', chatReply.text);

  console.log('\n--- 3. Testing Live Gemini 3.6 Flash Finalization Draft ---');
  const entryDraft = await generateEntryDraft({
    turns: [
      { role: 'user', text: 'I completed my engineering goals today and felt really proud.' },
      { role: 'model', text: 'That is great! What made you feel most fulfilled?' },
      { role: 'user', text: 'Solving the complex caching bug that had been bothering the team for weeks.' },
    ],
    correlationId: 'test-draft-' + Date.now(),
  });
  console.log('Gemini Finalize Model:', entryDraft.model);
  console.log('Gemini Draft Title:', entryDraft.draft.title);
  console.log('Gemini Draft Mood:', entryDraft.draft.mood);
  console.log('Gemini Draft Score:', entryDraft.draft.moodScore);
  console.log('Gemini Draft Reason:', entryDraft.draft.moodReason);
  console.log('Gemini Draft Tags:', entryDraft.draft.tags);
}

main().catch((err) => {
  console.error('Connectivity test error:', err);
  process.exit(1);
});
