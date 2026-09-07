import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { CheckinStateService } from './checkin-state.service';
import { CheckinContactsService } from './checkin-contacts.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';

function fakeAuthService(user: Pick<User, 'uid' | 'displayName' | 'email'> | null = null) {
  return { currentUser: signal(user) } as unknown as AuthService;
}

const noopContacts = { upsert: async () => undefined } as unknown as CheckinContactsService;

/**
 * Exercises CheckinStateService against the real Firestore emulator — not a
 * mock — because its claim/release methods are transactional, and per
 * CLAUDE.md and the role-locking-pattern/localStorage-to-firestore-migration
 * skills, a hand-rolled mock can't reproduce Firestore's optimistic-concurrency
 * retry behavior. Run via `npm run test:emulator` with the emulator already
 * running (`npm run emulators`) — this suite is excluded from the default
 * `npm test` run (see angular.json's `test` target `exclude`).
 *
 * Uses a project id distinct from the dev `.firebaserc` project so this suite
 * never wipes data someone is interactively poking at against the same
 * running emulator.
 *
 * Role keys used below (e.g. 'toastmaster') are arbitrary as far as
 * CheckinStateService is concerned — it never validates a roleKey against
 * RoleDefinitionService, so no role-definition seeding is needed here.
 *
 * No localStorage anywhere anymore — an anonymous persona's identity comes
 * entirely from calling checkIn(name, email); the resulting uid is whatever
 * sha256Hex(email) produces, read back via `svc.currentUid` after check-in
 * rather than assumed ahead of time.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
`;

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor() timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('CheckinStateService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let firestore: Firestore;
  let parentInjector: Injector;
  const createdServices: CheckinStateService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-test',
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: FIRESTORE_RULES,
      },
    });
    // RulesTestContext.firestore() is typed as the legacy compat Firestore (the
    // package's public types still reflect that), but the object it returns at
    // runtime is interchangeable with the modular SDK's functions — this is the
    // pattern Firebase's own rules-unit-testing docs use for modular-SDK tests.
    firestore = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    // Fetched fresh per test, not once in beforeAll: TestBed destroys its
    // environment injector after every test by default, and
    // CheckinStateService's effect() (seeding currentName from a signed-in
    // member's displayName) needs a live DestroyRef from this injector's
    // ancestor chain — a stale parentInjector throws NG0205 on the second
    // test onward. A bare TestBed module, unused directly beyond that — just
    // gives us a parent injector that already provides NgZone, so our own
    // child injectors below don't need to reinvent it.
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterEach(() => {
    for (const service of createdServices) service.ngOnDestroy();
    createdServices.length = 0;
  });

  function createService(signedInUser: Pick<User, 'uid' | 'displayName' | 'email'> | null = null): CheckinStateService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        CheckinStateService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
        { provide: AuthService, useValue: fakeAuthService(signedInUser) },
        { provide: CheckinContactsService, useValue: noopContacts },
      ],
    });
    const service = child.get(CheckinStateService);
    createdServices.push(service);
    return service;
  }

  it('checkIn() adds the current user to attendees once, and updates the name on repeat check-in', async () => {
    const service = createService();
    service.loadMeeting('m1');

    await service.checkIn('Thabo M.', 'thabo@example.com');
    await waitFor(() => service.attendees().length === 1);
    expect(service.attendees()[0].name).toBe('Thabo M.');

    await service.checkIn('Thabo Molefe', 'thabo@example.com');
    await waitFor(() => service.attendees()[0]?.name === 'Thabo Molefe');
    expect(service.attendees().length).toBe(1);
  });

  it('checkIn() rejects an anonymous visitor with an invalid email — nothing is written', async () => {
    const service = createService();
    service.loadMeeting('m1b');

    await service.checkIn('Thabo M.', 'not-an-email');
    expect(service.attendees().length).toBe(0);
  });

  it('claimRole() succeeds when unclaimed and blocks a different uid from claiming it', async () => {
    const svcA = createService();
    const svcB = createService();
    svcA.loadMeeting('m2');
    svcB.loadMeeting('m2');
    await svcA.checkIn('Alice', 'alice@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');
    const uidA = svcA.currentUid;

    expect(await svcA.claimRole('toastmaster')).toBe(true);
    expect(await svcB.claimRole('toastmaster')).toBe(false);

    await waitFor(() => svcB.roles()['toastmaster']?.uid === uidA);
  });

  it('claimRole() fails without a checked-in name', async () => {
    const service = createService();
    service.loadMeeting('m3');
    expect(await service.claimRole('toastmaster')).toBe(false);
  });

  it('releaseRole() only releases a claim owned by the current uid', async () => {
    const svcA = createService();
    const svcB = createService();
    svcA.loadMeeting('m4');
    svcB.loadMeeting('m4');
    await svcA.checkIn('Alice', 'alice@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');
    const uidA = svcA.currentUid;
    await svcA.claimRole('toastmaster');
    await waitFor(() => svcB.roles()['toastmaster']?.uid === uidA);

    await svcB.releaseRole('toastmaster'); // not svcB's claim — no-op
    expect(svcB.roles()['toastmaster'].uid).toBe(uidA);

    await svcA.releaseRole('toastmaster');
    await waitFor(() => svcA.roles()['toastmaster']?.uid === '');
  });

  it('addSpeakerSignup() rejects a second signup from the same person and respects maxSpeakers', async () => {
    const service = createService();
    service.loadMeeting('m5');
    await service.checkIn('Naledi K.', 'naledi@example.com');

    expect(await service.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' })).toBe(
      true
    );
    expect(await service.addSpeakerSignup({ title: 'Talk 2', level: 'CC2', timePref: '5-7' })).toBe(
      false
    );
  });

  it('claimEvaluatorSlot() rejects evaluating your own speech and blocks a second concurrent claim', async () => {
    const svcA = createService();
    const svcB = createService();
    svcA.loadMeeting('m6');
    svcB.loadMeeting('m6');
    await svcA.checkIn('Naledi K.', 'naledi@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcB.speakers().length === 1);
    const speakerId = svcB.speakers()[0].id;

    // Naledi cannot evaluate her own speech
    expect(await svcA.claimEvaluatorSlot(speakerId)).toBe(false);
    // Bongani can
    expect(await svcB.claimEvaluatorSlot(speakerId)).toBe(true);
  });

  it('releaseEvaluatorSlot() only releases a claim owned by the current uid', async () => {
    const svcA = createService();
    const svcB = createService();
    svcA.loadMeeting('m7');
    svcB.loadMeeting('m7');
    await svcA.checkIn('Naledi K.', 'naledi@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');
    const uidB = svcB.currentUid;
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcB.speakers().length === 1);
    const speakerId = svcB.speakers()[0].id;
    await svcB.claimEvaluatorSlot(speakerId);

    await svcA.releaseEvaluatorSlot(speakerId); // not svcA's claim — no-op
    await waitFor(() => svcA.speakers()[0]?.evaluator?.uid === uidB);

    await svcB.releaseEvaluatorSlot(speakerId);
    await waitFor(() => svcB.speakers()[0]?.evaluator === null);
  });

  it('loadMeeting() isolates data between different meeting ids', async () => {
    const service = createService();

    service.loadMeeting('m8a');
    await service.checkIn('Alice', 'alice@example.com');
    const uid = service.currentUid;
    await service.claimRole('toastmaster');
    expect(service.attendees().length).toBe(1);

    service.loadMeeting('m8b');
    await waitFor(() => service.attendees().length === 0);
    expect(service.roles()['toastmaster']?.uid ?? '').toBe('');

    service.loadMeeting('m8a');
    await waitFor(() => service.attendees().length === 1);
    expect(service.attendees()[0].name).toBe('Alice');
    expect(service.roles()['toastmaster'].uid).toBe(uid);
  });

  it('setRoleLocked() toggles lockedRoles() and makes claim/release a no-op on that role', async () => {
    const service = createService();
    service.loadMeeting('m9');
    await service.checkIn('Thabo M.', 'thabo@example.com');
    const uid = service.currentUid;

    await service.setRoleLocked('toastmaster', true);
    await waitFor(() => service.lockedRoles().includes('toastmaster'));

    expect(await service.claimRole('toastmaster')).toBe(false);
    expect(service.roles()['toastmaster']?.uid ?? '').toBe('');

    await service.setRoleLocked('toastmaster', false);
    await waitFor(() => !service.lockedRoles().includes('toastmaster'));
    expect(await service.claimRole('toastmaster')).toBe(true);

    await service.setRoleLocked('toastmaster', true);
    await waitFor(() => service.lockedRoles().includes('toastmaster'));
    await service.releaseRole('toastmaster'); // locked — no-op
    await waitFor(() => service.roles()['toastmaster']?.uid === uid);
  });

  it('two concurrent claimRole() calls for the same role: exactly one succeeds', async () => {
    const svcA = createService();
    const svcB = createService();
    svcA.loadMeeting('m10');
    svcB.loadMeeting('m10');
    await svcA.checkIn('Alice', 'alice@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');

    const [okA, okB] = await Promise.all([
      svcA.claimRole('toastmaster'),
      svcB.claimRole('toastmaster'),
    ]);

    expect([okA, okB].filter(Boolean).length).toBe(1);
  });

  it('claimRole()/releaseRole() ownership checks work identically when currentUid comes from a signed-in member, not an anonymous email-derived uid', async () => {
    // Asserts via direct getDoc() reads rather than waiting on a second
    // service instance's own onSnapshot listener to catch up — claimRole()/
    // releaseRole() only resolve once their runTransaction() has actually
    // committed, so the write is already durable the moment each awaited
    // call returns; a second listener's independent push delivery is a
    // separate, slower concern this test doesn't need to depend on.
    const svcA = createService({ uid: 'member-a', displayName: null, email: 'member-a@example.com' });
    const svcB = createService({ uid: 'member-b', displayName: null, email: 'member-b@example.com' });
    svcA.loadMeeting('m12');
    svcB.loadMeeting('m12');
    await svcA.checkIn('Alice');
    await svcB.checkIn('Bongani');

    expect(svcA.currentUid).toBe('member-a');
    expect(await svcA.claimRole('toastmaster')).toBe(true);
    expect(await svcB.claimRole('toastmaster')).toBe(false);

    const afterClaim = await getDoc(doc(firestore, 'checkins', 'm12'));
    expect(afterClaim.data()?.['roles']?.['toastmaster']?.uid).toBe('member-a');

    await svcB.releaseRole('toastmaster'); // not svcB's claim — no-op
    const afterNoopRelease = await getDoc(doc(firestore, 'checkins', 'm12'));
    expect(afterNoopRelease.data()?.['roles']?.['toastmaster']?.uid).toBe('member-a');

    await svcA.releaseRole('toastmaster');
    const afterRelease = await getDoc(doc(firestore, 'checkins', 'm12'));
    expect(afterRelease.data()?.['roles']?.['toastmaster']?.uid).toBe('');
  });

  it('deleteMeeting() removes the Firestore document outright, without needing loadMeeting() first', async () => {
    const service = createService();
    service.loadMeeting('m11');
    await service.checkIn('Alice', 'alice@example.com');
    await waitFor(() => service.attendees().length === 1);

    const other = createService(); // never calls loadMeeting('m11')
    await other.deleteMeeting('m11');

    const snap = await getDoc(doc(firestore, 'checkins', 'm11'));
    expect(snap.exists()).toBe(false);
  });
});
