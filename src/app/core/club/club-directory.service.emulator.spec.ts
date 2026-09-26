import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { ClubDirectoryService } from './club-directory.service';
import { FIRESTORE } from '../firebase/firestore.provider';
import { AuthService } from '../auth/auth.service';

/** Embedded rules mirror the real clubs / clubSlugs / auditLog rules (see club-provisioning.service.emulator.spec.ts for why). */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /clubs/{clubId} {
      allow read: if true;
      allow update: if isAdmin()
        && request.resource.data.slug == resource.data.slug
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.active is bool;
      allow delete: if false;
      match /auditLog/{entryId} {
        allow read: if isAdmin();
        allow create: if isAdmin()
          && request.resource.data.action is string
          && request.resource.data.actorUid is string
          && request.resource.data.at is string
          && request.resource.data.summary is string;
        allow update, delete: if false;
      }
    }
    match /clubSlugs/{slug} {
      allow read: if true;
    }
  }
}
`;

function fakeAuth(uid: string, email: string): AuthService {
  return { currentUser: () => ({ uid, email }) } as unknown as AuthService;
}

describe('ClubDirectoryService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let platformDb: Firestore;
  let parentInjector: Injector;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-directory-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    platformDb = testEnv.authenticatedContext('platform-admin-uid', { admin: true }).firestore() as unknown as Firestore;
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed through a rules-free context: creation itself is covered by the provisioning spec.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      for (const [id, slug, name] of [
        ['club-b-id', 'club-b', 'Beta Club'],
        ['club-a-id', 'club-a', 'Alpha Club'],
      ]) {
        await setDoc(doc(db, 'clubs', id), {
          slug, name, subLine: '', addressLine: '', logoLeft: 'logo.png', logoRight: 'crown.png',
          missionStatement: '', website: '', facebookPage: '', createdAt: '2026-01-01T00:00:00.000Z', active: true,
        });
        await setDoc(doc(db, 'clubSlugs', slug), { clubId: id });
      }
    });
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  function createService(db: Firestore = platformDb): ClubDirectoryService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        ClubDirectoryService,
        { provide: FIRESTORE, useValue: db },
        { provide: AuthService, useValue: fakeAuth('platform-admin-uid', 'platform@example.com') },
      ],
    });
    return child.get(ClubDirectoryService);
  }

  it('listClubs() returns every club with its id, sorted by name', async () => {
    const clubs = await createService().listClubs();
    expect(clubs.map((c) => c.name)).toEqual(['Alpha Club', 'Beta Club']);
    expect(clubs[0].id).toBe('club-a-id');
  });

  it('getClubBySlug() resolves a slug, and returns null for an unknown one', async () => {
    const service = createService();
    expect((await service.getClubBySlug('club-b'))?.name).toBe('Beta Club');
    expect(await service.getClubBySlug('nope')).toBeNull();
  });

  it('updateClub() saves the edits, trims them, keeps the slug, and writes a club.update audit entry', async () => {
    const service = createService();
    await service.updateClub('club-a-id', 'club-a', {
      name: '  Alpha Renamed  ',
      subLine: 'Sub',
      addressLine: '1 Main Rd',
      missionStatement: 'Mission',
      website: 'https://a.example',
      facebookPage: 'alpha',
      active: true,
    });

    const club = await service.getClubBySlug('club-a');
    expect(club).toMatchObject({ name: 'Alpha Renamed', subLine: 'Sub', addressLine: '1 Main Rd', slug: 'club-a', active: true });

    const audit = await getDocs(collection(platformDb, 'clubs', 'club-a-id', 'auditLog'));
    expect(audit.docs.map((d) => [d.data()['action'], d.data()['summary']])).toEqual([['club.update', 'Edited club "Alpha Renamed" (club-a)']]);
  });

  it('updateClub() rejects a blank name before writing anything', async () => {
    await expect(
      createService().updateClub('club-a-id', 'club-a', { name: '   ', subLine: '', addressLine: '', missionStatement: '', website: '', facebookPage: '', active: true })
    ).rejects.toThrow();
    expect((await createService().getClubBySlug('club-a'))?.name).toBe('Alpha Club');
  });

  it('updateClub() is rejected for a non-platform user, and the batch writes no audit entry', async () => {
    const memberDb = testEnv.authenticatedContext('random-member-uid').firestore() as unknown as Firestore;
    await expect(
      createService(memberDb).updateClub('club-a-id', 'club-a', { name: 'Hijacked', subLine: '', addressLine: '', missionStatement: '', website: '', facebookPage: '', active: true })
    ).rejects.toThrow();

    expect((await createService().getClubBySlug('club-a'))?.name).toBe('Alpha Club');
    expect((await getDocs(collection(platformDb, 'clubs', 'club-a-id', 'auditLog'))).size).toBe(0);
  });

  it('deactivates and reactivates a club, recording each as its own audit entry', async () => {
    const service = createService();
    const base = { name: 'Alpha Club', subLine: '', addressLine: '', missionStatement: '', website: '', facebookPage: '' };

    await service.updateClub('club-a-id', 'club-a', { ...base, active: false }, true);
    expect((await service.getClubBySlug('club-a'))?.active).toBe(false);

    await service.updateClub('club-a-id', 'club-a', { ...base, active: true }, false);
    expect((await service.getClubBySlug('club-a'))?.active).toBe(true);

    const audit = await getDocs(collection(platformDb, 'clubs', 'club-a-id', 'auditLog'));
    expect(audit.docs.map((d) => d.data()['summary']).sort()).toEqual([
      'Deactivated club "Alpha Club" (club-a)',
      'Reactivated club "Alpha Club" (club-a)',
    ]);
  });

  it('listActiveClubs() returns only active clubs, and works for a signed-out visitor', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'clubs', 'club-off-id'), {
        slug: 'club-off', name: 'Closed Club', subLine: '', addressLine: '', logoLeft: 'logo.png', logoRight: 'crown.png',
        missionStatement: '', website: '', facebookPage: '', createdAt: '2026-01-01T00:00:00.000Z', active: false,
      });
    });
    const anon = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    const active = await createService(anon).listActiveClubs();
    expect(active.map((c) => c.name)).toEqual(['Alpha Club', 'Beta Club']);
    expect((await createService().listClubs()).length).toBe(3);
  });
});
