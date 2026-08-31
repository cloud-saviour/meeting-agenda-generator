import { Injectable, computed, inject, signal } from '@angular/core';
import { AgendaSnapshot } from '../models/agenda.models';
import { StorageService } from '../../../core/services/storage.service';

const STORAGE_KEY = 'agora-agenda-published';
const INDEX_KEY = 'agora-agenda-published-index';

function storageKey(meetingId: string): string {
  return meetingId === 'default' ? STORAGE_KEY : `${STORAGE_KEY}-${meetingId}`;
}

export interface PublishedAgendaEntry {
  no: string;
  date: string;
  theme: string;
  publishedAt: string;
}

/**
 * Publishes a read-only snapshot of the agenda per meeting number, so
 * non-admin members (via the check-in page's "Preview Agenda" link) can see
 * it without touching the live in-memory editing session. Mirrors
 * CheckinStateService's loadMeeting()/storage-key shape deliberately: when
 * this moves off localStorage onto a real backend, loadMeeting() becomes a
 * live onSnapshot() subscription updating the same `snapshot` signal —
 * consumers reading `current` won't need to change.
 *
 * Also maintains a small hand-rolled index (StorageService can't enumerate
 * keys — same reason SavedAgendaService has one) so meeting-agnostic entry
 * points like the Home page tile can find *which* meeting to link to, via
 * `nearestEntry`, without any admin session/context available.
 */
@Injectable({ providedIn: 'root' })
export class PublishedAgendaService {
  private readonly storage = inject(StorageService);

  private readonly snapshot = signal<AgendaSnapshot | null>(null);
  private readonly index = signal<PublishedAgendaEntry[]>(this.loadIndex());

  readonly current = computed(() => this.snapshot());

  /** Published meetings, sorted by date ascending. */
  readonly entries = computed(() => [...this.index()].sort((a, b) => a.date.localeCompare(b.date)));

  /**
   * The meeting a meeting-agnostic entry point (e.g. Home) should link
   * check-in to: the nearest upcoming (today-or-later) published meeting by
   * date, or — if none is upcoming — the most recently past one, so the link
   * still goes somewhere useful (e.g. a latecomer checking in right after a
   * meeting). Null only when nothing has ever been published.
   */
  readonly nearestEntry = computed<PublishedAgendaEntry | null>(() => {
    const list = this.entries();
    if (list.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    return list.find((e) => e.date >= today) ?? list[list.length - 1];
  });

  publish(meetingId: string, data: AgendaSnapshot): void {
    this.storage.set(storageKey(meetingId), JSON.stringify(data));

    const entry: PublishedAgendaEntry = {
      no: meetingId,
      date: data.date,
      theme: data.theme,
      publishedAt: new Date().toISOString(),
    };
    this.index.update((list) => [...list.filter((e) => e.no !== meetingId), entry]);
    this.persistIndex();
  }

  loadMeeting(meetingId: string): void {
    const raw = this.storage.get(storageKey(meetingId));
    try {
      this.snapshot.set(raw ? (JSON.parse(raw) as AgendaSnapshot) : null);
    } catch {
      this.snapshot.set(null);
    }
  }

  private loadIndex(): PublishedAgendaEntry[] {
    try {
      const raw = this.storage.get(INDEX_KEY);
      return raw ? (JSON.parse(raw) as PublishedAgendaEntry[]) : [];
    } catch {
      return [];
    }
  }

  private persistIndex(): void {
    this.storage.set(INDEX_KEY, JSON.stringify(this.index()));
  }
}
