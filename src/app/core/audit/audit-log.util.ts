import { DocumentData, DocumentReference, Firestore, WithFieldValue, collection, doc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { AuditAction } from './audit-log.models';

const COLLECTION = 'auditLog';

/**
 * `WriteBatch.set()` and `Transaction.set()` are each overloaded (a plain
 * write vs. one with `SetOptions`), and TypeScript can't resolve a call
 * through a `WriteBatch | Transaction` union of two independently-overloaded
 * methods. This narrower structural type has exactly the one signature this
 * file needs — both `WriteBatch` and `Transaction` satisfy it, so either can
 * still be passed in without a cast at the call site.
 */
interface AuditEntryWriter {
  set(ref: DocumentReference<DocumentData>, data: WithFieldValue<DocumentData>): unknown;
}

/**
 * Appends one audit entry to `writer` — never call this outside a
 * `writeBatch()`/`runTransaction()` that also contains the actual change
 * being audited, or the trail can drift out of sync with reality (both
 * writes commit together, or neither does). `writer` accepts either a
 * `WriteBatch` (every existing caller — a simple merge-write on a
 * non-competing document) or a `Transaction` (CheckinStateService's admin
 * correction/removal methods, which must read-decide-write the whole
 * `checkins/{meetingId}` document transactionally, since it's a single
 * document other calls compete to mutate) — `Transaction.set()` and
 * `WriteBatch.set()` share the same call shape, so one function serves both.
 * `actor` is normally `AuthService.currentUser()` at the call site;
 * `uid`/`email` fall back to `''` if somehow null. For most audited
 * collections an unauthenticated caller could never reach here anyway,
 * since their write rule already requires `isAppAdmin()` — the one
 * exception is `checkins/**`, which has no rules backstop at all
 * (`allow read, write: if true`), so those callers must check
 * `isAppAdmin()` themselves before calling this.
 */
export function appendAuditEntry(
  firestore: Firestore,
  writer: AuditEntryWriter,
  action: AuditAction,
  summary: string,
  actor: User | null
): void {
  writer.set(doc(collection(firestore, COLLECTION)), {
    action,
    actorUid: actor?.uid ?? '',
    actorEmail: actor?.email ?? '',
    at: new Date().toISOString(),
    summary,
  });
}
