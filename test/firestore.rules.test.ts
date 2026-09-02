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

// Must match firebase.json → emulators.firestore.port. Deliberately NOT 8080: the API dev
// server owns that port, and a rules suite that quietly connects to Express instead of the
// emulator either fails for the wrong reason or passes without testing anything.
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
const [emulatorHost, emulatorPort] = EMULATOR_HOST.split(':');

describe('Firestore Security Rules Matrix (Root Hardened Rules)', () => {
  beforeAll(async () => {
    const rulesPath = path.resolve(__dirname, '../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-rules-test',
      firestore: {
        rules,
        host: emulatorHost,
        port: parseInt(emulatorPort, 10),
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

  // =========================================================================
  // --- POSITIVE (AUTHORIZED) CASES ---
  // =========================================================================

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

  // `get` and `list` are separate operations in Firestore. A suite that only asserts on
  // doc().get() proves nothing about whether a collection can be enumerated, which is the
  // shape a real cross-user probe takes: read the whole collection and see what comes back.
  it('POS-ENT-02: User A can LIST own entries collection', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/entries/e1').set({ title: 'My Entry' });
      await context.firestore().doc('users/userA/entries/e2').set({ title: 'Second Entry' });
    });
    const userADb = testEnv.authenticatedContext('userA').firestore();
    const snap = await assertSucceeds(userADb.collection('users/userA/entries').get());
    expect(snap.size).toBe(2);
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

  it('POS-ADM-01: Admin attempting to read /aggregates/daily_2026-09-02 is ALLOWED', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('aggregates/daily_2026-09-02').set({ totalEntries: 10, activeUsers: 5 });
    });
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertSucceeds(adminDb.doc('aggregates/daily_2026-09-02').get());
  });

  // =========================================================================
  // --- NEGATIVE (UNAUTHORIZED / ATTACK) CASES ---
  // =========================================================================

  it('NEG-AUTH-01: Unauthenticated read on user document is DENIED', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthDb.doc('users/userA').get());
  });

  it('NEG-AUTH-02: Unauthenticated write on user document is DENIED', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthDb.doc('users/userA').set({ role: 'admin' }));
  });

  it('NEG-ENT-01: User B LISTING User A entries collection is DENIED', async () => {
    // Seeded with real documents so the query has something to return if the rule leaks —
    // an empty collection would pass this test even against a broken rule.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/entries/e1').set({ title: 'Private Entry' });
      await context.firestore().doc('users/userA/entries/e2').set({ title: 'Private Entry 2' });
    });
    const userBDb = testEnv.authenticatedContext('userB').firestore();
    await assertFails(userBDb.collection('users/userA/entries').get());
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

  it('NEG-ENT-05: User B writing User A entry is DENIED', async () => {
    const userBDb = testEnv.authenticatedContext('userB').firestore();
    await assertFails(
      userBDb.doc('users/userA/entries/e1').set({ title: 'Injected', moodScore: 5 })
    );
  });

  it('NEG-SES-02: User B LISTING User A sessions and messages is DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/sessions/s1').set({ title: 'Session 1' });
      await context.firestore().doc('users/userA/sessions/s1/messages/m1').set({ text: 'Private' });
    });
    const userBDb = testEnv.authenticatedContext('userB').firestore();
    await assertFails(userBDb.collection('users/userA/sessions').get());
    await assertFails(userBDb.collection('users/userA/sessions/s1/messages').get());
  });

  it('NEG-SES-03: User A client-writing own session is DENIED (backend Admin SDK writes only)', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(
      userADb.doc('users/userA/sessions/s1').set({ title: 'Forged', status: 'active' })
    );
  });

  it('NEG-SES-04: User A client-writing own message is DENIED', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(
      userADb.doc('users/userA/sessions/s1/messages/m1').set({ role: 'model', text: 'Forged reply' })
    );
  });

  it('NEG-SES-05: User B writing into User A session and messages is DENIED', async () => {
    const userBDb = testEnv.authenticatedContext('userB').firestore();
    await assertFails(userBDb.doc('users/userA/sessions/s1').set({ title: 'Injected' }));
    await assertFails(
      userBDb.doc('users/userA/sessions/s1/messages/m1').set({ role: 'user', text: 'Injected' })
    );
  });

  it('NEG-USR-01: Any signed-in user LISTING the users collection is DENIED (no uid enumeration)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA').set({ displayName: 'Alice' });
      await context.firestore().doc('users/userB').set({ displayName: 'Bob' });
    });
    const userBDb = testEnv.authenticatedContext('userB').firestore();
    await assertFails(userBDb.collection('users').get());
  });

  // =========================================================================
  // --- MILESTONE 5: RBAC & ADMIN ISOLATION ATTACK CASES ---
  // =========================================================================

  it('NEG-ADM-01: Plain user attempting to read /aggregates/daily_2026-09-02 is DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('aggregates/daily_2026-09-02').set({ totalEntries: 5 });
    });
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(userADb.doc('aggregates/daily_2026-09-02').get());
  });

  it('NEG-ADM-02: Plain user attempting to write /aggregates/daily_2026-09-02 is DENIED', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(
      userADb.doc('aggregates/daily_2026-09-02').set({ totalEntries: 999 })
    );
  });

  it('NEG-ADM-03: Admin attempting to write /aggregates/daily_2026-09-02 is DENIED (client writes forbidden)', async () => {
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(
      adminDb.doc('aggregates/daily_2026-09-02').set({ totalEntries: 999 })
    );
  });

  it('NEG-ADM-04: Admin attempting to read users/{userA}/entries/{entryId} is DENIED (Admin NEVER sees content)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/entries/e1').set({
        title: 'Secret Diary Entry',
        summary: 'Deep personal thoughts',
      });
    });
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(adminDb.doc('users/userA/entries/e1').get());
  });

  it('NEG-ADM-05: Admin attempting to read or write audit_logs/{logId} is DENIED (Client access forbidden)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('audit_logs/log1').set({ action: 'role.grant', actorUid: 'adminUser' });
    });
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(adminDb.doc('audit_logs/log1').get());
    await assertFails(adminDb.doc('audit_logs/log1').set({ action: 'tampered' }));
    await assertFails(adminDb.collection('audit_logs').get());
  });

  it('NEG-ADM-06: Plain user attempting to read or write audit_logs/{logId} is DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('audit_logs/log1').set({ action: 'role.grant', actorUid: 'adminUser' });
    });
    const userADb = testEnv.authenticatedContext('userA').firestore();
    await assertFails(userADb.doc('audit_logs/log1').get());
    await assertFails(userADb.doc('audit_logs/log1').set({ action: 'tampered' }));
    await assertFails(userADb.collection('audit_logs').get());
  });

  it('NEG-ADM-07: Admin attempting to list users/{userA}/entries is DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/entries/e1').set({ summary: 'Private summary' });
      await context.firestore().doc('users/userA/entries/e2').set({ summary: 'Private summary 2' });
    });
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(adminDb.collection('users/userA/entries').get());
  });

  it('NEG-ADM-08: Admin attempting to read users/{userA}/sessions/{sessionId}/messages/{messageId} is DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/sessions/s1/messages/m1').set({
        text: 'Private conversation with model',
        role: 'user',
      });
    });
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(adminDb.doc('users/userA/sessions/s1/messages/m1').get());
  });

  it('NEG-ADM-09: Admin attempting to list users/{userA}/sessions is DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/userA/sessions/s1').set({ title: 'Private Session 1' });
      await context.firestore().doc('users/userA/sessions/s2').set({ title: 'Private Session 2' });
    });
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    await assertFails(adminDb.collection('users/userA/sessions').get());
  });

  // =========================================================================
  // --- DEFAULT DENY CATCH-ALL ---
  // =========================================================================

  it('NEG-DFLT-01: Admin/Plain user accessing unlisted collection unlisted_collection/doc1 is DENIED by default catch-all', async () => {
    const userADb = testEnv.authenticatedContext('userA').firestore();
    const adminDb = testEnv.authenticatedContext('adminUser', { role: 'admin' }).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(userADb.doc('unlisted_collection/doc1').get());
    await assertFails(userADb.doc('unlisted_collection/doc1').set({ data: 'attack' }));
    await assertFails(adminDb.doc('unlisted_collection/doc1').get());
    await assertFails(adminDb.doc('unlisted_collection/doc1').set({ data: 'attack' }));
    await assertFails(unauthDb.doc('unlisted_collection/doc1').get());
    await assertFails(unauthDb.doc('unlisted_collection/doc1').set({ data: 'attack' }));
  });
});