import { Injectable, NgZone, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { AppAdmin } from '../models/app-admin.models';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubContextService } from '../../../core/club/club-context.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { appendAuditEntry } from '../../../core/audit/audit-log.util';

const CLUBS_COLLECTION = 'clubs';
const COLLECTION = 'appAdmins';

/**
 * Firestore-backed grant list at `clubs/{clubId}/appAdmins/{uid}` — see
 * AuthService's/ClubContextService's class docs and firestore.rules'
 * isGrantedAdmin() for the full design. A grant is per-club: being a
 * granted admin of one club implies nothing about any other. Mirrors
 * CommitteeRosterService's shape (onSnapshot on the whole collection →
 * signal + computed + ready), but one document per uid here, not a single
 * combined document — there's no "whole roster in one atomic write" need
 * the way committeeRoster has, and per-uid documents are what let
 * firestore.rules express "you can always read your own" cheaply.
 *
 * grant()/revoke() are plain writes, not a runTransaction — this is
 * admin-authored (any app-admin of THIS club can call it, enforced
 * server-side — see firestore.rules' appAdmins rule), not a
 * first-come-first-served identity claim. Each is a `writeBatch()`
 * covering both the appAdmins change itself and a matching entry in this
 * club's append-only `auditLog` collection — see AuditLogService, injected
 * only by the true-admin-only AuditLogComponent. Batching keeps the audit
 * trail from ever drifting out of sync with the actual grant list: either
 * both writes land, or neither does.
 *
 * Multi-club: the `onSnapshot()` below re-subscribes via `effect()`
 * whenever `clubContext.currentClubId()` changes — see RoleDefinitionService
 * for the same pattern and why.
 */
@Injectable({ providedIn: 'root' })
export class AppAdminService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly clubContext = inject(ClubContextService);
  private readonly zone = inject(NgZone);

  private readonly admins = signal<AppAdmin[]>([]);
  private unsubscribe: (() => void) | undefined;

  readonly all = computed(() => this.admins());
  readonly ready = signal(false);

  constructor() {
    effect(() => {
      const clubId = this.clubContext.currentClubId();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.admins.set([]);
      this.ready.set(false);
      if (!clubId) return;

      this.unsubscribe = onSnapshot(
        collection(this.firestore, CLUBS_COLLECTION, clubId, COLLECTION),
        (snap) =>
          this.zone.run(() => {
            this.admins.set(snap.docs.map((d) => d.data() as AppAdmin));
            this.ready.set(true);
          }),
        (err) => this.zone.run(() => console.error('appAdmins snapshot listener failed', err))
      );
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  private docRef(uid: string) {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) throw new Error('AppAdminService called with no club resolved');
    return doc(this.firestore, CLUBS_COLLECTION, clubId, COLLECTION, uid);
  }

  isGranted(uid: string): boolean {
    return this.admins().some((a) => a.uid === uid);
  }

  grant(uid: string, email: string, displayName: string): Promise<void> {
    const actor = this.auth.currentUser();
    const now = new Date().toISOString();
    const entry: AppAdmin = { uid, email, displayName, grantedAt: now, grantedByEmail: actor?.email ?? '' };

    const batch = writeBatch(this.firestore);
    batch.set(this.docRef(uid), entry);
    appendAuditEntry(this.firestore, batch, 'admin.grant', `Granted admin access to ${displayName} (${email})`, actor, this.clubContext.currentClubId() ?? undefined);
    return batch.commit().catch((err) => {
      console.error('appAdmins grant failed', err);
      throw err;
    });
  }

  revoke(uid: string, email: string, displayName: string): Promise<void> {
    const actor = this.auth.currentUser();

    const batch = writeBatch(this.firestore);
    batch.delete(this.docRef(uid));
    appendAuditEntry(this.firestore, batch, 'admin.revoke', `Revoked admin access from ${displayName} (${email})`, actor, this.clubContext.currentClubId() ?? undefined);
    return batch.commit().catch((err) => {
      console.error('appAdmins revoke failed', err);
      throw err;
    });
  }
}
