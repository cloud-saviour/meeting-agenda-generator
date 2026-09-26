import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { ClubProvisioningService, SlugTakenError } from './club-provisioning.service';
import { FIRESTORE } from '../firebase/firestore.provider';
import { AuthService } from '../auth/auth.service';

/**
 * Club creation is one atomic batch authorised only by the real global
 * `admin` claim (see firestore.rules). This suite's embedded rules mirror the
 * real clubs / clubSlugs / appAdmins / roleDefinitions / auditLog rules —
 * the unit-test builder can't read firestore.rules from disk at runtime.
 * Run via `npm run test:emulator` with the emulator already running.
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
      allow read: if true;
      allow create: if isAdmin()
        && request.resource.data.slug is string
        && request.resource.data.slug.matches('^[a-z0-9]+(-[a-z0-9]+)*$')
        && request.resource.data.slug.size() <= 40
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.active == true;
      allow update: if isAdmin()
        && request.resource.data.slug == resource.data.slug
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.active is bool;
      allow delete: if false;
      match /appAdmins/{uid} {
        allow read: if request.auth != null && (request.auth.uid == uid || isAppAdmin(clubId));
        allow create, update: if isAppAdmin(clubId) && request.auth.uid != uid;
        allow delete: if isAppAdmin(clubId);
      }
      match /roleDefinitions/{roleId} {
        allow read: if true;
        allow write: if isAppAdmin(clubId);
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
    match /clubSlugs/{slug} {
      allow read: if true;
      allow create: if isAdmin()
        && request.resource.data.clubId is string
        && getAfter(/databases/$(database)/documents/clubs/$(request.resource.data.clubId)).data.slug == slug;
      allow update, delete: if false;
    }
  }
}
`;

const FIRST_ADMIN = { uid: 'first-admin-uid', email: 'first@example.com', displayName: 'First Admin' };

function fakeAuth(uid: string, email: string): AuthService {
  return { currentUser: () => ({ uid, email }) } as unknown as AuthService;
}

describe('ClubProvisioningService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let platformDb: Firestore;
  let parentInjector: Injector;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-provisioning-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    platformDb = testEnv.authenticatedContext('platform-admin-uid', { admin: true }).firestore() as unknown as Firestore;
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  function createService(db: Firestore = platformDb, uid = 'platform-admin-uid', email = 'platform@example.com'): ClubProvisioningService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        ClubProvisioningService,
        { provide: FIRESTORE, useValue: db },
        { provide: AuthService, useValue: fakeAuth(uid, email) },
      ],
    });
    return child.get(ClubProvisioningService);
  }

  async function clubIdFor(slug: string): Promise<string> {
    return (await getDoc(doc(platformDb, 'clubSlugs', slug))).data()?.['clubId'];
  }

  it('creates the club, slug pointer, standard roles, first admin and an audit entry together', async () => {
    const slug = await createService().createClub({
      slug: 'new-club',
      name: 'New Club',
      subLine: 'A sub-line',
      addressLine: '1 Main Road',
      firstAdmin: FIRST_ADMIN,
    });
    expect(slug).toBe('new-club');

    const clubId = await clubIdFor('new-club');
    expect(clubId).toBeTruthy();
    expect((await getDoc(doc(platformDb, 'clubs', clubId))).data()).toMatchObject({
      slug: 'new-club',
      name: 'New Club',
      subLine: 'A sub-line',
      addressLine: '1 Main Road',
      active: true,
    });

    const roles = await getDocs(collection(platformDb, 'clubs', clubId, 'roleDefinitions'));
    expect(roles.size).toBe(15);
    expect(roles.docs.filter((d) => d.data()['kind'] === 'meeting').length).toBe(8);
    expect(roles.docs.filter((d) => d.data()['kind'] === 'committee').length).toBe(7);

    expect((await getDoc(doc(platformDb, 'clubs', clubId, 'appAdmins', FIRST_ADMIN.uid))).exists()).toBe(true);

    const audit = await getDocs(collection(platformDb, 'clubs', clubId, 'auditLog'));
    expect(audit.docs.map((d) => d.data()['action'])).toEqual(['club.create']);
  });

  it('works without a first admin — no appAdmins entry is written', async () => {
    await createService().createClub({ slug: 'no-admin', name: 'No Admin', subLine: '', addressLine: '' });
    const clubId = await clubIdFor('no-admin');
    expect((await getDocs(collection(platformDb, 'clubs', clubId, 'appAdmins'))).size).toBe(0);
  });

  it('rejects a taken slug and leaves the existing club untouched', async () => {
    const service = createService();
    await service.createClub({ slug: 'taken', name: 'Original', subLine: '', addressLine: '' });
    const originalId = await clubIdFor('taken');

    await expect(service.createClub({ slug: 'taken', name: 'Impostor', subLine: '', addressLine: '' })).rejects.toBeInstanceOf(SlugTakenError);

    expect(await clubIdFor('taken')).toBe(originalId);
    expect((await getDocs(collection(platformDb, 'clubs'))).size).toBe(1);
  });

  it('rejects an invalid slug before writing anything', async () => {
    await expect(createService().createClub({ slug: 'Bad Slug', name: 'X', subLine: '', addressLine: '' })).rejects.toThrow();
    expect((await getDocs(collection(platformDb, 'clubs'))).size).toBe(0);
  });

  it('rejects a signed-in user without the platform claim — and writes nothing (atomic)', async () => {
    const memberDb = testEnv.authenticatedContext('random-member-uid').firestore() as unknown as Firestore;
    await expect(
      createService(memberDb, 'random-member-uid', 'member@example.com').createClub({ slug: 'sneaky', name: 'Sneaky', subLine: '', addressLine: '' })
    ).rejects.toThrow();

    expect((await getDocs(collection(platformDb, 'clubs'))).size).toBe(0);
    expect((await getDoc(doc(platformDb, 'clubSlugs', 'sneaky'))).exists()).toBe(false);
  });

  it('rejects a granted club admin of another club creating a new club', async () => {
    await createService().createClub({ slug: 'existing', name: 'Existing', subLine: '', addressLine: '', firstAdmin: FIRST_ADMIN });
    const grantedDb = testEnv.authenticatedContext(FIRST_ADMIN.uid).firestore() as unknown as Firestore;

    await expect(
      createService(grantedDb, FIRST_ADMIN.uid, FIRST_ADMIN.email).createClub({ slug: 'second', name: 'Second', subLine: '', addressLine: '' })
    ).rejects.toThrow();
    expect((await getDoc(doc(platformDb, 'clubSlugs', 'second'))).exists()).toBe(false);
  });

  it('rejects a slug pointer that names a club with a different slug — even for a platform admin', async () => {
    const batch = writeBatch(platformDb);
    const clubRef = doc(collection(platformDb, 'clubs'));
    batch.set(clubRef, { slug: 'real-slug', name: 'Club', active: true });
    batch.set(doc(platformDb, 'clubSlugs', 'other-slug'), { clubId: clubRef.id });
    await expect(batch.commit()).rejects.toThrow();
  });

  it('never lets a client overwrite a slug pointer or delete a club', async () => {
    await createService().createClub({ slug: 'locked', name: 'Locked', subLine: '', addressLine: '' });
    const clubId = await clubIdFor('locked');

    await expect(setDoc(doc(platformDb, 'clubSlugs', 'locked'), { clubId: 'someone-elses' })).rejects.toThrow();
    await expect(deleteDoc(doc(platformDb, 'clubs', clubId))).rejects.toThrow();
  });

  it('lets a platform admin edit a club but never its slug or createdAt', async () => {
    await createService().createClub({ slug: 'editable', name: 'Editable', subLine: '', addressLine: '' });
    const clubId = await clubIdFor('editable');
    const ref = doc(platformDb, 'clubs', clubId);
    const before = (await getDoc(ref)).data()!;

    await updateDoc(ref, { name: 'Renamed', missionStatement: 'New mission' });
    expect((await getDoc(ref)).data()).toMatchObject({ name: 'Renamed', missionStatement: 'New mission', slug: 'editable' });

    await expect(updateDoc(ref, { slug: 'other' })).rejects.toThrow();
    await expect(updateDoc(ref, { createdAt: '2000-01-01T00:00:00.000Z' })).rejects.toThrow();
    await expect(updateDoc(ref, { name: '' })).rejects.toThrow();
    expect((await getDoc(ref)).data()?.['createdAt']).toBe(before['createdAt']);
  });

  it('rejects a non-platform user editing a club, including a granted admin of that same club', async () => {
    await createService().createClub({ slug: 'guarded', name: 'Guarded', subLine: '', addressLine: '', firstAdmin: FIRST_ADMIN });
    const clubId = await clubIdFor('guarded');
    const grantedDb = testEnv.authenticatedContext(FIRST_ADMIN.uid).firestore() as unknown as Firestore;
    const memberDb = testEnv.authenticatedContext('random-member-uid').firestore() as unknown as Firestore;

    await expect(updateDoc(doc(grantedDb, 'clubs', clubId), { name: 'Hijacked' })).rejects.toThrow();
    await expect(updateDoc(doc(memberDb, 'clubs', clubId), { name: 'Hijacked' })).rejects.toThrow();
    expect((await getDoc(doc(platformDb, 'clubs', clubId))).data()?.['name']).toBe('Guarded');
  });
});
