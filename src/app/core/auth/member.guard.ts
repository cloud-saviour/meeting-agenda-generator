import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { waitForReady } from './wait-for-ready';

/**
 * Gates member-only routes (e.g. /member) on currentUser() alone, not
 * isAdmin() — a member account never has the admin claim (self-service
 * sign-up can't grant it, see AuthService.signUp()), so authGuard would
 * wrongly reject every member. Any signed-in account, admin or member,
 * counts as "at least a member" here.
 */
export const memberGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return waitForReady(auth).then(() =>
    auth.currentUser() !== null ? true : router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`)
  );
};
