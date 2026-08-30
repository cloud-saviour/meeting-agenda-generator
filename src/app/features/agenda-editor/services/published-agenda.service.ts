import { Injectable, computed, inject, signal } from '@angular/core';
import { AgendaSnapshot } from '../models/agenda.models';
import { StorageService } from '../../../core/services/storage.service';

const STORAGE_KEY = 'agora-agenda-published';

function storageKey(meetingId: string): string {
  return meetingId === 'default' ? STORAGE_KEY : `${STORAGE_KEY}-${meetingId}`;
}

/**
 * Publishes a read-only snapshot of the agenda per meeting number, so
 * non-admin members (via the check-in page's "Preview Agenda" link) can see
 * it without touching the live in-memory editing session. Mirrors
 * CheckinStateService's loadMeeting()/storage-key shape deliberately: when
 * this moves off localStorage onto a real backend, loadMeeting() becomes a
 * live onSnapshot() subscription updating the same `snapshot` signal —
 * consumers reading `current` won't need to change.
 */
@Injectable({ providedIn: 'root' })
export class PublishedAgendaService {
  private readonly storage = inject(StorageService);

  private readonly snapshot = signal<AgendaSnapshot | null>(null);

  readonly current = computed(() => this.snapshot());

  publish(meetingId: string, data: AgendaSnapshot): void {
    this.storage.set(storageKey(meetingId), JSON.stringify(data));
  }

  loadMeeting(meetingId: string): void {
    const raw = this.storage.get(storageKey(meetingId));
    try {
      this.snapshot.set(raw ? (JSON.parse(raw) as AgendaSnapshot) : null);
    } catch {
      this.snapshot.set(null);
    }
  }
}
