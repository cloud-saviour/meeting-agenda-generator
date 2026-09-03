import { Injectable, NgZone, OnDestroy, computed, inject, signal } from '@angular/core';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { AgendaSnapshot } from '../models/agenda.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';

const COLLECTION = 'publishedAgendas';

export interface PublishedAgendaEntry {
  no: string;
  date: string;
  theme: string;
  publishedAt: string;
}

interface PublishedAgendaDoc extends AgendaSnapshot {
  publishedAt: string;
}

/**
 * Publishes a read-only snapshot of the agenda per meeting number, so
 * non-admin members (via the check-in page's "Preview Agenda" link) can see
 * it without touching the live in-memory editing session. Firestore-backed —
 * one document per meeting at `publishedAgendas/{meetingId}` — because unlike
 * SavedAgendaService (a single-admin, one-browser workload), this service's
 * entire purpose is being read on a *different device* than the one that
 * published it, which localStorage can never do.
 *
 * No separate index collection is needed the way the old localStorage
 * version needed a hand-rolled one — `entries()`/`nearestEntry()` are
 * derived from a live `onSnapshot()` on the whole collection, which is
 * Firestore's version of "enumerate the keys" for free.
 */
@Injectable({ providedIn: 'root' })
export class PublishedAgendaService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly zone = inject(NgZone);

  private readonly snapshot = signal<AgendaSnapshot | null>(null);
  private readonly allEntries = signal<PublishedAgendaEntry[]>([]);
  private currentMeetingId: string | null = null;
  private unsubscribeMeeting: (() => void) | undefined;
  private readonly unsubscribeIndex: () => void;

  readonly current = computed(() => this.snapshot());

  /** Published meetings, sorted by date ascending. */
  readonly entries = computed(() =>
    [...this.allEntries()].sort((a, b) => a.date.localeCompare(b.date))
  );

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

  constructor() {
    // Always-on, from construction — same pattern as RoleDefinitionService —
    // since there's no "which meeting" context for Home's nearestEntry lookup.
    this.unsubscribeIndex = onSnapshot(
      collection(this.firestore, COLLECTION),
      (snap) =>
        this.zone.run(() => {
          this.allEntries.set(
            snap.docs.map((d) => {
              const data = d.data() as PublishedAgendaDoc;
              return { no: d.id, date: data.date, theme: data.theme, publishedAt: data.publishedAt };
            })
          );
        }),
      (err) => this.zone.run(() => console.error('publishedAgendas index listener failed', err))
    );
  }

  ngOnDestroy(): void {
    this.unsubscribeIndex();
    this.unsubscribeMeeting?.();
  }

  publish(meetingId: string, data: AgendaSnapshot): Promise<void> {
    const payload: PublishedAgendaDoc = { ...data, publishedAt: new Date().toISOString() };
    return setDoc(doc(this.firestore, COLLECTION, meetingId), payload).catch((err) =>
      console.error('publish failed', err)
    );
  }

  /**
   * Subscribes live to a meeting's published snapshot — idempotent, calling
   * this again with the same meetingId is a cheap no-op rather than tearing
   * down and rebuilding the listener.
   */
  loadMeeting(meetingId: string): void {
    if (meetingId === this.currentMeetingId) return;
    this.unsubscribeMeeting?.();
    this.currentMeetingId = meetingId;

    const ref = doc(this.firestore, COLLECTION, meetingId);
    this.unsubscribeMeeting = onSnapshot(
      ref,
      (snap) =>
        this.zone.run(() => {
          this.snapshot.set(snap.exists() ? (snap.data() as AgendaSnapshot) : null);
        }),
      (err) => this.zone.run(() => console.error('publishedAgendas snapshot listener failed', err))
    );
  }
}
