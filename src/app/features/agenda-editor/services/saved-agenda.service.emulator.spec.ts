import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { SavedAgendaService } from './saved-agenda.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AgendaSnapshot } from '../models/agenda.models';

/**
 * SavedAgendaService is Firestore-backed — one document per meeting at
 * `savedAgendas/{meetingId}`. Migrated for cross-device convenience, not a
 * correctness bug (unlike CheckinStateService/PublishedAgendaService) — it's
 * a genuinely single-admin workload. Run via `npm run test:emulator` with
 * the emulator already running.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
`;

function makeSnapshot(overrides: Partial<AgendaSnapshot> = {}): AgendaSnapshot {
  return {
    no: '160',
    date: '2026-08-29',
    arr: '18:30',
    st: '19:00',
    theme: 'Resilience',
    word: 'perseverance',
    club: "King's Speakers Club #12",
    sub: 'Agora Speakers',
    addr: '123 Main Street',
    mission: 'To provide a supportive environment.',
    vpe: 'Jane Doe',
    hotSeat: 'John Smith',
    reserve: 'Reserve Speaker',
    apologies: 'None',
    period: 'Q3',
    web: 'https://example.com',
    fb: 'https://facebook.com/example',
    agItems: [],
    spks: [],
    cmt: [],
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor() timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('SavedAgendaService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let firestore: Firestore;
  let parentInjector: Injector;
  const createdServices: SavedAgendaService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-saved-test',
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

  afterEach(() => {
    for (const service of createdServices) service.ngOnDestroy();
    createdServices.length = 0;
  });

  function createService(): SavedAgendaService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        SavedAgendaService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(SavedAgendaService);
    createdServices.push(service);
    return service;
  }

  it('save() followed by load() with the same meeting number round-trips the snapshot', async () => {
    const service = createService();
    const snapshot = makeSnapshot({ no: '160', theme: 'Resilience' });

    await service.save(snapshot);

    expect(await service.load('160')).toMatchObject(snapshot);
  });

  it('load() for a meeting number that was never saved returns null', async () => {
    const service = createService();

    expect(await service.load('999')).toBeNull();
  });

  it('save() is a no-op when the snapshot has no meeting number', async () => {
    const service = createService();
    const snapshot = makeSnapshot({ no: '' });

    await service.save(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.entries()).toEqual([]);
    expect(await service.load('')).toBeNull();
  });

  it('entries() reflects a save, keyed by meeting number', async () => {
    const service = createService();
    await service.save(makeSnapshot({ no: '160', theme: 'Resilience', date: '2026-08-29' }));

    await waitFor(() => service.entries().length === 1);
    const entries = service.entries();
    expect(entries[0]).toMatchObject({ no: '160', theme: 'Resilience', date: '2026-08-29' });
    expect(entries[0].updatedAt).toBeTruthy();
  });

  it('saving the same meeting number again upserts (updates) rather than duplicating', async () => {
    const service = createService();
    await service.save(makeSnapshot({ no: '160', theme: 'First' }));
    await waitFor(() => service.entries().length === 1);

    await service.save(makeSnapshot({ no: '160', theme: 'Second' }));

    await waitFor(() => service.entries()[0]?.theme === 'Second');
    expect(service.entries().length).toBe(1);
    expect((await service.load('160'))?.theme).toBe('Second');
  });

  it('entries() sorts by updatedAt, most recently saved first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // real setTimeout for waitFor() to keep polling
    try {
      const service = createService();
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
      await service.save(makeSnapshot({ no: '160' }));
      vi.setSystemTime(new Date('2026-01-01T10:05:00Z'));
      await service.save(makeSnapshot({ no: '161' }));

      await waitFor(() => service.entries().length === 2);
      expect(service.entries().map((e) => e.no)).toEqual(['161', '160']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('delete() removes both the draft and the index entry', async () => {
    const service = createService();
    await service.save(makeSnapshot({ no: '160' }));
    await waitFor(() => service.entries().length === 1);

    await service.delete('160');

    await waitFor(() => service.entries().length === 0);
    expect(await service.load('160')).toBeNull();
  });

  it('delete() only removes the targeted meeting number', async () => {
    const service = createService();
    await service.save(makeSnapshot({ no: '160' }));
    await service.save(makeSnapshot({ no: '161' }));
    await waitFor(() => service.entries().length === 2);

    await service.delete('160');

    await waitFor(() => service.entries().length === 1);
    expect(service.entries().map((e) => e.no)).toEqual(['161']);
    expect(await service.load('161')).not.toBeNull();
  });
});
