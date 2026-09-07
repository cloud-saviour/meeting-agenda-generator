import { Injectable, NgZone, inject, signal } from '@angular/core';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  Auth,
  User,
} from 'firebase/auth';
import { AUTH } from '../firebase/auth.provider';

/**
 * Two independent identity tiers share this one service. Admin: a signed-in
 * Firebase user is an admin only if their ID token carries the `admin`
 * custom claim (see firestore.rules' isAdmin(), and
 * scripts/seed-admin-user.mjs which sets it) — accounts are provisioned
 * manually via that script, so nobody can grant themselves the claim.
 * Unlike a Firestore-doc allowlist, a custom claim is part of the user's own
 * ID token, so the client can read its own admin status via
 * getIdTokenResult() below — that's what makes `isAdmin` usable for UI
 * gating (see HomeComponent), not just server-side rule enforcement.
 *
 * Member: any account created via signUp() below — self-service, no claim
 * involved at all, since a client can never set its own custom claim (see
 * firestore.rules' header comment). "Is a member" just means "is signed in"
 * (see member.guard.ts) — there's nothing to derive or gate here beyond
 * `currentUser() !== null`.
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

  /**
   * Self-service member sign-up. Returns the new uid directly off the
   * `UserCredential` rather than making the caller wait on the async
   * onAuthStateChanged listener to populate `currentUser()`.
   */
  async signUp(email: string, password: string, displayName: string): Promise<string> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(credential.user, { displayName });
    return credential.user.uid;
  }

  /** Updates the Auth user record's displayName — see MemberProfileService.updateProfile() for why this must stay in sync with the Firestore members/{uid} doc. */
  updateDisplayName(displayName: string): Promise<void> {
    if (!this.auth.currentUser) return Promise.resolve();
    return updateProfile(this.auth.currentUser, { displayName });
  }

  signOut(): Promise<void> {
    return signOut(this.auth);
  }

  resetPassword(email: string): Promise<void> {
    return sendPasswordResetEmail(this.auth, email);
  }
}
