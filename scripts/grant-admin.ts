#!/usr/bin/env npx tsx
/**
 * scripts/grant-admin.ts
 *
 * Standalone operational CLI tool to bootstrap the first administrator using
 * Application Default Credentials (ADC).
 *
 * Precedence:
 * - Admin privilege is granted ONLY via Firebase Custom Claims (`{ role: 'admin' }`).
 * - Stored in Firebase Auth custom user claims and signed inside ID tokens.
 * - Calls `revokeRefreshTokens(uid)` immediately to enforce token re-issue.
 * - Updates `users/{uid}.role` as a display mirror.
 * - Excluded from production Docker images via .dockerignore.
 *
 * Usage:
 *   npx tsx scripts/grant-admin.ts <uid>
 *   npx tsx scripts/grant-admin.ts --uid <uid>
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../api/.env') });

import { auth, db, FieldValue } from '../api/src/firebase.js';

async function grantAdmin(uid: string): Promise<void> {
  if (!uid || typeof uid !== 'string' || uid.trim().length === 0) {
    console.error('Error: UID is required.');
    console.error('Usage: npx tsx scripts/grant-admin.ts <uid>');
    process.exit(1);
  }

  const cleanUid = uid.trim();
  console.log(`[Grant-Admin] Bootstrapping admin role for UID: ${cleanUid}`);

  try {
    // 1. Verify user exists in Firebase Auth
    const userRecord = await auth.getUser(cleanUid);
    console.log(`[Grant-Admin] Found user: ${userRecord.email || userRecord.uid}`);

    // 2. Assign custom user claim { role: 'admin' }
    await auth.setCustomUserClaims(cleanUid, {
      ...(userRecord.customClaims || {}),
      role: 'admin',
    });
    console.log('[Grant-Admin] Successfully set custom claim { role: "admin" }');

    // 3. Immediately revoke refresh tokens so user must re-authenticate to acquire new claim
    await auth.revokeRefreshTokens(cleanUid);
    console.log('[Grant-Admin] Revoked active refresh tokens for immediate claim propagation.');

    // 4. Update Firestore user doc display mirror
    const userRef = db.doc(`users/${cleanUid}`);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      await userRef.update({
        role: 'admin',
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await userRef.set(
        {
          role: 'admin',
          email: userRecord.email || null,
          displayName: userRecord.displayName || null,
          photoURL: userRecord.photoURL || null,
          createdAt: FieldValue.serverTimestamp(),
          lastActiveAt: FieldValue.serverTimestamp(),
          entryCount: 0,
        },
        { merge: true }
      );
    }
    console.log('[Grant-Admin] Updated Firestore display mirror at users/' + cleanUid);

    // 5. Append audit log entry
    await db.collection('audit_logs').add({
      actorUid: 'cli:grant-admin',
      action: 'role.grant',
      targetUid: cleanUid,
      at: FieldValue.serverTimestamp(),
      meta: { source: 'scripts/grant-admin.ts', method: 'ADC_CLI' },
    });
    console.log('[Grant-Admin] Appended audit log record.');

    console.log('\n SUCCESS: Admin role granted.');
    console.log(' IMPORTANT: The user must sign out and sign back in to receive the updated token claims.\n');
  } catch (error: any) {
    console.error('[Grant-Admin] Failed to grant admin role:', error.message || error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let targetUid = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--uid' && args[i + 1]) {
    targetUid = args[i + 1];
    break;
  } else if (!args[i].startsWith('--')) {
    targetUid = args[i];
    break;
  }
}

if (!targetUid) {
  console.error('Error: Please provide target UID.');
  console.error('Usage: npx tsx scripts/grant-admin.ts <uid>');
  process.exit(1);
}

grantAdmin(targetUid);
