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
  /**
   * checkin/admin-roles/etc. use `position:sticky` (Bootstrap's `.sticky-top`)
   * so the nav stays pinned to the top of the viewport; agenda-editor's flex
   * shell doesn't need this, since its own `vh-100`/`flex-shrink-0` layout
   * already keeps the nav in place. Deliberately `sticky`, not `fixed`: a
   * fixed nav is removed from document flow entirely, which is why this
   * used to require every consuming page to hardcode a matching
   * `margin-top`/`padding-top` guessing the nav's rendered height — that
   * guess broke the moment the nav wrapped to more than one row (e.g. an
   * admin's extra nav links on a narrow phone screen), silently hiding
   * whatever content sat right below it. `sticky` keeps the nav in normal
   * document flow — it still reserves its own real height, so content
   * after it is pushed down by whatever that height actually is, with no
   * hardcoded offset needed anywhere. See CLAUDE.md.
   */
  @Input() fixed = false;
  /** agenda-editor only, for its existing d-print-none behavior. */
  @Input() printHidden = false;

  readonly currentUser = this.auth.currentUser;

  signOut() {
    this.auth.signOut().then(() => this.router.navigateByUrl('/'));
  }
}
