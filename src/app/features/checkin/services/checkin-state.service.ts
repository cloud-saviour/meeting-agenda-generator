import { Injectable, NgZone, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { deleteDoc, doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { Attendee, CheckinMeeting, CheckinSnapshot, CheckinSpeaker } from '../models/checkin.models';
import { CheckinContactsService } from './checkin-contacts.service';
import { APP_LOCALE } from '../../../core/utils/locale';
import { sha256Hex } from '../../../core/utils/hash';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';

const CHECKINS_COLLECTION = 'checkins';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Trimmed, lowercased so the same person always hashes to the same uid regardless of capitalization/whitespace. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable({ providedIn: 'root' })
export class CheckinStateService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);
  private readonly auth = inject(AuthService);
  private readonly contacts = inject(CheckinContactsService);

  // ── Identity ──────────────────────────────────────────────────────────
  // No localStorage anywhere in this service — nothing here persists across
  // a reload. A signed-in account (member or admin) always uses its real
  // Firebase uid. An anonymous visitor's uid is derived deterministically
  // from an email — normally entered up front at CheckinComponent's
  // guest-email gate via identifyAsGuest() below, before any name is typed
  // — so the SAME person gets the SAME uid on a later visit or a different
  // device without anything being stored client-side; before they've
  // identified, `sessionUid` is a random, in-memory-only placeholder (never
  // written anywhere) so `=== this.currentUid` comparisons elsewhere don't
  // need to handle a null case. `currentUid` stays a plain string getter
  // (not a Signal<string>) so every existing comparison, here and in
  // role-board/speaker-signup/evaluator-slots, keeps working unchanged.
  private readonly sessionUid = makeId();
  private readonly emailIdentity = signal<string | null>(null);
  // The normalized (trimmed+lowercased) raw email behind emailIdentity —
  // kept separately so checkIn() can still upsert it into
  // CheckinContactsService even when identifyAsGuest() was called earlier
  // (by the gate) rather than inline within this same checkIn() call.
  private readonly guestEmail = signal<string | null>(null);
  private readonly uidSource = computed(() => this.auth.currentUser()?.uid ?? this.emailIdentity() ?? this.sessionUid);
  get currentUid(): string {
    return this.uidSource();
  }
  /**
   * True for a signed-in account, or once an anonymous visitor has
   * identified themselves via identifyAsGuest() — drives
   * CheckinComponent's guest-email gate. Folds in the signed-in case so
   * the gate condition is a single check (`!isGuestIdentified()`) rather
   * than every caller needing to separately check auth state too.
   */
  readonly isGuestIdentified = computed(() => !!this.auth.currentUser() || this.emailIdentity() !== null);
  readonly currentName = signal<string>('');
  /** `undefined` (distinct from the real "signed out" value `null`) so the very first
   *  identity-change effect run below always seeds/clears, even on a cold, signed-out load. */
  private lastUid: string | null | undefined = undefined;

  // ── Shared meeting state (Firestore-backed, kept live via onSnapshot) ───
  private readonly snapshot = signal<CheckinSnapshot>(this.emptySnapshotPlaceholder());
  private currentMeetingId: string | null = null;
  private unsubscribeSnapshot: (() => void) | undefined;

  readonly meeting = computed(() => this.snapshot().meeting);
  readonly attendees = computed(() => this.snapshot().attendees);
  readonly roles = computed(() => this.snapshot().roles);
  readonly speakers = computed(() => this.snapshot().speakers);
  readonly lockedRoles = computed(() => this.snapshot().lockedRoles);
  readonly apologies = computed(() => this.snapshot().apologies);

  readonly isCheckedIn = computed(() =>
    this.attendees().some((a) => a.uid === this.currentUid)
  );

  constructor() {
    // CheckinStateService is a `providedIn: 'root'` singleton — it outlives
    // any single /checkin visit, so `currentName`/`emailIdentity` must be
    // *reset* whenever the resolved identity actually changes (anonymous →
    // signed in, one account → another, or signed in → anonymous again),
    // not just seeded once while blank. Without this, whatever the previous
    // identity typed (or, for an anonymous visitor, their derived
    // email-hash uid) leaks forward into the next identity that uses this
    // same browser tab — e.g. checking in anonymously as "Jane", then
    // signing in as admin and going back to /checkin, would still show
    // "Jane" instead of the admin's own name. `lastUid` is compared by
    // value (uid string, or null when signed out) so this only fires on a
    // genuine identity change, not on every unrelated auth-signal update.
    //
    // The synchronous call below (same as the old seed-once code it
    // replaces) matters for the common case: CheckinComponent reads
    // currentName() once into a plain field at its own construction, so
    // this must already be settled before that happens, not wait for the
    // effect's first (deferred) flush. The effect that follows exists only
    // to catch *subsequent* identity changes during this service's
    // lifetime — by the time it first runs, `syncIdentity` is a no-op
    // (lastUid already matches), since nothing has changed since the
    // synchronous call.
    this.syncIdentity(this.auth.currentUser());
    effect(() => this.syncIdentity(this.auth.currentUser()));
  }

  private syncIdentity(user: { uid: string; displayName: string | null } | null): void {
    const uid = user?.uid ?? null;
    if (uid === this.lastUid) return;
    this.lastUid = uid;
    this.currentName.set(user?.displayName ?? '');
    this.emailIdentity.set(null);
    this.guestEmail.set(null);
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
            ? this.normalize(snap.data() as CheckinSnapshot)
            : this.defaultSnapshot(meetingId);
          this.snapshot.set(data);
        }),
      (err) => this.zone.run(() => console.error('checkin snapshot listener failed', err))
    );
  }

  // ── Attendance ────────────────────────────────────────────────────────
  /**
   * Establishes an anonymous visitor's identity from a typed email —
   * normalizes (trim+lowercase) and SHA-256-hashes it into `emailIdentity`
   * (see the class-level Identity comment), so `currentUid` resolves
   * deterministically to the same uid on a later visit or device with
   * nothing stored client-side. Also stashes the normalized email in
   * `guestEmail` so a later `checkIn()` call — made without an email, once
   * already identified — can still upsert it into CheckinContactsService.
   *
   * This is CheckinComponent's guest-email gate's entry point, called up
   * front before any name is entered. `checkIn()` below also calls it
   * internally (only when not already identified) so every existing
   * `checkIn(name, email)` call site that passes email+name together in
   * one step — chiefly in the test suites — keeps working unchanged.
   *
   * Safe to call again after already identified (e.g. re-entering the same
   * email after a reload): just re-derives and re-sets the same hash.
   * Never called for a signed-in account.
   *
   * Returns false only for an invalid-looking email.
   */
  async identifyAsGuest(email: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalized)) return false;
    this.emailIdentity.set(await sha256Hex(normalized));
    this.guestEmail.set(normalized);
    return true;
  }

  /**
   * `email` is required for an anonymous check-in that hasn't already
   * identified via `identifyAsGuest()` — it's how a stable uid gets
   * derived without localStorage, and (via `guestEmail`, from either
   * source) it's separately upserted into CheckinContactsService
   * (admin-only-readable) for the planned reminder-email feature. Omit it
   * for a signed-in account (member or admin), which already has a stable
   * uid and a real email via Firebase Auth — passing one anyway is ignored.
   *
   * Async because deriving the uid from email (sha256Hex, via
   * identifyAsGuest()) must complete BEFORE building the attendee record
   * below, which reads `currentUid`.
   *
   * Returns `Promise<boolean>` (false only for a blank name or, for an
   * anonymous visitor not yet identified, an invalid-looking email) rather
   * than `void`, matching `claimRole()`/`addSpeakerSignup()`/
   * `claimEvaluatorSlot()` below — callers must not infer success from
   * `isCheckedIn()` immediately afterward, since that reads the
   * `onSnapshot()`-driven `snapshot` signal, which can still lag behind the
   * transaction this method just awaited.
   *
   * Also retracts any prior `uncheckIn()` apology for this uid, for
   * symmetry — re-attending after apologizing should un-apologize, at
   * least at the check-in layer. This does NOT retroactively remove the
   * name from the agenda's already-synced free-text
   * `MeetingData.apologies` string (see AgendaEditorComponent's
   * applyCheckinSnapshot()) — that's a one-way import, same limitation the
   * existing speaker-signup import already has. If an admin has already
   * synced "Jane" into the printed agenda and Jane later re-checks-in, the
   * admin must remove her name from that text by hand.
   */
  async checkIn(name: string, email?: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;

    const signedInUser = this.auth.currentUser();
    let contactEmail: string;
    if (signedInUser) {
      contactEmail = signedInUser.email ?? '';
    } else {
      if (!this.emailIdentity()) {
        const ok = await this.identifyAsGuest(email ?? '');
        if (!ok) return false; // invalid-looking anonymous email
      }
      contactEmail = this.guestEmail() ?? '';
    }

    this.currentName.set(trimmed);
    this.contacts.upsert(this.currentUid, trimmed, contactEmail); // best-effort, doesn't block the check-in below

    await this.mutate((s) => {
      const apologies = s.apologies.filter((a) => a.uid !== this.currentUid);
      const already = s.attendees.some((a) => a.uid === this.currentUid);
      if (already) {
        const next = {
          ...s,
          apologies,
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
      const next = { ...s, apologies, attendees: [...s.attendees, attendee] };
      return { next, result: undefined };
    });
    return true;
  }

  /**
   * Withdraws the current user from this meeting: removes them from
   * attendees, releases any (unlocked) role claim they hold, cancels their
   * own speaker signup, releases any evaluator slot they hold for someone
   * else's speech, and records them in `apologies` — all in one
   * transaction. Determines "was checked in" from the transaction's own
   * `attendees` read, not from `currentName()`, so it's a safe no-op
   * standalone (e.g. a signed-in member who never actually checked in for
   * this meeting) rather than depending on the caller (the UI) to enforce
   * that — consistent with how every other mutator here validates inside
   * its own `mutate()` callback.
   */
  uncheckIn(): Promise<void> {
    const uid = this.currentUid;

    return this.mutate((s) => {
      const attendee = s.attendees.find((a) => a.uid === uid);
      if (!attendee) return { next: s, result: undefined }; // never checked in — nothing to withdraw

      const next: CheckinSnapshot = {
        ...s,
        attendees: s.attendees.filter((a) => a.uid !== uid),
        roles: Object.fromEntries(
          Object.entries(s.roles).map(([roleId, claim]) =>
            !s.lockedRoles.includes(roleId) && claim.uid === uid ? [roleId, { name: '', uid: '' }] : [roleId, claim]
          )
        ),
        speakers: s.speakers
          .filter((sp) => sp.uid !== uid) // cancels their own prepared-speech signup
          .map((sp) => (sp.evaluator?.uid === uid ? { ...sp, evaluator: null } : sp)), // releases an evaluator slot claimed for someone else's speech
        apologies: s.apologies.some((a) => a.uid === uid)
          ? s.apologies // idempotent — repeat calls don't duplicate
          : [
              ...s.apologies,
              { uid, name: attendee.name, joinedAt: new Date().toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' }) },
            ],
      };
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

  /**
   * A member may only release their own claim; an admin may release anyone's
   * (running the meeting means being able to free up a role someone claimed
   * by mistake, or who's no longer available, without waiting on them).
   * Organizer-locked roles can't be released by either.
   */
  releaseRole(roleKey: string): Promise<void> {
    return this.mutate((s) => {
      if (s.lockedRoles.includes(roleKey)) return { next: s, result: undefined };
      const existing = s.roles[roleKey];
      if (!existing || (existing.uid !== this.currentUid && !this.auth.isAdmin())) {
        return { next: s, result: undefined };
      }
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
        ? this.normalize(snap.data() as CheckinSnapshot)
        : this.defaultSnapshot(meetingId);
      const { next, result } = fn(current);
      tx.set(ref, next);
      return result;
    }).catch((err) => {
      console.error('checkin transaction failed', err);
      return undefined;
    });
  }

  /**
   * Backward-compat for checkins/** documents written before `apologies`
   * existed (`.emulator-data/` persists across restarts, so old documents
   * genuinely exist without this field) — treats a missing field as empty
   * rather than `undefined`, which would otherwise throw the moment
   * anything here calls `.some()`/`.filter()`/`.map()` on it.
   */
  private normalize(data: CheckinSnapshot): CheckinSnapshot {
    return { ...data, apologies: data.apologies ?? [] };
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
        club: '',
        sub: '',
        addr: '',
      },
      attendees: [],
      roles: {},
      speakers: [],
      lockedRoles: [],
      apologies: [],
    };
  }

  /** Cheap placeholder for the snapshot field initializer; real data arrives via loadMeeting()'s listener. */
  private emptySnapshotPlaceholder(): CheckinSnapshot {
    return {
      meeting: { id: 'default', date: '', theme: '', word: '', start: '18:15', maxSpeakers: 3, club: '', sub: '', addr: '' },
      attendees: [],
      roles: {},
      speakers: [],
      lockedRoles: [],
      apologies: [],
    };
  }
}
