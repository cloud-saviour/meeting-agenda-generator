import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FirebaseApp, deleteApp, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { AuthService } from './auth.service';
import { AUTH } from '../firebase/auth.provider';

/**
 * First emulator spec for Auth in this project — same "test the real
 * emulator, not a hand-rolled mock" philosophy the Firestore specs already
 * use (see checkin-state.service.emulator.spec.ts). One real difference from
 * those, discovered while writing this suite: the Auth emulator does NOT
 * isolate by the `projectId` passed to initializeApp() the way Firestore's
 * @firebase/rules-unit-testing genuinely does — every account created here
 * lands in the SAME single bucket as this machine's interactive dev session
 * (i.e. the same one holding admin@example.com and any account seeded via
 * the Emulator UI). So, unlike the Firestore emulator specs, this suite must
 * NEVER call the Auth emulator's clear-accounts endpoint — doing so would
 * delete real interactive dev accounts, not an isolated test project.
 * Instead, every email used below is per-run-unique (a random suffix), so
 * repeat runs never collide with leftover data from a previous run or from
 * a real signed-in session.
 */
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function setAdminClaim(uid: string): Promise<void> {
  await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ admin: true }) }),
  });
}

describe('AuthService (Firebase Auth emulator)', () => {
  let app: FirebaseApp;
  let auth: Auth;
  let parentInjector: Injector;
  let counter = 0;

  beforeEach(() => {
    app = initializeApp({ projectId: 'meeting-agenda-generator-auth-test', apiKey: 'test-api-key' }, `auth-test-${++counter}`);
    auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterEach(async () => {
    await deleteApp(app);
  });

  function createService(): AuthService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [AuthService, { provide: AUTH, useValue: auth }, { provide: NgZone, useValue: TestBed.inject(NgZone) }],
    });
    return child.get(AuthService);
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('waitFor() timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('signUp creates a real account with the given displayName and never carries the admin claim', async () => {
    const service = createService();
    const uid = await service.signUp(uniqueEmail('member'), 'password123', 'Ada Lovelace');
    expect(uid).toBeTruthy();

    await waitFor(() => service.ready() && service.currentUser() !== null);
    expect(service.currentUser()?.displayName).toBe('Ada Lovelace');
    expect(service.isAdmin()).toBe(false);
  });

  it('signIn/signOut round-trip against an account created via signUp', async () => {
    const service = createService();
    const email = uniqueEmail('roundtrip');
    await service.signUp(email, 'password123', 'Grace Hopper');
    await service.signOut();
    await waitFor(() => service.currentUser() === null);

    await service.signIn(email, 'password123');
    await waitFor(() => service.currentUser()?.email === email);

    await service.signOut();
    await waitFor(() => service.currentUser() === null);
  });

  it('rejects sign-up with an already-registered email', async () => {
    const service = createService();
    const email = uniqueEmail('dup');
    await service.signUp(email, 'password123', 'First');
    await expect(service.signUp(email, 'password123', 'Second')).rejects.toThrow();
  });

  it('updateDisplayName changes the signed-in user\'s displayName', async () => {
    const service = createService();
    await service.signUp(uniqueEmail('rename'), 'password123', 'Old Name');
    await service.updateDisplayName('New Name');
    expect(auth.currentUser?.displayName).toBe('New Name');
  });

  it('hasAccount() returns true for an email that was just signed up, including a differently-cased/padded variant of it', async () => {
    const service = createService();
    const email = uniqueEmail('has-account');
    await service.signUp(email, 'password123', 'Has Account');

    expect(await service.hasAccount(email)).toBe(true);
    expect(await service.hasAccount(`  ${email.toUpperCase()}  `)).toBe(true);
  });

  it('hasAccount() returns false for an email that was never signed up', async () => {
    const service = createService();
    expect(await service.hasAccount(uniqueEmail('never-registered'))).toBe(false);
  });

  it('isAdmin() reads true only for an account whose ID token carries the admin claim — set via the Auth emulator\'s admin-bypass REST API, exactly like scripts/seed-admin-user.mjs uses the Admin SDK for', async () => {
    const service = createService();
    const email = uniqueEmail('admin-claim');
    const uid = await service.signUp(email, 'password123', 'Admin Candidate');
    await waitFor(() => service.currentUser() !== null);
    expect(service.isAdmin()).toBe(false); // fresh self-service account: no claim yet

    await setAdminClaim(uid);

    // The claim only appears in a freshly issued ID token (see AuthService's
    // own class doc) — sign out and back in to pick it up.
    await service.signOut();
    await service.signIn(email, 'password123');
    await waitFor(() => service.isAdmin() === true);
  });
});
