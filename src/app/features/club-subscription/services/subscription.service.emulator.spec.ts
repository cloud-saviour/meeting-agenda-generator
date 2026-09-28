import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { SubscriptionService } from './subscription.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { ClubContextService } from '../../../core/club/club-context.service';
import { AuthService } from '../../../core/auth/auth.service';
import { sha256Hex } from '../../../core/utils/hash';

const clubAId = 'club-a';
const clubBId = 'club-b';

function fakeClubContextService(clubId: string | null = clubAId, isAppAdmin = false) {
  return { currentClubId: signal<string | null>(clubId), isAppAdmin: signal(isAppAdmin) } as unknown as ClubContextService;
}

function fakeAuthService(user: Pick<User, 'uid' | 'email'> | null = null) {
  return { currentUser: signal(user) } as unknown as AuthService;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor() timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Mirrors the real `clubs/{clubId}/subscribers` and `.../announcements`
 * rules (see firestore.rules) — the unit-test builder can't read the real
 * file from disk. `isGrantedAdmin`/`appAdmins` are included so the "granted
 * admin can read subscribers" case can be exercised for real, same as
 * checkin-contacts.service.emulator.spec.ts.
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
      match /subscribers/{subscriberId} {
        allow get: if true;
        allow list: if isAppAdmin(clubId);
        allow write: if true;
      }
      match /announcements/{id} {
        allow read: if true;
        allow create: if isAppAdmin(clubId)
          && request.resource.data.subject is string
          && request.resource.data.subject.size() > 0
          && request.resource.data.subject.size() <= 200
          && request.resource.data.body is string
          && request.resource.data.body.size() > 0
          && request.resource.data.body.size() <= 5000;
        allow update, delete: if false;
      }
      match /auditLog/{entryId} {
        allow read: if isAdmin();
        allow create: if isAppAdmin(clubId)
          && request.resource.data.action is string
          && request.resource.data.actorUid is string
          && request.resource.data.at is string
          && request.resource.data.summary is string;
        allow update, delete: if false;
      }
    }
  }
}
`;

describe('SubscriptionService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let unauthFirestore: Firestore;
  let adminFirestore: Firestore;
  let parentInjector: Injector;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-subscription-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    unauthFirestore = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    adminFirestore = testEnv.authenticatedContext('admin-uid', { admin: true }).firestore() as unknown as Firestore;
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  // Fresh per test, not once in beforeAll — SubscriptionService subscribes
  // via constructor effect()s, and TestBed destroys its injector after every
  // test (NG0205 otherwise from the second test onward). See CLAUDE.md.
  beforeEach(async () => {
    await testEnv.clearFirestore();
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  function createService(
    firestore: Firestore,
    clubContext = fakeClubContextService(),
    authService = fakeAuthService()
  ): SubscriptionService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        SubscriptionService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: ClubContextService, useValue: clubContext },
        { provide: AuthService, useValue: authService },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    return child.get(SubscriptionService);
  }

  describe('subscribe() / unsubscribe()', () => {
    it('subscribes an anonymous guest — no sign-in needed', async () => {
      const service = createService(unauthFirestore);
      const ok = await service.subscribe('  Guest@Example.com  ');
      expect(ok).toBe(true);

      const id = await sha256Hex('guest@example.com');
      const snap = await getDoc(doc(adminFirestore, 'clubs', clubAId, 'subscribers', id));
      expect(snap.data()).toMatchObject({ email: 'guest@example.com' });
    });

    it('re-subscribing the same email is idempotent — same doc id, one entry', async () => {
      const service = createService(unauthFirestore);
      await service.subscribe('guest@example.com');
      await service.subscribe('GUEST@example.com');

      const snap = await getDocs(collection(adminFirestore, 'clubs', clubAId, 'subscribers'));
      expect(snap.size).toBe(1);
    });

    it('rejects a blank/invalid-looking email without writing anything', async () => {
      const service = createService(unauthFirestore);
      expect(await service.subscribe('not-an-email')).toBe(false);
      expect(await service.subscribe('')).toBe(false);
      expect((await getDocs(collection(adminFirestore, 'clubs', clubAId, 'subscribers'))).size).toBe(0);
    });

    it('unsubscribe() removes the subscriber doc', async () => {
      const service = createService(unauthFirestore);
      await service.subscribe('guest@example.com');
      const id = await sha256Hex('guest@example.com');
      expect((await getDoc(doc(adminFirestore, 'clubs', clubAId, 'subscribers', id))).exists()).toBe(true);

      const ok = await service.unsubscribe('guest@example.com');
      expect(ok).toBe(true);
      expect((await getDoc(doc(adminFirestore, 'clubs', clubAId, 'subscribers', id))).exists()).toBe(false);
    });

    it('unsubscribe() of an email that was never subscribed is a harmless no-op', async () => {
      const service = createService(unauthFirestore);
      await expect(service.unsubscribe('never-subscribed@example.com')).resolves.toBe(true);
    });
  });

  describe('isSubscribed() — a public, single-doc self-check (not the admin list())', () => {
    it('is false for an email nobody subscribed, checked by a signed-out visitor', async () => {
      const service = createService(unauthFirestore);
      expect(await service.isSubscribed('guest@example.com')).toBe(false);
    });

    it('is true right after subscribe(), and false again right after unsubscribe(), for the SAME signed-out caller', async () => {
      const service = createService(unauthFirestore);
      await service.subscribe('guest@example.com');
      expect(await service.isSubscribed('guest@example.com')).toBe(true);

      await service.unsubscribe('guest@example.com');
      expect(await service.isSubscribed('guest@example.com')).toBe(false);
    });

    it('returns false, not a thrown error, for a blank/invalid email', async () => {
      const service = createService(unauthFirestore);
      await expect(service.isSubscribed('not-an-email')).resolves.toBe(false);
    });
  });

  describe('subscribers() — admin-only read', () => {
    it('stays empty for a signed-out or non-admin viewer, even after subscribers exist', async () => {
      const id = await sha256Hex('guest@example.com');
      await setDoc(doc(adminFirestore, 'clubs', clubAId, 'subscribers', id), { email: 'guest@example.com', subscribedAt: 'now' });

      const guest = createService(unauthFirestore, fakeClubContextService(clubAId, false));
      await new Promise((r) => setTimeout(r, 300));
      expect(guest.subscribers().size).toBe(0);
    });

    it('reads live for a real-claim admin', async () => {
      const id = await sha256Hex('guest@example.com');
      await setDoc(doc(adminFirestore, 'clubs', clubAId, 'subscribers', id), { email: 'guest@example.com', subscribedAt: 'now' });

      const admin = createService(adminFirestore, fakeClubContextService(clubAId, true));
      await waitFor(() => admin.subscribers().size === 1);
      expect(admin.subscribers().get(id)?.email).toBe('guest@example.com');
    });

    it('reads live for a GRANTED (non-claim) admin of this club', async () => {
      await setDoc(doc(adminFirestore, 'clubs', clubAId, 'appAdmins', 'granted-uid'), { uid: 'granted-uid' });
      const id = await sha256Hex('guest@example.com');
      await setDoc(doc(adminFirestore, 'clubs', clubAId, 'subscribers', id), { email: 'guest@example.com', subscribedAt: 'now' });

      const grantedFirestore = testEnv.authenticatedContext('granted-uid').firestore() as unknown as Firestore;
      const granted = createService(grantedFirestore, fakeClubContextService(clubAId, true));
      await waitFor(() => granted.subscribers().size === 1);
    });

    it('an admin of a DIFFERENT club cannot read this club’s subscribers', async () => {
      await setDoc(doc(adminFirestore, 'clubs', clubBId, 'appAdmins', 'other-admin-uid'), { uid: 'other-admin-uid' });
      const id = await sha256Hex('guest@example.com');
      await setDoc(doc(adminFirestore, 'clubs', clubAId, 'subscribers', id), { email: 'guest@example.com', subscribedAt: 'now' });

      const otherClubFirestore = testEnv.authenticatedContext('other-admin-uid').firestore() as unknown as Firestore;
      // Client-side isAppAdmin is forced true here on purpose — this proves
      // the SERVER rule rejects it (this uid is only granted in club B), not
      // just that the client chose not to ask.
      const wrongClubAdmin = createService(otherClubFirestore, fakeClubContextService(clubAId, true));
      await new Promise((r) => setTimeout(r, 300));
      expect(wrongClubAdmin.subscribers().size).toBe(0);
    });
  });

  describe('announcements — public read, admin-only write', () => {
    it('is readable live by a signed-out guest', async () => {
      await setDoc(doc(adminFirestore, 'clubs', clubAId, 'announcements', 'a1'), {
        subject: 'Hello', body: 'World', createdAt: '2026-01-01T00:00:00.000Z', createdByEmail: 'admin@example.com',
      });

      const guest = createService(unauthFirestore, fakeClubContextService(clubAId, false));
      await waitFor(() => guest.announcements().length === 1);
      expect(guest.announcements()[0]).toMatchObject({ subject: 'Hello', body: 'World' });
    });

    it('postAnnouncement() writes the announcement and a matching audit entry, admin only', async () => {
      const service = createService(adminFirestore, fakeClubContextService(clubAId, true), fakeAuthService({ uid: 'admin-uid', email: 'admin@example.com' }));
      await service.postAnnouncement('  New meeting time  ', '  We moved to 6pm.  ');

      const snap = await getDocs(collection(adminFirestore, 'clubs', clubAId, 'announcements'));
      expect(snap.size).toBe(1);
      expect(snap.docs[0].data()).toMatchObject({ subject: 'New meeting time', body: 'We moved to 6pm.', createdByEmail: 'admin@example.com' });

      const audit = await getDocs(collection(adminFirestore, 'clubs', clubAId, 'auditLog'));
      expect(audit.docs.map((d) => [d.data()['action'], d.data()['summary']])).toEqual([
        ['announcement.create', 'Posted announcement "New meeting time"'],
      ]);
    });

    it('rejects postAnnouncement() for a signed-in non-admin, and writes nothing', async () => {
      const memberFirestore = testEnv.authenticatedContext('member-uid').firestore() as unknown as Firestore;
      const service = createService(memberFirestore, fakeClubContextService(clubAId, false), fakeAuthService({ uid: 'member-uid', email: 'member@example.com' }));
      await expect(service.postAnnouncement('Subject', 'Body')).rejects.toThrow();
      expect((await getDocs(collection(adminFirestore, 'clubs', clubAId, 'announcements'))).size).toBe(0);
    });

    it('rejects a blank subject or body before writing', async () => {
      const service = createService(adminFirestore, fakeClubContextService(clubAId, true));
      await expect(service.postAnnouncement('   ', 'Body')).rejects.toThrow();
      await expect(service.postAnnouncement('Subject', '   ')).rejects.toThrow();
    });
  });
});
