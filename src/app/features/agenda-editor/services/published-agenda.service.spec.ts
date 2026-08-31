import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PublishedAgendaService } from './published-agenda.service';
import { StorageService } from '../../../core/services/storage.service';
import { AgendaSnapshot } from '../models/agenda.models';

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

function makeService(): PublishedAgendaService {
  TestBed.configureTestingModule({
    providers: [{ provide: StorageService, useClass: FakeStorage }],
  });
  return TestBed.inject(PublishedAgendaService);
}

describe('PublishedAgendaService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('publish() followed by loadMeeting() with the same meeting id round-trips the snapshot', () => {
    const service = makeService();
    const snapshot = makeSnapshot({ theme: 'Resilience' });

    service.publish('160', snapshot);
    service.loadMeeting('160');

    expect(service.current()).toEqual(snapshot);
  });

  it('loadMeeting() for a meeting id that was never published sets current() to null', () => {
    const service = makeService();

    service.loadMeeting('999');

    expect(service.current()).toBeNull();
  });

  it('isolates two different meeting ids from each other', () => {
    const service = makeService();
    const snapshot = makeSnapshot({ no: '160' });

    service.publish('160', snapshot);
    service.loadMeeting('161');

    expect(service.current()).toBeNull();
  });

  it('the "default" meeting id round-trips through the bare unsuffixed storage key', () => {
    const fake = new FakeStorage();
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: fake }] });
    const service = TestBed.inject(PublishedAgendaService);
    const snapshot = makeSnapshot({ no: 'default' });

    service.publish('default', snapshot);

    const raw = fake.get('agora-agenda-published');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual(snapshot);

    // A suffixed key must not have been used for 'default'.
    expect(fake.get('agora-agenda-published-default')).toBeNull();

    service.loadMeeting('default');
    expect(service.current()).toEqual(snapshot);
  });

  it('loadMeeting() on corrupted JSON does not throw and sets current() to null', () => {
    const fake = new FakeStorage();
    fake.set('agora-agenda-published-160', 'not valid json{');
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: fake }] });
    const service = TestBed.inject(PublishedAgendaService);

    expect(() => service.loadMeeting('160')).not.toThrow();
    expect(service.current()).toBeNull();
  });

  it('entries() lists every published meeting, sorted by date ascending', () => {
    const service = makeService();
    service.publish('161', makeSnapshot({ no: '161', date: '2026-09-15', theme: 'Later' }));
    service.publish('160', makeSnapshot({ no: '160', date: '2026-08-29', theme: 'Earlier' }));

    expect(service.entries().map((e) => e.no)).toEqual(['160', '161']);
  });

  it('republishing the same meeting number upserts the index entry rather than duplicating', () => {
    const service = makeService();
    service.publish('160', makeSnapshot({ no: '160', theme: 'First' }));
    service.publish('160', makeSnapshot({ no: '160', theme: 'Second' }));

    const entries = service.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].theme).toBe('Second');
  });

  it('nearestEntry() is null when nothing has ever been published', () => {
    const service = makeService();

    expect(service.nearestEntry()).toBeNull();
  });

  it('nearestEntry() picks the nearest upcoming (today-or-later) published meeting', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = makeService();
      service.publish('165', makeSnapshot({ no: '165', date: '2026-10-01', theme: 'Far Future' }));
      service.publish('160', makeSnapshot({ no: '160', date: '2026-09-05', theme: 'Near Future' }));
      service.publish('159', makeSnapshot({ no: '159', date: '2026-08-01', theme: 'Past' }));

      expect(service.nearestEntry()?.no).toBe('160');
    } finally {
      vi.useRealTimers();
    }
  });

  it('nearestEntry() falls back to the most recent past meeting when nothing is upcoming', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = makeService();
      service.publish('158', makeSnapshot({ no: '158', date: '2026-07-01', theme: 'Older' }));
      service.publish('159', makeSnapshot({ no: '159', date: '2026-08-01', theme: 'Most Recent Past' }));

      expect(service.nearestEntry()?.no).toBe('159');
    } finally {
      vi.useRealTimers();
    }
  });

  it('nearestEntry() treats today\'s date as upcoming, not past', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
      const service = makeService();
      service.publish('160', makeSnapshot({ no: '160', date: '2026-08-31', theme: 'Today' }));

      expect(service.nearestEntry()?.no).toBe('160');
    } finally {
      vi.useRealTimers();
    }
  });
});
