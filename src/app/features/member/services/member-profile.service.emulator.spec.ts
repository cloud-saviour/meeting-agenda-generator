import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { MemberProfileService } from './member-profile.service';
import { AuthService } from '../../../core/auth/auth.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * `members/{uid}` is own-uid read/write plus admin read (never admin
 * write — see firestore.rules' comment). Run via `npm run test:emulator`
 * with the emulator already running.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /members/{memberId} {
      allow read: if request.auth != null && (request.auth.uid == memberId || isAdmin());
      allow create, update: if request.auth != null && request.auth.uid == memberId
        && request.resource.data.uid == memberId;
      allow delete: if false;
    }
  }
}
`;

const fakeAuthService = { updateDisplayName: vi.fn().mockResolvedValue(undefined) } as unknown as AuthService;

describe('MemberProfileService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let parentInjector: Injector;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-members-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    vi.clearAllMocks();
  });

  function serviceFor(uid: string | null, claims?: Record<string, unknown>): MemberProfileService {
    const firestore = (uid ? testEnv.authenticatedContext(uid, claims) : testEnv.unauthenticatedContext())
      .firestore() as unknown as Firestore;
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        MemberProfileService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: AuthService, useValue: fakeAuthService },
      ],
    });
    return child.get(MemberProfileService);
  }

  it('a member can create and read their own profile', async () => {
    const service = serviceFor('my-uid');
    await service.createProfile('my-uid', 'me@example.com', 'Me');

    const profile = await service.getProfile('my-uid');
    expect(profile).toMatchObject({ uid: 'my-uid', email: 'me@example.com', displayName: 'Me' });
  });

  it('a member can update their own profile, syncing displayName via AuthService too', async () => {
    const service = serviceFor('my-uid');
    await service.createProfile('my-uid', 'me@example.com', 'Old Name');

    await service.updateProfile('my-uid', { displayName: 'New Name' });

    expect(fakeAuthService.updateDisplayName).toHaveBeenCalledWith('New Name');
    const profile = await service.getProfile('my-uid');
    expect(profile?.displayName).toBe('New Name');
  });

  it('rejects creating a profile document under someone else\'s uid', async () => {
    const service = serviceFor('my-uid');
    await expect(service.createProfile('someone-elses-uid', 'x@example.com', 'X')).rejects.toThrow();
  });

  it('rejects another member reading a profile that isn\'t theirs, but allows an admin', async () => {
    // seed as the owner first
    const owner = serviceFor('owner-uid');
    await owner.createProfile('owner-uid', 'owner@example.com', 'Owner');

    // MemberProfileService.getProfile() swallows all errors into null, so
    // the security property itself is asserted directly against the SDK —
    // a real PERMISSION_DENIED, not merely "returned null".
    const strangerFirestore = testEnv.authenticatedContext('stranger-uid').firestore() as unknown as Firestore;
    await expect(getDoc(doc(strangerFirestore, 'members', 'owner-uid'))).rejects.toThrow();

    const adminFirestore = testEnv.authenticatedContext('admin-uid', { admin: true }).firestore() as unknown as Firestore;
    const adminChild = Injector.create({
      parent: parentInjector,
      providers: [
        MemberProfileService,
        { provide: FIRESTORE, useValue: adminFirestore },
        { provide: AuthService, useValue: fakeAuthService },
      ],
    });
    const asAdmin = await adminChild.get(MemberProfileService).getProfile('owner-uid');
    expect(asAdmin?.displayName).toBe('Owner');
  });
});
