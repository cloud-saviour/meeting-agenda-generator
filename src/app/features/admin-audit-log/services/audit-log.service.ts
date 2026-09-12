import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { AuditLogEntry } from '../../../core/audit/audit-log.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'auditLog';
/** Most-recent-first cap — a small club's admin-grant activity will never come close to this; it exists purely to bound the read, not because older entries stop mattering. */
const MAX_ENTRIES = 200;

/**
 * Read-only view of the append-only auditLog collection — see
 * firestore.rules' `allow read: if isAdmin()`, true-claim only, so this is
 * only ever injected by AuditLogComponent (guarded by superAdminGuard).
 * Entries are written exclusively by AppAdminService.grant()/revoke(), in
 * the same writeBatch() as the appAdmins change itself — this service
 * never writes, only reads, so the trail can't drift out of sync with
 * itself from this side.
 */
@Injectable({ providedIn: 'root' })
export class AuditLogService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);

  private readonly log = signal<AuditLogEntry[]>([]);
  private readonly unsubscribe: () => void;

  readonly entries = computed(() => this.log());
  readonly ready = signal(false);

  constructor() {
    const q = query(collection(this.firestore, COLLECTION), orderBy('at', 'desc'), limit(MAX_ENTRIES));
    this.unsubscribe = onSnapshot(
      q,
      (snap) =>
        this.zone.run(() => {
          this.log.set(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditLogEntry));
          this.ready.set(true);
        }),
      (err) => this.zone.run(() => console.error('auditLog snapshot listener failed', err))
    );
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }
}
