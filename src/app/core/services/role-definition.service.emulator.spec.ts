import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { RoleDefinitionService } from './role-definition.service';
import { FIRESTORE } from '../firebase/firestore.provider';

/**
 * RoleDefinitionService has no localStorage fallback anymore — the role list
 * lives entirely in Firestore's `roleDefinitions` collection (seeded via
 * scripts/seed-role-definitions.mjs, not hardcoded in the app). Run via
 * `npm run test:emulator` with the emulator already running.
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

describe('RoleDefinitionService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let firestore: Firestore;
  let parentInjector: Injector;
  const createdServices: RoleDefinitionService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-roles-test',
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

  function createService(): RoleDefinitionService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        RoleDefinitionService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(RoleDefinitionService);
    createdServices.push(service);
    return service;
  }

  it('starts empty when Firestore has no role documents yet — no hardcoded fallback', async () => {
    const service = createService();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(service.all()).toEqual([]);
  });

  it('create() adds a role and it appears live once Firestore delivers it', async () => {
    const service = createService();
    const role = await service.create('Table Topics Master');
    expect(role.order).toBe(0);

    await waitFor(() => service.all().some((r) => r.id === role.id));
    expect(service.all().find((r) => r.id === role.id)?.label).toBe('Table Topics Master');
  });

  it('create() assigns increasing order indices', async () => {
    const service = createService();
    const first = await service.create('Role A');
    await waitFor(() => service.all().length === 1);
    const second = await service.create('Role B');

    expect(second.order).toBe(first.order + 1);
  });

  it('archive() sets active=false without removing the entry; restore() reverses it', async () => {
    const service = createService();
    const role = await service.create('Table Topics Master');
    await waitFor(() => service.all().length === 1);

    await service.archive(role.id);
    await waitFor(() => !service.activeRoles().some((r) => r.id === role.id));
    expect(service.all().some((r) => r.id === role.id)).toBe(true);

    await service.restore(role.id);
    await waitFor(() => service.activeRoles().some((r) => r.id === role.id));
  });

  it('update() changes label and description', async () => {
    const service = createService();
    const role = await service.create('Old Label', 'Old description');
    await waitFor(() => service.all().length === 1);

    await service.update(role.id, { label: 'New Label', description: 'New description' });

    await waitFor(() => service.all()[0]?.label === 'New Label');
    expect(service.all()[0].description).toBe('New description');
  });
});
