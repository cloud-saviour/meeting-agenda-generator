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
 * Admin-only auth: any signed-in Firebase user is treated as an admin (see
 * firestore.rules' isAdmin()). Accounts are provisioned manually — there is
 * no sign-up page — so "authenticated" and "admin" are equivalent here.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(AUTH);
  private readonly zone = inject(NgZone);

  readonly currentUser = signal<User | null>(null);
  /** True once the first onAuthStateChanged callback has fired — see auth.guard.ts for why this matters. */
  readonly ready = signal(false);

  constructor() {
    onAuthStateChanged(
      this.auth,
      (user) =>
        this.zone.run(() => {
          this.currentUser.set(user);
          this.ready.set(true);
        }),
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
