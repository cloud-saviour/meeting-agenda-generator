import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { deleteDoc, doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { Attendee, CheckinMeeting, CheckinSnapshot, CheckinSpeaker } from '../models/checkin.models';
import { StorageService } from '../../../core/services/storage.service';
import { APP_LOCALE } from '../../../core/utils/locale';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const UID_KEY = 'agora-checkin-uid';
const NAME_KEY = 'agora-checkin-name';
const CHECKINS_COLLECTION = 'checkins';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

@Injectable({ providedIn: 'root' })
export class CheckinStateService implements OnDestroy {
  private readonly storage = inject(StorageService);
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);

  // ── Local identity (per-browser, persists across visits) ────────────────
  readonly currentUid: string;
  readonly currentName = signal<string>('');

  // ── Shared meeting state (Firestore-backed, kept live via onSnapshot) ───
  private readonly snapshot = signal<CheckinSnapshot>(this.emptySnapshotPlaceholder());
  private currentMeetingId: string | null = null;
  private unsubscribeSnapshot: (() => void) | undefined;

  readonly meeting = computed(() => this.snapshot().meeting);
  readonly attendees = computed(() => this.snapshot().attendees);
  readonly roles = computed(() => this.snapshot().roles);
  readonly speakers = computed(() => this.snapshot().speakers);
  readonly lockedRoles = computed(() => this.snapshot().lockedRoles);

  readonly isCheckedIn = computed(() =>
    this.attendees().some((a) => a.uid === this.currentUid)
  );

  constructor() {
    this.currentUid = this.loadOrCreateUid();
    this.currentName.set(this.storage.get(NAME_KEY) || '');
  }

  ngOnDestroy(): void {
    this.unsubscribeSnapshot?.();
  }

  /**
   * Switches to a specific meeting's check-in sheet, isolated from every other
   * meeting id, and subscribes to it live — claims/signups made on any device
   * show up here without a reload. Idempotent: calling this again with the
   * same meetingId (e.g. from an effect that re-fires on every unrelated form
   * edit) is a cheap no-op rather than tearing down and rebuilding the listener.
   */
  loadMeeting(meetingId: string): void {
    if (meetingId === this.currentMeetingId) return;
    this.unsubscribeSnapshot?.();
    this.currentMeetingId = meetingId;

    const ref = doc(this.firestore, CHECKINS_COLLECTION, meetingId);
    this.unsubscribeSnapshot = onSnapshot(
      ref,
      (snap) =>
        this.zone.run(() => {
          const data = snap.exists()
            ? (snap.data() as CheckinSnapshot)
            : this.defaultSnapshot(meetingId);
          this.snapshot.set(data);
        }),
      (err) => this.zone.run(() => console.error('checkin snapshot listener failed', err))
    );
  }

  // ── Identity ──────────────────────────────────────────────────────────
  private loadOrCreateUid(): string {
    let uid = this.storage.get(UID_KEY);
    if (!uid) {
      uid = makeId();
      this.storage.set(UID_KEY, uid);
    }
    return uid;
  }

  // ── Attendance ────────────────────────────────────────────────────────
  checkIn(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve();
    this.currentName.set(trimmed);
    this.storage.set(NAME_KEY, trimmed);

    return this.mutate((s) => {
      const already = s.attendees.some((a) => a.uid === this.currentUid);
      if (already) {
        const next = {
          ...s,
          attendees: s.attendees.map((a) =>
            a.uid === this.currentUid ? { ...a, name: trimmed } : a
          ),
        };
        return { next, result: undefined };
      }
      const attendee: Attendee = {
        uid: this.currentUid,
        name: trimmed,
        joinedAt: new Date().toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' }),
      };
      const next = { ...s, attendees: [...s.attendees, attendee] };
      return { next, result: undefined };
    }).then(() => undefined);
  }

  // ── Roles: first-come locking ────────────────────────────────────────
  /** Returns true if the claim succeeded, false if the role was already taken or is organizer-locked. */
  claimRole(roleKey: string): Promise<boolean> {
    if (!this.currentName()) return Promise.resolve(false);

    return this.mutate((s) => {
      if (s.lockedRoles.includes(roleKey)) return { next: s, result: false };
      const existing = s.roles[roleKey];
      if (existing?.uid && existing.uid !== this.currentUid) return { next: s, result: false };

      const next = {
        ...s,
        roles: { ...s.roles, [roleKey]: { name: this.currentName(), uid: this.currentUid } },
      };
      return { next, result: true };
    }).then((result) => result ?? false);
  }

  /** A member may only release their own claim; organizer-locked roles can't be released either. */
  releaseRole(roleKey: string): Promise<void> {
    return this.mutate((s) => {
      if (s.lockedRoles.includes(roleKey)) return { next: s, result: undefined };
      const existing = s.roles[roleKey];
      if (!existing || existing.uid !== this.currentUid) return { next: s, result: undefined };
      const next = { ...s, roles: { ...s.roles, [roleKey]: { name: '', uid: '' } } };
      return { next, result: undefined };
    }).then(() => undefined);
  }

  // ── Roles: organizer override (from the Agenda Editor) ─────────────────
  /** Locks or unlocks a role from being claimed/released here — set by the Agenda Editor's override toggle. */
  setRoleLocked(roleId: string, locked: boolean): Promise<void> {
    return this.mutate((s) => {
      const set = new Set(s.lockedRoles);
      locked ? set.add(roleId) : set.delete(roleId);
      const next = { ...s, lockedRoles: [...set] };
      return { next, result: undefined };
    }).then(() => undefined);
  }

  // ── Speakers ──────────────────────────────────────────────────────────
  addSpeakerSignup(data: { title: string; level: string; timePref: string }): Promise<boolean> {
    if (!this.currentName()) return Promise.resolve(false);

    return this.mutate((s) => {
      if (s.speakers.length >= s.meeting.maxSpeakers) return { next: s, result: false };
      if (s.speakers.some((sp) => sp.uid === this.currentUid)) return { next: s, result: false };

      const speaker: CheckinSpeaker = {
        id: makeId(),
        name: this.currentName(),
        uid: this.currentUid,
        title: data.title.trim(),
        level: data.level.trim(),
        timePref: data.timePref,
        evaluator: null,
      };
      const next = { ...s, speakers: [...s.speakers, speaker] };
      return { next, result: true };
    }).then((result) => result ?? false);
  }

  removeSpeakerSignup(id: string): Promise<void> {
    return this.mutate((s) => {
      const sp = s.speakers.find((x) => x.id === id);
      if (!sp || sp.uid !== this.currentUid) return { next: s, result: undefined };
      const next = { ...s, speakers: s.speakers.filter((x) => x.id !== id) };
      return { next, result: undefined };
    }).then(() => undefined);
  }

  // ── Evaluators: one evaluation slot per speaker, one claim per member ──
  claimEvaluatorSlot(speakerId: string): Promise<boolean> {
    if (!this.currentName()) return Promise.resolve(false);

    return this.mutate((s) => {
      if (s.speakers.some((sp) => sp.evaluator?.uid === this.currentUid)) {
        return { next: s, result: false };
      }
      const target = s.speakers.find((sp) => sp.id === speakerId);
      if (!target || target.evaluator?.uid || target.uid === this.currentUid) {
        return { next: s, result: false };
      }

      const next = {
        ...s,
        speakers: s.speakers.map((sp) =>
          sp.id === speakerId
            ? { ...sp, evaluator: { name: this.currentName(), uid: this.currentUid } }
            : sp
        ),
      };
      return { next, result: true };
    }).then((result) => result ?? false);
  }

  releaseEvaluatorSlot(speakerId: string): Promise<void> {
    return this.mutate((s) => {
      const next = {
        ...s,
        speakers: s.speakers.map((sp) => {
          if (sp.id !== speakerId) return sp;
          if (!sp.evaluator || sp.evaluator.uid !== this.currentUid) return sp;
          return { ...sp, evaluator: null };
        }),
      };
      return { next, result: undefined };
    }).then(() => undefined);
  }

  // ── Meeting config (admin) ──────────────────────────────────────────────
  updateMeeting(patch: Partial<CheckinMeeting>): Promise<void> {
    return this.mutate((s) => {
      const next = { ...s, meeting: { ...s.meeting, ...patch } };
      return { next, result: undefined };
    }).then(() => undefined);
  }

  resetAll(): Promise<void> {
    if (!this.currentMeetingId) return Promise.resolve();
    const ref = doc(this.firestore, CHECKINS_COLLECTION, this.currentMeetingId);
    return runTransaction(this.firestore, async (tx) => {
      tx.set(ref, this.defaultSnapshot(this.currentMeetingId!));
    }).catch((err) => console.error('checkin resetAll failed', err));
  }

  /**
   * Deletes a meeting's check-in document outright — distinct from
   * `resetAll()`, which only clears the *currently loaded* meeting back to
   * defaults. Callers don't need this meeting loaded first (e.g. deleting a
   * saved agenda from the "My Agendas" list operates on a meeting number
   * that was never opened in this browser session).
   */
  deleteMeeting(meetingId: string): Promise<void> {
    const ref = doc(this.firestore, CHECKINS_COLLECTION, meetingId);
    return deleteDoc(ref).catch((err) => console.error('checkin deleteMeeting failed', err));
  }

  // ── Persistence (Firestore transactions) ─────────────────────────────────
  /**
   * Every mutator routes through here. `mutate` must be pure — Firestore
   * retries it on write contention — and is given the full current snapshot
   * so it can make an atomic read-decide-write decision in one transaction.
   * A role id absent from `roles` is treated the same as one present with an
   * empty claim everywhere it's read (see `claimRole`/`releaseRole` above and
   * the components' template lookups), so nothing here needs to know the
   * full set of role definitions — that's RoleDefinitionService's concern.
   * Errors are logged and swallowed (no toast/banner system exists yet in
   * this app) so `Promise<void>`-returning callers don't need to change
   * their existing fire-and-forget call sites.
   */
  private mutate<T>(
    fn: (s: CheckinSnapshot) => { next: CheckinSnapshot; result: T }
  ): Promise<T | undefined> {
    if (!this.currentMeetingId) return Promise.resolve(undefined);
    const meetingId = this.currentMeetingId;
    const ref = doc(this.firestore, CHECKINS_COLLECTION, meetingId);

    return runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists()
        ? (snap.data() as CheckinSnapshot)
        : this.defaultSnapshot(meetingId);
      const { next, result } = fn(current);
      tx.set(ref, next);
      return result;
    }).catch((err) => {
      console.error('checkin transaction failed', err);
      return undefined;
    });
  }

  private defaultSnapshot(meetingId: string): CheckinSnapshot {
    return {
      meeting: {
        id: meetingId,
        date: new Date().toISOString().slice(0, 10),
        theme: '',
        word: '',
        start: '18:15',
        maxSpeakers: 3,
      },
      attendees: [],
      roles: {},
      speakers: [],
      lockedRoles: [],
    };
  }

  /** Cheap placeholder for the snapshot field initializer; real data arrives via loadMeeting()'s listener. */
  private emptySnapshotPlaceholder(): CheckinSnapshot {
    return {
      meeting: { id: 'default', date: '', theme: '', word: '', start: '18:15', maxSpeakers: 3 },
      attendees: [],
      roles: {},
      speakers: [],
      lockedRoles: [],
    };
  }
}
