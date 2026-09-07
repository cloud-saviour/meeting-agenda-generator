import { Injectable, inject } from '@angular/core';
import { doc, setDoc } from 'firebase/firestore';
import { CheckinContact } from '../models/checkin.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'checkinContacts';

/**
 * Admin-only-readable store of real emails behind check-in identities — a
 * sibling of CheckinStateService, not part of it, since it's a different
 * collection with different rules (public write like `checkins/**`, but
 * admin-only READ, unlike it) and simple upsert semantics rather than
 * `checkins`' first-come-first-served transactional shape. This is the
 * foundation for a planned reminder-email feature; nothing reads from it
 * yet beyond what an admin might look up directly.
 */
@Injectable({ providedIn: 'root' })
export class CheckinContactsService {
  private readonly firestore = inject(FIRESTORE);

  async upsert(uid: string, name: string, email: string): Promise<void> {
    const contact: CheckinContact = { uid, name, email, updatedAt: new Date().toISOString() };
    try {
      await setDoc(doc(this.firestore, COLLECTION, uid), contact, { merge: true });
    } catch (err) {
      // Never let a contacts-list write failure block the actual check-in —
      // the attendee record in `checkins/**` is the thing that matters live
      // during a meeting; this is a secondary, best-effort side record.
      console.error('checkinContacts upsert failed', err);
    }
  }
}
