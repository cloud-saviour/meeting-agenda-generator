import { AuthService } from './auth.service';

/**
 * Shared by authGuard and memberGuard — onAuthStateChanged is async, so on a
 * cold page load both isAdmin() and currentUser() briefly read stale/empty
 * even for an already-signed-in account (Firebase restores the cached
 * session asynchronously). Deciding before ready() would bounce a
 * signed-in user to /login on every hard refresh.
 */
export function waitForReady(auth: AuthService): Promise<void> {
  if (auth.ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const id = setInterval(() => {
      if (auth.ready()) {
        clearInterval(id);
        resolve();
      }
    }, 20);
  });
}
