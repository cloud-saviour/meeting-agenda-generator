import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { CheckinContactsService } from './checkin-contacts.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { ClubContextService } from '../../../core/club/club-context.service';

const testClubId = 'test-club';

function fakeClubContextService(clubId: string | null = testClubId, isAppAdmin = false) {
  return { currentClubId: signal<string | null>(clubId), isAppAdmin: signal(isAppAdmin) } as unknown as ClubContextService;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor() timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * `clubs/{clubId}/checkinContacts/{uid}` holds real emails behind check-in
 * identities — write is open (same accepted risk as `checkins/**` itself:
 * anonymous, self-reported, no verification), but read is admin-only, since
 * this is the one place raw PII lives (see firestore.rules). Mirrors the real
 * rule's `isAppAdmin(clubId)` (real claim OR a granted admin of THIS club),
 * not just the real claim, since CheckinContactsService.byUid() must work for
 * a granted club admin too.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /clubs/{clubId} {
      function isGrantedAdmin(cid) {
        return request.auth != null &&
          exists(/databases/$(database)/documents/clubs/$(cid)/appAdmins/$(request.auth.uid));
      }
      function isAppAdmin(cid) {
        return isAdmin() || isGrantedAdmin(cid);
      }
      match /appAdmins/{uid} {
        allow read: if true;
        allow write: if isAdmin();
      }
      match /checkinContacts/{uid} {
        allow read: if isAppAdmin(clubId);
        allow write: if true;
      }
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
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  // Fetched fresh per test, not once in beforeAll: CheckinContactsService now
  // subscribes via a constructor effect() (byUid()), and Angular's TestBed
  // destroys its environment injector after every test — a parentInjector
  // captured once would throw NG0205 from the second test onward. Same fix
  // this repo's other emulator specs needed once their services grew an
  // effect() too (see CLAUDE.md).
  beforeEach(async () => {
    await testEnv.clearFirestore();
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  function createService(firestore: Firestore, clubContext = fakeClubContextService()): CheckinContactsService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        CheckinContactsService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: ClubContextService, useValue: clubContext },
      ],
    });
    return child.get(CheckinContactsService);
  }

  it('upsert() writes the contact — writable even unauthenticated, matching checkins/** itself', async () => {
    const service = createService(unauthFirestore);
    await service.upsert('uid-1', 'Alice', 'alice@example.com');

    const snap = await getDoc(doc(adminFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'));
    expect(snap.data()).toMatchObject({ uid: 'uid-1', name: 'Alice', email: 'alice@example.com' });
  });

  it('upsert() called again merges (updates) rather than duplicating', async () => {
    const service = createService(unauthFirestore);
    await service.upsert('uid-1', 'Alice', 'alice@example.com');
    await service.upsert('uid-1', 'Alice A.', 'alice@example.com');

    const snap = await getDoc(doc(adminFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'));
    expect(snap.data()?.['name']).toBe('Alice A.');
  });

  it('rejects an unauthenticated read — this is the one place raw email is protected', async () => {
    const admin = createService(adminFirestore);
    await admin.upsert('uid-1', 'Alice', 'alice@example.com');

    await expect(getDoc(doc(unauthFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'))).rejects.toThrow();
  });

  it('allows an admin to read a contact', async () => {
    const admin = createService(adminFirestore);
    await admin.upsert('uid-1', 'Alice', 'alice@example.com');

    const snap = await getDoc(doc(adminFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'));
    expect(snap.data()?.['email']).toBe('alice@example.com');
  });

  it('upsert() no-ops when no club is resolved', async () => {
    const service = createService(unauthFirestore, fakeClubContextService(null));
    await expect(service.upsert('uid-1', 'Alice', 'alice@example.com')).resolves.toBeUndefined();
  });

  it('byUid() stays empty for a signed-out or non-admin viewer, even after contacts exist', async () => {
    await setDoc(doc(adminFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'), {
      uid: 'uid-1', name: 'Alice', email: 'alice@example.com', updatedAt: 'now',
    });

    const guest = createService(unauthFirestore, fakeClubContextService(testClubId, false));
    // Nothing to await on success — confirm it STAYS empty for a beat, since
    // there's no positive event a permission-denied read would ever fire.
    await new Promise((r) => setTimeout(r, 300));
    expect(guest.byUid().size).toBe(0);
  });

  it('byUid() reads live for a real-claim admin', async () => {
    await setDoc(doc(adminFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'), {
      uid: 'uid-1', name: 'Alice', email: 'alice@example.com', updatedAt: 'now',
    });

    const admin = createService(adminFirestore, fakeClubContextService(testClubId, true));
    await waitFor(() => admin.byUid().size === 1);
    expect(admin.byUid().get('uid-1')?.email).toBe('alice@example.com');
  });

  it('byUid() reads live for a GRANTED (non-claim) admin of this club', async () => {
    await setDoc(doc(adminFirestore, 'clubs', testClubId, 'appAdmins', 'granted-uid'), { uid: 'granted-uid' });
    await setDoc(doc(adminFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'), {
      uid: 'uid-1', name: 'Alice', email: 'alice@example.com', updatedAt: 'now',
    });

    const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
    const granted = createService(grantedFirestore, fakeClubContextService(testClubId, true));
    await waitFor(() => granted.byUid().size === 1);
    expect(granted.byUid().get('uid-1')?.email).toBe('alice@example.com');
  });

  it('byUid() clears when the club changes and stops listening on the old club', async () => {
    await setDoc(doc(adminFirestore, 'clubs', testClubId, 'checkinContacts', 'uid-1'), {
      uid: 'uid-1', name: 'Alice', email: 'alice@example.com', updatedAt: 'now',
    });

    const clubIdSignal = signal<string | null>(testClubId);
    const clubContext = { currentClubId: clubIdSignal, isAppAdmin: signal(true) } as unknown as ClubContextService;
    const admin = createService(adminFirestore, clubContext);
    await waitFor(() => admin.byUid().size === 1);

    clubIdSignal.set('other-club');
    await waitFor(() => admin.byUid().size === 0);
  });
});
