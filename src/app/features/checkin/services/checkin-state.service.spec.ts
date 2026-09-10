import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { CheckinStateService } from './checkin-state.service';
import { CheckinContactsService } from './checkin-contacts.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';

// Never exercised by this suite — only present so CheckinStateService's
// constructor-time `inject(FIRESTORE)` has something to resolve. checkIn()'s
// mutate() call cleanly no-ops without a real Firestore connection as long
// as loadMeeting() was never called (currentMeetingId stays null), which is
// exactly the case in every test below — none of them call loadMeeting().
const unusedFirestoreStub = {} as unknown as Firestore;
const noopContacts = { upsert: async () => undefined } as unknown as CheckinContactsService;

function fakeAuthService(user: Pick<User, 'uid' | 'displayName' | 'email'> | null = null) {
  return { currentUser: signal(user) } as unknown as AuthService;
}

/**
 * This suite covers what doesn't touch the Firestore-backed snapshot — pure
 * identity derivation (no more localStorage anywhere in this service).
 * Claim/release/signup/evaluator/loadMeeting-isolation logic lives in
 * checkin-state.service.emulator.spec.ts — per CLAUDE.md and the
 * role-locking-pattern/localStorage-to-firestore-migration skills, a
 * hand-rolled mock can't reproduce Firestore's transaction retry semantics,
 * so that logic must be verified against the real emulator, not a fake.
 */
function createService(user: Pick<User, 'uid' | 'displayName' | 'email'> | null = null): CheckinStateService {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIRESTORE, useValue: unusedFirestoreStub },
      { provide: AuthService, useValue: fakeAuthService(user) },
      { provide: CheckinContactsService, useValue: noopContacts },
    ],
  });
  return TestBed.inject(CheckinStateService);
}

