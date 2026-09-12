import { Injectable, inject, signal } from '@angular/core';
import { arrayRemove, arrayUnion, collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { MemberHistoryRecord } from '../../member/models/member.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';
import { AuditAction } from '../../../core/audit/audit-log.models';
import { appendAuditEntry } from '../../../core/audit/audit-log.util';

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
  private readonly auth = inject(AuthService);

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
    return this.upsert(
      meetingId,
      uid,
      meta,
      { attended: true },
      { attended: true },
      'attendance.confirm',
      `Confirmed attendance for ${uid} at meeting #${meetingId}`
    );
  }

  unconfirmAttendance(meetingId: string, uid: string): Promise<void> {
    return this.upsert(
      meetingId,
      uid,
      undefined,
      { attended: false },
      { attended: false },
      'attendance.unconfirm',
      `Unconfirmed attendance for ${uid} at meeting #${meetingId}`
    );
  }

  confirmRole(meetingId: string, uid: string, roleId: string, meta: MeetingMeta): Promise<void> {
    const roles = new Set(this.confirmations().get(uid)?.rolesConfirmed ?? []);
    roles.add(roleId);
    return this.upsert(
      meetingId,
      uid,
      meta,
      { rolesConfirmed: arrayUnion(roleId) },
      { rolesConfirmed: [...roles] },
      'attendance.confirm',
      `Confirmed role "${roleId}" for ${uid} at meeting #${meetingId}`
    );
  }

  unconfirmRole(meetingId: string, uid: string, roleId: string): Promise<void> {
    const roles = new Set(this.confirmations().get(uid)?.rolesConfirmed ?? []);
    roles.delete(roleId);
    return this.upsert(
      meetingId,
      uid,
      undefined,
      { rolesConfirmed: arrayRemove(roleId) },
      { rolesConfirmed: [...roles] },
      'attendance.unconfirm',
      `Unconfirmed role "${roleId}" for ${uid} at meeting #${meetingId}`
    );
  }

  confirmSpeech(meetingId: string, uid: string, meta: MeetingMeta): Promise<void> {
    return this.upsert(
      meetingId,
      uid,
      meta,
      { spoke: true },
      { spoke: true },
      'attendance.confirm',
      `Confirmed speech for ${uid} at meeting #${meetingId}`
    );
  }

  unconfirmSpeech(meetingId: string, uid: string): Promise<void> {
    return this.upsert(
      meetingId,
      uid,
      undefined,
      { spoke: false },
      { spoke: false },
      'attendance.unconfirm',
      `Unconfirmed speech for ${uid} at meeting #${meetingId}`
    );
  }

  /** Keyed by the evaluator's uid, not the speaker's — the record describes the evaluator's own involvement. */
  confirmEvaluation(meetingId: string, evaluatorUid: string, speakerId: string, meta: MeetingMeta): Promise<void> {
    return this.upsert(
      meetingId,
      evaluatorUid,
      meta,
      { evaluatedSpeakerId: speakerId },
      { evaluatedSpeakerId: speakerId },
      'attendance.confirm',
      `Confirmed ${evaluatorUid}'s evaluation of speaker ${speakerId} at meeting #${meetingId}`
    );
  }

  unconfirmEvaluation(meetingId: string, evaluatorUid: string): Promise<void> {
    return this.upsert(
      meetingId,
      evaluatorUid,
      undefined,
      { evaluatedSpeakerId: null },
      { evaluatedSpeakerId: null },
      'attendance.unconfirm',
      `Unconfirmed ${evaluatorUid}'s evaluation at meeting #${meetingId}`
    );
  }

  /**
   * firestorePatch is what's actually written (may contain arrayUnion()/
   * arrayRemove() sentinels); localPatch is the fully-resolved equivalent
   * used to update the in-memory cache optimistically, since sentinel
   * values can't be read back client-side. The two must describe the same
   * change — callers compute localPatch from the current cached state.
   * Identified by uid, not display name, in the audit summary — this
   * service only ever sees a uid (see its class doc); resolving that to a
   * name would need touching every calling component's call site for a
   * cosmetic improvement, not a functional one.
   */
  private async upsert(
    meetingId: string,
    uid: string,
    meta: MeetingMeta | undefined,
    firestorePatch: Record<string, unknown>,
    localPatch: LocalPatch,
    auditAction: AuditAction,
    auditSummary: string
  ): Promise<void> {
    const ref = doc(this.firestore, COLLECTION, `${meetingId}_${uid}`);
    const updatedAt = new Date().toISOString();

    try {
      const batch = writeBatch(this.firestore);
      batch.set(
        ref,
        { meetingId, uid, ...(meta ? { date: meta.date, theme: meta.theme } : {}), ...firestorePatch, updatedAt },
        { merge: true }
      );
      appendAuditEntry(this.firestore, batch, auditAction, auditSummary, this.auth.currentUser());
      await batch.commit();
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
