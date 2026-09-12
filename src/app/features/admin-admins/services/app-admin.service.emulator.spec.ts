import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { AppAdminService } from './app-admin.service';
import { AuthService } from '../../../core/auth/auth.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * appAdmins/{uid} is the Firestore-based admin grant — see AuthService's
 * class doc and firestore.rules' isGrantedAdmin()/isAppAdmin(). Any
 * app-admin (real claim or granted) can grant/revoke ANOTHER member's
 * access — the key security property this file regression-tests is the
 * one thing still off-limits to everyone: granting/regranting your OWN
 * uid (create/update require `request.auth.uid != uid`; delete has no
 * such restriction, so cleanup of a legacy self-grant is still possible).
 * This file uses a minimal embedded `auditLog` rule too, since
 * AppAdminService.grant()/revoke() now write both collections in one
 * writeBatch() — see AuditLogService for the full-featured version of
 * that collection's rules and its own dedicated spec. Run via
 * `npm run test:emulator` with the emulator already running.
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
      allow read: if request.auth != null && (request.auth.uid == uid || isAppAdmin());
      allow create, update: if isAppAdmin() && request.auth.uid != uid;
      allow delete: if isAppAdmin();
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

function fakeAuth(uid: string, email: string | null): AuthService {
  return { currentUser: () => (email ? { uid, email } : null) } as unknown as AuthService;
}

