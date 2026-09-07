import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { MemberHistoryService } from './member-history.service';
import { MemberHistoryRecord } from '../models/member.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * loadHistory() calls Firestore's collection()/getDocs()/where() directly,
 * so this suite exercises it against the real emulator, same "test the
 * real thing" philosophy as every other Firestore-backed service here.
 * Seeds `memberHistory` docs directly (bypassing AttendanceConfirmationService,
 * which has its own emulator spec covering the write side and rules).
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /memberHistory/{recordId} {
      allow read, write: if true;
    }
  }
}
`;

function record(overrides: Partial<MemberHistoryRecord> = {}): MemberHistoryRecord {
  return {
    meetingId: 'm',
    uid: 'u1',
    date: '2026-01-01',
    theme: '',
    attended: false,
    rolesConfirmed: [],
    spoke: false,
    evaluatedSpeakerId: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MemberHistoryService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let firestore: Firestore;
  let parentInjector: Injector;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-history-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    firestore = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    TestBed.configureTestingModule({});
    parentInjector = TestBed.inject(Injector);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  function createService(): MemberHistoryService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [MemberHistoryService, { provide: FIRESTORE, useValue: firestore }],
    });
    return child.get(MemberHistoryService);
  }

  it('filters out records with no involvement, and sorts newest first by the denormalized date', async () => {
    await setDoc(doc(firestore, 'memberHistory', '1_u1'), record({ meetingId: '1', uid: 'u1', date: '2026-01-01', theme: 'Theme One', attended: true }));
    await setDoc(doc(firestore, 'memberHistory', '2_u1'), record({ meetingId: '2', uid: 'u1', date: '2026-01-15' })); // no involvement at all
    await setDoc(doc(firestore, 'memberHistory', '3_u1'), record({ meetingId: '3', uid: 'u1', date: '2026-02-01', theme: 'Theme Three', spoke: true }));

    const service = createService();
    const history = await service.loadHistory('u1');

    expect(history.map((e) => e.meetingId)).toEqual(['3', '1']);
    expect(history[0].theme).toBe('Theme Three');
    expect(history[1].theme).toBe('Theme One');
  });

  it('only returns records for the given uid', async () => {
    await setDoc(doc(firestore, 'memberHistory', '1_u1'), record({ meetingId: '1', uid: 'u1', attended: true }));
    await setDoc(doc(firestore, 'memberHistory', '1_someone-else'), record({ meetingId: '1', uid: 'someone-else', attended: true }));

    const service = createService();
    const history = await service.loadHistory('u1');
    expect(history).toHaveLength(1);
    expect(history[0].meetingId).toBe('1');
  });

  it('returns an empty list for a uid with no records at all', async () => {
    await setDoc(doc(firestore, 'memberHistory', '1_someone-else'), record({ meetingId: '1', uid: 'someone-else', attended: true }));

    const service = createService();
    const history = await service.loadHistory('u1');
    expect(history).toEqual([]);
  });
});
