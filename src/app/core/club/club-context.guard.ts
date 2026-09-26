import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClubContextService } from './club-context.service';
import { waitForReady } from '../auth/wait-for-ready';
import { AuthService } from '../auth/auth.service';

/**
 * Parent guard on `c/:clubSlug` — resolves the slug to a club before any
 * child route (home, checkin, admin/*, ...) renders. Runs on every
 * navigation into the club subtree, same as authGuard already runs on
 * every /admin/** navigation today, so ClubContextService.setClub()'s own
 * same-slug no-op check is what keeps this cheap on in-club navigation.
 *
 * Waits on AuthService's own readiness first — ClubContextService.setClub()
 * reads auth.currentUser() to decide whether to open the per-club
 * appAdmins listener at all, so a cold reload must not race ahead of
 * Firebase Auth's session restore.
 */
export const clubContextGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const clubContext = inject(ClubContextService);
  const router = inject(Router);

  const slug = route.paramMap.get('clubSlug');
  if (!slug) return router.parseUrl('/');

  await waitForReady(auth);
  const ok = await clubContext.setClub(slug);
  return ok ? true : router.parseUrl('/');
};
