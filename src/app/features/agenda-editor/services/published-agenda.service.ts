import { Injectable, NgZone, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { collection, doc, getDocFromServer, getDocs, onSnapshot, writeBatch } from 'firebase/firestore';
import { AgendaSnapshot } from '../models/agenda.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { AuthService } from '../../../core/auth/auth.service';
import { appendAuditEntry } from '../../../core/audit/audit-log.util';

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
 * **At most one document exists in this collection at a time** — `publish()`
 * is exclusive: it reads the whole collection, deletes every other document,
 * and sets the new one, all inside a single `writeBatch()` (this codebase's
 * first use of `writeBatch()`), so publishing meeting B always un-publishes
 * whatever meeting A was previously published, atomically — there's never a
 * window where zero or two meetings are simultaneously published.
 *
 * No separate index collection is needed the way the old localStorage
 * version needed a hand-rolled one — `entries()`/`nearestEntry()` are
 * derived from a live `onSnapshot()` on the whole collection, which is
 * Firestore's version of "enumerate the keys" for free (in practice they now
 * only ever see 0 or 1 entries, but their code is unchanged — it already
 * degrades to that correctly).
 */
@Injectable({ providedIn: 'root' })
export class PublishedAgendaService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private readonly snapshot = signal<AgendaSnapshot | null>(null);
  private readonly allEntries = signal<PublishedAgendaEntry[]>([]);
  private currentMeetingId: string | null = null;
  private unsubscribeMeeting: (() => void) | undefined;
  private unsubscribeIndex: (() => void) | undefined;

  readonly current = computed(() => this.snapshot());

  /** Currently-published meeting(s), sorted by date ascending — normally 0 or 1, since publish() is exclusive. */
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
    // Only listen while signed in. Unlike RoleDefinitionService (public-read),
    // `publishedAgendas` requires auth — see firestore.rules — so an always-on
    // listener would sit retrying a permission-denied read for every
    // signed-out visitor on the public Home route, which injects this service.
    // Re-subscribed on each auth transition, previous listener torn down
    // first, mirroring how AuthService re-subscribes its appAdmins listener.
    effect(() => {
      const signedIn = this.auth.currentUser() !== null;
      untracked(() => {
        this.unsubscribeIndex?.();
        this.unsubscribeIndex = undefined;
        if (!signedIn) {
          // Drop anything the previous session could see, so nearestEntry()
          // reports null rather than leaving a stale entry behind after sign-out.
          this.allEntries.set([]);
          this.snapshot.set(null);
          return;
        }
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
      });
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeIndex?.();
    this.unsubscribeMeeting?.();
  }

  /**
   * Exclusive publish: at most one meeting is ever published at a time.
   * Reads the whole collection, deletes every doc whose id isn't the one
   * being published, then sets the new one — all inside a single
   * writeBatch() so viewers never observe a transient "nothing published"
   * or "two published" state between the deletes and the set. Rethrows on
   * failure — both call sites (AdminAgendasComponent.publish(),
   * AgendaEditorComponent.save()) need to know whether it actually landed,
   * not just see it logged to the console.
   */
  publish(meetingId: string, data: AgendaSnapshot): Promise<void> {
    const payload: PublishedAgendaDoc = { ...data, publishedAt: new Date().toISOString() };
    const coll = collection(this.firestore, COLLECTION);
    return getDocs(coll)
      .then((snap) => {
        const batch = writeBatch(this.firestore);
        for (const d of snap.docs) {
          if (d.id !== meetingId) batch.delete(d.ref);
        }
        batch.set(doc(this.firestore, COLLECTION, meetingId), payload);
        appendAuditEntry(
          this.firestore,
          batch,
          'agenda.publish',
          `Published agenda #${meetingId} (${data.theme || 'untitled'})`,
          this.auth.currentUser()
        );
        return batch.commit();
      })
      .catch((err) => {
        console.error('publish failed', err);
        throw err;
      });
  }

  /**
   * Removes this meeting's published doc outright, if any — a no-op if it
   * isn't currently published (e.g. it was already superseded by a later
   * publish()). Callers that delete a saved agenda must call this too
   * (see AdminAgendasComponent.remove()) — otherwise a deleted meeting's
   * published snapshot lingers as an orphaned entry, keeping Home's
   * Check-in tile (and /preview) alive for a meeting that no longer
   * exists anywhere else.
   */
  unpublish(meetingId: string): Promise<void> {
    const entry = this.allEntries().find((e) => e.no === meetingId);
    const batch = writeBatch(this.firestore);
    batch.delete(doc(this.firestore, COLLECTION, meetingId));
    // Only log when it was genuinely published — a no-op unpublish (already
    // gone) isn't a meaningful admin action worth recording.
    if (entry) {
      appendAuditEntry(
        this.firestore,
        batch,
        'agenda.unpublish',
        `Unpublished agenda #${meetingId}${entry.theme ? ` (${entry.theme})` : ''}`,
        this.auth.currentUser()
      );
    }
    return batch.commit().catch((err) => console.error('unpublish failed', err));
  }

  /**
   * One-time, real network read of this meeting's published doc —
   * `getDocFromServer()`, not `getDoc()`, so it bypasses Firestore's local
   * cache and genuinely round-trips to the server. Backs the "🔄 Refresh"
   * button on /preview: `loadMeeting()`'s `onSnapshot` listener already
   * keeps this live in the normal case, but a listener that silently
   * dropped (e.g. after a long-backgrounded mobile tab) wouldn't show that
   * to the viewer — this gives them a real way to force a fresh read on
   * demand instead of just a reassurance no-op. Updates the same
   * `snapshot` signal `current()` reads, so the result renders through the
   * exact same path as a live update.
   */
  async refetch(meetingId: string): Promise<void> {
    try {
      const snap = await getDocFromServer(doc(this.firestore, COLLECTION, meetingId));
      this.snapshot.set(snap.exists() ? (snap.data() as AgendaSnapshot) : null);
    } catch (err) {
      console.error('publishedAgendas refetch failed', err);
      throw err;
    }
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
