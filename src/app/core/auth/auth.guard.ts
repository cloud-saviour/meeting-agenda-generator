import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Waits for AuthService.ready() before deciding — onAuthStateChanged is
 * async, so on a cold page load currentUser() briefly reads null even for an
 * already-signed-in admin (Firebase restores the cached session
 * asynchronously). Deciding before ready() would bounce a signed-in admin to
 * /login on every hard refresh.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return waitForReady(auth).then((user) =>
    user ? true : router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`)
  );
};

function waitForReady(auth: AuthService): Promise<ReturnType<AuthService['currentUser']>> {
  if (auth.ready()) return Promise.resolve(auth.currentUser());
  return new Promise((resolve) => {
    const id = setInterval(() => {
      if (auth.ready()) {
        clearInterval(id);
        resolve(auth.currentUser());
      }
    }, 20);
  });
}
