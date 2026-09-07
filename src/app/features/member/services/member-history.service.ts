import { Injectable, inject } from '@angular/core';
import { collection, getDocs } from 'firebase/firestore';
import { CheckinSnapshot } from '../../checkin/models/checkin.models';
import { MemberHistoryEntry } from '../models/member.models';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'checkins';

/** Pure so it's testable without Firestore — scans one meeting's checkin snapshot for a given uid's involvement. */
export function scanOne(meetingId: string, data: CheckinSnapshot, uid: string): MemberHistoryEntry {
  const rolesClaimed = Object.entries(data.roles)
    .filter(([, claim]) => claim.uid === uid)
    .map(([roleKey]) => roleKey);
  const speaker = data.speakers.find((sp) => sp.uid === uid);
  const evaluated = data.speakers.find((sp) => sp.evaluator?.uid === uid);

  return {
    meetingId,
    date: '',
    theme: '',
    attended: data.attendees.some((a) => a.uid === uid),
    rolesClaimed,
    spoke: !!speaker,
    evaluatedSpeakerId: evaluated?.id ?? null,
  };
}

/**
 * Cross-meeting history for a member — reuses PublishedAgendaService's
 * "enumerate the whole collection client-side" pattern rather than a new
 * denormalized index, since `uid` only lives nested inside array/map fields
 * on `checkins/{meetingId}` docs (unqueryable via `where()`). Costs O(every
 * meeting the club has ever held) per call, not O(meetings this member
 * attended) — the right fit at small-club scale, not beyond it (see the
 * member-facing-accounts plan for the future denormalized-index option).
 *
 * A one-time getDocs(), not a live onSnapshot() — a dashboard visit is
 * occasional, matching SavedAgendaService.load()'s one-time-read precedent
 * rather than holding a permanent listener over the whole collection.
 */
@Injectable({ providedIn: 'root' })
export class MemberHistoryService {
  private readonly firestore = inject(FIRESTORE);
  private readonly publishedAgenda = inject(PublishedAgendaService);

  async loadHistory(uid: string): Promise<MemberHistoryEntry[]> {
    const snap = await getDocs(collection(this.firestore, COLLECTION));
    const meta = this.publishedAgenda.entries();

    return snap.docs
      .map((d) => scanOne(d.id, d.data() as CheckinSnapshot, uid))
      .filter((e) => e.attended || e.rolesClaimed.length > 0 || e.spoke || e.evaluatedSpeakerId)
      .map((e) => {
        const entry = meta.find((m) => m.no === e.meetingId);
        return { ...e, date: entry?.date ?? '', theme: entry?.theme ?? '' };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}
