import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MemberProfileService } from '../../member/services/member-profile.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [FormsModule, RouterLink, NavbarComponent],
  templateUrl: './signup.component.html',
})
export class SignupComponent {
  private readonly auth = inject(AuthService);
  private readonly memberProfile = inject(MemberProfileService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  displayName = '';
  email = '';
  password = '';
  error: string | null = null;
  busy = false;

  async submit() {
    this.error = null;
    if (!this.displayName.trim() || !this.email.trim() || !this.password) {
      this.error = 'Enter your name, email, and password.';
      return;
    }
    if (this.password.length < 6) {
      this.error = 'Password must be at least 6 characters.';
      return;
    }

    this.busy = true;
    try {
      const uid = await this.auth.signUp(this.email.trim(), this.password, this.displayName.trim());
      await this.memberProfile.createProfile(uid, this.email.trim(), this.displayName.trim());
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/member';
      this.router.navigateByUrl(returnUrl);
    } catch (err) {
      this.error =
        (err as { code?: string }).code === 'auth/email-already-in-use'
          ? 'An account already exists for that email.'
          : 'Could not create your account. Check your details and try again.';
    } finally {
      this.busy = false;
    }
  }
}
