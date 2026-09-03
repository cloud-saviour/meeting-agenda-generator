import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { CommitteeRosterService } from './committee-roster.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { CommitteeMember } from '../models/agenda.models';

/**
 * CommitteeRosterService is Firestore-backed — a single document at
 * `committeeRoster/current` holding the whole roster array (not one doc per
 * role, since roleId isn't a unique key here — see the service's own doc
 * comment). Run via `npm run test:emulator` with the emulator already running.
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

describe('CommitteeRosterService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let firestore: Firestore;
  let parentInjector: Injector;
  const createdServices: CommitteeRosterService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-roster-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    firestore = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;

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

  function createService(): CommitteeRosterService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        CommitteeRosterService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(CommitteeRosterService);
    createdServices.push(service);
    return service;
  }

  it('starts with 7 blank slots when Firestore has no roster document yet', async () => {
    const service = createService();
    await waitFor(() => service.all().length === 7);
    expect(service.all().every((m) => m.roleId === '' && m.name === '')).toBe(true);
  });

  it('ready() is false until Firestore delivers its first result, then stays true', async () => {
    // Regression test: AgendaStateService's one-time catch-up seed depends on
    // this — all()'s pre-load placeholder is itself a valid-looking 7-slot
    // array, so a consumer can't tell "still loading" from "genuinely empty"
    // by content alone. Caught a real bug where the guard consumed the
    // placeholder before Firestore's real data ever arrived.
    const service = createService();
    expect(service.ready()).toBe(false);

    await waitFor(() => service.ready());
    expect(service.ready()).toBe(true);
  });

  it('replaceAll() persists the roster and it appears live, padded back to 7 slots', async () => {
    const service = createService();
    await waitFor(() => service.all().length === 7);

    const members: CommitteeMember[] = [
      { roleId: 'president', name: 'Naledi K.', email: 'naledi@example.com', phone: '' },
      { roleId: 'secretary', name: 'Thabo M.', email: '', phone: '0821234567' },
    ];
    await service.replaceAll(members);

    await waitFor(() => service.all()[0]?.name === 'Naledi K.');
    expect(service.all().length).toBe(7);
    expect(service.all()[1].name).toBe('Thabo M.');
    expect(service.all().slice(2).every((m) => m.roleId === '' && m.name === '')).toBe(true);
  });

  it('replaceAll() fully replaces rather than merging — stale slots from a longer roster do not carry over', async () => {
    const service = createService();
    await service.replaceAll([
      { roleId: 'president', name: 'Naledi K.', email: '', phone: '' },
      { roleId: 'secretary', name: 'Thabo M.', email: '', phone: '' },
      { roleId: 'treasurer', name: 'Bongani S.', email: '', phone: '' },
    ]);
    await waitFor(() => service.all()[2]?.name === 'Bongani S.');

    await service.replaceAll([{ roleId: 'president', name: 'New President', email: '', phone: '' }]);

    await waitFor(() => service.all()[0]?.name === 'New President');
    expect(service.all().length).toBe(7);
    expect(service.all().some((m) => m.name === 'Thabo M.' || m.name === 'Bongani S.')).toBe(false);
  });

  it("regression: manually deleting one array element in Firestore (not through the app) restores a blank slot instead of permanently losing it", async () => {
    // This is exactly what happened in production: an admin deleted one
    // committee member via the Firestore/Emulator UI directly (not through
    // the app, which has no "remove a slot" action at all). That doesn't
    // clear the slot — it removes the whole array element, shifting every
    // later entry up by one index and leaving only 6. Without padding, the
    // missing 7th slot — and the admin's ability to re-enter anyone into it
    // — would be gone until someone hand-edited Firestore again.
    const service = createService();
    await service.replaceAll([
      { roleId: 'president', name: 'Person A', email: '', phone: '' },
      { roleId: 'secretary', name: 'Person B', email: '', phone: '' },
      { roleId: 'vpEducation', name: 'Person C', email: '', phone: '' },
      { roleId: 'communityManager', name: 'Person D', email: '', phone: '' },
      { roleId: 'vpMembership', name: 'Person E', email: '', phone: '' },
      { roleId: 'rsaAmbassador', name: 'Person F', email: '', phone: '' },
      { roleId: 'treasurer', name: 'Person G', email: '', phone: '' },
    ]);
    await waitFor(() => service.all().length === 7);

    // Simulate the manual deletion: write the array back with the
    // vpEducation entry (index 2) removed outright, as the Emulator UI would.
    const remaining = service.all().filter((m) => m.roleId !== 'vpEducation');
    expect(remaining.length).toBe(6);
    await service.replaceAll(remaining);

    await waitFor(() => service.all().length === 7);
    expect(service.all().filter((m) => m.name).map((m) => m.name)).toEqual([
      'Person A',
      'Person B',
      'Person D',
      'Person E',
      'Person F',
      'Person G',
    ]);
    // A blank slot is back, ready for the admin to pick "VP Education" and
    // re-enter a name — the actual bug being fixed here.
    expect(service.all()[6]).toEqual({ roleId: '', name: '', email: '', phone: '' });
  });

  it('two independent instances see the same live roster', async () => {
    const svcA = createService();
    const svcB = createService();
    await waitFor(() => svcA.all().length === 7 && svcB.all().length === 7);

    await svcA.replaceAll([{ roleId: 'president', name: 'From A', email: '', phone: '' }]);

    await waitFor(() => svcB.all()[0]?.name === 'From A');
    expect(svcB.all().length).toBe(7);
  });
});
