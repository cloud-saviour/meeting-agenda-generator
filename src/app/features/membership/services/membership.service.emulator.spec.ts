import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { MembershipService } from './membership.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubContextService } from '../../../core/club/club-context.service';

/** Embedded rules mirror the real clubs/memberships/appAdmins/auditLog rules plus the collection-group read rule. */
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
      allow read: if true;
      match /appAdmins/{uid} {
        allow read: if request.auth != null && (request.auth.uid == uid || isAppAdmin(clubId));
        allow write: if isAdmin();
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
      match /memberships/{uid} {
        allow read: if request.auth != null && (request.auth.uid == uid || isAppAdmin(clubId));
        allow create: if request.auth != null && (
          (request.auth.uid == uid
            && request.resource.data.uid == uid
            && request.resource.data.status == 'pending'
            && request.resource.data.email == request.auth.token.email
            && request.resource.data.displayName is string
            && request.resource.data.displayName.size() > 0
            && request.resource.data.decidedAt == null)
          ||
          // A platform admin (the real claim) can add anyone to any club directly, already active.
          (isAdmin()
            && request.resource.data.uid == uid
            && request.resource.data.status == 'active'
            && request.resource.data.email is string
            && request.resource.data.displayName is string
            && request.resource.data.displayName.size() > 0));
        allow update: if request.auth != null && (
          (request.auth.uid == uid
            && resource.data.status in ['rejected', 'removed']
            && request.resource.data.status == 'pending'
            && request.resource.data.uid == resource.data.uid
            && request.resource.data.decidedAt == null)
          ||
          (isAppAdmin(clubId)
            && request.auth.uid != uid
            && request.resource.data.uid == resource.data.uid
            && request.resource.data.status in ['active', 'rejected', 'removed']));
        allow delete: if request.auth != null && request.auth.uid == uid && resource.data.status == 'pending';
      }
    }
    match /{path=**}/memberships/{uid} {
      allow read: if request.auth != null && (request.auth.uid == resource.data.uid || isAdmin());
    }
  }
}
`;

const CLUB_A = 'club-a-id';
const CLUB_B = 'club-b-id';
const ADMIN = { uid: 'admin-uid', email: 'admin@example.com', displayName: 'Club Admin' };
const THABO = { uid: 'thabo-uid', email: 'thabo@example.com', displayName: 'Thabo' };
const NALEDI = { uid: 'naledi-uid', email: 'naledi@example.com', displayName: 'Naledi' };

type Person = typeof ADMIN;

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor() timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('MembershipService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let parentInjector: Injector;
  const created: MembershipService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-membership-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'clubs', CLUB_A), { slug: 'club-a', name: 'Alpha Club', active: true });
      await setDoc(doc(db, 'clubs', CLUB_B), { slug: 'club-b', name: 'Beta Club', active: true });
      await setDoc(doc(db, 'clubs', 'club-off-id'), { slug: 'club-off', name: 'Closed Club', active: false });
      await setDoc(doc(db, 'clubs', CLUB_A, 'appAdmins', ADMIN.uid), { uid: ADMIN.uid });
    });
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterEach(() => {
    for (const s of created) s.ngOnDestroy();
    created.length = 0;
  });

  function dbFor(p: Person): Firestore {
    return testEnv.authenticatedContext(p.uid, { email: p.email }).firestore() as unknown as Firestore;
  }

  function serviceFor(p: Person, clubId = CLUB_A): MembershipService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        MembershipService,
        { provide: FIRESTORE, useValue: dbFor(p) },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
        { provide: AuthService, useValue: { currentUser: signal({ uid: p.uid, email: p.email, displayName: p.displayName }) } },
        { provide: ClubContextService, useValue: { currentClubId: signal<string | null>(clubId) } },
      ],
    });
    const s = child.get(MembershipService);
    created.push(s);
    return s;
  }

  it('a member requests to join and their own row becomes pending', async () => {
    const svc = serviceFor(THABO);
    await waitFor(() => svc.mineLoaded());
    expect(svc.status()).toBe('none');

    await svc.requestToJoin();
    await waitFor(() => svc.status() === 'pending');
    expect(svc.mine()).toMatchObject({ uid: THABO.uid, email: THABO.email, displayName: 'Thabo', status: 'pending', decidedAt: null });
  });

  it('rejects a signed-out request, a request for someone else, and a row created as already active', async () => {
    const anon = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    const row = { uid: THABO.uid, email: THABO.email, displayName: 'Thabo', requestedAt: 'x', decidedAt: null, decidedByUid: null, decidedByEmail: null };

    await expect(setDoc(doc(anon, 'clubs', CLUB_A, 'memberships', THABO.uid), { ...row, status: 'pending' })).rejects.toThrow();
    await expect(setDoc(doc(dbFor(NALEDI), 'clubs', CLUB_A, 'memberships', THABO.uid), { ...row, status: 'pending' })).rejects.toThrow();
    await expect(setDoc(doc(dbFor(THABO), 'clubs', CLUB_A, 'memberships', THABO.uid), { ...row, status: 'active' })).rejects.toThrow();
  });

  it('a member cannot approve themselves, and neither can a club admin approve their own row', async () => {
    await serviceFor(THABO).requestToJoin();
    await expect(updateDoc(doc(dbFor(THABO), 'clubs', CLUB_A, 'memberships', THABO.uid), { status: 'active' })).rejects.toThrow();

    await serviceFor(ADMIN).requestToJoin();
    await expect(updateDoc(doc(dbFor(ADMIN), 'clubs', CLUB_A, 'memberships', ADMIN.uid), { status: 'active' })).rejects.toThrow();
  });

  it('a club admin approves a request: the row goes active, the member sees it live, and it is audited', async () => {
    const thabo = serviceFor(THABO);
    await thabo.requestToJoin();
    await waitFor(() => thabo.status() === 'pending');

    const admin = serviceFor(ADMIN);
    expect(await admin.countPending()).toBe(1);
    const [request] = await admin.listForClub();
    await admin.decide(request, 'active');

    await waitFor(() => thabo.status() === 'active');
    expect(thabo.mine()).toMatchObject({ decidedByUid: ADMIN.uid, decidedByEmail: ADMIN.email });
    expect(await admin.countPending()).toBe(0);

    // The audit log is readable only by a platform admin (the real claim), by design.
    const platformDb = testEnv.authenticatedContext('platform-uid', { admin: true }).firestore() as unknown as Firestore;
    const audit = await getDocs(collection(platformDb, 'clubs', CLUB_A, 'auditLog'));
    expect(audit.docs.map((d) => [d.data()['action'], d.data()['summary']])).toEqual([
      ['membership.approve', 'Approved membership for Thabo (thabo@example.com)'],
    ]);
  });

  it('a rejected member can ask again; an active member cannot re-request', async () => {
    const thabo = serviceFor(THABO);
    const admin = serviceFor(ADMIN);

    await thabo.requestToJoin();
    await admin.decide((await admin.listForClub())[0], 'rejected');
    await waitFor(() => thabo.status() === 'rejected');

    await thabo.requestToJoin();
    await waitFor(() => thabo.status() === 'pending');

    await admin.decide((await admin.listForClub())[0], 'active');
    await waitFor(() => thabo.status() === 'active');
    await expect(thabo.requestToJoin()).rejects.toThrow();
  });

  it('a removed member can ask to rejoin', async () => {
    const thabo = serviceFor(THABO);
    const admin = serviceFor(ADMIN);
    await thabo.requestToJoin();
    await admin.decide((await admin.listForClub())[0], 'active');
    await admin.decide((await admin.listForClub())[0], 'removed');
    await waitFor(() => thabo.status() === 'removed');

    await thabo.requestToJoin();
    await waitFor(() => thabo.status() === 'pending');
  });

  it('a member can withdraw a pending request but not delete an active membership', async () => {
    const thabo = serviceFor(THABO);
    await thabo.requestToJoin();
    await waitFor(() => thabo.status() === 'pending');
    await thabo.cancelRequest();
    await waitFor(() => thabo.status() === 'none');

    await thabo.requestToJoin();
    const admin = serviceFor(ADMIN);
    await admin.decide((await admin.listForClub())[0], 'active');
    await waitFor(() => thabo.status() === 'active');
    await expect(thabo.cancelRequest()).rejects.toThrow();
  });

  it('a non-admin cannot list the club\'s memberships', async () => {
    await serviceFor(THABO).requestToJoin();
    await expect(serviceFor(NALEDI).listForClub()).rejects.toThrow();
  });

  it('listMyClubs() returns only my own memberships across clubs, and hides inactive clubs', async () => {
    await serviceFor(THABO, CLUB_A).requestToJoin();
    await serviceFor(THABO, CLUB_B).requestToJoin();
    await serviceFor(THABO, 'club-off-id').requestToJoin();
    await serviceFor(NALEDI, CLUB_A).requestToJoin();

    const mine = await serviceFor(THABO).listMyClubs();
    expect(mine.map((m) => [m.club.name, m.status])).toEqual([
      ['Alpha Club', 'pending'],
      ['Beta Club', 'pending'],
    ]);
  });

  it('a collection-group read of someone else\'s memberships is rejected', async () => {
    await serviceFor(NALEDI).requestToJoin();
    const { collectionGroup, query, where } = await import('firebase/firestore');
    await expect(getDocs(query(collectionGroup(dbFor(THABO), 'memberships'), where('uid', '==', NALEDI.uid)))).rejects.toThrow();
  });

  describe('platform admin', () => {
    const PLATFORM = { uid: 'platform-uid', email: 'platform@example.com', displayName: 'Platform Admin' };

    function platformService(): MembershipService {
      const db = testEnv.authenticatedContext(PLATFORM.uid, { admin: true, email: PLATFORM.email }).firestore() as unknown as Firestore;
      const child = Injector.create({
        parent: parentInjector,
        providers: [
          MembershipService,
          { provide: FIRESTORE, useValue: db },
          { provide: NgZone, useValue: TestBed.inject(NgZone) },
          { provide: AuthService, useValue: { currentUser: signal({ uid: PLATFORM.uid, email: PLATFORM.email, displayName: PLATFORM.displayName }) } },
          { provide: ClubContextService, useValue: { currentClubId: signal<string | null>(CLUB_A) } },
        ],
      });
      const s = child.get(MembershipService);
      created.push(s);
      return s;
    }

    it('adds someone to a club directly, already active, and audits it', async () => {
      await platformService().assignToClub(CLUB_A, THABO);

      const thabo = serviceFor(THABO);
      await waitFor(() => thabo.status() === 'active');
      expect(thabo.mine()).toMatchObject({ status: 'active', decidedByEmail: PLATFORM.email });

      const platformDb = testEnv.authenticatedContext(PLATFORM.uid, { admin: true }).firestore() as unknown as Firestore;
      const audit = await getDocs(collection(platformDb, 'clubs', CLUB_A, 'auditLog'));
      expect(audit.docs.map((d) => [d.data()['action'], d.data()['summary']])).toEqual([
        ['membership.assign', 'Added Thabo (thabo@example.com) to the club'],
      ]);
    });

    it('approves an existing pending request and keeps its original request time', async () => {
      const thabo = serviceFor(THABO);
      await thabo.requestToJoin();
      await waitFor(() => thabo.status() === 'pending');
      const requestedAt = thabo.mine()!.requestedAt;

      const platform = platformService();
      await platform.assignToClub(CLUB_A, THABO, thabo.mine()!);
      await waitFor(() => thabo.status() === 'active');
      expect(thabo.mine()?.requestedAt).toBe(requestedAt);
    });

    it('listAllMemberships() sees every club and everyone', async () => {
      await serviceFor(THABO, CLUB_A).requestToJoin();
      await serviceFor(NALEDI, CLUB_B).requestToJoin();

      const all = await platformService().listAllMemberships();
      expect(all.map((m) => [m.clubId, m.uid]).sort()).toEqual([
        [CLUB_A, THABO.uid],
        [CLUB_B, NALEDI.uid],
      ]);
    });

    it('removes someone from any club, audits it, and they can ask to rejoin', async () => {
      const platform = platformService();
      await platform.assignToClub(CLUB_A, THABO);
      const thabo = serviceFor(THABO);
      await waitFor(() => thabo.status() === 'active');

      await platform.removeFromClub(CLUB_A, THABO);
      await waitFor(() => thabo.status() === 'removed');
      expect(thabo.mine()).toMatchObject({ decidedByEmail: PLATFORM.email });

      const platformDb = testEnv.authenticatedContext(PLATFORM.uid, { admin: true }).firestore() as unknown as Firestore;
      const audit = await getDocs(collection(platformDb, 'clubs', CLUB_A, 'auditLog'));
      expect(audit.docs.map((d) => d.data()['action']).sort()).toEqual(['membership.assign', 'membership.remove']);

      await thabo.requestToJoin();
      await waitFor(() => thabo.status() === 'pending');
    });

    it('a member cannot remove another member, and a club admin can only remove within their own club', async () => {
      await platformService().assignToClub(CLUB_A, THABO);
      await platformService().assignToClub(CLUB_B, THABO);
      await expect(serviceFor(NALEDI).removeFromClub(CLUB_A, THABO)).rejects.toThrow();
      await expect(serviceFor(ADMIN).removeFromClub(CLUB_B, THABO)).rejects.toThrow(); // ADMIN administers club A only
      await serviceFor(ADMIN).removeFromClub(CLUB_A, THABO);
    });

    it('a member, or a club-only admin, cannot add someone else as active or list everyone', async () => {
      await expect(serviceFor(THABO).assignToClub(CLUB_A, NALEDI)).rejects.toThrow();
      await expect(serviceFor(ADMIN).assignToClub(CLUB_A, NALEDI)).rejects.toThrow();
      await expect(serviceFor(ADMIN).listAllMemberships()).rejects.toThrow();
    });
  });
});
