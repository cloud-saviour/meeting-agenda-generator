import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * Backward compatibility for already-shared, un-prefixed check-in/preview
 * links — before multi-club routing, `/checkin?meeting=<id>` and
 * `/preview?meeting=<id>` were the real, distributed URLs (texted, printed,
 * QR-coded) for the one club this app used to serve exclusively. Those
 * links are already out in the world and must keep working, so a bare
 * `/checkin` or `/preview` visit redirects into that club's own
 * `/c/<slug>/checkin`/`/preview` — same segment, same query params
 * (`{ meeting: ... }`) preserved exactly, nothing else changed.
 *
 * `environment.defaultClubSlug` is the one club scripts/migrate-to-clubs.mjs
 * provisions today — see its own doc comment in environment.ts.
 */
export function legacyClubRedirectGuard(segment: string): CanActivateFn {
  return (_route, state) => {
    const router = inject(Router);
    return router.createUrlTree(['/c', environment.defaultClubSlug, segment], {
      queryParams: router.parseUrl(state.url).queryParams,
    });
  };
}

/**
 * Same backward compatibility as above, for bookmarked un-prefixed
 * `/admin/...` and `/member` pages: prepends the default club's `/c/<slug>`
 * to the whole requested URL, so any sub-path, query string and fragment
 * survive unchanged (`/admin/agendas?x=1` -> `/c/<slug>/admin/agendas?x=1`).
 */
export const legacyClubPrefixGuard: CanActivateFn = (_route, state) =>
  inject(Router).parseUrl(`/c/${environment.defaultClubSlug}${state.url}`);
