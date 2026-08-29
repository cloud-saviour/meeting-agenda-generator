import { Injectable, computed, inject, signal } from '@angular/core';
import { CommitteeMember } from '../models/agenda.models';
import { StorageService } from '../../../core/services/storage.service';

const STORAGE_KEY = 'agora-committee-roster';

function seedRoster(): CommitteeMember[] {
  // Blank on purpose: pre-assigning a distinct role per slot left every
  // slot's dropdown with only one selectable option (itself), since the
  // duplicate-prevention filter excludes roles already used elsewhere.
  // Starting unassigned lets every role stay pickable until an admin
  // actually assigns it.
  return Array.from({ length: 7 }, () => ({ roleId: '', name: '', email: '', phone: '' }));
}

/**
 * Persists the Executive Committee roster (who holds each committee role)
 * across sessions/agendas — unlike the rest of the agenda editor's state,
 * which is deliberately per-agenda and in-memory only. Committee members
 * are assigned by the admin (not via check-in) and change roughly yearly,
 * so every new agenda should start prepopulated with the current roster.
 */
@Injectable({ providedIn: 'root' })
export class CommitteeRosterService {
  private readonly storage = inject(StorageService);

  private readonly roster = signal<CommitteeMember[]>(this.load());

  readonly all = computed(() => this.roster());

  /** Replaces the whole roster in one commit — used when the admin explicitly saves. */
  replaceAll(members: CommitteeMember[]): void {
    this.roster.set(JSON.parse(JSON.stringify(members)));
    this.persist();
  }

  private persist(): void {
    this.storage.set(STORAGE_KEY, JSON.stringify(this.roster()));
  }

  private load(): CommitteeMember[] {
    try {
      const raw = this.storage.get(STORAGE_KEY);
      if (!raw) return seedRoster();
      const parsed = JSON.parse(raw) as CommitteeMember[];
      return Array.isArray(parsed) && parsed.length ? parsed : seedRoster();
    } catch {
      return seedRoster();
    }
  }
}
