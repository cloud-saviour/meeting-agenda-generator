import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firestore.provider';
import { AuthService } from '../auth/auth.service';
import { Club, ClubSlugPointer } from '../models/club.models';

const CLUBS_COLLECTION = 'clubs';
const CLUB_SLUGS_COLLECTION = 'clubSlugs';

/**
 * Resolves the `/c/:clubSlug` route segment to a club and holds that
 * club's live data for the rest of the app — every club-scoped Firestore
 * service (CheckinStateService, RoleDefinitionService, etc.) injects this
 * to build its paths as `clubs/{currentClubId()}/<collection>/...` instead
 * of a bare top-level collection.
 *
 * Deliberately root-provided but NOT auto-resolving on construction (unlike
 * AuthService's onAuthStateChanged, which has exactly one global answer) —
 * there is no "current club" until clubContextGuard calls setClub() with a
 * slug from the route, since which club is current is route-dependent, not
 * session-dependent. A navigation to a different club's `/c/:clubSlug`
 * calls setClub() again.
 *
 * The `appAdmins/{uid}` grant listener used to live in AuthService (see its
 * class doc history) — it moved here because a grant is now genuinely
 * per-club (clubs/{clubId}/appAdmins/{uid}), not global. AuthService keeps
 * only the real, global `admin` custom claim.
 */
@Injectable({ providedIn: 'root' })
export class ClubContextService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);
  private readonly auth = inject(AuthService);

  readonly currentClubSlug = signal<string | null>(null);
  readonly currentClubId = signal<string | null>(null);
  readonly currentClub = signal<Club | null>(null);
  private readonly grantedAdmin = signal(false);

  /** Full parity with the real claim for every club feature except granting/revoking access to THIS club — see firestore.rules' appAdmins rule under clubs/{clubId}. */
  readonly isAppAdmin = computed(() => this.auth.isAdmin() || this.grantedAdmin());

  /** True once the slug has resolved to a club AND (if signed in) the first appAdmins/{uid} snapshot for THIS club has arrived — same "don't flash-redirect on a cold reload" reasoning AuthService.ready() already documents. */
  readonly ready = signal(false);

  private unsubscribeClub: (() => void) | undefined;
  private unsubscribeGrantedAdmin: (() => void) | undefined;
  private resolvingSlug: string | null = null;

  ngOnDestroy(): void {
    this.unsubscribeClub?.();
    this.unsubscribeGrantedAdmin?.();
  }

  /**
   * Resolves `slug` to a clubId via one `clubSlugs/{slug}` read, then
   * subscribes live to that club's branding doc and (once auth is known)
   * this user's grant doc. Returns false if the slug doesn't resolve to
   * any club — the caller (clubContextGuard) redirects on that.
   *
   * Idempotent per slug: re-navigating within the same club is a cheap
   * no-op rather than tearing down and rebuilding both listeners, same
   * shape as CheckinStateService.loadMeeting()/PublishedAgendaService.loadMeeting().
   */
  async setClub(slug: string): Promise<boolean> {
    if (slug === this.currentClubSlug()) return this.currentClubId() !== null;
    this.resolvingSlug = slug;

    this.unsubscribeClub?.();
    this.unsubscribeGrantedAdmin?.();
    this.currentClubSlug.set(slug);
    this.currentClubId.set(null);
    this.currentClub.set(null);
    this.grantedAdmin.set(false);
    this.ready.set(false);

    let clubId: string;
    try {
      const pointerSnap = await getDoc(doc(this.firestore, CLUB_SLUGS_COLLECTION, slug));
      if (!pointerSnap.exists()) return false;
      clubId = (pointerSnap.data() as ClubSlugPointer).clubId;
    } catch (err) {
      console.error('club slug resolution failed', err);
      return false;
    }

    // A navigation to a different club could have started (and completed)
    // while this async resolution was in flight — never let a stale
    // resolution clobber a newer one's state.
    if (this.resolvingSlug !== slug) return this.currentClubId() !== null;

    this.currentClubId.set(clubId);

    this.unsubscribeClub = onSnapshot(
      doc(this.firestore, CLUBS_COLLECTION, clubId),
      (snap) => this.zone.run(() => this.currentClub.set(snap.exists() ? (snap.data() as Club) : null)),
      (err) => this.zone.run(() => console.error('club snapshot listener failed', err))
    );

    const user = this.auth.currentUser();
    if (!user) {
      this.ready.set(true);
      return true;
    }

    await new Promise<void>((resolve) => {
      let resolved = false;
      this.unsubscribeGrantedAdmin = onSnapshot(
        doc(this.firestore, CLUBS_COLLECTION, clubId, 'appAdmins', user.uid),
        (snap) =>
          this.zone.run(() => {
            this.grantedAdmin.set(snap.exists());
            if (!resolved) {
              resolved = true;
              resolve();
            }
          }),
        (err) =>
          this.zone.run(() => {
            console.error('club appAdmins snapshot listener failed', err);
            if (!resolved) {
              resolved = true;
              resolve();
            }
          })
      );
    });

    if (this.resolvingSlug !== slug) return this.currentClubId() !== null;
    this.ready.set(true);
    return true;
  }
}
