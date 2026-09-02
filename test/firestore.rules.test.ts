import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules Matrix (Root Hardened Rules)', () => {
  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-rules-test',
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  // --- POSITIVE (AUTHORIZED) CASES ---
  it('POS-AUTH-01: User A can read own user doc', async () => {
    // Seed doc via Admin bypass
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA').set({ displayName: 'Alice' });
    });
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertSucceeds(userADb.doc('users/userA').get());
  });

  it('POS-ENT-01: User A can read own entries', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/entries/e1').set({ title: 'My Entry' });
    });
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertSucceeds(userADb.doc('users/userA/entries/e1').get());
  });

  it('POS-SES-01: User A can read own sessions & messages', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/sessions/s1').set({ title: 'Session 1' });
      await context.firestore().doc('users/userA/sessions/s1/messages/m1').set({ text: 'Hello' });
    });
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertSucceeds(userADb.doc('users/userA/sessions/s1').get());
    await assertSucceeds(userADb.doc('users/userA/sessions/s1/messages/m1').get());
  });

  it('POS-ADM-01: User holding custom claim role:admin can read aggregates', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('aggregates/daily_2026-09-01').set({ totalEntries: 10 });
    });
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertSucceeds(adminDb.doc('aggregates/daily_2026-09-01').get());
  });

  // --- NEGATIVE (UNAUTHORIZED / ATTACK) CASES ---
  it('NEG-AUTH-01: Unauthenticated read on user document is DENIED', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthDb.doc('users/userA').get());
  });

  it('NEG-AUTH-02: Unauthenticated write on user document is DENIED', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthDb.doc('users/userA').set({ role: 'admin' }));
  });

  it('NEG-ENT-02: Client write on own entries is DENIED (Backend Admin SDK writes only)', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(
      userADb.doc('users/userA/entries/entry1').set({
        title: 'Forged Title',
        summary: 'Forged Summary',
      })
    );
  });

  it('NEG-ENT-03: User B reading User A entries is DENIED', async () => {
    const userBDb = testEnv.authenticatedContext('userB').firestore();
    await assertFails(userBDb.doc('users/userA/entries/entry1').get());
  });

  it('NEG-ENT-04: User A attempting to self-elevate role in doc is DENIED', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(userADb.doc('users/userA').update({ role: 'admin' }));
  });

  it('NEG-ADM-01: Plain user reading aggregates is DENIED', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(userADb.doc('aggregates/daily_2026-09-01').get());
  });

  it('NEG-ADM-04: Admin-claim user reading User A entries is DENIED (Admin sees aggregates, not content)', async () => {
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(adminDb.doc('users/userA/entries/entry1').get());
  });

  it('NEG-ADM-05: Admin reading audit_logs is DENIED (Audit logs are backend-only)', async () => {
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(adminDb.doc('audit_logs/log1').get());
  });

  it('NEG-ADM-06: Random collection read/write is DENIED (Default Deny)', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(userADb.doc('random_collection/doc1').get());
  });
});