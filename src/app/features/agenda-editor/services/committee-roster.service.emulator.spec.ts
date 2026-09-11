import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { CommitteeRosterService } from './committee-roster.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * CommitteeRosterService is Firestore-backed — a single document at
 * `committeeRoster/current` holding the whole roster array (not one doc per
 * role, since it's a variable-length list of only the *assigned* roles — see
 * the service's own doc comment). Run via `npm run test:emulator` with the
 * emulator already running.
 *
 * isAdmin() requires the `admin` custom claim, not just an authenticated uid
 * (see firestore.rules) — authenticatedContext()'s second argument simulates
 * that claim directly, no Firestore fixture document needed.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /committeeRoster/{docId} {
      allow read: if true;
      allow write: if isAdmin();
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
    firestore = testEnv.authenticatedContext('test-admin-uid', { admin: true }).firestore() as unknown as Firestore;

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

  it('starts empty when Firestore has no roster document yet', async () => {
    const service = createService();
    await waitFor(() => service.ready());
    expect(service.all()).toEqual([]);
  });

  it('ready() is false until Firestore delivers its first result, then stays true', async () => {
    // Regression test: AgendaStateService's one-time catch-up seed (for
    // agItems/meeting.vpe) depends on this — all()'s pre-load placeholder
    // is itself a valid-looking (empty) array, so a consumer can't tell
    // "still loading" from "genuinely empty" by content alone. Caught a real
    // bug where the guard consumed the placeholder before Firestore's real
    // data ever arrived.
    const service = createService();
    expect(service.ready()).toBe(false);

    await waitFor(() => service.ready());
    expect(service.ready()).toBe(true);
  });

  it('assign() adds an entry without disturbing other roles', async () => {
    const service = createService();
    await waitFor(() => service.ready());

    await service.assign('president', 'Naledi K.', 'naledi@example.com', '');
    await waitFor(() => service.all().some((m) => m.roleId === 'president'));
    await service.assign('secretary', 'Thabo M.', '', '0821234567');
    await waitFor(() => service.all().some((m) => m.roleId === 'secretary'));

    expect(service.all().length).toBe(2);
    expect(service.all().find((m) => m.roleId === 'president')?.name).toBe('Naledi K.');
    expect(service.all().find((m) => m.roleId === 'secretary')?.name).toBe('Thabo M.');
  });

  it('assign() on an already-assigned role replaces it rather than appending a duplicate', async () => {
    const service = createService();
    await service.assign('president', 'First Person', '', '');
    await waitFor(() => service.all().find((m) => m.roleId === 'president')?.name === 'First Person');

    await service.assign('president', 'Second Person', '', '');
    await waitFor(() => service.all().find((m) => m.roleId === 'president')?.name === 'Second Person');

    expect(service.all().filter((m) => m.roleId === 'president').length).toBe(1);
  });

  it('unassign() removes the entry entirely — no leftover blank placeholder', async () => {
    const service = createService();
    await service.assign('president', 'Naledi K.', '', '');
    await service.assign('secretary', 'Thabo M.', '', '');
    await waitFor(() => service.all().length === 2);

    await service.unassign('president');

    await waitFor(() => service.all().length === 1);
    expect(service.all().some((m) => m.roleId === 'president')).toBe(false);
    expect(service.all()[0].roleId).toBe('secretary');
  });

  it('unassign() on a never-assigned role is a safe no-op', async () => {
    const service = createService();
    await service.assign('president', 'Naledi K.', '', '');
    await waitFor(() => service.all().length === 1);

    await service.unassign('treasurer');

    expect(service.all().length).toBe(1);
    expect(service.all()[0].roleId).toBe('president');
  });

  it('filters out legacy blank-roleId padded entries left over from the old fixed-slot model', async () => {
    // Simulate old stored data: a previous version of this service padded
    // the array with blank-roleId slots. An unassigned role is now
    // "absent," not "present with roleId ''" — the service must tolerate
    // finding old data shaped the old way.
    await setDoc(doc(firestore, 'committeeRoster', 'current'), {
      members: [
        { roleId: 'president', name: 'Naledi K.', email: '', phone: '' },
        { roleId: '', name: '', email: '', phone: '' },
        { roleId: '', name: '', email: '', phone: '' },
      ],
    });

    const service = createService();
    await waitFor(() => service.ready());

    expect(service.all()).toEqual([{ roleId: 'president', name: 'Naledi K.', email: '', phone: '' }]);
  });

  it('two independent instances see the same live roster', async () => {
    const svcA = createService();
    const svcB = createService();
    await waitFor(() => svcA.ready() && svcB.ready());

    await svcA.assign('president', 'From A', '', '');

    await waitFor(() => svcB.all().some((m) => m.roleId === 'president'));
    expect(svcB.all()[0].name).toBe('From A');
  });

  it('replaceAll() overwrites the whole roster in one atomic write — for import, where the file is the new source of truth', async () => {
    const service = createService();
    await service.assign('president', 'Existing President', '', '');
    await waitFor(() => service.all().length === 1);

    await service.replaceAll([
      { roleId: 'secretary', name: 'Imported Secretary', email: '', phone: '' },
      { roleId: 'treasurer', name: 'Imported Treasurer', email: '', phone: '' },
    ]);

    await waitFor(() => service.all().length === 2);
    expect(service.all().some((m) => m.roleId === 'president')).toBe(false);
    expect(service.all().map((m) => m.roleId).sort()).toEqual(['secretary', 'treasurer']);
  });
});
