import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { generateChatReply } from '../src/services/gemini.js';

async function main() {
  try {
    const res = await generateChatReply({
      history: [],
      userText: 'I led a complex production database migration today. It was stressful but successful, though I feel mentally exhausted.',
      correlationId: 'test-direct-chat',
    });
    console.log('Chat Reply succeeded:', res);
  } catch (err: any) {
    console.error('Chat Reply failed with full error:', err);
    if (err.cause) {
      console.error('Cause:', err.cause);
    }
  }
}

main();
