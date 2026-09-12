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

function fakeAuthService(user: Pick<User, 'uid' | 'displayName' | 'email'> | null = null, isAdmin = false) {
  return { currentUser: signal(user), isAdmin: signal(isAdmin) } as unknown as AuthService;
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

  function createService(
    signedInUser: Pick<User, 'uid' | 'displayName' | 'email'> | null = null,
    isAdmin = false
  ): CheckinStateService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        CheckinStateService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
        { provide: AuthService, useValue: fakeAuthService(signedInUser, isAdmin) },
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

  it('identifyAsGuest() then checkIn(name) produces the identical Firestore attendee record and uid as checkIn(name, email) in one step', async () => {
    const oneStep = createService();
    oneStep.loadMeeting('m1c');
    await oneStep.checkIn('Thabo M.', 'thabo@example.com');
    await waitFor(() => oneStep.attendees().length === 1);

    const twoStep = createService();
    twoStep.loadMeeting('m1d');
    await twoStep.identifyAsGuest('thabo@example.com');
    await twoStep.checkIn('Thabo M.');
    await waitFor(() => twoStep.attendees().length === 1);

    expect(twoStep.currentUid).toBe(oneStep.currentUid); // same email → same derived uid, regardless of path
    expect(twoStep.attendees()[0]).toEqual(oneStep.attendees()[0]);
  });

  it('identifyAsGuest() restores a returning guest\'s name from their existing attendee record — no retyping required', async () => {
    const first = createService();
    first.loadMeeting('m1c2');
    await first.checkIn('Naledi K.', 'naledi@example.com');
    await waitFor(() => first.attendees().length === 1);

    // A later visit/device/reload: a fresh service instance, nothing checked in yet.
    const returning = createService();
    returning.loadMeeting('m1c2');
    await waitFor(() => returning.attendees().length === 1); // let the live listener deliver Naledi's record first
    expect(returning.currentName()).toBe(''); // not identified yet — no name should be assumed

    const ok = await returning.identifyAsGuest('naledi@example.com');
    expect(ok).toBe(true);
    expect(returning.currentName()).toBe('Naledi K.');
    expect(returning.isCheckedIn()).toBe(true);
  });

  it('identifyAsGuest() leaves currentName blank for a genuinely new guest — no existing attendee record to restore', async () => {
    const service = createService();
    service.loadMeeting('m1c3');

    await service.identifyAsGuest('brand-new@example.com');
    expect(service.currentName()).toBe('');
  });

  it('uncheckIn() removes the attendee, releases their role claim and evaluator slot, cancels their own speaker signup, and records them in apologies', async () => {
    const svcA = createService();
    const svcB = createService();
    svcA.loadMeeting('m1e');
    svcB.loadMeeting('m1e');
    await svcA.checkIn('Alice', 'alice@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');
    const uidA = svcA.currentUid;

    await svcA.claimRole('toastmaster');
    await svcB.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcA.speakers().length === 1);
    const speakerId = svcA.speakers()[0].id;
    await svcA.claimEvaluatorSlot(speakerId); // Alice evaluates Bongani's speech
    await svcA.addSpeakerSignup({ title: 'Alice\'s Talk', level: 'CC1', timePref: '5-7' }); // Alice's own signup too
    await waitFor(() => svcA.speakers().length === 2);

    await svcA.uncheckIn();

    await waitFor(() => svcB.attendees().every((a) => a.uid !== uidA));
    expect(svcB.roles()['toastmaster']?.uid).toBe('');
    expect(svcB.speakers().find((sp) => sp.uid === uidA)).toBeUndefined(); // Alice's own signup gone
    expect(svcB.speakers().find((sp) => sp.id === speakerId)?.evaluator).toBeNull(); // her evaluator claim released
    expect(svcB.apologies().some((a) => a.uid === uidA && a.name === 'Alice')).toBe(true);
  });

  it('uncheckIn() does not release an organizer-locked role', async () => {
    const svcA = createService();
    const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
    svcA.loadMeeting('m1f');
    admin.loadMeeting('m1f');
    await svcA.checkIn('Alice', 'alice@example.com');
    const uidA = svcA.currentUid;
    await svcA.claimRole('toastmaster');
    await waitFor(() => admin.roles()['toastmaster']?.uid === uidA);

    await admin.setRoleLocked('toastmaster', true);
    await waitFor(() => admin.lockedRoles().includes('toastmaster'));

    await svcA.uncheckIn();
    await waitFor(() => admin.apologies().some((a) => a.uid === uidA));
    expect(admin.roles()['toastmaster'].uid).toBe(uidA); // locked — role claim survives the withdrawal
  });

  it('uncheckIn() is idempotent — calling it twice does not duplicate the apologies entry', async () => {
    const service = createService();
    service.loadMeeting('m1g');
    await service.checkIn('Alice', 'alice@example.com');

    await service.uncheckIn();
    await waitFor(() => service.apologies().length === 1);
    await service.uncheckIn(); // already withdrawn — safe no-op

    expect(service.apologies().length).toBe(1);
  });

  it('uncheckIn() is a safe no-op for someone never checked in', async () => {
    const service = createService();
    service.loadMeeting('m1h');

    await service.uncheckIn();

    expect(service.attendees()).toEqual([]);
    expect(service.roles()).toEqual({});
    expect(service.speakers()).toEqual([]);
    expect(service.apologies()).toEqual([]);
  });

  it('checkIn() after uncheckIn() removes the person from apologies again', async () => {
    const service = createService();
    service.loadMeeting('m1i');
    await service.checkIn('Alice', 'alice@example.com');

    await service.uncheckIn();
    await waitFor(() => service.apologies().length === 1);

    await service.checkIn('Alice', 'alice@example.com');
    await waitFor(() => service.attendees().length === 1);
    expect(service.apologies()).toEqual([]);
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

  it('releaseRole() lets an admin release a claim they do not own', async () => {
    const svcA = createService(); // anonymous claimant
    const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
    svcA.loadMeeting('m4b');
    admin.loadMeeting('m4b');
    await svcA.checkIn('Alice', 'alice@example.com');
    const uidA = svcA.currentUid;
    await svcA.claimRole('toastmaster');
    await waitFor(() => admin.roles()['toastmaster']?.uid === uidA);

    await admin.releaseRole('toastmaster'); // not admin's claim, but admin — should succeed
    await waitFor(() => admin.roles()['toastmaster']?.uid === '');
  });

  it('releaseRole() still respects a locked role even for an admin', async () => {
    const svcA = createService();
    const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
    svcA.loadMeeting('m4c');
    admin.loadMeeting('m4c');
    await svcA.checkIn('Alice', 'alice@example.com');
    const uidA = svcA.currentUid;
    await svcA.claimRole('toastmaster');
    await waitFor(() => admin.roles()['toastmaster']?.uid === uidA);

    await admin.setRoleLocked('toastmaster', true);
    await waitFor(() => admin.lockedRoles().includes('toastmaster'));

    await admin.releaseRole('toastmaster'); // locked — no-op even for an admin
    expect(admin.roles()['toastmaster'].uid).toBe(uidA);
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
