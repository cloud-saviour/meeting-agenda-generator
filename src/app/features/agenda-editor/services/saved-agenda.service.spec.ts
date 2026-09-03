import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SavedAgendaService } from './saved-agenda.service';
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

function makeService(): SavedAgendaService {
  TestBed.configureTestingModule({
    providers: [{ provide: StorageService, useClass: FakeStorage }],
  });
  return TestBed.inject(SavedAgendaService);
}

describe('SavedAgendaService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('save() followed by load() with the same meeting number round-trips the snapshot', () => {
    const service = makeService();
    const snapshot = makeSnapshot({ no: '160', theme: 'Resilience' });

    service.save(snapshot);

    expect(service.load('160')).toEqual(snapshot);
  });

  it('load() for a meeting number that was never saved returns null', () => {
    const service = makeService();

    expect(service.load('999')).toBeNull();
  });

  it('save() is a no-op when the snapshot has no meeting number', () => {
    const service = makeService();
    const snapshot = makeSnapshot({ no: '' });

    service.save(snapshot);

    expect(service.entries()).toEqual([]);
    expect(service.load('')).toBeNull();
  });

  it('entries() reflects a save, keyed by meeting number', () => {
    const service = makeService();
    service.save(makeSnapshot({ no: '160', theme: 'Resilience', date: '2026-08-29' }));

    const entries = service.entries();
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({ no: '160', theme: 'Resilience', date: '2026-08-29' });
    expect(entries[0].updatedAt).toBeTruthy();
  });

  it('saving the same meeting number again upserts (updates) rather than duplicating', () => {
    const service = makeService();
    service.save(makeSnapshot({ no: '160', theme: 'First' }));
    service.save(makeSnapshot({ no: '160', theme: 'Second' }));

    const entries = service.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].theme).toBe('Second');
    expect(service.load('160')?.theme).toBe('Second');
  });

  it('entries() sorts by updatedAt, most recently saved first', () => {
    vi.useFakeTimers();
    try {
      const service = makeService();
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
      service.save(makeSnapshot({ no: '160' }));
      vi.setSystemTime(new Date('2026-01-01T10:05:00Z'));
      service.save(makeSnapshot({ no: '161' }));

      const entries = service.entries();
      expect(entries.map((e) => e.no)).toEqual(['161', '160']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('delete() removes both the draft and the index entry', () => {
    const service = makeService();
    service.save(makeSnapshot({ no: '160' }));

    service.delete('160');

    expect(service.entries()).toEqual([]);
    expect(service.load('160')).toBeNull();
  });

  it('delete() only removes the targeted meeting number', () => {
    const service = makeService();
    service.save(makeSnapshot({ no: '160' }));
    service.save(makeSnapshot({ no: '161' }));

    service.delete('160');

    expect(service.entries().map((e) => e.no)).toEqual(['161']);
    expect(service.load('161')).not.toBeNull();
  });

  it('loading corrupted JSON for a draft does not throw and returns null', () => {
    const fake = new FakeStorage();
    fake.set('agora-agenda-draft-160', 'not valid json{');
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: fake }] });
    const service = TestBed.inject(SavedAgendaService);

    expect(() => service.load('160')).not.toThrow();
    expect(service.load('160')).toBeNull();
  });

  it('a corrupted index does not throw on construction and starts empty', () => {
    const fake = new FakeStorage();
    fake.set('agora-agenda-index', 'not valid json{');
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: fake }] });

    expect(() => TestBed.inject(SavedAgendaService)).not.toThrow();
    expect(TestBed.inject(SavedAgendaService).entries()).toEqual([]);
  });
});
