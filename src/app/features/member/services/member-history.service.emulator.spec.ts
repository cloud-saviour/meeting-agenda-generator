import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { MemberHistoryService } from './member-history.service';
import { CheckinSnapshot } from '../../checkin/models/checkin.models';
import { PublishedAgendaService } from '../../agenda-editor/services/published-agenda.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

/**
 * loadHistory() calls Firestore's collection()/getDocs() directly, so this
 * suite exercises it against the real emulator, same "test the real thing"
 * philosophy as every other Firestore-backed service here. `checkins/**` is
 * fully public (allow read, write: if true), so no rules-specific test is
 * needed — just the scan/filter/join/sort behavior itself.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /checkins/{meetingId} {
      allow read, write: if true;
    }
  }
}
`;

function snapshot(overrides: Partial<CheckinSnapshot> = {}): CheckinSnapshot {
  return {
    meeting: { id: 'm', date: '2026-01-01', theme: '', word: '', start: '18:15', maxSpeakers: 3 },
    attendees: [],
    roles: {},
    speakers: [],
    lockedRoles: [],
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

  function createService(publishedEntries: { no: string; date: string; theme: string; publishedAt: string }[]): MemberHistoryService {
    const fakePublishedAgenda = { entries: () => publishedEntries } as unknown as PublishedAgendaService;
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        MemberHistoryService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: PublishedAgendaService, useValue: fakePublishedAgenda },
      ],
    });
    return child.get(MemberHistoryService);
  }

  it('filters out meetings with no involvement, joins date/theme, and sorts newest first', async () => {
    await setDoc(doc(firestore, 'checkins', '1'), snapshot({ attendees: [{ uid: 'u1', name: 'Ada', joinedAt: '18:00' }] }));
    await setDoc(doc(firestore, 'checkins', '2'), snapshot()); // no involvement
    await setDoc(
      doc(firestore, 'checkins', '3'),
      snapshot({ speakers: [{ id: 's', uid: 'u1', name: 'Ada', title: 'T', level: 'L', timePref: '5-7', evaluator: null }] })
    );

    const service = createService([
      { no: '1', date: '2026-01-01', theme: 'Theme One', publishedAt: '' },
      { no: '3', date: '2026-02-01', theme: 'Theme Three', publishedAt: '' },
    ]);

    const history = await service.loadHistory('u1');
    expect(history.map((e) => e.meetingId)).toEqual(['3', '1']);
    expect(history[0].theme).toBe('Theme Three');
    expect(history[1].theme).toBe('Theme One');
  });

  it('returns an empty list for a uid with no involvement in any meeting', async () => {
    await setDoc(doc(firestore, 'checkins', '1'), snapshot({ attendees: [{ uid: 'someone-else', name: 'Bob', joinedAt: '18:00' }] }));

    const service = createService([]);
    const history = await service.loadHistory('u1');
    expect(history).toEqual([]);
  });
});
