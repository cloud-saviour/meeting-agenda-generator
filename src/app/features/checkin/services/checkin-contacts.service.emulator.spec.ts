import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { CheckinContactsService } from './checkin-contacts.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * `checkinContacts/{uid}` holds real emails behind check-in identities —
 * write is open (same accepted risk as `checkins/**` itself: anonymous,
 * self-reported, no verification), but read is admin-only, since this is
 * the one place raw PII lives (see firestore.rules).
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /checkinContacts/{uid} {
      allow read: if isAdmin();
      allow write: if true;
    }
  }
}
`;

describe('CheckinContactsService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let unauthFirestore: Firestore;
  let adminFirestore: Firestore;
  let parentInjector: Injector;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-contacts-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    unauthFirestore = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    adminFirestore = testEnv.authenticatedContext('admin-uid', { admin: true }).firestore() as unknown as Firestore;
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  function createService(firestore: Firestore): CheckinContactsService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [CheckinContactsService, { provide: FIRESTORE, useValue: firestore }],
    });
    return child.get(CheckinContactsService);
  }

  it('upsert() writes the contact — writable even unauthenticated, matching checkins/** itself', async () => {
    const service = createService(unauthFirestore);
    await service.upsert('uid-1', 'Alice', 'alice@example.com');

    const snap = await getDoc(doc(adminFirestore, 'checkinContacts', 'uid-1'));
    expect(snap.data()).toMatchObject({ uid: 'uid-1', name: 'Alice', email: 'alice@example.com' });
  });

  it('upsert() called again merges (updates) rather than duplicating', async () => {
    const service = createService(unauthFirestore);
    await service.upsert('uid-1', 'Alice', 'alice@example.com');
    await service.upsert('uid-1', 'Alice A.', 'alice@example.com');

    const snap = await getDoc(doc(adminFirestore, 'checkinContacts', 'uid-1'));
    expect(snap.data()?.['name']).toBe('Alice A.');
  });

  it('rejects an unauthenticated read — this is the one place raw email is protected', async () => {
    const admin = createService(adminFirestore);
    await admin.upsert('uid-1', 'Alice', 'alice@example.com');

    await expect(getDoc(doc(unauthFirestore, 'checkinContacts', 'uid-1'))).rejects.toThrow();
  });

  it('allows an admin to read a contact', async () => {
    const admin = createService(adminFirestore);
    await admin.upsert('uid-1', 'Alice', 'alice@example.com');

    const snap = await getDoc(doc(adminFirestore, 'checkinContacts', 'uid-1'));
    expect(snap.data()?.['email']).toBe('alice@example.com');
  });
});
