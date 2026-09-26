import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClubContextService } from './club-context.service';

/**
 * Formerly authGuard (core/auth/auth.guard.ts) — moved and renamed once
 * "app-admin" became "app-admin of the CURRENT club", not global. Checks
 * ClubContextService.isAppAdmin() (the real `admin` claim OR a
 * clubs/{clubId}/appAdmins/{uid} grant for the club this session is
 * currently in) — never `AuthService.isAppAdmin()`, since that concept no
 * longer exists there (see its class doc: it now only ever tracks the
 * global, real claim as `isAdmin`).
 *
 * No readiness wait needed here, unlike the old authGuard: this only ever
 * runs nested under `c/:clubSlug`, and Angular guarantees a parent route's
 * CanActivateFn fully resolves before any child's runs — clubContextGuard
 * (the parent) already awaited both AuthService and ClubContextService
 * readiness, so clubContext.ready() is already true by the time this fires.
 *
 * Guards every c/:clubSlug/admin/** route, including manage-admins — any
 * app-admin of this club, real claim or granted, can grant/revoke another
 * member's access to it (see firestore.rules' appAdmins rule under
 * clubs/{clubId}).
 */
export const clubAdminGuard: CanActivateFn = (_route, state) => {
  const clubContext = inject(ClubContextService);
  const router = inject(Router);

  return clubContext.isAppAdmin() ? true : router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`);
};
