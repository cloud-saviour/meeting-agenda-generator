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

  it('seeds currentName from the signed-in account\'s displayName only while it is still blank', () => {
    const service = createService({ uid: 'member-uid', displayName: 'Ada Lovelace', email: 'ada@example.com' });
    TestBed.tick();
    expect(service.currentName()).toBe('Ada Lovelace');
  });

  it('does not overwrite a name already set this session', () => {
    const service = createService({ uid: 'member-uid', displayName: 'Ada Lovelace', email: 'ada@example.com' });
    service.currentName.set('Typed Name');
    TestBed.tick();
    expect(service.currentName()).toBe('Typed Name');
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
});
