import { Injectable, inject } from '@angular/core';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { MemberHistoryEntry, MemberHistoryRecord } from '../models/member.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'memberHistory';

/**
 * Cross-meeting history for a member — a real filtered query
 * (`where('uid','==', uid)`) against the official memberHistory collection
 * written by AttendanceConfirmationService's admin confirm actions (see
 * `/checkin`'s admin-only controls). Replaces the earlier whole-`checkins`-
 * collection scan: date/theme are now denormalized onto each record at
 * confirm time, so no PublishedAgendaService join is needed either.
 *
 * A one-time getDocs(), not a live onSnapshot() — a dashboard visit is
 * occasional, matching SavedAgendaService.load()'s one-time-read precedent
 * rather than holding a permanent listener.
 */
@Injectable({ providedIn: 'root' })
export class MemberHistoryService {
  private readonly firestore = inject(FIRESTORE);

  async loadHistory(uid: string): Promise<MemberHistoryEntry[]> {
    const snap = await getDocs(query(collection(this.firestore, COLLECTION), where('uid', '==', uid)));

    return snap.docs
      .map((d) => d.data() as MemberHistoryRecord)
      .filter((r) => r.attended || r.rolesConfirmed.length > 0 || r.spoke || r.evaluatedSpeakerId)
      .map((r) => ({
        meetingId: r.meetingId,
        date: r.date,
        theme: r.theme,
        attended: r.attended,
        rolesConfirmed: r.rolesConfirmed,
        spoke: r.spoke,
        evaluatedSpeakerId: r.evaluatedSpeakerId,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}
