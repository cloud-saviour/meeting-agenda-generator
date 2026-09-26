import { Injectable, NgZone, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { AuditLogEntry } from '../../../core/audit/audit-log.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { ClubContextService } from '../../../core/club/club-context.service';

const CLUBS_COLLECTION = 'clubs';
const COLLECTION = 'auditLog';
/** Most-recent-first cap — a small club's admin-grant activity will never come close to this; it exists purely to bound the read, not because older entries stop mattering. */
const MAX_ENTRIES = 200;

/**
 * Read-only view of the append-only `clubs/{clubId}/auditLog` collection —
 * see firestore.rules' `allow read: if isAdmin()`, true-claim only, so this
 * is only ever injected by AuditLogComponent (guarded by superAdminGuard).
 * The GUARD stays global/real-claim-only, deliberately not club-aware (see
 * AuthService's class doc) — but the log CONTENT read here is still
 * per-club, since the route this lives on is nested under `c/:clubSlug`: a
 * true admin sees one club's trail at a time, by visiting that club's own
 * /c/<slug>/admin/audit-log, not a cross-club merged view.
 *
 * Entries are written exclusively by AppAdminService.grant()/revoke() (and
 * every other audited mutator), in the same writeBatch()/transaction as the
 * change itself — this service never writes, only reads, so the trail
 * can't drift out of sync with itself from this side.
 *
 * Multi-club: the query `onSnapshot()` below re-subscribes via `effect()`
 * whenever `clubContext.currentClubId()` changes — see RoleDefinitionService
 * for the same pattern and why.
 */
@Injectable({ providedIn: 'root' })
export class AuditLogService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly clubContext = inject(ClubContextService);
  private readonly zone = inject(NgZone);

  private readonly log = signal<AuditLogEntry[]>([]);
  private unsubscribe: (() => void) | undefined;

  readonly entries = computed(() => this.log());
  readonly ready = signal(false);

  constructor() {
    effect(() => {
      const clubId = this.clubContext.currentClubId();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.log.set([]);
      this.ready.set(false);
      if (!clubId) return;

      const q = query(
        collection(this.firestore, CLUBS_COLLECTION, clubId, COLLECTION),
        orderBy('at', 'desc'),
        limit(MAX_ENTRIES)
      );
      this.unsubscribe = onSnapshot(
        q,
        (snap) =>
          this.zone.run(() => {
            this.log.set(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditLogEntry));
            this.ready.set(true);
          }),
        (err) => this.zone.run(() => console.error('auditLog snapshot listener failed', err))
      );
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
