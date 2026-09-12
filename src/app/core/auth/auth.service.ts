import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  Auth,
  User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { AUTH } from '../firebase/auth.provider';
import { FIRESTORE } from '../firebase/firestore.provider';

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
 * Granted admin: `isAppAdmin` also recognizes a Firestore-based grant at
 * `appAdmins/{uid}` (see firestore.rules' isGrantedAdmin()) — full parity
 * with `isAdmin` for every app feature, granting/revoking OTHER members'
 * access included: any app-admin, real claim or granted, can manage
 * `appAdmins/{uid}` for a different uid. The one thing still off-limits to
 * everyone is granting/regranting your OWN uid (see firestore.rules'
 * appAdmins rule) — self-granting is pointless and, for a true admin
 * specifically, a footgun (it'd make their access outlive their own claim
 * if that claim is later revoked). Unlike the claim, this is a live
 * `onSnapshot` (see `grantedAdmin` below), so a grant or revoke takes
 * effect in the affected session immediately, no sign-out needed.
 * super-admin.guard.ts still exists for routes that must stay
 * real-claim-only (not currently manage-admins — see AdminAdminsComponent).
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
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);

  readonly currentUser = signal<User | null>(null);
  readonly isAdmin = signal(false);
  private readonly grantedAdmin = signal(false);
  /** Full parity with isAdmin() for app features — see class doc for the one deliberate exception (granting/revoking access itself). */
  readonly isAppAdmin = computed(() => this.isAdmin() || this.grantedAdmin());
  /** True once the first onAuthStateChanged callback has fired AND (if signed in) the first appAdmins/{uid} snapshot has arrived — see auth.guard.ts for why this matters. */
  readonly ready = signal(false);

  /** Unsubscribes the previous user's appAdmins/{uid} listener — reassigned on every auth-state change so a stale listener never keeps running for a signed-out or switched-away account. */
  private unsubscribeGrantedAdmin: (() => void) | null = null;

  constructor() {
    onAuthStateChanged(
      this.auth,
      async (user) => {
        this.unsubscribeGrantedAdmin?.();
        this.unsubscribeGrantedAdmin = null;

        // getIdTokenResult() is async, so it runs outside the zone; the
        // resulting signal writes are batched together in one zone.run().
        const tokenResult = user ? await user.getIdTokenResult() : null;

        if (!user) {
          this.zone.run(() => {
            this.currentUser.set(null);
            this.isAdmin.set(false);
            this.grantedAdmin.set(false);
            this.ready.set(true);
          });
          return;
        }

        // Wait for the appAdmins/{uid} listener's first result before
        // flipping ready() — same reasoning as isAdmin() above: without
        // this, authGuard could flash-redirect a granted (non-claim)
        // admin on a hard refresh, before their grant has been read.
        await new Promise<void>((resolve) => {
          let resolved = false;
          this.unsubscribeGrantedAdmin = onSnapshot(
            doc(this.firestore, 'appAdmins', user.uid),
            (snap) =>
              this.zone.run(() => {
                this.grantedAdmin.set(snap.exists());
                if (!resolved) {
                  resolved = true;
                  resolve();
                }
              }),
            (err) =>
              this.zone.run(() => {
                console.error('appAdmins snapshot listener failed', err);
                if (!resolved) {
                  resolved = true;
                  resolve();
                }
              })
          );
        });

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

  /**
   * True if `email` already has a Firebase Auth account (member or admin —
   * this checks the Auth system generically, the same one both tiers share,
   * not the `members` Firestore collection specifically). Used only by the
   * check-in guest-email gate to redirect a guest to sign in instead of
   * creating a disconnected anonymous identity for an email that already has
   * a real account — see CLAUDE.md for why this is a deliberate, narrow
   * exception to the anti-enumeration posture `resetPassword()`'s caller
   * (login.component.ts) otherwise maintains.
   *
   * Fails open (returns false) on any error — a lookup failure must never
   * block someone from checking in as a guest; worst case they proceed as
   * guest even though they have an account, same as today's behavior.
   */
  async hasAccount(email: string): Promise<boolean> {
    try {
      const methods = await fetchSignInMethodsForEmail(this.auth, email.trim().toLowerCase());
      return methods.length > 0;
    } catch {
      return false;
    }
  }
}
