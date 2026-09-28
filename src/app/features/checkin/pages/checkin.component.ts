import { ConfirmButtonComponent } from '../../../layout/confirm-button/confirm-button.component';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CheckinStateService } from '../services/checkin-state.service';
import { AttendanceConfirmationService } from '../services/attendance-confirmation.service';
import { AttendanceListComponent } from '../components/attendance-list/attendance-list.component';
import { ApologiesListComponent } from '../components/apologies-list/apologies-list.component';
import { RoleBoardComponent } from '../components/role-board/role-board.component';
import { SpeakerSignupComponent } from '../components/speaker-signup/speaker-signup.component';
import { EvaluatorSlotsComponent } from '../components/evaluator-slots/evaluator-slots.component';
import { APP_LOCALE } from '../../../core/utils/locale';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubContextService } from '../../../core/club/club-context.service';
import { SubscriptionService } from '../../club-subscription/services/subscription.service';

@Component({
  selector: 'app-checkin',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    NavbarComponent,
    AttendanceListComponent,
    ApologiesListComponent,
    RoleBoardComponent,
    SpeakerSignupComponent,
    EvaluatorSlotsComponent,
    ConfirmButtonComponent,
  ],
  templateUrl: './checkin.component.html',
})
export class CheckinComponent {
  readonly state = inject(CheckinStateService);
  private readonly auth = inject(AuthService);
  private readonly clubContext = inject(ClubContextService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);
  private readonly subscription = inject(SubscriptionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  nameInput = '';
  checkInError: string | null = null;
  meetingId: string;

  guestEmailInput = '';
  guestEmailError: string | null = null;
  guestIdentifying = false;

  /**
   * TEMPORARY: the newsletter subscribe/unsubscribe nav toggle is restricted
   * to platform admins (the real, global `admin` claim — not just a club
   * admin) while the feature is still being tested, so ordinary members and
   * guests never see it. Remove this gate (and the `isPlatformAdmin()` check
   * in the template/effect below) once the feature is confirmed working.
   */
  readonly isPlatformAdmin = this.auth.isAdmin;

  /**
   * Newsletter subscribe/unsubscribe toggle, reusing whoever's email
   * check-in already has (the signed-in account's, or the guest's once
   * identified) — never a separate email box. `null` means "don't know
   * yet" (nobody identified yet, or the one-time isSubscribed() lookup for
   * the resolved email hasn't returned) — the toggle stays hidden rather
   * than guessing, since showing "Subscribe" and then having it turn out
   * they already are would look broken.
   */
  readonly subscribed = signal<boolean | null>(null);
  readonly subscriptionBusy = signal(false);
  private lastCheckedEmail: string | null = null;

  constructor() {
    // `||`, not `??` — an empty-but-present `?meeting=` (e.g. a nav link built
    // from a blank meeting number) must fall back to 'default' too, not resolve to ''.
    this.meetingId = this.route.snapshot.queryParamMap.get('meeting') || 'default';
    this.state.loadMeeting(this.meetingId);
    this.nameInput = this.state.currentName();

    // Catches up nameInput (a plain field, not a reactive template binding)
    // when currentName() is seeded asynchronously after this constructor's
    // synchronous read above — e.g. a signed-in member's displayName,
    // arriving once Firebase Auth's session restore resolves. Guarded the
    // same way CheckinStateService itself guards this seed: never overwrites
    // something the person already typed.
    effect(() => {
      const name = this.state.currentName();
      if (name && !this.nameInput) {
        this.nameInput = name;
      }
    });

    // Reactive, not a one-time check: isAppAdmin() reads false until both
    // Firebase Auth's async session restore AND clubContextGuard's own
    // per-club grant listener resolve, even for an already-signed-in admin
    // on a cold reload — a plain `if (clubContext.isAppAdmin())` here would
    // silently skip loading forever. loadForMeeting() is itself idempotent
    // per meetingId, so repeated effect firings are cheap no-ops.
    //
    // clubContext.isAppAdmin(), not auth.isAdmin(): memberHistory's write
    // rule is isAppAdmin(clubId) (a Firestore-granted admin of THIS club can
    // confirm attendance same as a real-claim one — see firestore.rules), so
    // gating the load on the narrower real-claim check would leave a granted
    // admin's confirm buttons stuck showing stale/empty state even though
    // their writes would actually succeed.
    effect(() => {
      if (this.clubContext.isAppAdmin()) {
        this.attendanceConfirmation.loadForMeeting(this.meetingId);
      }
    });

    // Looks up subscription status once an email is known (signed-in
    // immediately, or a guest once they identify) — re-checks if the email
    // itself changes (switching identity on a shared device, see
    // switchIdentity()), but never re-fires for the SAME email, since
    // subscribe()/unsubscribe() already update `subscribed` locally.
    // TEMPORARY: also gated on isPlatformAdmin() — see that field's own
    // comment — so a non-admin never even triggers the isSubscribed() read
    // while the feature is still being tested.
    effect(() => {
      const email = this.state.currentEmail();
      if (!email || !this.isPlatformAdmin() || email === this.lastCheckedEmail) return;
      this.lastCheckedEmail = email;
      this.subscribed.set(null);
      this.subscription
        .isSubscribed(email)
        .then((yes) => this.subscribed.set(yes))
        .catch((err) => {
          console.error('isSubscribed failed', err);
          this.subscribed.set(null);
        });
    });
  }

  async toggleSubscription(): Promise<void> {
    const email = this.state.currentEmail();
    if (!email || this.subscriptionBusy()) return;
    this.subscriptionBusy.set(true);
    try {
      const wasSubscribed = this.subscribed();
      const ok = wasSubscribed ? await this.subscription.unsubscribe(email) : await this.subscription.subscribe(email);
      if (ok) this.subscribed.set(!wasSubscribed);
    } catch (err) {
      console.error('toggleSubscription failed', err);
    } finally {
      this.subscriptionBusy.set(false);
    }
  }

  /**
   * Only admin and anonymous users may change their check-in name; a
   * signed-in non-admin member's name is locked to their account (they use
   * /member's "Edit Name" instead). Admins are deliberately exempt — they
   * need the flexibility to type whatever name makes sense while running a
   * meeting, same as an anonymous check-in — so isAdmin() short-circuits
   * this to false before the match check below ever runs.
   *
   * The match check itself locks the field only once nameInput demonstrably
   * IS the signed-in member's own name (matches their Auth displayName
   * exactly) — not just "someone is signed in and the field happens to be
   * non-empty". There's no localStorage anymore for this to go stale
   * against, but the same defensive shape is kept: never lock on a value
   * that doesn't actually match the account's real name.
   */
  get isNameLocked(): boolean {
    if (this.auth.isAdmin()) return false;
    const user = this.auth.currentUser();
    return !!user?.displayName && this.nameInput === user.displayName;
  }

  /**
   * Gate condition — hides everything but the meeting-header card until
   * identity is established: signed in, or an anonymous visitor has
   * already identified via email (this session, or after retyping the
   * same email post-reload). See CheckinStateService.identifyAsGuest().
   */
  get needsGuestIdentification(): boolean {
    return !this.state.isGuestIdentified();
  }

  /**
   * Before establishing an anonymous guest identity, checks whether the
   * typed email already belongs to a real account (member or admin) via
   * AuthService.hasAccount() — if so, redirects to /login with the email
   * pre-filled and this page as returnUrl, rather than creating a
   * disconnected guest identity for someone who already has a real
   * account. See CLAUDE.md for the deliberate anti-enumeration tradeoff
   * this accepts.
   */
  async identifyAsGuest() {
    this.guestEmailError = null;
    const email = this.guestEmailInput.trim();
    if (!email) {
      this.guestEmailError = 'Enter your email.';
      return;
    }
    this.guestIdentifying = true;
    try {
      if (await this.auth.hasAccount(email)) {
        this.router.navigate(['/login'], { queryParams: { email, returnUrl: this.router.url } });
        return;
      }
      const ok = await this.state.identifyAsGuest(email);
      if (!ok) this.guestEmailError = 'Enter a valid email address.';
    } finally {
      this.guestIdentifying = false;
    }
  }

  get dateStr(): string {
    const d = this.state.meeting().date;
    if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  checkInNotice: string | null = null;

  async checkIn() {
    this.checkInError = null;
    this.checkInNotice = null;
    if (!this.nameInput.trim()) {
      this.checkInError = 'Enter your name.';
      return;
    }
    // Identity (including, for an anonymous visitor, a validated email) is
    // already established by the guest-email gate before this card even
    // renders — see needsGuestIdentification — so a failure here would only
    // be defensive (not something the gate should let happen in practice).
    const success = await this.state.checkIn(this.nameInput);
    if (!success) {
      this.checkInError = 'Something went wrong — try again.';
      return;
    }
    this.checkInNotice = 'You are checked in. You can now take a role or sign up to speak below.';
  }

  /**
   * Step-1 "I can't come — send apologies", for someone who knows up front
   * they won't attend and never intends to check in — distinct from
   * `uncheckIn()`, which withdraws someone already attending. No confirm
   * step needed here (unlike "I can't come after all"): nothing has been
   * claimed yet, so there's nothing to warn about losing.
   */
  async sendApologies() {
    this.checkInError = null;
    this.checkInNotice = null;
    if (!this.nameInput.trim()) {
      this.checkInError = 'Enter your name.';
      return;
    }
    const success = await this.state.sendApologies(this.nameInput);
    if (!success) {
      this.checkInError = 'Something went wrong — try again.';
      return;
    }
    this.checkInNotice = "Thanks for letting us know — you're marked as not attending.";
  }

  async uncheckIn() {
    // The "are you sure?" step is the inline ConfirmButtonComponent in the template.
    await this.state.uncheckIn();
    this.checkInNotice = 'You are marked as not attending, and your roles and speech were given up.';
  }

  /** Whether the "Not you?" link is shown at all — never for a signed-in account. */
  get isGuest(): boolean {
    return !this.auth.currentUser();
  }

  /**
   * Ends this device's guest identity and re-shows the email gate, so a
   * shared phone/tablet handed to a different person at the meeting can't
   * keep acting as whoever used it before — see
   * CheckinStateService.switchGuestIdentity()'s doc comment for the gap
   * this closes. Resets this page's own local fields too (name/email boxes,
   * any notice), since those aren't state's to clear.
   */
  switchIdentity() {
    this.state.switchGuestIdentity();
    this.nameInput = '';
    this.guestEmailInput = '';
    this.checkInError = null;
    this.checkInNotice = null;
    this.subscribed.set(null);
    this.lastCheckedEmail = null;
  }
}
