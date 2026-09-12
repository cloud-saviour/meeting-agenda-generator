import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { waitForReady } from './wait-for-ready';

/**
 * Checks isAppAdmin() — the real `admin` claim OR a Firestore-granted
 * appAdmins/{uid} entry (see AuthService class doc) — not just
 * currentUser(). A signed-in account with neither (e.g. a plain member
 * account, see member.guard.ts) must be bounced too, not just left to fail
 * on the underlying Firestore reads/writes. Also guards
 * admin/manage-admins — any app-admin, real claim or granted, can grant
 * or revoke another member's access (the one thing still off-limits to
 * everyone is granting/regranting your OWN uid — see firestore.rules'
 * appAdmins rule).
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return waitForReady(auth).then(() =>
    auth.isAppAdmin() ? true : router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`)
  );
};
