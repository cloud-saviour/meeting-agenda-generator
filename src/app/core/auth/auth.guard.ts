import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { waitForReady } from './wait-for-ready';

/**
 * Checks isAdmin(), not just currentUser() — a signed-in account without the
 * admin custom claim (e.g. a member account, see member.guard.ts) must be
 * bounced too, not just left to fail on the underlying Firestore reads/writes.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return waitForReady(auth).then(() =>
    auth.isAdmin() ? true : router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`)
  );
};
