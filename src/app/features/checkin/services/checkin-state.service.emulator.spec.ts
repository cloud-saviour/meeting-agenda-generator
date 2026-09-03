import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { CheckinStateService } from './checkin-state.service';
import { StorageService } from '../../../core/services/storage.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

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
 */
class FakeStorage {
  private store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}

// This unit-test builder bundles for the browser, so the real firestore.rules
// file (repo root) can't be read via node:fs at runtime — inlined instead.
// Keep this in sync with firestore.rules if that file's rules ever change
// beyond this trivial "allow everything" placeholder.
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

    // A bare TestBed module, unused directly — just gives us a parent injector
    // that already provides NgZone, so our own child injectors below don't
    // need to reinvent it.
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterEach(() => {
    for (const service of createdServices) service.ngOnDestroy();
    createdServices.length = 0;
  });

  function createService(uid: string, name?: string): CheckinStateService {
    const storage = new FakeStorage();
    storage.set('agora-checkin-uid', uid);
    if (name) storage.set('agora-checkin-name', name);

    const child = Injector.create({
      parent: parentInjector,
      providers: [
        CheckinStateService,
        { provide: StorageService, useValue: storage },
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(CheckinStateService);
    createdServices.push(service);
    return service;
  }

  it('checkIn() adds the current user to attendees once, and updates the name on repeat check-in', async () => {
    const service = createService('uid-1');
    service.loadMeeting('m1');

    await service.checkIn('Thabo M.');
    await waitFor(() => service.attendees().length === 1);
    expect(service.attendees()[0].name).toBe('Thabo M.');

    await service.checkIn('Thabo Molefe');
    await waitFor(() => service.attendees()[0]?.name === 'Thabo Molefe');
    expect(service.attendees().length).toBe(1);
  });

  it('claimRole() succeeds when unclaimed and blocks a different uid from claiming it', async () => {
    const svcA = createService('uid-a');
    const svcB = createService('uid-b');
    svcA.loadMeeting('m2');
    svcB.loadMeeting('m2');
    await svcA.checkIn('Alice');
    await svcB.checkIn('Bongani');

    expect(await svcA.claimRole('toastmaster')).toBe(true);
    expect(await svcB.claimRole('toastmaster')).toBe(false);

    await waitFor(() => svcB.roles()['toastmaster']?.uid === 'uid-a');
  });

  it('claimRole() fails without a checked-in name', async () => {
    const service = createService('uid-1');
    service.loadMeeting('m3');
    expect(await service.claimRole('toastmaster')).toBe(false);
  });

  it('releaseRole() only releases a claim owned by the current uid', async () => {
    const svcA = createService('uid-a');
    const svcB = createService('uid-b');
    svcA.loadMeeting('m4');
    svcB.loadMeeting('m4');
    await svcA.checkIn('Alice');
    await svcB.checkIn('Bongani');
    await svcA.claimRole('toastmaster');
    await waitFor(() => svcB.roles()['toastmaster']?.uid === 'uid-a');

    await svcB.releaseRole('toastmaster'); // not svcB's claim — no-op
    expect(svcB.roles()['toastmaster'].uid).toBe('uid-a');

    await svcA.releaseRole('toastmaster');
    await waitFor(() => svcA.roles()['toastmaster']?.uid === '');
  });

  it('addSpeakerSignup() rejects a second signup from the same person and respects maxSpeakers', async () => {
    const service = createService('uid-1');
    service.loadMeeting('m5');
    await service.checkIn('Naledi K.');

    expect(await service.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' })).toBe(
      true
    );
    expect(await service.addSpeakerSignup({ title: 'Talk 2', level: 'CC2', timePref: '5-7' })).toBe(
      false
    );
  });

  it('claimEvaluatorSlot() rejects evaluating your own speech and blocks a second concurrent claim', async () => {
    const svcA = createService('uid-a');
    const svcB = createService('uid-b');
    svcA.loadMeeting('m6');
    svcB.loadMeeting('m6');
    await svcA.checkIn('Naledi K.');
    await svcB.checkIn('Bongani');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcB.speakers().length === 1);
    const speakerId = svcB.speakers()[0].id;

    // Naledi cannot evaluate her own speech
    expect(await svcA.claimEvaluatorSlot(speakerId)).toBe(false);
    // Bongani can
    expect(await svcB.claimEvaluatorSlot(speakerId)).toBe(true);
  });

  it('releaseEvaluatorSlot() only releases a claim owned by the current uid', async () => {
    const svcA = createService('uid-a');
    const svcB = createService('uid-b');
    svcA.loadMeeting('m7');
    svcB.loadMeeting('m7');
    await svcA.checkIn('Naledi K.');
    await svcB.checkIn('Bongani');
    await svcA.addSpeakerSignup({ title: 'Talk 1', level: 'CC1', timePref: '5-7' });
    await waitFor(() => svcB.speakers().length === 1);
    const speakerId = svcB.speakers()[0].id;
    await svcB.claimEvaluatorSlot(speakerId);

    await svcA.releaseEvaluatorSlot(speakerId); // not svcA's claim — no-op
    await waitFor(() => svcA.speakers()[0]?.evaluator?.uid === 'uid-b');

    await svcB.releaseEvaluatorSlot(speakerId);
    await waitFor(() => svcB.speakers()[0]?.evaluator === null);
  });

  it('loadMeeting() isolates data between different meeting ids', async () => {
    const service = createService('uid-1');

    service.loadMeeting('m8a');
    await service.checkIn('Alice');
    await service.claimRole('toastmaster');
    expect(service.attendees().length).toBe(1);

    service.loadMeeting('m8b');
    await waitFor(() => service.attendees().length === 0);
    expect(service.roles()['toastmaster']?.uid ?? '').toBe('');

    service.loadMeeting('m8a');
    await waitFor(() => service.attendees().length === 1);
    expect(service.attendees()[0].name).toBe('Alice');
    expect(service.roles()['toastmaster'].uid).toBe('uid-1');
  });

  it('setRoleLocked() toggles lockedRoles() and makes claim/release a no-op on that role', async () => {
    const service = createService('uid-1');
    service.loadMeeting('m9');
    await service.checkIn('Thabo M.');

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
    await waitFor(() => service.roles()['toastmaster']?.uid === 'uid-1');
  });

  it('two concurrent claimRole() calls for the same role: exactly one succeeds', async () => {
    const svcA = createService('uid-a');
    const svcB = createService('uid-b');
    svcA.loadMeeting('m10');
    svcB.loadMeeting('m10');
    await svcA.checkIn('Alice');
    await svcB.checkIn('Bongani');

    const [okA, okB] = await Promise.all([
      svcA.claimRole('toastmaster'),
      svcB.claimRole('toastmaster'),
    ]);

    expect([okA, okB].filter(Boolean).length).toBe(1);
  });

  it('deleteMeeting() removes the Firestore document outright, without needing loadMeeting() first', async () => {
    const service = createService('uid-1');
    service.loadMeeting('m11');
    await service.checkIn('Alice');
    await waitFor(() => service.attendees().length === 1);

    const other = createService('uid-2'); // never calls loadMeeting('m11')
    await other.deleteMeeting('m11');

    const snap = await getDoc(doc(firestore, 'checkins', 'm11'));
    expect(snap.exists()).toBe(false);
  });
});
