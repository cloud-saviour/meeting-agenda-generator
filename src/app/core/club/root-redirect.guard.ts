import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { waitForReady } from '../auth/wait-for-ready';

/**
 * Guard on the bare `/`. A platform admin works across clubs, so they go to
 * the clubs list; everyone else stays on `/` and sees the club picker (which
 * skips straight into the club when only one is active). Old un-prefixed
 * links such as /checkin still go to the default club — see
 * legacyClubRedirectGuard.
 */
export const rootRedirectGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await waitForReady(auth);
  return auth.isAdmin() ? router.parseUrl('/platform/clubs') : true;
};
