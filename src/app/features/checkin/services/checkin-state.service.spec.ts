import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { CheckinStateService } from './checkin-state.service';
import { StorageService } from '../../../core/services/storage.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

// Never exercised by this suite — only present so CheckinStateService's
// constructor-time `inject(FIRESTORE)` has something to resolve.
const unusedFirestoreStub = {} as unknown as Firestore;

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
    ];
    TestBed.configureTestingModule({ providers });
    const first = TestBed.inject(CheckinStateService);
    const uid = first.currentUid;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers });
    const second = TestBed.inject(CheckinStateService);

    expect(second.currentUid).toBe(uid);
  });
});
