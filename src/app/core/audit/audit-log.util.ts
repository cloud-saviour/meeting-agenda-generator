import { Firestore, WriteBatch, collection, doc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { AuditAction } from './audit-log.models';

const COLLECTION = 'auditLog';

/**
 * Appends one audit entry to `batch` — never call this outside a
 * `writeBatch()` that also contains the actual change being audited, or
 * the trail can drift out of sync with reality (a batch either commits
 * both writes or neither). `actor` is normally `AuthService.currentUser()`
 * at the call site; `uid`/`email` fall back to `''` if somehow null (an
 * unauthenticated caller could never reach here anyway, since every
 * audited collection's write rule already requires isAppAdmin()).
 */
export function appendAuditEntry(
  firestore: Firestore,
  batch: WriteBatch,
  action: AuditAction,
  summary: string,
  actor: User | null
): void {
  batch.set(doc(collection(firestore, COLLECTION)), {
    action,
    actorUid: actor?.uid ?? '',
    actorEmail: actor?.email ?? '',
    at: new Date().toISOString(),
    summary,
  });
}
