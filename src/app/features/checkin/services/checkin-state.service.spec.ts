import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { CheckinStateService } from './checkin-state.service';
import { StorageService } from '../../../core/services/storage.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';

// Never exercised by this suite — only present so CheckinStateService's
// constructor-time `inject(FIRESTORE)` has something to resolve.
const unusedFirestoreStub = {} as unknown as Firestore;

function fakeAuthService(user: Pick<User, 'uid' | 'displayName'> | null = null) {
  return { currentUser: signal(user) } as unknown as AuthService;
}

/**
 * This suite covers only what doesn't touch the Firestore-backed snapshot:
 * per-browser uid persistence (still localStorage). Claim/release/signup/
 * evaluator/loadMeeting-isolation logic all moved to
 * checkin-state.service.emulator.spec.ts — per CLAUDE.md and the
 * role-locking-pattern/localStorage-to-firestore-migration skills, a
 * hand-rolled mock can't reproduce Firestore's transaction retry semantics,
 * so that logic must be verified against the real emulator, not a fake.
 */
class FakeStorage {
  private store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}

describe('CheckinStateService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('generates a uid on first construction and reuses it on later construction', () => {
    const fake = new FakeStorage();
    const providers = [
      { provide: StorageService, useValue: fake },
      { provide: FIRESTORE, useValue: unusedFirestoreStub },
      { provide: AuthService, useValue: fakeAuthService() },
    ];
    TestBed.configureTestingModule({ providers });
    const first = TestBed.inject(CheckinStateService);
    const uid = first.currentUid;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers });
    const second = TestBed.inject(CheckinStateService);

    expect(second.currentUid).toBe(uid);
  });

  it('currentUid falls back to the local anonymous uid when nobody is signed in', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: new FakeStorage() },
        { provide: FIRESTORE, useValue: unusedFirestoreStub },
        { provide: AuthService, useValue: fakeAuthService(null) },
      ],
    });
    const service = TestBed.inject(CheckinStateService);
    expect(service.currentUid).not.toBe('');
  });

  it('currentUid switches to the signed-in member\'s real Firebase uid', () => {
    const storage = new FakeStorage();
    storage.set('agora-checkin-uid', 'local-anon-uid');
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storage },
        { provide: FIRESTORE, useValue: unusedFirestoreStub },
        { provide: AuthService, useValue: fakeAuthService({ uid: 'member-uid', displayName: null }) },
      ],
    });
    const service = TestBed.inject(CheckinStateService);
    expect(service.currentUid).toBe('member-uid');
  });

  it('seeds currentName from the signed-in member\'s displayName only when there is no local override yet', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: new FakeStorage() },
        { provide: FIRESTORE, useValue: unusedFirestoreStub },
        { provide: AuthService, useValue: fakeAuthService({ uid: 'member-uid', displayName: 'Ada Lovelace' }) },
      ],
    });
    const service = TestBed.inject(CheckinStateService);
    TestBed.tick();
    expect(service.currentName()).toBe('Ada Lovelace');
  });

  it('does not overwrite a name already typed on this browser', () => {
    const storage = new FakeStorage();
    storage.set('agora-checkin-name', 'Local Name');
    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storage },
        { provide: FIRESTORE, useValue: unusedFirestoreStub },
        { provide: AuthService, useValue: fakeAuthService({ uid: 'member-uid', displayName: 'Ada Lovelace' }) },
      ],
    });
    const service = TestBed.inject(CheckinStateService);
    TestBed.tick();
    expect(service.currentName()).toBe('Local Name');
  });
});
