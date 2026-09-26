import { Injectable, inject } from '@angular/core';
import { doc, setDoc } from 'firebase/firestore';
import { CheckinContact } from '../models/checkin.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { ClubContextService } from '../../../core/club/club-context.service';

const CLUBS_COLLECTION = 'clubs';
const COLLECTION = 'checkinContacts';

/**
 * Admin-only-readable store of real emails behind check-in identities — a
 * sibling of CheckinStateService, not part of it, since it's a different
 * collection with different rules (public write like `checkins/**`, but
 * admin-only READ, unlike it) and simple upsert semantics rather than
 * `checkins`' first-come-first-served transactional shape. This is the
 * foundation for a planned reminder-email feature; nothing reads from it
 * yet beyond what an admin might look up directly.
 *
 * Multi-club: lives at `clubs/{clubId}/checkinContacts/{uid}` — a no-op
 * (logged, not thrown, matching the fail-open contract below) if called
 * with no club resolved, which shouldn't happen since every caller of
 * upsert() (CheckinStateService.checkIn()) already requires a resolved club.
 */
@Injectable({ providedIn: 'root' })
export class CheckinContactsService {
  private readonly firestore = inject(FIRESTORE);
  private readonly clubContext = inject(ClubContextService);

  async upsert(uid: string, name: string, email: string): Promise<void> {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) {
      console.error('checkinContacts upsert skipped — no club resolved');
      return;
    }
    const contact: CheckinContact = { uid, name, email, updatedAt: new Date().toISOString() };
    try {
      await setDoc(doc(this.firestore, CLUBS_COLLECTION, clubId, COLLECTION, uid), contact, { merge: true });
    } catch (err) {
      // Never let a contacts-list write failure block the actual check-in —
      // the attendee record in `checkins/**` is the thing that matters live
      // during a meeting; this is a secondary, best-effort side record.
      console.error('checkinContacts upsert failed', err);
    }
  }
}
