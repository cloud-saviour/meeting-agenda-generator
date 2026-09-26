import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { CheckinStateService } from './checkin-state.service';
import { CheckinContactsService } from './checkin-contacts.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * `isAppAdmin` defaults to mirror `isAdmin` so every existing call site
 * (`createService(user, true)`) keeps meaning "a real-claim admin" — pass it
 * explicitly to simulate a Firestore-granted (non-claim) admin instead
 * (`isAdmin: false, isAppAdmin: true`), which is the case the `releaseRole()`
 * `isAdmin()`-vs-`isAppAdmin()` bug missed.
 */
function fakeAuthService(
  user: Pick<User, 'uid' | 'displayName' | 'email'> | null = null,
  isAdmin = false,
  isAppAdmin = isAdmin
) {
  return { currentUser: signal(user), isAdmin: signal(isAdmin), isAppAdmin: signal(isAppAdmin) } as unknown as AuthService;
}

async function auditEntriesFor(firestore: Firestore, action: string) {
  const snap = await getDocs(query(collection(firestore, 'auditLog'), where('action', '==', action)));
  return snap.docs.map((d) => d.data());
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
    isAdmin = false,
    isAppAdmin = isAdmin
  ): CheckinStateService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        CheckinStateService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
        { provide: AuthService, useValue: fakeAuthService(signedInUser, isAdmin, isAppAdmin) },
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

  // A signed-in member/admin has currentName seeded from their Firebase
  // displayName the moment the service constructs — so a "do they have a
  // name?" check passes for them without them ever tapping "I'm Attending".
  // Taking part must require actual attendance, not merely having a name.
  it('claimRole()/addSpeakerSignup()/claimEvaluatorSlot() all fail for a signed-in member who never checked in', async () => {
    const member = createService({ uid: 'member-uid', displayName: 'Naledi K.', email: 'naledi@example.com' });
    const speaker = createService();
    member.loadMeeting('m3b');
    speaker.loadMeeting('m3b');
    await speaker.checkIn('Bongani', 'bongani@example.com');
    await speaker.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => member.speakers().length === 1);
    const speakerId = member.speakers()[0].id;

    expect(member.currentName()).toBe('Naledi K.'); // has a name…
    expect(member.isCheckedIn()).toBe(false); // …but never attended

    expect(await member.claimRole('toastmaster')).toBe(false);
    expect(await member.addSpeakerSignup({ title: 'Talk 2', level: 'CC2', timePref: '5-7' })).toBe(false);
    expect(await member.claimEvaluatorSlot(speakerId)).toBe(false);

    expect(member.roles()['toastmaster']?.uid).toBeFalsy();
    expect(member.speakers().length).toBe(1);
    expect(member.speakers()[0].evaluator).toBeNull();

    // …and all three start working the moment they actually check in.
    await member.checkIn('Naledi K.');
    expect(await member.claimRole('toastmaster')).toBe(true);
    expect(await member.claimEvaluatorSlot(speakerId)).toBe(true);
  });

  it('claiming fails again after uncheckIn() — withdrawing revokes the ability to take part', async () => {
    const service = createService();
    service.loadMeeting('m3c');
    await service.checkIn('Alice', 'alice@example.com');
    expect(await service.claimRole('toastmaster')).toBe(true);

    await service.uncheckIn();
    await waitFor(() => !service.isCheckedIn());

    expect(await service.claimRole('toastmaster')).toBe(false);
    expect(await service.addSpeakerSignup({ title: 'Talk', level: 'CC1', timePref: '5-7' })).toBe(false);
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

  it('releaseRole() lets a granted-only admin (isAppAdmin true, isAdmin false) release a claim they do not own', async () => {
    const svcA = createService(); // anonymous claimant
    const granted = createService({ uid: 'granted-uid', displayName: 'Granted', email: 'granted@example.com' }, false, true);
    svcA.loadMeeting('m4d');
    granted.loadMeeting('m4d');
    await svcA.checkIn('Alice', 'alice@example.com');
    const uidA = svcA.currentUid;
    await svcA.claimRole('toastmaster');
    await waitFor(() => granted.roles()['toastmaster']?.uid === uidA);

    await granted.releaseRole('toastmaster'); // not granted's claim, no real claim either — should still succeed
    await waitFor(() => granted.roles()['toastmaster']?.uid === '');
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

  it('removeSpeakerSignup() lets an admin remove a signup they do not own', async () => {
    const svcA = createService();
    const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
    svcA.loadMeeting('m5b');
    admin.loadMeeting('m5b');
    await svcA.checkIn('Naledi K.', 'naledi@example.com');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => admin.speakers().length === 1);
    const speakerId = admin.speakers()[0].id;

    await admin.removeSpeakerSignup(speakerId);
    await waitFor(() => admin.speakers().length === 0);
  });

  it('removeSpeakerSignup() lets a granted-only admin remove a signup they do not own', async () => {
    const svcA = createService();
    const granted = createService({ uid: 'granted-uid', displayName: 'Granted', email: 'granted@example.com' }, false, true);
    svcA.loadMeeting('m5c');
    granted.loadMeeting('m5c');
    await svcA.checkIn('Naledi K.', 'naledi@example.com');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => granted.speakers().length === 1);
    const speakerId = granted.speakers()[0].id;

    await granted.removeSpeakerSignup(speakerId);
    await waitFor(() => granted.speakers().length === 0);
  });

  it('removeSpeakerSignup() still no-ops for a non-owning non-admin', async () => {
    const svcA = createService();
    const svcB = createService();
    svcA.loadMeeting('m5d');
    svcB.loadMeeting('m5d');
    await svcA.checkIn('Naledi K.', 'naledi@example.com');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcB.speakers().length === 1);
    const speakerId = svcB.speakers()[0].id;

    await svcB.removeSpeakerSignup(speakerId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(svcB.speakers().length).toBe(1);
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

  it('releaseEvaluatorSlot() lets an admin release an evaluator slot they do not own', async () => {
    const svcA = createService();
    const svcB = createService();
    const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
    svcA.loadMeeting('m7b');
    svcB.loadMeeting('m7b');
    admin.loadMeeting('m7b');
    await svcA.checkIn('Naledi K.', 'naledi@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcB.speakers().length === 1);
    const speakerId = svcB.speakers()[0].id;
    await svcB.claimEvaluatorSlot(speakerId);
    await waitFor(() => admin.speakers()[0]?.evaluator !== null);

    await admin.releaseEvaluatorSlot(speakerId);
    await waitFor(() => admin.speakers()[0]?.evaluator === null);
  });

  it('releaseEvaluatorSlot() lets a granted-only admin release an evaluator slot they do not own', async () => {
    const svcA = createService();
    const svcB = createService();
    const granted = createService({ uid: 'granted-uid', displayName: 'Granted', email: 'granted@example.com' }, false, true);
    svcA.loadMeeting('m7c');
    svcB.loadMeeting('m7c');
    granted.loadMeeting('m7c');
    await svcA.checkIn('Naledi K.', 'naledi@example.com');
    await svcB.checkIn('Bongani', 'bongani@example.com');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcB.speakers().length === 1);
    const speakerId = svcB.speakers()[0].id;
    await svcB.claimEvaluatorSlot(speakerId);
    await waitFor(() => granted.speakers()[0]?.evaluator !== null);

    await granted.releaseEvaluatorSlot(speakerId);
    await waitFor(() => granted.speakers()[0]?.evaluator === null);
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

  describe('adminRenamePerson()', () => {
    it('lets an app-admin correct a mistyped name', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m13a');
      admin.loadMeeting('m13a');
      await svcA.checkIn('Alise', 'alice@example.com');
      const uid = svcA.currentUid;
      await waitFor(() => admin.attendees().length === 1);

      expect(await admin.adminRenamePerson(uid, 'Alice')).toBe(true);
      await waitFor(() => admin.attendees()[0]?.name === 'Alice');
    });

    it('lets a granted-only admin correct a mistyped name', async () => {
      const svcA = createService();
      const granted = createService({ uid: 'granted-uid', displayName: 'Granted', email: 'granted@example.com' }, false, true);
      svcA.loadMeeting('m13b');
      granted.loadMeeting('m13b');
      await svcA.checkIn('Alise', 'alice@example.com');
      const uid = svcA.currentUid;
      await waitFor(() => granted.attendees().length === 1);

      expect(await granted.adminRenamePerson(uid, 'Alice')).toBe(true);
      await waitFor(() => granted.attendees()[0]?.name === 'Alice');
    });

    it('sweeps attendee, role claim, own speaker name, and nested evaluator.name for the same uid in one call', async () => {
      const priya = createService();
      const thabo = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      priya.loadMeeting('m13c');
      thabo.loadMeeting('m13c');
      admin.loadMeeting('m13c');
      await priya.checkIn('Priya Naidoo', 'priya@example.com');
      await thabo.checkIn('Thabo', 'thabo@example.com');
      const priyaUid = priya.currentUid;

      await priya.claimRole('timer'); // role claim
      await priya.addSpeakerSignup({ title: 'The Art of the Pause', level: 'CC6', timePref: '6-8' }); // own signup
      await thabo.addSpeakerSignup({ title: 'Finding Your Voice', level: 'CC4', timePref: '5-7' });
      await waitFor(() => admin.speakers().length === 2);
      const thaboSpeakerId = admin.speakers().find((sp) => sp.uid !== priyaUid)!.id;
      await priya.claimEvaluatorSlot(thaboSpeakerId); // evaluates Thabo's speech
      await waitFor(() => admin.speakers().find((sp) => sp.id === thaboSpeakerId)?.evaluator?.uid === priyaUid);

      expect(await admin.adminRenamePerson(priyaUid, 'Priya N.')).toBe(true);

      await waitFor(() => admin.attendees().find((a) => a.uid === priyaUid)?.name === 'Priya N.');
      expect(admin.roles()['timer']?.name).toBe('Priya N.');
      expect(admin.speakers().find((sp) => sp.uid === priyaUid)?.name).toBe('Priya N.');
      expect(admin.speakers().find((sp) => sp.id === thaboSpeakerId)?.evaluator?.name).toBe('Priya N.');
      // uid never changes on any of the four copies
      expect(admin.roles()['timer']?.uid).toBe(priyaUid);
      expect(admin.speakers().find((sp) => sp.uid === priyaUid)?.uid).toBe(priyaUid);
      expect(admin.speakers().find((sp) => sp.id === thaboSpeakerId)?.evaluator?.uid).toBe(priyaUid);
    });

    it('also updates an existing apology entry for that uid', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m13d');
      admin.loadMeeting('m13d');
      await svcA.checkIn('Alise', 'alice@example.com');
      const uid = svcA.currentUid;
      await svcA.uncheckIn();
      await waitFor(() => admin.apologies().length === 1);

      await admin.adminRenamePerson(uid, 'Alice');
      await waitFor(() => admin.apologies()[0]?.name === 'Alice');
    });

    it('is a no-op for a non-admin caller', async () => {
      const svcA = createService();
      const svcB = createService();
      svcA.loadMeeting('m13e');
      svcB.loadMeeting('m13e');
      await svcA.checkIn('Alise', 'alice@example.com');
      const uid = svcA.currentUid;
      await waitFor(() => svcB.attendees().length === 1);

      expect(await svcB.adminRenamePerson(uid, 'Alice')).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(svcB.attendees()[0].name).toBe('Alise');
    });

    it('is a no-op for a uid with no record anywhere in the meeting', async () => {
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      admin.loadMeeting('m13f');

      expect(await admin.adminRenamePerson('nobody-uid', 'Whoever')).toBe(false);
    });

    it('writes a checkin.adminEdit auditLog entry', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m13g');
      admin.loadMeeting('m13g');
      await svcA.checkIn('Alise', 'alice@example.com');
      const uid = svcA.currentUid;
      await waitFor(() => admin.attendees().length === 1);

      await admin.adminRenamePerson(uid, 'Alice');

      const entries = await auditEntriesFor(firestore, 'checkin.adminEdit');
      expect(entries.some((e) => (e['summary'] as string).includes(uid) && (e['summary'] as string).includes('Alice'))).toBe(true);
    });
  });

  describe('adminEditSpeaker()', () => {
    it('lets an admin correct title/level/timePref without touching name or uid', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m14a');
      admin.loadMeeting('m14a');
      await svcA.checkIn('Naledi K.', 'naledi@example.com');
      await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
      await waitFor(() => admin.speakers().length === 1);
      const id = admin.speakers()[0].id;
      const uid = admin.speakers()[0].uid;

      expect(await admin.adminEditSpeaker(id, { title: 'Talk One', level: 'CC2', timePref: '7-10' })).toBe(true);
      await waitFor(() => admin.speakers()[0]?.title === 'Talk One');
      expect(admin.speakers()[0].level).toBe('CC2');
      expect(admin.speakers()[0].timePref).toBe('7-10');
      expect(admin.speakers()[0].name).toBe('Naledi K.');
      expect(admin.speakers()[0].uid).toBe(uid);
    });

    it('is a no-op for a non-admin', async () => {
      const svcA = createService();
      const svcB = createService();
      svcA.loadMeeting('m14b');
      svcB.loadMeeting('m14b');
      await svcA.checkIn('Naledi K.', 'naledi@example.com');
      await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
      await waitFor(() => svcB.speakers().length === 1);
      const id = svcB.speakers()[0].id;

      expect(await svcB.adminEditSpeaker(id, { title: 'Hacked' })).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(svcB.speakers()[0].title).toBe('Talk 1');
    });

    it('is a no-op for an unknown speakerId', async () => {
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      admin.loadMeeting('m14c');

      expect(await admin.adminEditSpeaker('no-such-id', { title: 'X' })).toBe(false);
    });

    it('writes a checkin.adminEdit auditLog entry', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m14d');
      admin.loadMeeting('m14d');
      await svcA.checkIn('Naledi K.', 'naledi@example.com');
      await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
      await waitFor(() => admin.speakers().length === 1);
      const id = admin.speakers()[0].id;

      await admin.adminEditSpeaker(id, { title: 'Talk One' });

      const entries = await auditEntriesFor(firestore, 'checkin.adminEdit');
      expect(entries.some((e) => (e['summary'] as string).includes('Naledi K.'))).toBe(true);
    });
  });

  describe('adminRemoveAttendee()', () => {
    it('cascades: removes the attendee, releases their unlocked role claim, cancels their own speaker signup, releases their evaluator slot', async () => {
      const svcA = createService();
      const svcB = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m15a');
      svcB.loadMeeting('m15a');
      admin.loadMeeting('m15a');
      await svcA.checkIn('Alice', 'alice@example.com');
      await svcB.checkIn('Bongani', 'bongani@example.com');
      const uidA = svcA.currentUid;
      await svcA.claimRole('toastmaster');
      await svcB.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
      await waitFor(() => admin.speakers().length === 1);
      const speakerId = admin.speakers()[0].id;
      await svcA.claimEvaluatorSlot(speakerId);
      await svcA.addSpeakerSignup({ title: "Alice's Talk", level: 'CC1', timePref: '5-7' });
      await waitFor(() => admin.speakers().length === 2);

      expect(await admin.adminRemoveAttendee(uidA)).toBe(true);

      await waitFor(() => admin.attendees().every((a) => a.uid !== uidA));
      expect(admin.roles()['toastmaster']?.uid).toBe('');
      expect(admin.speakers().find((sp) => sp.uid === uidA)).toBeUndefined();
      expect(admin.speakers().find((sp) => sp.id === speakerId)?.evaluator).toBeNull();
    });

    it('does NOT add the removed uid to apologies', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m15b');
      admin.loadMeeting('m15b');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await waitFor(() => admin.attendees().length === 1);

      await admin.adminRemoveAttendee(uidA);
      await waitFor(() => admin.attendees().length === 0);

      expect(admin.apologies().some((a) => a.uid === uidA)).toBe(false);
    });

    it('respects a locked role — does not release it', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m15c');
      admin.loadMeeting('m15c');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await svcA.claimRole('toastmaster');
      await waitFor(() => admin.roles()['toastmaster']?.uid === uidA);
      await admin.setRoleLocked('toastmaster', true);
      await waitFor(() => admin.lockedRoles().includes('toastmaster'));

      await admin.adminRemoveAttendee(uidA);
      await waitFor(() => admin.attendees().every((a) => a.uid !== uidA));
      expect(admin.roles()['toastmaster'].uid).toBe(uidA); // locked — survives the removal
    });

    it('is a no-op for a non-admin', async () => {
      const svcA = createService();
      const svcB = createService();
      svcA.loadMeeting('m15d');
      svcB.loadMeeting('m15d');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await waitFor(() => svcB.attendees().length === 1);

      expect(await svcB.adminRemoveAttendee(uidA)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(svcB.attendees().length).toBe(1);
    });

    it('lets a granted-only admin remove an attendee', async () => {
      const svcA = createService();
      const granted = createService({ uid: 'granted-uid', displayName: 'Granted', email: 'granted@example.com' }, false, true);
      svcA.loadMeeting('m15e');
      granted.loadMeeting('m15e');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await waitFor(() => granted.attendees().length === 1);

      expect(await granted.adminRemoveAttendee(uidA)).toBe(true);
      await waitFor(() => granted.attendees().length === 0);
    });

    it('writes a checkin.adminRemove auditLog entry', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m15f');
      admin.loadMeeting('m15f');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await waitFor(() => admin.attendees().length === 1);

      await admin.adminRemoveAttendee(uidA);

      const entries = await auditEntriesFor(firestore, 'checkin.adminRemove');
      expect(entries.some((e) => (e['summary'] as string).includes('Alice'))).toBe(true);
    });
  });

  describe('adminRemoveApology()', () => {
    it('removes a stray apology entry', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m16a');
      admin.loadMeeting('m16a');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await svcA.uncheckIn();
      await waitFor(() => admin.apologies().length === 1);

      expect(await admin.adminRemoveApology(uidA)).toBe(true);
      await waitFor(() => admin.apologies().length === 0);
    });

    it('is a no-op for a non-admin', async () => {
      const svcA = createService();
      const svcB = createService();
      svcA.loadMeeting('m16b');
      svcB.loadMeeting('m16b');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await svcA.uncheckIn();
      await waitFor(() => svcB.apologies().length === 1);

      expect(await svcB.adminRemoveApology(uidA)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(svcB.apologies().length).toBe(1);
    });

    it('writes a checkin.adminRemove auditLog entry', async () => {
      const svcA = createService();
      const admin = createService({ uid: 'admin-uid', displayName: 'Admin', email: 'admin@example.com' }, true);
      svcA.loadMeeting('m16c');
      admin.loadMeeting('m16c');
      await svcA.checkIn('Alice', 'alice@example.com');
      const uidA = svcA.currentUid;
      await svcA.uncheckIn();
      await waitFor(() => admin.apologies().length === 1);

      await admin.adminRemoveApology(uidA);

      const entries = await auditEntriesFor(firestore, 'checkin.adminRemove');
      expect(entries.some((e) => (e['summary'] as string).includes('Alice'))).toBe(true);
    });
  });
});
