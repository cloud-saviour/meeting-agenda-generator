import { Injectable, NgZone, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubContextService } from '../../../core/club/club-context.service';
import { ClubRecord } from '../../../core/club/club-directory.service';
import { Club } from '../../../core/models/club.models';
import { AuditAction } from '../../../core/audit/audit-log.models';
import { appendAuditEntry } from '../../../core/audit/audit-log.util';
import { Membership, MembershipDecision, MembershipStatus } from '../models/membership.models';

const CLUBS = 'clubs';
const MEMBERSHIPS = 'memberships';

const DECISION_AUDIT: Record<MembershipDecision, { action: AuditAction; verb: string }> = {
  active: { action: 'membership.approve', verb: 'Approved' },
  rejected: { action: 'membership.reject', verb: 'Rejected' },
  removed: { action: 'membership.remove', verb: 'Removed' },
};

/** A membership row plus the club it belongs to (from a collection-group read). */
export interface ClubMembership extends Membership {
  clubId: string;
}

/** A club the signed-in person has a membership row in (any status), with that status. */
export interface MyClub {
  club: ClubRecord;
  status: MembershipStatus;
}

/**
 * Membership of the CURRENT club, with admin approval: a signed-in member
 * asks to join (`pending`), a club admin approves or rejects, and an admin
 * can later remove an active member. Stored at
 * `clubs/{clubId}/memberships/{uid}` — inside the club, so each club has its
 * own list and one account can belong to several. Membership only drives the
 * landing page, "My clubs" and the roster; it does NOT gate check-in, preview
 * or roles, which stay open to guests. firestore.rules is what stops a member
 * approving themselves.
 *
 * `mine` is a live listener on the signed-in user's own row for the current
 * club; everything else is a one-time read, since the admin page refreshes
 * after each action.
 */
