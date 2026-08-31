import { Injectable, computed, inject, signal } from '@angular/core';
import { AgendaSnapshot } from '../models/agenda.models';
import { StorageService } from '../../../core/services/storage.service';

const DRAFT_PREFIX = 'agora-agenda-draft';
const INDEX_KEY = 'agora-agenda-index';

function draftKey(no: string): string {
  return `${DRAFT_PREFIX}-${no}`;
}

export interface SavedAgendaEntry {
  no: string;
  date: string;
  theme: string;
  updatedAt: string;
}

/**
 * The admin's library of saved agendas — one full AgendaSnapshot per meeting
 * number, plus a small hand-maintained index (StorageService can't enumerate
 * keys) so the "My Agendas" list doesn't need to scan localStorage. Shaped
 * the same way CheckinStateService/PublishedAgendaService are (save/load by
 * a plain id, a listing signal) so it could swap to a Firestore collection
 * later without changing callers — see CLAUDE.md's Persistence section.
 */
@Injectable({ providedIn: 'root' })
export class SavedAgendaService {
  private readonly storage = inject(StorageService);
  private readonly index = signal<SavedAgendaEntry[]>(this.loadIndex());

  /** Saved agendas, most recently edited first. */
  readonly entries = computed(() =>
    [...this.index()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  );

  /** No-ops when snapshot.no is blank — a saved agenda must have a real meeting number. */
  save(snapshot: AgendaSnapshot): void {
    if (!snapshot.no) return;
    this.storage.set(draftKey(snapshot.no), JSON.stringify(snapshot));

    const entry: SavedAgendaEntry = {
      no: snapshot.no,
      date: snapshot.date,
      theme: snapshot.theme,
      updatedAt: new Date().toISOString(),
    };
    this.index.update((list) => [...list.filter((e) => e.no !== snapshot.no), entry]);
    this.persistIndex();
  }

  load(no: string): AgendaSnapshot | null {
    const raw = this.storage.get(draftKey(no));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AgendaSnapshot;
    } catch {
      return null;
    }
  }

  delete(no: string): void {
    this.storage.remove(draftKey(no));
    this.index.update((list) => list.filter((e) => e.no !== no));
    this.persistIndex();
  }

  private loadIndex(): SavedAgendaEntry[] {
    try {
      const raw = this.storage.get(INDEX_KEY);
      return raw ? (JSON.parse(raw) as SavedAgendaEntry[]) : [];
    } catch {
      return [];
    }
  }

  private persistIndex(): void {
    this.storage.set(INDEX_KEY, JSON.stringify(this.index()));
  }
}
