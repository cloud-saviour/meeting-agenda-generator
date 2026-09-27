import { Injectable, NgZone, OnDestroy, effect, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
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
 * yet beyond the live `byUid` map below, read by AttendanceListComponent to
 * show an attendee's email under their name on `/checkin`'s "Who is coming"
 * list.
 *
 * Multi-club: lives at `clubs/{clubId}/checkinContacts/{uid}` — a no-op
 * (logged, not thrown, matching the fail-open contract below) if called
 * with no club resolved, which shouldn't happen since every caller of
 * upsert() (CheckinStateService.checkIn()) already requires a resolved club.
 *
 * `byUid()` subscribes ONLY when the viewer is an app-admin of the current
 * club — firestore.rules makes this collection admin-read-only (unlike every
 * other checkin-related collection, which is public), specifically so raw
 * emails never reach an anonymous or member visitor's client. Subscribing
 * unconditionally (the pattern every other org-scoped service here uses)
 * would mean every non-admin visit to `/checkin` fires a permission-denied
 * read — gate on `isAppAdmin()` too, not just `currentClubId()`, the way no
 * other service in this app needs to.
 */
@Injectable({ providedIn: 'root' })
export class CheckinContactsService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly clubContext = inject(ClubContextService);
  private readonly zone = inject(NgZone);

  private readonly byUidSignal = signal<Map<string, CheckinContact>>(new Map());
  /** Email/name keyed by check-in uid — empty for anyone who isn't an app-admin of the current club. */
  readonly byUid = this.byUidSignal.asReadonly();
  private unsubscribe: (() => void) | undefined;

  constructor() {
    effect(() => {
      const clubId = this.clubContext.currentClubId();
      const isAppAdmin = this.clubContext.isAppAdmin();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.byUidSignal.set(new Map());
      if (!clubId || !isAppAdmin) return;

      this.unsubscribe = onSnapshot(collection(this.firestore, CLUBS_COLLECTION, clubId, COLLECTION), (snap) =>
        this.zone.run(() => {
          const next = new Map<string, CheckinContact>();
          for (const d of snap.docs) next.set(d.id, d.data() as CheckinContact);
          this.byUidSignal.set(next);
        })
      );
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

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
