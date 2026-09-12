import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NavbarComponent, NavLink } from '../../../layout/navbar/navbar.component';

const RESET_SENT_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink, NavbarComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  mode: 'signIn' | 'reset' = 'signIn';

  email = '';
  password = '';
  error: string | null = null;
  busy = false;

  resetEmail = '';
  resetBusy = false;
  resetMessage: string | null = null;
  resetError: string | null = null;

  /** True when `email` was seeded from a `?email=` query param (the check-in
   *  guest gate redirects here when the typed email already has an account —
   *  see CheckinComponent.identifyAsGuest()) — drives a small explanatory
   *  banner so the redirect doesn't feel unexplained. */
  prefilledFromCheckin = false;

  constructor() {
    const email = this.route.snapshot.queryParamMap.get('email');
    if (email) {
      this.email = email;
      this.prefilledFromCheckin = true;
    }
  }

  /**
   * Admin-only nav links (Agenda Editor, Manage Roles) only appear for actual
   * admins — /login is reachable by anyone, including an already-signed-in
   * non-admin member.
   *
   * No "Preview Agenda" link here: this page has no meeting context, so it
   * could only link to a bare /preview, which resolves the missing
   * `?meeting=` to the id 'default' and lands on the not-published fallback
   * even when a meeting really is published. Same reason it's gone from
   * /signup; /checkin and /member link to /preview with a real meeting number
   * instead.
   */
  get navLinks(): NavLink[] {
    const links: NavLink[] = [];
    if (this.auth.isAdmin()) {
      links.push({ label: '📝 Agenda Editor', path: '/admin' }, { label: '⚙ Manage Roles', path: '/admin/manage-roles' });
    }
    links.push({ label: '🏠 Home', path: '/' });
    return links;
  }

  async submit() {
    this.error = null;
    if (!this.email.trim() || !this.password) {
      this.error = 'Enter your email and password.';
      return;
    }
    this.busy = true;
    try {
      await this.auth.signIn(this.email.trim(), this.password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
      this.router.navigateByUrl(returnUrl);
    } catch {
      this.error = 'Invalid email or password.';
    } finally {
      this.busy = false;
    }
  }

  showReset() {
    this.mode = 'reset';
    this.error = null;
    this.resetMessage = null;
    this.resetError = null;
  }

  showSignIn() {
    this.mode = 'signIn';
    this.resetMessage = null;
    this.resetError = null;
  }

  // Unlike sendReset() below, CheckinComponent's guest-email gate DOES
  // reveal account existence via AuthService.hasAccount() before ever
  // reaching this page — a deliberate, narrower exception to the
  // anti-enumeration posture sendReset() otherwise maintains. See CLAUDE.md.
  async sendReset() {
    this.resetError = null;
    this.resetMessage = null;
    if (!this.resetEmail.trim()) {
      this.resetError = 'Enter your email.';
      return;
    }
    this.resetBusy = true;
    try {
      await this.auth.resetPassword(this.resetEmail.trim());
      this.resetMessage = RESET_SENT_MESSAGE;
    } catch (err) {
      // auth/user-not-found must show the same success message as a real
      // account, not an error — otherwise this becomes an email-enumeration
      // oracle. Only a genuinely different failure (e.g. invalid-email) is
      // shown as an error.
      if ((err as { code?: string }).code === 'auth/user-not-found') {
        this.resetMessage = RESET_SENT_MESSAGE;
      } else {
        this.resetError = 'Could not send the reset email. Check the address and try again.';
      }
    } finally {
      this.resetBusy = false;
    }
  }
}
