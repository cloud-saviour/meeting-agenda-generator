import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

export interface NavLink {
  label: string;
  path: string;
  queryParams?: Record<string, string>;
}

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
  /**
   * Rendered as-is, no filtering — NavbarComponent doesn't know which
   * links are admin-only. Each page is responsible for only including
   * admin routes (/admin, /admin/manage-roles, etc.) when AuthService.isAdmin()
   * is true; a page reachable by non-admins must build this array
   * conditionally rather than pass a static literal. See checkin.component.ts
   * and login.component.ts's navLinks getters for the pattern.
   */
  @Input() links: NavLink[] = [];
  /** checkin/admin-roles use position:fixed; agenda-editor's flex shell doesn't. */
  @Input() fixed = false;
  /** agenda-editor only, for its existing d-print-none behavior. */
  @Input() printHidden = false;

  readonly currentUser = this.auth.currentUser;

  signOut() {
    this.auth.signOut().then(() => this.router.navigateByUrl('/'));
  }
}
