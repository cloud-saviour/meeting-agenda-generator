import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { waitForReady } from './wait-for-ready';

/**
 * Checks isAdmin() specifically — the real Firebase custom claim, not
 * isAppAdmin(). Reserved for routes that must stay real-claim-only even
 * though a granted (non-claim) admin has full parity with a real admin
 * almost everywhere else in the app — e.g. a future audit-log/activity
 * view, where "who granted/revoked what" should only be visible to the
 * one tier that can't itself be granted by someone else. Not currently
 * used by admin/manage-admins — that route uses authGuard, since any
 * app-admin (real or granted) can grant/revoke another member's access
 * (see firestore.rules' appAdmins rule and AuthService's class doc).
 */
export const superAdminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return waitForReady(auth).then(() =>
    auth.isAdmin() ? true : router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`)
  );
};
