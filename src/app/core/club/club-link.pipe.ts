import { Pipe, PipeTransform, inject } from '@angular/core';
import { ClubContextService } from './club-context.service';

/**
 * Prefixes an internal path with the CURRENT club's `/c/<slug>` segment —
 * `'/admin/hub' | clubLink` → `/c/kings-speakers-12/admin/hub`. Used
 * everywhere a template builds a `routerLink` (directly, or via a
 * NavbarComponent `NavLink[]` array — see navbar.component.html, the one
 * place that applies this to every page's `links` input at once) instead
 * of hand-threading `ClubContextService.currentClubSlug()` through every
 * component that needs an internal link.
 *
 * `/login` and `/signup` are passed through UNCHANGED — they're the two
 * deliberately club-agnostic routes (a Firebase account is global, not
 * club-scoped, see AuthService's class doc), so they must never gain a
 * `/c/<slug>` prefix.
 *
 * Impure (`pure: false`): the transform depends on
 * `ClubContextService.currentClubSlug()`, a signal read internally rather
 * than passed as a pipe argument, so a pure pipe (which only re-runs when
 * its own arguments' identity changes) wouldn't re-evaluate if the club
 * context changed under an already-rendered component. The recompute
 * itself is a cheap string op, so the impure cost is negligible.
 */
@Pipe({ name: 'clubLink', standalone: true, pure: false })
export class ClubLinkPipe implements PipeTransform {
  private readonly clubContext = inject(ClubContextService);

  transform(path: string): string {
    if (path === '/login' || path === '/signup') return path;
    const slug = this.clubContext.currentClubSlug();
    if (!slug) return path;
    return path === '/' ? `/c/${slug}` : `/c/${slug}${path}`;
  }
}
