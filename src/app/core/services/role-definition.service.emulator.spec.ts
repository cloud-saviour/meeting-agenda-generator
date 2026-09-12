import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { RoleDefinitionService } from './role-definition.service';
import { FIRESTORE } from '../firebase/firestore.provider';
import { AuthService } from '../auth/auth.service';

/**
 * RoleDefinitionService has no localStorage fallback anymore — the role list
 * lives entirely in Firestore's `roleDefinitions` collection (seeded via
 * scripts/seed-role-definitions.mjs, not hardcoded in the app). Run via
 * `npm run test:emulator` with the emulator already running.
 *
 * isAdmin() requires the `admin` custom claim, not just an authenticated uid
 * (see firestore.rules) — authenticatedContext()'s second argument simulates
 * that claim directly, no Firestore fixture document needed. isAppAdmin()
 * also recognizes a Firestore-granted appAdmins/{uid} entry (see
 * AuthService/AppAdminService) — full parity with isAdmin() for this
 * collection, per firestore.rules.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    function isGrantedAdmin() {
      return request.auth != null &&
        exists(/databases/$(database)/documents/appAdmins/$(request.auth.uid));
    }
    function isAppAdmin() {
      return isAdmin() || isGrantedAdmin();
    }
    match /appAdmins/{uid} {
      allow read: if request.auth != null && (request.auth.uid == uid || isAdmin());
      allow write: if isAdmin();
    }
    match /roleDefinitions/{roleId} {
      allow read: if true;
      allow write: if isAppAdmin();
    }
    match /auditLog/{entryId} {
      allow read: if isAdmin();
      allow create: if isAppAdmin();
      allow update, delete: if false;
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

function fakeAuth(uid: string, email: string): AuthService {
  return { currentUser: () => ({ uid, email }) } as unknown as AuthService;
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

  function createService(firestoreInstance: Firestore = firestore, authUid = 'test-admin-uid', authEmail = 'test-admin@example.com'): RoleDefinitionService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        RoleDefinitionService,
        { provide: FIRESTORE, useValue: firestoreInstance },
        { provide: AuthService, useValue: fakeAuth(authUid, authEmail) },
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

  it('setDefinition() creates a new role at the exact given id — for import, where stable ids must survive the round trip', async () => {
    const service = createService();
    await service.setDefinition({ id: 'toastmaster', label: 'Evening Chairman', order: 0, active: true });

    await waitFor(() => service.all().some((r) => r.id === 'toastmaster'));
    expect(service.all().find((r) => r.id === 'toastmaster')?.label).toBe('Evening Chairman');
  });

  it('setDefinition() overwrites an existing role at that id rather than duplicating it', async () => {
    const service = createService();
    await service.setDefinition({ id: 'toastmaster', label: 'Old Label', order: 0, active: true });
    await waitFor(() => service.all().length === 1);

    await service.setDefinition({ id: 'toastmaster', label: 'New Label', order: 3, active: false });

    await waitFor(() => service.all()[0]?.label === 'New Label');
    expect(service.all().length).toBe(1);
    expect(service.all()[0].order).toBe(3);
    expect(service.all()[0].active).toBe(false);
  });

  it('rejects writes from an authenticated uid with no admin custom claim — signed in alone is not enough', async () => {
    const nonAdminFirestore = testEnv
      .authenticatedContext('random-signed-up-uid')
      .firestore() as unknown as Firestore;
    const service = createService(nonAdminFirestore, 'random-signed-up-uid', 'random@example.com');

    await expect(service.create('Should Be Rejected')).rejects.toThrow();
  });

  it('allows writes from a Firestore-granted admin with no real claim — isAppAdmin() takes effect, not just isAdmin()', async () => {
    await setDoc(doc(firestore, 'appAdmins', 'granted-uid'), {
      uid: 'granted-uid',
      email: 'granted@example.com',
      displayName: 'Granted Admin',
      grantedAt: new Date().toISOString(),
      grantedByEmail: 'test-admin@example.com',
    });

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const service = createService(grantedFirestore, 'granted-uid', 'granted@example.com');

    const role = await service.create('Granted Admin Created This');
    await waitFor(() => service.all().some((r) => r.id === role.id));
    expect(service.all().find((r) => r.id === role.id)?.label).toBe('Granted Admin Created This');
  });

  it('create() and archive() each write a matching auditLog entry in the same batch as the change itself', async () => {
    const service = createService();
    const role = await service.create('Table Topics Master');
    await service.archive(role.id);

    const snap = await getDocs(collection(firestore, 'auditLog'));
    const entries = snap.docs.map((d) => d.data());

    expect(entries.some((e) => e['action'] === 'role.create' && e['summary'].includes('Table Topics Master'))).toBe(true);
    expect(entries.some((e) => e['action'] === 'role.archive' && e['summary'].includes('Table Topics Master'))).toBe(true);
  });
});