describe('CheckinStateService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('gives an anonymous, not-yet-checked-in visitor a non-empty session uid', () => {
    const service = createService();
    expect(service.currentUid).not.toBe('');
  });

  it('two separate anonymous instances get different session uids — nothing persists across construction anymore', () => {
    const first = createService();
    const firstUid = first.currentUid;

    TestBed.resetTestingModule();
    const second = createService();

    expect(second.currentUid).not.toBe(firstUid);
  });

  it('currentUid is the signed-in account\'s real Firebase uid, regardless of email/name', () => {
    const service = createService({ uid: 'member-uid', displayName: null, email: 'member@example.com' });
    expect(service.currentUid).toBe('member-uid');
  });

  it('seeds currentName from the signed-in account\'s displayName on construction', () => {
    const service = createService({ uid: 'member-uid', displayName: 'Ada Lovelace', email: 'ada@example.com' });
    TestBed.tick();
    expect(service.currentName()).toBe('Ada Lovelace');
  });

  it('does not overwrite a name already set this session, as long as the identity has not changed', () => {
    const service = createService({ uid: 'member-uid', displayName: 'Ada Lovelace', email: 'ada@example.com' });
    service.currentName.set('Typed Name');
    TestBed.tick();
    expect(service.currentName()).toBe('Typed Name');
  });

  it('clears and re-seeds currentName when the resolved identity actually changes — no leaking a name across identities', async () => {
    const auth = fakeAuthService(); // starts anonymous
    TestBed.configureTestingModule({
      providers: [
        { provide: FIRESTORE, useValue: unusedFirestoreStub },
        { provide: AuthService, useValue: auth },
        { provide: CheckinContactsService, useValue: noopContacts },
      ],
    });
    const service = TestBed.inject(CheckinStateService);

    await service.checkIn('Jane Anonymous', 'jane@example.com');
    expect(service.currentName()).toBe('Jane Anonymous');

    // Same browser tab, someone now signs in as admin — simulates the real
    // bug: CheckinStateService is a `providedIn: 'root'` singleton, so this
    // is the SAME service instance the anonymous check-in used above.
    auth.currentUser.set({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' } as User);
    TestBed.tick();

    expect(service.currentUid).toBe('admin-uid');
    expect(service.currentName()).toBe('Admin'); // not the leftover "Jane Anonymous"

    // Signing back out must not leak "Admin" forward to the next anonymous visitor either.
    auth.currentUser.set(null);
    TestBed.tick();

    expect(service.currentName()).toBe('');
  });

  it('checkIn() derives the SAME uid for an anonymous visitor from the SAME email, even across separate instances', async () => {
    const first = createService();
    await first.checkIn('Alice', 'alice@example.com');
    const firstUid = first.currentUid;
    expect(firstUid).not.toBe('');

    TestBed.resetTestingModule();
    const second = createService();
    await second.checkIn('Alice Again', 'ALICE@Example.com '); // different case/whitespace — must normalize to the same uid

    expect(second.currentUid).toBe(firstUid);
  });

  it('checkIn() derives DIFFERENT uids for different emails', async () => {
    const first = createService();
    await first.checkIn('Alice', 'alice@example.com');

    TestBed.resetTestingModule();
    const second = createService();
    await second.checkIn('Bob', 'bob@example.com');

    expect(second.currentUid).not.toBe(first.currentUid);
  });

  it('checkIn() silently no-ops for an anonymous visitor with an invalid-looking email', async () => {
    const service = createService();
    const uidBefore = service.currentUid;

    await service.checkIn('Alice', 'not-an-email');

    expect(service.currentName()).toBe('');
    expect(service.currentUid).toBe(uidBefore); // still the random session uid, untouched
  });

  it('checkIn() ignores the email param for a signed-in account and keeps their real uid', async () => {
    const service = createService({ uid: 'member-uid', displayName: null, email: 'member@example.com' });
    await service.checkIn('Whatever Name');
    expect(service.currentUid).toBe('member-uid');
    expect(service.currentName()).toBe('Whatever Name');
  });

  it('isGuestIdentified is false for a fresh anonymous instance', () => {
    const service = createService();
    expect(service.isGuestIdentified()).toBe(false);
  });

  it('identifyAsGuest() sets isGuestIdentified true and derives the same uid checkIn() would', async () => {
    const service = createService();
    const ok = await service.identifyAsGuest('Guest@Example.com ');
    expect(ok).toBe(true);
    expect(service.isGuestIdentified()).toBe(true);
    const uidAfterIdentify = service.currentUid;

    TestBed.resetTestingModule();
    const other = createService();
    await other.checkIn('Whoever', 'guest@example.com'); // normalized form
    expect(other.currentUid).toBe(uidAfterIdentify);
  });

  it('identifyAsGuest() returns false and leaves isGuestIdentified false for an invalid-looking email', async () => {
    const service = createService();
    const ok = await service.identifyAsGuest('not-an-email');
    expect(ok).toBe(false);
    expect(service.isGuestIdentified()).toBe(false);
  });

  it('isGuestIdentified is always true for a signed-in account, without calling identifyAsGuest()', () => {
    const service = createService({ uid: 'member-uid', displayName: null, email: 'member@example.com' });
    expect(service.isGuestIdentified()).toBe(true);
  });

  it('checkIn(name) with no email succeeds once already identified via identifyAsGuest()', async () => {
    const service = createService();
    await service.identifyAsGuest('guest@example.com');
    const success = await service.checkIn('Guest Name'); // no email arg
    expect(success).toBe(true);
    expect(service.currentName()).toBe('Guest Name');
  });

  it('resets isGuestIdentified back to false when a guest identity is followed by sign-out — no leaking forward', async () => {
    const auth = fakeAuthService(); // starts anonymous
    TestBed.configureTestingModule({
      providers: [
        { provide: FIRESTORE, useValue: unusedFirestoreStub },
        { provide: AuthService, useValue: auth },
        { provide: CheckinContactsService, useValue: noopContacts },
      ],
    });
    const service = TestBed.inject(CheckinStateService);

    await service.identifyAsGuest('guest@example.com');
    expect(service.isGuestIdentified()).toBe(true);

    auth.currentUser.set({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' } as User);
    TestBed.tick();
    // Still true — but now via the signed-in branch, not the stale guest hash.
    expect(service.isGuestIdentified()).toBe(true);

    auth.currentUser.set(null);
    TestBed.tick();
    expect(service.isGuestIdentified()).toBe(false); // guest identity was reset by syncIdentity(), not leaked forward
  });
});
