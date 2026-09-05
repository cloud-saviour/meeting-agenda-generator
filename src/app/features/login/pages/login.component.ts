import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NavbarComponent } from '../../../layout/navbar/navbar.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, NavbarComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  email = '';
  password = '';
  error: string | null = null;
  busy = false;

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
}
