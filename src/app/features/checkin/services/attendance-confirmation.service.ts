import { Injectable, inject, signal } from '@angular/core';
import { arrayRemove, arrayUnion, collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { MemberHistoryRecord } from '../../member/models/member.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'memberHistory';

interface MeetingMeta {
  date: string;
  theme: string;
}

type LocalPatch = Partial<Pick<MemberHistoryRecord, 'attended' | 'rolesConfirmed' | 'spoke' | 'evaluatedSpeakerId'>>;

function emptyRecord(meetingId: string, uid: string, meta: MeetingMeta | undefined): MemberHistoryRecord {
  return {
    meetingId,
    uid,
    date: meta?.date ?? '',
    theme: meta?.theme ?? '',
    attended: false,
    rolesConfirmed: [],
    spoke: false,
    evaluatedSpeakerId: null,
    updatedAt: '',
  };
}

/**
 * Admin-only "mark register" / role-confirmation actions on /checkin —
 * writes the official memberHistory/{meetingId}_{uid} record the member
 * dashboard reads (see MemberHistoryService). A sibling of
 * CheckinStateService, not an extension of it: CheckinStateService.mutate()
 * is hard-wired to one whole-doc, first-come-first-served transactional
 * read-decide-write over `checkins/{meetingId}` (see the
 * role-locking-pattern skill) — memberHistory writes are the opposite
 * shape: single-admin, non-competing, partial/mergeable fields on a
 * different collection with different (meeting, uid) addressing.
 */
@Injectable({ providedIn: 'root' })
export class AttendanceConfirmationService {
  private readonly firestore = inject(FIRESTORE);

  private readonly confirmations = signal<Map<string, MemberHistoryRecord>>(new Map());
  readonly confirmationsForCurrentMeeting = this.confirmations.asReadonly();
  private loadedMeetingId: string | null = null;

  /** Idempotent per meetingId, same pattern as CheckinStateService.loadMeeting(). */
  async loadForMeeting(meetingId: string): Promise<void> {
    if (meetingId === this.loadedMeetingId) return;
    this.loadedMeetingId = meetingId;

    const snap = await getDocs(query(collection(this.firestore, COLLECTION), where('meetingId', '==', meetingId)));
    const map = new Map<string, MemberHistoryRecord>();
    for (const d of snap.docs) {
      const record = d.data() as MemberHistoryRecord;
      map.set(record.uid, record);
    }
    this.confirmations.set(map);
  }

  confirmAttendance(meetingId: string, uid: string, meta: MeetingMeta): Promise<void> {
    return this.upsert(meetingId, uid, meta, { attended: true }, { attended: true });
  }

  unconfirmAttendance(meetingId: string, uid: string): Promise<void> {
    return this.upsert(meetingId, uid, undefined, { attended: false }, { attended: false });
  }

  confirmRole(meetingId: string, uid: string, roleId: string, meta: MeetingMeta): Promise<void> {
    const roles = new Set(this.confirmations().get(uid)?.rolesConfirmed ?? []);
    roles.add(roleId);
    return this.upsert(meetingId, uid, meta, { rolesConfirmed: arrayUnion(roleId) }, { rolesConfirmed: [...roles] });
  }

  unconfirmRole(meetingId: string, uid: string, roleId: string): Promise<void> {
    const roles = new Set(this.confirmations().get(uid)?.rolesConfirmed ?? []);
    roles.delete(roleId);
    return this.upsert(meetingId, uid, undefined, { rolesConfirmed: arrayRemove(roleId) }, { rolesConfirmed: [...roles] });
  }

  confirmSpeech(meetingId: string, uid: string, meta: MeetingMeta): Promise<void> {
    return this.upsert(meetingId, uid, meta, { spoke: true }, { spoke: true });
  }

  unconfirmSpeech(meetingId: string, uid: string): Promise<void> {
    return this.upsert(meetingId, uid, undefined, { spoke: false }, { spoke: false });
  }

  /** Keyed by the evaluator's uid, not the speaker's — the record describes the evaluator's own involvement. */
  confirmEvaluation(meetingId: string, evaluatorUid: string, speakerId: string, meta: MeetingMeta): Promise<void> {
    return this.upsert(
      meetingId,
      evaluatorUid,
      meta,
      { evaluatedSpeakerId: speakerId },
      { evaluatedSpeakerId: speakerId }
    );
  }

  unconfirmEvaluation(meetingId: string, evaluatorUid: string): Promise<void> {
    return this.upsert(meetingId, evaluatorUid, undefined, { evaluatedSpeakerId: null }, { evaluatedSpeakerId: null });
  }

  /**
   * firestorePatch is what's actually written (may contain arrayUnion()/
   * arrayRemove() sentinels); localPatch is the fully-resolved equivalent
   * used to update the in-memory cache optimistically, since sentinel
   * values can't be read back client-side. The two must describe the same
   * change — callers compute localPatch from the current cached state.
   */
  private async upsert(
    meetingId: string,
    uid: string,
    meta: MeetingMeta | undefined,
    firestorePatch: Record<string, unknown>,
    localPatch: LocalPatch
  ): Promise<void> {
    const ref = doc(this.firestore, COLLECTION, `${meetingId}_${uid}`);
    const updatedAt = new Date().toISOString();

    try {
      await setDoc(
        ref,
        { meetingId, uid, ...(meta ? { date: meta.date, theme: meta.theme } : {}), ...firestorePatch, updatedAt },
        { merge: true }
      );
    } catch (err) {
      console.error('memberHistory confirm failed', err);
      throw err;
    }

    this.confirmations.update((map) => {
      const next = new Map(map);
      const existing = next.get(uid) ?? emptyRecord(meetingId, uid, meta);
      next.set(uid, { ...existing, ...(meta ? { date: meta.date, theme: meta.theme } : {}), ...localPatch, updatedAt });
      return next;
    });
  }
}