@Injectable({ providedIn: 'root' })
export class MembershipService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly clubContext = inject(ClubContextService);
  private readonly zone = inject(NgZone);

  readonly mine = signal<Membership | null>(null);
  /** True once the first snapshot of the signed-in user's own row has arrived (so the UI doesn't flash "Join" before it knows). */
  readonly mineLoaded = signal(false);
  /** `none` when there is no row yet. */
  readonly status = computed<MembershipStatus | 'none'>(() => this.mine()?.status ?? 'none');

  private unsubscribe: (() => void) | undefined;

  constructor() {
    effect(() => {
      const clubId = this.clubContext.currentClubId();
      const user = this.auth.currentUser();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.mine.set(null);
      this.mineLoaded.set(false);
      if (!clubId || !user) return;

      this.unsubscribe = onSnapshot(
        doc(this.firestore, CLUBS, clubId, MEMBERSHIPS, user.uid),
        (snap) =>
          this.zone.run(() => {
            this.mine.set(snap.exists() ? (snap.data() as Membership) : null);
            this.mineLoaded.set(true);
          }),
        (err) =>
          this.zone.run(() => {
            console.error('membership listener failed', err);
            this.mineLoaded.set(true);
          })
      );
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  private ref(uid: string) {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) throw new Error('MembershipService called with no club resolved');
    return doc(this.firestore, CLUBS, clubId, MEMBERSHIPS, uid);
  }

  /** Ask to join the current club (also used to ask again after a rejection or removal). Rejects if the person already has a pending or active row. */
  async requestToJoin(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !user.email) throw new Error('You need to be signed in to join a club.');
    const membership: Membership = {
      uid: user.uid,
      email: user.email,
      displayName: (user.displayName ?? '').trim() || user.email,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      decidedByUid: null,
      decidedByEmail: null,
    };
    await setDoc(this.ref(user.uid), membership);
  }

  /** Withdraw your own pending request. */
  async cancelRequest(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;
    await deleteDoc(this.ref(user.uid));
  }

  /** Every membership row of the current club, pending first, then by name. Club admins only (rules). */
  async listForClub(): Promise<Membership[]> {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) return [];
    const snap = await getDocs(collection(this.firestore, CLUBS, clubId, MEMBERSHIPS));
    const rank: Record<MembershipStatus, number> = { pending: 0, active: 1, rejected: 2, removed: 3 };
    return snap.docs
      .map((d) => d.data() as Membership)
      .sort((a, b) => rank[a.status] - rank[b.status] || a.displayName.localeCompare(b.displayName));
  }

  async countPending(): Promise<number> {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) return 0;
    const snap = await getDocs(query(collection(this.firestore, CLUBS, clubId, MEMBERSHIPS), where('status', '==', 'pending')));
    return snap.size;
  }

  /** Approve, reject or remove — with a matching audit entry in the same batch. */
  async decide(member: Membership, decision: MembershipDecision): Promise<void> {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) throw new Error('Not signed in to a club.');
    await this.applyDecision(clubId, member, decision);
  }

  /**
   * Platform admin removes someone from ANY club (not just the current one),
   * from the All Members page. The row stays with status `removed`, so the
   * person can ask to rejoin. Audited in that club's log in the same batch.
   * A club admin's separate admin grant, if any, is not touched.
   */
  async removeFromClub(clubId: string, person: { uid: string; email: string; displayName: string }): Promise<void> {
    await this.applyDecision(clubId, person, 'removed');
  }

  private async applyDecision(
    clubId: string,
    person: { uid: string; email: string; displayName: string },
    decision: MembershipDecision
  ): Promise<void> {
    const actor = this.auth.currentUser();
    if (!actor) throw new Error('Not signed in.');
    const { action, verb } = DECISION_AUDIT[decision];

    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, CLUBS, clubId, MEMBERSHIPS, person.uid), {
      status: decision,
      decidedAt: new Date().toISOString(),
      decidedByUid: actor.uid,
      decidedByEmail: actor.email ?? '',
    });
    appendAuditEntry(this.firestore, batch, action, `${verb} membership for ${person.displayName} (${person.email})`, actor, clubId);
    await batch.commit();
  }

  /** Every membership row in every club. Platform admins only (the recursive read rule allows the real claim). */
  async listAllMemberships(): Promise<ClubMembership[]> {
    const snap = await getDocs(collectionGroup(this.firestore, MEMBERSHIPS));
    return snap.docs.flatMap((d) => {
      const clubId = d.ref.parent.parent?.id;
      return clubId ? [{ ...(d.data() as Membership), clubId }] : [];
    });
  }

  /**
   * Platform admin adds someone to a club directly, already active — no
   * request/approval step. Also approves an existing pending row, and
   * reinstates a rejected or removed one. Audited in that club's log in the
   * same batch.
   */
  async assignToClub(clubId: string, person: { uid: string; email: string; displayName: string }, existing?: Membership): Promise<void> {
    const actor = this.auth.currentUser();
    if (!actor) throw new Error('Not signed in.');
    const now = new Date().toISOString();
    const membership: Membership = {
      uid: person.uid,
      email: person.email,
      displayName: person.displayName,
      status: 'active',
      requestedAt: existing?.requestedAt ?? now,
      decidedAt: now,
      decidedByUid: actor.uid,
      decidedByEmail: actor.email ?? '',
    };
    const batch = writeBatch(this.firestore);
    batch.set(doc(this.firestore, CLUBS, clubId, MEMBERSHIPS, person.uid), membership);
    appendAuditEntry(this.firestore, batch, 'membership.assign', `Added ${person.displayName} (${person.email}) to the club`, actor, clubId);
    await batch.commit();
  }

  /**
   * The signed-in person's memberships across ALL clubs — a collection-group
   * query on `memberships` filtered by uid (needs the collection-group index
   * in firestore.indexes.json and the recursive read rule). Status is
   * filtered by the caller, so one index is enough.
   */
  async listMyClubs(): Promise<MyClub[]> {
    const user = this.auth.currentUser();
    if (!user) return [];
    const snap = await getDocs(query(collectionGroup(this.firestore, MEMBERSHIPS), where('uid', '==', user.uid)));
    const results = await Promise.all(
      snap.docs.map(async (d) => {
        const clubId = d.ref.parent.parent?.id;
        if (!clubId) return null;
        const club = await getDoc(doc(this.firestore, CLUBS, clubId));
        if (!club.exists()) return null;
        return { club: { id: club.id, ...(club.data() as Club) }, status: (d.data() as Membership).status } as MyClub;
      })
    );
    return results.filter((r): r is MyClub => r !== null && r.club.active).sort((a, b) => a.club.name.localeCompare(b.club.name));
  }
}
