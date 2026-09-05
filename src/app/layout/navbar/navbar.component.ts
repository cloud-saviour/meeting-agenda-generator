import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  @Input() title = '';
  @Input() links: { label: string; path: string; queryParams?: Record<string, string> }[] = [];
  /** checkin/admin-roles use position:fixed; agenda-editor's flex shell doesn't. */
  @Input() fixed = false;
  /** agenda-editor only, for its existing d-print-none behavior. */
  @Input() printHidden = false;

  readonly currentUser = this.auth.currentUser;

  signOut() {
    this.auth.signOut().then(() => this.router.navigateByUrl('/'));
  }
}
