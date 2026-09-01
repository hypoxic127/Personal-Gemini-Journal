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

describe('Firestore Security Rules Matrix', () => {
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

  it('NEG-AUTH-01: Unauthenticated read on user document is DENIED', async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthDb.doc('users/userA').get());
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