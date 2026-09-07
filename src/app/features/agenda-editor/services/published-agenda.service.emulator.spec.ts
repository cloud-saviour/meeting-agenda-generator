import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { PublishedAgendaService } from './published-agenda.service';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AgendaSnapshot } from '../models/agenda.models';

/**
 * PublishedAgendaService is Firestore-backed — one document per meeting at
 * `publishedAgendas/{meetingId}` — specifically because its whole purpose
 * (a non-admin viewing a published agenda on their own device) can't work
 * on localStorage. Run via `npm run test:emulator` with the emulator
 * already running.
 *
 * isAdmin() requires the `admin` custom claim, not just an authenticated uid
 * (see firestore.rules) — authenticatedContext()'s second argument simulates
 * that claim directly, no Firestore fixture document needed.
 */
const FIRESTORE_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }
    match /publishedAgendas/{meetingId} {
      allow read: if true;
      allow write: if isAdmin();
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

describe('PublishedAgendaService (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let firestore: Firestore;
  let parentInjector: Injector;
  const createdServices: PublishedAgendaService[] = [];

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'meeting-agenda-generator-published-test',
      firestore: { host: '127.0.0.1', port: 8080, rules: FIRESTORE_RULES },
    });
    firestore = testEnv.authenticatedContext('test-admin-uid', { admin: true }).firestore() as unknown as Firestore;

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

  function createService(): PublishedAgendaService {
    const child = Injector.create({
      parent: parentInjector,
      providers: [
        PublishedAgendaService,
        { provide: FIRESTORE, useValue: firestore },
        { provide: NgZone, useValue: TestBed.inject(NgZone) },
      ],
    });
    const service = child.get(PublishedAgendaService);
    createdServices.push(service);
    return service;
  }

  it('publish() followed by loadMeeting() with the same meeting id round-trips the snapshot', async () => {
    const service = createService();
    const snapshot = makeSnapshot({ theme: 'Resilience' });

    await service.publish('160', snapshot);
    service.loadMeeting('160');

    await waitFor(() => service.current() !== null);
    expect(service.current()).toMatchObject(snapshot);
  });

  it('loadMeeting() for a meeting id that was never published sets current() to null', async () => {
    const service = createService();

    service.loadMeeting('999');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.current()).toBeNull();
  });

  it('isolates two different meeting ids from each other', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160' }));
    service.loadMeeting('160');
    await waitFor(() => service.current() !== null);

    service.loadMeeting('161');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.current()).toBeNull();
  });

  it('publishing a new meeting un-publishes whatever was previously published', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', date: '2026-08-29', theme: 'Earlier' }));
    await waitFor(() => service.entries().length === 1);

    await service.publish('161', makeSnapshot({ no: '161', date: '2026-09-15', theme: 'Later' }));
    await waitFor(() => service.entries()[0]?.no === '161');

    expect(service.entries().length).toBe(1);
    expect(service.entries()[0].no).toBe('161');
  });

  it("publishing a new meeting deletes the previously-published meeting's document, not just its index entry", async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'Earlier' }));
    await service.publish('161', makeSnapshot({ no: '161', theme: 'Later' }));

    service.loadMeeting('160');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.current()).toBeNull();
  });

  it('a component still watching a meeting via loadMeeting() sees current() go to null after a different meeting is published', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'Earlier' }));
    service.loadMeeting('160');
    await waitFor(() => service.current() !== null);

    await service.publish('161', makeSnapshot({ no: '161', theme: 'Later' }));

    await waitFor(() => service.current() === null);
  });

  it('republishing the same meeting number upserts the index entry rather than duplicating', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'First' }));
    await waitFor(() => service.entries().length === 1);

    await service.publish('160', makeSnapshot({ no: '160', theme: 'Second' }));
    await waitFor(() => service.entries()[0]?.theme === 'Second');

    expect(service.entries().length).toBe(1);
  });

  it('unpublish() removes the doc, leaving entries()/nearestEntry() empty', async () => {
    const service = createService();
    await service.publish('160', makeSnapshot({ no: '160', theme: 'First' }));
    await waitFor(() => service.entries().length === 1);

    await service.unpublish('160');
    await waitFor(() => service.entries().length === 0);

    expect(service.nearestEntry()).toBeNull();
  });

  it('unpublish() is a no-op for a meeting that was never published', async () => {
    const service = createService();
    await service.unpublish('999');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.entries().length).toBe(0);
  });

  it('nearestEntry() is null when nothing has ever been published', async () => {
    const service = createService();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(service.nearestEntry()).toBeNull();
  });

  it('nearestEntry() picks the published meeting when its date is upcoming (today-or-later)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // real setTimeout for waitFor() to keep polling
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = createService();
      await service.publish('160', makeSnapshot({ no: '160', date: '2026-09-05', theme: 'Near Future' }));

      await waitFor(() => service.entries().length === 1);
      expect(service.nearestEntry()?.no).toBe('160');
    } finally {
      vi.useRealTimers();
    }
  });

  it("nearestEntry() falls back to the published meeting even when its date is in the past", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // real setTimeout for waitFor() to keep polling
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = createService();
      await service.publish('159', makeSnapshot({ no: '159', date: '2026-08-01', theme: 'Past' }));

      await waitFor(() => service.entries().length === 1);
      expect(service.nearestEntry()?.no).toBe('159');
    } finally {
      vi.useRealTimers();
    }
  });

  it("nearestEntry() treats today's date as upcoming, not past", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // real setTimeout for waitFor() to keep polling
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = createService();
      await service.publish('160', makeSnapshot({ no: '160', date: '2026-08-31', theme: 'Today' }));

      await waitFor(() => service.entries().length === 1);
      expect(service.nearestEntry()?.no).toBe('160');
    } finally {
      vi.useRealTimers();
    }
  });
});
