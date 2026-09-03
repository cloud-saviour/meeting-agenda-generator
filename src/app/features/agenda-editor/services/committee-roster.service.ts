import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { CommitteeMember } from '../models/agenda.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'committeeRoster';
const DOC_ID = 'current';
const SLOT_COUNT = 7;

interface CommitteeRosterDoc {
  members: CommitteeMember[];
}

function blankSlot(): CommitteeMember {
  return { roleId: '', name: '', email: '', phone: '' };
}

function emptyRoster(): CommitteeMember[] {
  // Blank on purpose: pre-assigning a distinct role per slot left every
  // slot's dropdown with only one selectable option (itself), since the
  // duplicate-prevention filter excludes roles already used elsewhere.
  // Starting unassigned lets every role stay pickable until an admin
  // actually assigns it.
  return Array.from({ length: SLOT_COUNT }, blankSlot);
}

/**
 * Pads a stored roster back up to SLOT_COUNT slots if it's short. Needed
 * because the app itself never removes a slot (only clears/reassigns one),
 * but the Firestore document can still end up short some other way — e.g. an
 * admin manually deleting one array element via the Emulator UI or Firestore
 * console. Without this, a shortened array permanently hides a slot with no
 * way to get it back, since the app has no "add a slot" control either.
 */
function normalizeRoster(members: CommitteeMember[]): CommitteeMember[] {
  if (members.length >= SLOT_COUNT) return members;
  return [...members, ...Array.from({ length: SLOT_COUNT - members.length }, blankSlot)];
}

/**
 * Persists the Executive Committee roster (who holds each committee role)
 * across sessions/agendas — unlike the rest of the agenda editor's state,
 * which is deliberately per-agenda and in-memory only. Committee members
 * are assigned by the admin (not via check-in) and change roughly yearly,
 * so every new agenda should start prepopulated with the current roster.
 *
 * Firestore-backed — a single document at `committeeRoster/current` holding
 * the whole roster array. One doc, not one-per-role like RoleDefinitionService,
 * because `roleId` here isn't a unique key: multiple slots can legitimately
 * share the same (blank) roleId at once, and the roster is addressed by
 * array position, not roleId (see AgendaStateService.updateCommitteeMember).
 * `replaceAll()` already treats the whole roster as one atomic unit, so one
 * document matches the existing access pattern exactly.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeRosterService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);

  private readonly roster = signal<CommitteeMember[]>(emptyRoster());
  private readonly unsubscribe: () => void;

  readonly all = computed(() => this.roster());

  /**
   * True once Firestore's onSnapshot has delivered its first result (real
   * data, or confirmation there's none yet — either way, `all()` stops being
   * just the pre-load placeholder). Consumers that copy `all()` into their
   * own state exactly once at construction (e.g. AgendaStateService.cmt)
   * need this to tell "still the initial placeholder" apart from "Firestore
   * genuinely has nothing" — both look identical in content otherwise.
   */
  readonly ready = signal(false);

  constructor() {
    this.unsubscribe = onSnapshot(
      doc(this.firestore, COLLECTION, DOC_ID),
      (snap) =>
        this.zone.run(() => {
          const data = snap.data() as CommitteeRosterDoc | undefined;
          this.roster.set(data?.members?.length ? normalizeRoster(data.members) : emptyRoster());
          this.ready.set(true);
        }),
      (err) => this.zone.run(() => console.error('committeeRoster snapshot listener failed', err))
    );
  }

  ngOnDestroy(): void {
    this.unsubscribe();
  }

  /** Replaces the whole roster in one commit — used when the admin explicitly saves. */
  replaceAll(members: CommitteeMember[]): Promise<void> {
    const payload: CommitteeRosterDoc = { members: JSON.parse(JSON.stringify(members)) };
    return setDoc(doc(this.firestore, COLLECTION, DOC_ID), payload).catch((err) =>
      console.error('committeeRoster replaceAll failed', err)
    );
  }
}
