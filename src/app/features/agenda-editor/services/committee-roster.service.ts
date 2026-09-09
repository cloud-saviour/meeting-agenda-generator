import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { CommitteeMember } from '../models/agenda.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'committeeRoster';
const DOC_ID = 'current';

interface CommitteeRosterDoc {
  members: CommitteeMember[];
}

/**
 * Persists the Executive Committee roster (who currently holds each
 * committee role) — Firestore-backed, a single document at
 * `committeeRoster/current` holding the whole roster as one array, one
 * entry per *assigned* role. `roleId` is a genuine unique key: an
 * unassigned role simply has no entry at all, not a blank placeholder —
 * unlike the earlier fixed-7-slot model this replaced, there's no fixed
 * slot count to pad to, so nothing here can legitimately collide on a
 * shared blank `roleId` anymore.
 *
 * `assign()`/`unassign()` each read the already-live `roster()` signal
 * value and write back a whole new array in one `setDoc()` — no
 * `runTransaction`. This is admin-authored, not a first-come-first-served
 * claim by identity (see the role-locking-pattern skill for when a
 * transaction *is* warranted — this isn't it): a genuine double-admin
 * collision just means one assignment needs re-doing, an acceptable risk
 * for a small club's admin tooling.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeRosterService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);

  private readonly roster = signal<CommitteeMember[]>([]);
  private readonly unsubscribe: () => void;

  readonly all = computed(() => this.roster());

  /**
   * True once Firestore's onSnapshot has delivered its first result (real
   * data, or confirmation there's none yet — either way, `all()` stops being
   * just the pre-load placeholder). Consumers that copy `all()` into their
   * own state exactly once at construction (e.g. AgendaStateService's
   * one-time default-agenda seed) need this to tell "still the initial
   * placeholder" apart from "Firestore genuinely has nothing" — both look
   * identical in content otherwise.
   */
  readonly ready = signal(false);

  constructor() {
    this.unsubscribe = onSnapshot(
      doc(this.firestore, COLLECTION, DOC_ID),
      (snap) =>
        this.zone.run(() => {
          const data = snap.data() as CommitteeRosterDoc | undefined;
          // Defensive: legacy dev/emulator data may still hold blank-roleId
          // padded slots from the old fixed-7-slot model — an unassigned
          // role is now "absent", not "present with roleId ''".
          this.roster.set((data?.members ?? []).filter((m) => m.roleId));
          this.ready.set(true);
        }),
      (err) => this.zone.run(() => console.error('committeeRoster snapshot listener failed', err))
    );
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }

  /** Assigns (or reassigns) roleId to the given person — replaces any existing entry for that role. */
  assign(roleId: string, name: string, email: string, phone: string): Promise<void> {
    const next = [...this.roster().filter((m) => m.roleId !== roleId), { roleId, name, email, phone }];
    return this.persist(next);
  }

  /** Clears whoever currently holds roleId — the role goes back to unassigned. */
  unassign(roleId: string): Promise<void> {
    return this.persist(this.roster().filter((m) => m.roleId !== roleId));
  }

  private persist(members: CommitteeMember[]): Promise<void> {
    const payload: CommitteeRosterDoc = { members: JSON.parse(JSON.stringify(members)) };
    return setDoc(doc(this.firestore, COLLECTION, DOC_ID), payload).catch((err) => {
      console.error('committeeRoster write failed', err);
      throw err;
    });
  }
}
