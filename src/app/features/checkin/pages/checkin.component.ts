import { Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CheckinStateService } from '../services/checkin-state.service';
import { AttendanceConfirmationService } from '../services/attendance-confirmation.service';
import { AttendanceListComponent } from '../components/attendance-list/attendance-list.component';
import { RoleBoardComponent } from '../components/role-board/role-board.component';
import { SpeakerSignupComponent } from '../components/speaker-signup/speaker-signup.component';
import { EvaluatorSlotsComponent } from '../components/evaluator-slots/evaluator-slots.component';
import { APP_LOCALE } from '../../../core/utils/locale';
import { NavbarComponent, NavLink } from '../../../layout/navbar/navbar.component';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-checkin',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    NavbarComponent,
    AttendanceListComponent,
    RoleBoardComponent,
    SpeakerSignupComponent,
    EvaluatorSlotsComponent,
  ],
  templateUrl: './checkin.component.html',
})
export class CheckinComponent {
  readonly state = inject(CheckinStateService);
  private readonly auth = inject(AuthService);
  private readonly attendanceConfirmation = inject(AttendanceConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  nameInput = '';
  checkInError: string | null = null;
  meetingId: string;

  guestEmailInput = '';
  guestEmailError: string | null = null;
  guestIdentifying = false;

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

    // Reactive, not a one-time check: isAdmin() reads false until Firebase
    // Auth's async session restore resolves, even for an already-signed-in
    // admin on a cold reload — a plain `if (auth.isAdmin())` here would
    // silently skip loading forever. loadForMeeting() is itself idempotent
    // per meetingId, so repeated effect firings are cheap no-ops.
    effect(() => {
      if (this.auth.isAdmin()) {
        this.attendanceConfirmation.loadForMeeting(this.meetingId);
      }
    });
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

  /** Admin-only nav links (Agenda Editor, Manage Roles) only appear for actual admins — /checkin is reachable by anonymous visitors and non-admin members alike. */
  get navLinks(): NavLink[] {
    const links: NavLink[] = [
      { label: '👁 Preview Agenda', path: '/preview', queryParams: { meeting: this.meetingId } },
    ];
    if (this.auth.isAdmin()) {
      links.push({ label: '📝 Agenda Editor', path: '/admin' }, { label: '⚙ Manage Roles', path: '/admin/manage-roles' });
    }
    links.push({ label: '🏠 Home', path: '/' });
    return links;
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

  async checkIn() {
    this.checkInError = null;
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
    }
  }

  async uncheckIn() {
    const confirmed = confirm(
      "Mark yourself as not attending? This will also release any role you've claimed, cancel your speech signup, and release any evaluator slot you hold — and you'll be listed as an apology on the agenda."
    );
    if (!confirmed) return;
    await this.state.uncheckIn();
  }
}
