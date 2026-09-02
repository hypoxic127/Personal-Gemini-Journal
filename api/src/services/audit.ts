import { db, FieldValue } from '../firebase.js';
import { stripUndefined } from '../lib/sanitize.js';

export interface AuditLogPayload {
  actorUid: string;
  action: 'LOCATION_BULK_CLEAR' | 'ROLE_CHANGE' | 'SESSION_PURGE' | 'ADMIN_ACCESS' | string;
  targetUid: string;
  meta?: Record<string, unknown>;
}

/**
 * Appends an immutable audit event to the `audit_logs` collection via Admin SDK.
 * Client read/write access to this collection is denied by firestore.rules.
 */
export async function logAuditEvent(payload: AuditLogPayload): Promise<string> {
  const ref = db.collection('audit_logs').doc();
  await ref.set(
    stripUndefined({
      actorUid: payload.actorUid,
      action: payload.action,
      targetUid: payload.targetUid,
      at: FieldValue.serverTimestamp(),
      meta: payload.meta ?? {},
    })
  );
  return ref.id;
}
