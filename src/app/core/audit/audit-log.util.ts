import { DocumentData, DocumentReference, Firestore, WithFieldValue, collection, doc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { AuditAction } from './audit-log.models';

const CLUBS_COLLECTION = 'clubs';
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
 * since their write rule already requires `isAppAdmin(clubId)` — the one
 * exception is `checkins/**`, which has no rules backstop at all
 * (`allow read, write: if true`), so those callers must check
 * `isAppAdmin(clubId)` themselves before calling this.
 *
 * Multi-club: `clubId` writes to `clubs/{clubId}/auditLog` — every current
 * call site has one, since every audited action happens inside a specific
 * club's own admin UI. `clubId` is optional only so a caller with
 * genuinely no club context (none exist today) doesn't need a dummy value;
 * omitting it falls back to the legacy flat top-level `auditLog`, which has
 * no rule allowing a client write in the new ruleset — passing `undefined`
 * here is a bug, not a supported "global audit entry" path.
 */
export function appendAuditEntry(
  firestore: Firestore,
  writer: AuditEntryWriter,
  action: AuditAction,
  summary: string,
  actor: User | null,
  clubId?: string
): void {
  const ref = clubId
    ? doc(collection(firestore, CLUBS_COLLECTION, clubId, COLLECTION))
    : doc(collection(firestore, COLLECTION));
  writer.set(ref, {
    action,
    actorUid: actor?.uid ?? '',
    actorEmail: actor?.email ?? '',
    at: new Date().toISOString(),
    summary,
  });
}
