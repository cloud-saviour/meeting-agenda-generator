import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Attendee,
  CheckinMeeting,
  CheckinSnapshot,
  CheckinSpeaker,
  RoleClaim,
} from '../models/checkin.models';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { StorageService } from '../../../core/services/storage.service';
import { APP_LOCALE } from '../../../core/utils/locale';

const STORAGE_KEY = 'agora-checkin-data';
const UID_KEY = 'agora-checkin-uid';
const NAME_KEY = 'agora-checkin-name';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

@Injectable({ providedIn: 'root' })
export class CheckinStateService {
  private readonly roleDefs = inject(RoleDefinitionService);
  private readonly storage = inject(StorageService);

  // ── Local identity (per-browser, persists across visits) ────────────────
  readonly currentUid: string;
  readonly currentName = signal<string>('');

  // ── Shared meeting state (Phase 1: localStorage; Phase 2: Firebase) ─────
  private readonly snapshot = signal<CheckinSnapshot>(this.emptySnapshotPlaceholder());
  /** Which localStorage key persist()/loadSnapshot() target — set by loadMeeting(). */
  private currentStorageKey: string = STORAGE_KEY;

  readonly meeting = computed(() => this.snapshot().meeting);
  readonly attendees = computed(() => this.snapshot().attendees);
  readonly roles = computed(() => this.snapshot().roles);
  readonly speakers = computed(() => this.snapshot().speakers);

  readonly isCheckedIn = computed(() =>
    this.attendees().some((a) => a.uid === this.currentUid)
  );

  constructor() {
    this.currentUid = this.loadOrCreateUid();
    this.currentName.set(this.storage.get(NAME_KEY) || '');
    this.snapshot.set(this.loadSnapshot(this.currentStorageKey, 'default'));
  }

  /**
   * Switches to a specific meeting's check-in sheet, isolated from every other
   * meeting id. 'default' (the fallback when a URL has no ?meeting= param) uses
   * the original fixed storage key unsuffixed, so pre-existing bookmarked data
   * keeps working untouched; any other id gets its own `${STORAGE_KEY}-<id>` key.
   */
  loadMeeting(meetingId: string): void {
    this.currentStorageKey = meetingId === 'default' ? STORAGE_KEY : `${STORAGE_KEY}-${meetingId}`;
    this.snapshot.set(this.loadSnapshot(this.currentStorageKey, meetingId));
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
  checkIn(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.currentName.set(trimmed);
    this.storage.set(NAME_KEY, trimmed);

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
        joinedAt: new Date().toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' }),
      };
      return { ...s, attendees: [...s.attendees, attendee] };
    });
  }

  // ── Roles: first-come locking ────────────────────────────────────────
  /** Returns true if the claim succeeded, false if the role was already taken. */
  claimRole(roleKey: string): boolean {
    if (!this.currentName()) return false;
    const existing = this.snapshot().roles[roleKey];
    if (existing?.uid && existing.uid !== this.currentUid) return false;

    this.update((s) => ({
      ...s,
      roles: { ...s.roles, [roleKey]: { name: this.currentName(), uid: this.currentUid } },
    }));
    return true;
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

    const speaker: CheckinSpeaker = {
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
    if (s0.speakers.some((sp) => sp.evaluator?.uid === this.currentUid)) return false;

    const target = s0.speakers.find((sp) => sp.id === speakerId);
    if (!target || target.evaluator?.uid || target.uid === this.currentUid) return false;

    this.update((s) => ({
      ...s,
      speakers: s.speakers.map((sp) =>
        sp.id === speakerId ? { ...sp, evaluator: { name: this.currentName(), uid: this.currentUid } } : sp
      ),
    }));
    return true;
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
  updateMeeting(patch: Partial<CheckinMeeting>): void {
    this.update((s) => ({ ...s, meeting: { ...s.meeting, ...patch } }));
  }

  resetAll(): void {
    this.snapshot.set(this.defaultSnapshot(this.snapshot().meeting.id));
    this.persist();
  }

  // ── Persistence (Phase 1: localStorage) ─────────────────────────────────
  private update(fn: (s: CheckinSnapshot) => CheckinSnapshot): void {
    this.snapshot.update(fn);
    this.persist();
  }

  private persist(): void {
    this.storage.set(this.currentStorageKey, JSON.stringify(this.snapshot()));
  }

  private loadSnapshot(key: string, meetingId: string): CheckinSnapshot {
    try {
      const raw = this.storage.get(key);
      if (!raw) return this.defaultSnapshot(meetingId);
      const parsed = JSON.parse(raw) as CheckinSnapshot;
      // Backfill any role ids added (or missing) since the data was last saved
      const roles = { ...this.emptyRoles(), ...parsed.roles };
      return { ...this.defaultSnapshot(meetingId), ...parsed, roles };
    } catch {
      return this.defaultSnapshot(meetingId);
    }
  }

  /**
   * Sourced from roleDefs.all() rather than activeRoles() — an archived-but-claimed
   * role keeps its slot in the snapshot data even though it won't render on the board.
   */
  private emptyRoles(): Record<string, RoleClaim> {
    const roles: Record<string, RoleClaim> = {};
    for (const def of this.roleDefs.all()) {
      roles[def.id] = { name: '', uid: '' };
    }
    return roles;
  }

  private defaultSnapshot(meetingId: string = 'default'): CheckinSnapshot {
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
      roles: this.emptyRoles(),
      speakers: [],
    };
  }

  /** Cheap placeholder for the snapshot field initializer; real data loads in the constructor. */
  private emptySnapshotPlaceholder(): CheckinSnapshot {
    return {
      meeting: { id: 'default', date: '', theme: '', word: '', start: '18:15', maxSpeakers: 3 },
      attendees: [],
      roles: {},
      speakers: [],
    };
  }
}
