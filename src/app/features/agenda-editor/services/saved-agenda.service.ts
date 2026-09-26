import { Injectable, NgZone, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { collection, doc, getDoc, onSnapshot, writeBatch } from 'firebase/firestore';
import { AgendaSnapshot } from '../models/agenda.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';
import { ClubContextService } from '../../../core/club/club-context.service';
import { appendAuditEntry } from '../../../core/audit/audit-log.util';
import { MEETINGS_COLLECTION, meetingDocFromSnapshot } from '../../../core/models/meeting-doc.models';

const CLUBS_COLLECTION = 'clubs';
const COLLECTION = 'savedAgendas';

export interface SavedAgendaEntry {
  no: string;
  date: string;
  theme: string;
  updatedAt: string;
}

interface SavedAgendaDoc extends AgendaSnapshot {
  updatedAt: string;
}

/**
 * The admin's library of saved agendas — one document per meeting number at
 * `clubs/{clubId}/savedAgendas/{meetingId}`, holding the full `AgendaSnapshot`
 * plus `updatedAt`. Single-admin, one-browser-at-a-time workload (unlike
 * PublishedAgendaService or CheckinStateService) — migrated anyway for
 * cross-device convenience, not to fix a correctness bug. No separate index
 * collection needed — `entries()` is derived from a live `onSnapshot()` on
 * the whole collection, same as PublishedAgendaService/RoleDefinitionService.
 *
 * Multi-club: the index `onSnapshot()` below re-subscribes via `effect()`
 * whenever `clubContext.currentClubId()` changes — see RoleDefinitionService
 * for the same pattern and why.
 */
@Injectable({ providedIn: 'root' })
export class SavedAgendaService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly clubContext = inject(ClubContextService);
  private readonly zone = inject(NgZone);

  private readonly allEntries = signal<SavedAgendaEntry[]>([]);
  private unsubscribe: (() => void) | undefined;

  /** Saved agendas, most recently edited first. */
  readonly entries = computed(() =>
    [...this.allEntries()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  );

  constructor() {
    effect(() => {
      const clubId = this.clubContext.currentClubId();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.allEntries.set([]);
      if (!clubId) return;

      this.unsubscribe = onSnapshot(
        collection(this.firestore, CLUBS_COLLECTION, clubId, COLLECTION),
        (snap) =>
          this.zone.run(() => {
            this.allEntries.set(
              snap.docs.map((d) => {
                const data = d.data() as SavedAgendaDoc;
                return { no: d.id, date: data.date, theme: data.theme, updatedAt: data.updatedAt };
              })
            );
          }),
        (err) => this.zone.run(() => console.error('savedAgendas index listener failed', err))
      );
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  private docRef(no: string) {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) throw new Error('SavedAgendaService called with no club resolved');
    return doc(this.firestore, CLUBS_COLLECTION, clubId, COLLECTION, no);
  }

  private meetingDocRef(no: string) {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) throw new Error('SavedAgendaService called with no club resolved');
    return doc(this.firestore, CLUBS_COLLECTION, clubId, MEETINGS_COLLECTION, no);
  }

  /**
   * No-ops when snapshot.no is blank — a saved agenda must have a real
   * meeting number. Rethrows on failure (unlike this file's other
   * mutators used to) — save() backs the Agenda Editor's explicit Save
   * button (saving is no longer automatic), so a caller genuinely needs to
   * know whether it actually landed, not just see it logged to the
   * console. Audited (`agenda.save`) for the same reason: a deliberate
   * button click is exactly as meaningful as publish()/delete(), unlike
   * the old auto-save this replaced (see AuditAction's own doc comment).
   */
  save(snapshot: AgendaSnapshot): Promise<void> {
    if (!snapshot.no) return Promise.resolve();
    const payload: SavedAgendaDoc = { ...snapshot, updatedAt: new Date().toISOString() };
    const batch = writeBatch(this.firestore);
    batch.set(this.docRef(snapshot.no), payload);
    batch.set(this.meetingDocRef(snapshot.no), meetingDocFromSnapshot(snapshot));
    appendAuditEntry(
      this.firestore,
      batch,
      'agenda.save',
      `Saved agenda #${snapshot.no}${snapshot.theme ? ` (${snapshot.theme})` : ''}`,
      this.auth.currentUser(),
      this.clubContext.currentClubId() ?? undefined
    );
    return batch.commit().catch((err) => {
      console.error('savedAgendas save failed', err);
      throw err;
    });
  }

  /** One-time read, not a live subscription — opening a draft hydrates the editor once, it doesn't stay watching Firestore afterward. */
  async load(no: string): Promise<AgendaSnapshot | null> {
    try {
      const snap = await getDoc(this.docRef(no));
      return snap.exists() ? (snap.data() as AgendaSnapshot) : null;
    } catch (err) {
      console.error('savedAgendas load failed', err);
      return null;
    }
  }

  delete(no: string): Promise<void> {
    const theme = this.allEntries().find((e) => e.no === no)?.theme;
    const batch = writeBatch(this.firestore);
    batch.delete(this.docRef(no));
    appendAuditEntry(
      this.firestore,
      batch,
      'agenda.delete',
      `Deleted saved agenda #${no}${theme ? ` (${theme})` : ''}`,
      this.auth.currentUser(),
      this.clubContext.currentClubId() ?? undefined
    );
    return batch.commit().catch((err) => console.error('savedAgendas delete failed', err));
  }
}