describe('AppAdminService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let adminFirestore: Firestore;
  let parentInjector: Injector;
  const createdServices: AppAdminService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-appadmins-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    adminFirestore = testEnv.authenticatedContext('super-admin-uid', { admin: true }).firestore() as unknown as Firestore;

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

  function createService(
    firestore: Firestore,
    authUid = 'super-admin-uid',
    authEmail: string | null = 'super-admin@example.com'
  ): AppAdminService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        AppAdminService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: AuthService, useValue: fakeAuth(authUid, authEmail) },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(AppAdminService);
    createdServices.push(service);
    return service;
  }

  it('starts empty when Firestore has no grants yet', async () => {
    const service = createService(adminFirestore);
    await waitFor(() => service.ready());
    expect(service.all()).toEqual([]);
  });

  it('a true admin can grant and later revoke app-admin power', async () => {
    const service = createService(adminFirestore);
    await waitFor(() => service.ready());

    await service.grant('member-uid', 'member@example.com', 'Member One');
    await waitFor(() => service.isGranted('member-uid'));

    const granted = service.all().find((a) => a.uid === 'member-uid');
    expect(granted).toMatchObject({
      uid: 'member-uid',
      email: 'member@example.com',
      displayName: 'Member One',
      grantedByEmail: 'super-admin@example.com',
    });

    await service.revoke('member-uid', 'member@example.com', 'Member One');
    await waitFor(() => !service.isGranted('member-uid'));
    expect(service.all()).toEqual([]);
  });

  it('rejects a signed-in stranger (no claim, no grant) writing to appAdmins — being signed in is not enough', async () => {
    const strangerFirestore = testEnv.authenticatedContext('stranger-uid').firestore() as unknown as Firestore;
    await expect(setDoc(doc(strangerFirestore, 'appAdmins', 'someone-uid'), { uid: 'someone-uid' })).rejects.toThrow();
  });

  it('a GRANTED (non-claim) admin can grant/revoke a DIFFERENT member — the loosened model', async () => {
    // Seed a grant for 'granted-uid' as the true admin first.
    await grantAsTrueAdmin(adminFirestore, 'granted-uid');

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const grantedService = createService(grantedFirestore, 'granted-uid', 'granted@example.com');
    await waitFor(() => grantedService.ready());

    await grantedService.grant('another-uid', 'another@example.com', 'Another Member');
    await waitFor(() => grantedService.isGranted('another-uid'));

    await grantedService.revoke('another-uid', 'another@example.com', 'Another Member');
    await waitFor(() => !grantedService.isGranted('another-uid'));
  });

  it('a granted admin can read their own grant, and now anyone else\'s too — isAppAdmin() read', async () => {
    await setDoc(doc(adminFirestore, 'appAdmins', 'granted-uid'), {
      uid: 'granted-uid',
      email: 'granted@example.com',
      displayName: 'Granted Admin',
      grantedAt: new Date().toISOString(),
      grantedByEmail: 'super-admin@example.com',
    });
    await setDoc(doc(adminFirestore, 'appAdmins', 'other-uid'), {
      uid: 'other-uid',
      email: 'other@example.com',
      displayName: 'Other Admin',
      grantedAt: new Date().toISOString(),
      grantedByEmail: 'super-admin@example.com',
    });

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const own = await getDoc(doc(grantedFirestore, 'appAdmins', 'granted-uid'));
    expect(own.exists()).toBe(true);

    // Not "someone else's" in the browsing sense — a granted admin IS an
    // app-admin, so isAppAdmin() read now succeeds here too (see the
    // loosened model). What's still impossible is writing to their OWN uid.
    const other = await getDoc(doc(grantedFirestore, 'appAdmins', 'other-uid'));
    expect(other.exists()).toBe(true);
  });

  it('rejects a true admin granting themselves — self-grants are blocked, not just pointless', async () => {
    const service = createService(adminFirestore);
    await waitFor(() => service.ready());

    await expect(service.grant('super-admin-uid', 'super-admin@example.com', 'Super Admin')).rejects.toThrow();
    // The rejected write can appear briefly in the local cache as an
    // optimistic update before the server's rejection rolls it back — wait
    // for that rollback rather than asserting synchronously right after
    // the promise rejects.
    await waitFor(() => !service.isGranted('super-admin-uid'));
  });

  it('rejects a GRANTED admin granting themselves — the self-grant restriction applies to both tiers', async () => {
    await grantAsTrueAdmin(adminFirestore, 'granted-uid');

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const grantedService = createService(grantedFirestore, 'granted-uid', 'granted@example.com');
    await waitFor(() => grantedService.ready());

    await expect(
      grantedService.grant('granted-uid', 'granted@example.com', 'Granted Admin')
    ).rejects.toThrow();
  });

  it('still allows a true admin to delete a legacy self-grant, even though creating one is now blocked', async () => {
    // Simulate data that predates the self-grant restriction (e.g. seeded
    // directly, bypassing rules the way an Admin SDK script would).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const bypassFirestore = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(bypassFirestore, 'appAdmins', 'super-admin-uid'), {
        uid: 'super-admin-uid',
        email: 'super-admin@example.com',
        displayName: 'Super Admin',
        grantedAt: new Date().toISOString(),
        grantedByEmail: 'super-admin@example.com',
      });
    });

    const service = createService(adminFirestore);
    await waitFor(() => service.isGranted('super-admin-uid'));

    await service.revoke('super-admin-uid', 'super-admin@example.com', 'Super Admin');
    await waitFor(() => !service.isGranted('super-admin-uid'));
  });

  it('two independent instances see live grant/revoke updates', async () => {
    const svcA = createService(adminFirestore);
    const svcB = createService(adminFirestore);
    await waitFor(() => svcA.ready() && svcB.ready());

    await svcA.grant('member-uid', 'member@example.com', 'Member One');
    await waitFor(() => svcB.isGranted('member-uid'));

    await svcA.revoke('member-uid', 'member@example.com', 'Member One');
    await waitFor(() => !svcB.isGranted('member-uid'));
  });

  /** Seeds a grant directly as the true admin, bypassing the service layer — used to set up a "signed in as a granted admin" scenario for the next assertion. */
  async function grantAsTrueAdmin(firestore: Firestore, uid: string): Promise<void> {
    await setDoc(doc(firestore, 'appAdmins', uid), {
      uid,
      email: `${uid}@example.com`,
      displayName: 'Granted Admin',
      grantedAt: new Date().toISOString(),
      grantedByEmail: 'super-admin@example.com',
    });
  }
});
