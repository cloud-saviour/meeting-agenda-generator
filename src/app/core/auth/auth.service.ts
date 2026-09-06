import { Injectable, NgZone, inject, signal } from '@angular/core';
import {
  Auth,
  User,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { AUTH } from '../firebase/auth.provider';

/**
 * Admin-only auth: a signed-in Firebase user is an admin only if their ID
 * token carries the `admin` custom claim (see firestore.rules' isAdmin(),
 * and scripts/seed-admin-user.mjs which sets it). Accounts are provisioned
 * manually — there is no sign-up page — so nobody can grant themselves the
 * claim. Unlike a Firestore-doc allowlist, a custom claim is part of the
 * user's own ID token, so the client can read its own admin status via
 * getIdTokenResult() below — that's what makes `isAdmin` usable for UI
 * gating (see HomeComponent), not just server-side rule enforcement.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(AUTH);
  private readonly zone = inject(NgZone);

  readonly currentUser = signal<User | null>(null);
  readonly isAdmin = signal(false);
  /** True once the first onAuthStateChanged callback has fired — see auth.guard.ts for why this matters. */
  readonly ready = signal(false);

  constructor() {
    onAuthStateChanged(
      this.auth,
      async (user) => {
        // getIdTokenResult() is async, so it runs outside the zone; the
        // resulting signal writes are batched together in one zone.run().
        const tokenResult = user ? await user.getIdTokenResult() : null;
        this.zone.run(() => {
          this.currentUser.set(user);
          this.isAdmin.set(tokenResult?.claims['admin'] === true);
          this.ready.set(true);
        });
      },
      (err) => this.zone.run(() => console.error('auth state listener failed', err))
    );
  }

  signIn(email: string, password: string): Promise<void> {
    return signInWithEmailAndPassword(this.auth, email, password).then(() => undefined);
  }

  signOut(): Promise<void> {
    return signOut(this.auth);
  }

  resetPassword(email: string): Promise<void> {
    return sendPasswordResetEmail(this.auth, email);
  }
}
