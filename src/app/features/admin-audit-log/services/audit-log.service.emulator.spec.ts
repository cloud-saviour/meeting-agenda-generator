import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { AuditLogService } from './audit-log.service';
import { AppAdminService } from '../../admin-admins/services/app-admin.service';
import { AuthService } from '../../../core/auth/auth.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * auditLog/{entryId} is the append-only trail of meaningful admin actions
 * across the app (see core/audit/audit-log.models.ts's AuditAction) — see
 * AuditLogService's class doc and core/audit/audit-log.util.ts's
 * appendAuditEntry(), the only writer (always in the same writeBatch() as
 * the audited change itself). This file exercises that pattern through
 * AppAdminService.grant()/revoke() specifically, since it's the simplest
 * audited mutator to drive directly — every other instrumented service
 * (RoleDefinitionService, PublishedAgendaService, etc.) follows the exact
 * same appendAuditEntry() call shape, verified by one dedicated test each
 * in their own spec files. Read is isAdmin()-only — even a granted admin,
 * who CAN perform the audited action, cannot see the trail of who did
 * what — which is the key security property this file regression-tests.
 * Run via `npm run test:emulator` with the emulator already running.
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
      allow create: if isAppAdmin()
        && request.resource.data.action is string
        && request.resource.data.actorUid is string
        && request.resource.data.at is string
        && request.resource.data.summary is string;
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

describe('AuditLogService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let adminFirestore: Firestore;
  let parentInjector: Injector;
  const createdAuditServices: AuditLogService[] = [];
  const createdAdminServices: AppAdminService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-auditlog-test',
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
    for (const service of createdAuditServices) service.ngOnDestroy();
    for (const service of createdAdminServices) service.ngOnDestroy();
    createdAuditServices.length = 0;
    createdAdminServices.length = 0;
  });

  function createAuditService(firestore: Firestore): AuditLogService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        AuditLogService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(AuditLogService);
    createdAuditServices.push(service);
    return service;
  }

  function createAppAdminService(firestore: Firestore, uid: string, email: string): AppAdminService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        AppAdminService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: AuthService, useValue: fakeAuth(uid, email) },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(AppAdminService);
    createdAdminServices.push(service);
    return service;
  }

  it('a grant through AppAdminService creates a matching auditLog entry', async () => {
    const appAdmins = createAppAdminService(adminFirestore, 'super-admin-uid', 'super-admin@example.com');
    await waitFor(() => appAdmins.ready());
    await appAdmins.grant('member-uid', 'member@example.com', 'Member One');

    const auditLog = createAuditService(adminFirestore);
    await waitFor(() => auditLog.entries().length === 1);

    expect(auditLog.entries()[0]).toMatchObject({
      action: 'admin.grant',
      summary: 'Granted admin access to Member One (member@example.com)',
      actorUid: 'super-admin-uid',
      actorEmail: 'super-admin@example.com',
    });
  });

  it('a revoke through AppAdminService creates a matching auditLog entry, and the grant entry is still there — append-only', async () => {
    const appAdmins = createAppAdminService(adminFirestore, 'super-admin-uid', 'super-admin@example.com');
    await waitFor(() => appAdmins.ready());
    await appAdmins.grant('member-uid', 'member@example.com', 'Member One');
    await waitFor(() => appAdmins.isGranted('member-uid'));

    await appAdmins.revoke('member-uid', 'member@example.com', 'Member One');

    const auditLog = createAuditService(adminFirestore);
    await waitFor(() => auditLog.entries().length === 2);

    expect(auditLog.entries().map((e) => e.action).sort()).toEqual(['admin.grant', 'admin.revoke']);
  });

  it('a GRANTED admin performing a grant also creates a valid auditLog entry, attributed to them', async () => {
    // Seed 'granted-uid' as a granted admin directly (as the true admin).
    await createAppAdminService(adminFirestore, 'super-admin-uid', 'super-admin@example.com').grant(
      'granted-uid',
      'granted@example.com',
      'Granted Admin'
    );

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const appAdminsAsGranted = createAppAdminService(grantedFirestore, 'granted-uid', 'granted@example.com');
    await waitFor(() => appAdminsAsGranted.ready());
    await appAdminsAsGranted.grant('third-uid', 'third@example.com', 'Third Member');

    const auditLog = createAuditService(adminFirestore);
    await waitFor(() => auditLog.entries().some((e) => e.summary.includes('Third Member')));

    const entry = auditLog.entries().find((e) => e.summary.includes('Third Member'));
    expect(entry).toMatchObject({ action: 'admin.grant', actorUid: 'granted-uid', actorEmail: 'granted@example.com' });
  });

  it('rejects read from a GRANTED (non-claim) admin — even though they can perform the audited action, they cannot see the trail', async () => {
    await createAppAdminService(adminFirestore, 'super-admin-uid', 'super-admin@example.com').grant(
      'granted-uid',
      'granted@example.com',
      'Granted Admin'
    );

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const auditLog = createAuditService(grantedFirestore);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(auditLog.entries()).toEqual([]);
  });

  it('rejects read from a signed-in stranger with no claim and no grant', async () => {
    const strangerFirestore = testEnv.authenticatedContext('stranger-uid').firestore() as unknown as Firestore;
    const auditLog = createAuditService(strangerFirestore);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(auditLog.entries()).toEqual([]);
  });

  it('rejects a direct write missing required fields — server-side shape validation, not just client discipline', async () => {
    await expect(
      addDoc(collection(adminFirestore, 'auditLog'), {
        action: 'admin.grant',
        actorUid: 'super-admin-uid',
        at: new Date().toISOString(),
        // summary deliberately omitted
      })
    ).rejects.toThrow();
  });

  it('rejects updating or deleting an existing entry — immutable once written', async () => {
    const appAdmins = createAppAdminService(adminFirestore, 'super-admin-uid', 'super-admin@example.com');
    await appAdmins.grant('member-uid', 'member@example.com', 'Member One');

    const auditLog = createAuditService(adminFirestore);
    await waitFor(() => auditLog.entries().length === 1);
    const entryId = auditLog.entries()[0].id;

    await expect(updateDoc(doc(adminFirestore, 'auditLog', entryId), { action: 'admin.revoke' })).rejects.toThrow();
    await expect(deleteDoc(doc(adminFirestore, 'auditLog', entryId))).rejects.toThrow();
  });
});
