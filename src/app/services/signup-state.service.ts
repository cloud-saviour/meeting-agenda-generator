import { Injectable, computed, signal } from '@angular/core';
import {
  Attendee,
  DEFAULT_ROLE_KEYS,
  RoleClaim,
  SignupMeeting,
  SignupSnapshot,
  SignupSpeaker,
} from '../models/signup.models';

const STORAGE_KEY = 'agora-signup-data';
const UID_KEY = 'agora-signup-uid';
const NAME_KEY = 'agora-signup-name';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function emptyRoles(): Record<string, RoleClaim> {
  const roles: Record<string, RoleClaim> = {};
  for (const key of DEFAULT_ROLE_KEYS) {
    roles[key] = { name: '', uid: '' };
  }
  return roles;
}

function defaultSnapshot(): SignupSnapshot {
  return {
    meeting: {
      id: 'default',
      date: new Date().toISOString().slice(0, 10),
      theme: '',
      word: '',
      start: '18:15',
      maxSpeakers: 3,
    },
    attendees: [],
    roles: emptyRoles(),
    speakers: [],
  };
}

@Injectable({ providedIn: 'root' })
export class SignupStateService {
  // ── Local identity (per-browser, persists across visits) ────────────────
  readonly currentUid: string;
  readonly currentName = signal<string>('');

  // ── Shared meeting state (Phase 1: localStorage; Phase 2: Firebase) ─────
  private readonly snapshot = signal<SignupSnapshot>(this.loadSnapshot());

  readonly meeting = computed(() => this.snapshot().meeting);
  readonly attendees = computed(() => this.snapshot().attendees);
  readonly roles = computed(() => this.snapshot().roles);
  readonly speakers = computed(() => this.snapshot().speakers);

  readonly isCheckedIn = computed(() =>
    this.attendees().some((a) => a.uid === this.currentUid)
  );

  constructor() {
    this.currentUid = this.loadOrCreateUid();
    this.currentName.set(localStorage.getItem(NAME_KEY) || '');
  }

  // ── Identity ──────────────────────────────────────────────────────────
  private loadOrCreateUid(): string {
    let uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = makeId();
      localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  }

  // ── Attendance ────────────────────────────────────────────────────────
  checkIn(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.currentName.set(trimmed);
    localStorage.setItem(NAME_KEY, trimmed);

    this.update((s) => {
      const already = s.attendees.some((a) => a.uid === this.currentUid);
      if (already) {
        return {
          ...s,
          attendees: s.attendees.map((a) =>
            a.uid === this.currentUid ? { ...a, name: trimmed } : a
          ),
        };
      }
      const attendee: Attendee = {
        uid: this.currentUid,
        name: trimmed,
        joinedAt: new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
      };
      return { ...s, attendees: [...s.attendees, attendee] };
    });
  }

  // ── Roles: first-come locking ────────────────────────────────────────
  /** Returns true if the claim succeeded, false if the role was already taken. */
  claimRole(roleKey: string): boolean {
    if (!this.currentName()) return false;
    let succeeded = false;
    this.update((s) => {
      const existing = s.roles[roleKey];
      if (existing && existing.uid && existing.uid !== this.currentUid) {
        succeeded = false;
        return s;
      }
      succeeded = true;
      return {
        ...s,
        roles: { ...s.roles, [roleKey]: { name: this.currentName(), uid: this.currentUid } },
      };
    });
    return succeeded;
  }

  /** A member may only release their own claim. */
  releaseRole(roleKey: string): void {
    this.update((s) => {
      const existing = s.roles[roleKey];
      if (!existing || existing.uid !== this.currentUid) return s;
      return { ...s, roles: { ...s.roles, [roleKey]: { name: '', uid: '' } } };
    });
  }

  // ── Speakers ──────────────────────────────────────────────────────────
  addSpeakerSignup(data: { title: string; level: string; timePref: string }): boolean {
    if (!this.currentName()) return false;
    const s0 = this.snapshot();
    if (s0.speakers.length >= s0.meeting.maxSpeakers) return false;
    if (s0.speakers.some((sp) => sp.uid === this.currentUid)) return false;

    const speaker: SignupSpeaker = {
      id: makeId(),
      name: this.currentName(),
      uid: this.currentUid,
      title: data.title.trim(),
      level: data.level.trim(),
      timePref: data.timePref,
      evaluator: null,
    };
    this.update((s) => ({ ...s, speakers: [...s.speakers, speaker] }));
    return true;
  }

  removeSpeakerSignup(id: string): void {
    this.update((s) => {
      const sp = s.speakers.find((x) => x.id === id);
      if (!sp || sp.uid !== this.currentUid) return s;
      return { ...s, speakers: s.speakers.filter((x) => x.id !== id) };
    });
  }

  // ── Evaluators: one evaluation slot per speaker, one claim per member ──
  claimEvaluatorSlot(speakerId: string): boolean {
    if (!this.currentName()) return false;
    const s0 = this.snapshot();
    const alreadyEvaluating = s0.speakers.some((sp) => sp.evaluator?.uid === this.currentUid);
    if (alreadyEvaluating) return false;

    let succeeded = false;
    this.update((s) => ({
      ...s,
      speakers: s.speakers.map((sp) => {
        if (sp.id !== speakerId) return sp;
        if (sp.evaluator && sp.evaluator.uid) return sp;
        if (sp.uid === this.currentUid) return sp; // can't evaluate your own speech
        succeeded = true;
        return { ...sp, evaluator: { name: this.currentName(), uid: this.currentUid } };
      }),
    }));
    return succeeded;
  }

  releaseEvaluatorSlot(speakerId: string): void {
    this.update((s) => ({
      ...s,
      speakers: s.speakers.map((sp) => {
        if (sp.id !== speakerId) return sp;
        if (!sp.evaluator || sp.evaluator.uid !== this.currentUid) return sp;
        return { ...sp, evaluator: null };
      }),
    }));
  }

  // ── Meeting config (admin) ──────────────────────────────────────────────
  updateMeeting(patch: Partial<SignupMeeting>): void {
    this.update((s) => ({ ...s, meeting: { ...s.meeting, ...patch } }));
  }

  resetAll(): void {
    this.snapshot.set(defaultSnapshot());
    this.persist();
  }

  // ── Persistence (Phase 1: localStorage) ─────────────────────────────────
  private update(fn: (s: SignupSnapshot) => SignupSnapshot): void {
    this.snapshot.update(fn);
    this.persist();
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
  }

  private loadSnapshot(): SignupSnapshot {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSnapshot();
      const parsed = JSON.parse(raw) as SignupSnapshot;
      // Backfill any role keys added since the data was last saved
      const roles = { ...emptyRoles(), ...parsed.roles };
      return { ...defaultSnapshot(), ...parsed, roles };
    } catch {
      return defaultSnapshot();
    }
  }
}
