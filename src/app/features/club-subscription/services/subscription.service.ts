import { Injectable, NgZone, OnDestroy, effect, inject, signal } from '@angular/core';
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc, writeBatch } from 'firebase/firestore';
import { Announcement, Subscriber } from '../models/subscription.models';
import { FIRESTORE } from '../../../core/firebase/firestore.provider';
import { ClubContextService } from '../../../core/club/club-context.service';
import { AuthService } from '../../../core/auth/auth.service';
import { appendAuditEntry } from '../../../core/audit/audit-log.util';
import { sha256Hex } from '../../../core/utils/hash';

const CLUBS_COLLECTION = 'clubs';
const SUBSCRIBERS_COLLECTION = 'subscribers';
const ANNOUNCEMENTS_COLLECTION = 'announcements';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lowercased so the same address always hashes to the same subscriber doc id, same convention as CheckinStateService's guest identity. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Per-club email subscription + club news — no sign-in or membership
 * required, matching this app's existing "checkins/checkinContacts" accepted-
 * risk model (self-reported, unverified, no barrier). See CLAUDE.md.
 *
 * `subscribe()`/`unsubscribe()` key the doc by `sha256Hex(normalizedEmail)`
 * (same function `CheckinStateService.identifyAsGuest()` uses for the
 * identical reason) — the same address always resolves to the same doc, so
 * subscribing twice is a harmless overwrite and unsubscribing needs only the
 * email back, never a login or a token.
 *
 * `announcements` is the actual, visible-today half of the feature: sending
 * an email to `subscribers` is NOT built (this app has no mail-sending
 * capability at all — see CLAUDE.md's Known Gaps) — an announcement is a
 * public club-news post from the moment it's created. Read live and
 * unconditionally (it's public data, like `publishedAgendas`); `subscribers`
 * itself is read live ONLY for an app-admin of the current club, the same
 * `isAppAdmin()`-gated shape `CheckinContactsService.byUid()` already uses,
 * since firestore.rules makes raw subscriber emails admin-read-only.
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionService implements OnDestroy {
  private readonly firestore = inject(FIRESTORE);
  private readonly clubContext = inject(ClubContextService);
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private readonly announcementsSignal = signal<Announcement[]>([]);
  readonly announcements = this.announcementsSignal.asReadonly();
  private unsubscribeAnnouncements: (() => void) | undefined;

  private readonly subscribersSignal = signal<Map<string, Subscriber>>(new Map());
  /** Empty for anyone who isn't an app-admin of the current club. */
  readonly subscribers = this.subscribersSignal.asReadonly();
  private unsubscribeSubscribers: (() => void) | undefined;

  constructor() {
    effect(() => {
      const clubId = this.clubContext.currentClubId();
      this.unsubscribeAnnouncements?.();
      this.unsubscribeAnnouncements = undefined;
      this.announcementsSignal.set([]);
      if (!clubId) return;

      this.unsubscribeAnnouncements = onSnapshot(
        query(collection(this.firestore, CLUBS_COLLECTION, clubId, ANNOUNCEMENTS_COLLECTION), orderBy('createdAt', 'desc')),
        (snap) =>
          this.zone.run(() => {
            this.announcementsSignal.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Announcement, 'id'>) })));
          }),
        (err) => this.zone.run(() => console.error('announcements snapshot listener failed', err))
      );
    });

    effect(() => {
      const clubId = this.clubContext.currentClubId();
      const isAppAdmin = this.clubContext.isAppAdmin();
      this.unsubscribeSubscribers?.();
      this.unsubscribeSubscribers = undefined;
      this.subscribersSignal.set(new Map());
      if (!clubId || !isAppAdmin) return;

      this.unsubscribeSubscribers = onSnapshot(
        collection(this.firestore, CLUBS_COLLECTION, clubId, SUBSCRIBERS_COLLECTION),
        (snap) =>
          this.zone.run(() => {
            const next = new Map<string, Subscriber>();
            for (const d of snap.docs) next.set(d.id, d.data() as Subscriber);
            this.subscribersSignal.set(next);
          }),
        (err) => this.zone.run(() => console.error('subscribers snapshot listener failed', err))
      );
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeAnnouncements?.();
    this.unsubscribeSubscribers?.();
  }

  /** Returns false for a blank/invalid-looking email or if no club is resolved. */
  async subscribe(email: string): Promise<boolean> {
    const clubId = this.clubContext.currentClubId();
    const normalized = normalizeEmail(email);
    if (!clubId || !EMAIL_PATTERN.test(normalized)) return false;

    const id = await sha256Hex(normalized);
    const subscriber: Subscriber = { email: normalized, subscribedAt: new Date().toISOString() };
    await setDoc(doc(this.firestore, CLUBS_COLLECTION, clubId, SUBSCRIBERS_COLLECTION, id), subscriber);
    return true;
  }

  /** Returns false for a blank/invalid-looking email or if no club is resolved — true whether or not that email was actually subscribed. */
  async unsubscribe(email: string): Promise<boolean> {
    const clubId = this.clubContext.currentClubId();
    const normalized = normalizeEmail(email);
    if (!clubId || !EMAIL_PATTERN.test(normalized)) return false;

    const id = await sha256Hex(normalized);
    await deleteDoc(doc(this.firestore, CLUBS_COLLECTION, clubId, SUBSCRIBERS_COLLECTION, id));
    return true;
  }

  /**
   * Whether `email` is currently subscribed to the CURRENT club — a single
   * `getDoc()` by the same hash `subscribe()`/`unsubscribe()` use, not a
   * subscription: this is a one-time check for a "Subscribe"/"Unsubscribe"
   * toggle to know which label to show, not a live listener. Works for
   * anyone (firestore.rules' `subscribers` rule allows `get` publicly,
   * unlike `list` — see its own comment). Returns false if no club is
   * resolved or the email looks invalid, same as subscribe()/unsubscribe().
   */
  async isSubscribed(email: string): Promise<boolean> {
    const clubId = this.clubContext.currentClubId();
    const normalized = normalizeEmail(email);
    if (!clubId || !EMAIL_PATTERN.test(normalized)) return false;

    const id = await sha256Hex(normalized);
    const snap = await getDoc(doc(this.firestore, CLUBS_COLLECTION, clubId, SUBSCRIBERS_COLLECTION, id));
    return snap.exists();
  }

  /**
   * Admin-only (enforced by firestore.rules, not just the caller). Writes the
   * announcement and its audit entry in one batch — see appendAuditEntry()'s
   * own doc comment on why this must never be split across two writes.
   */
  async postAnnouncement(subject: string, body: string): Promise<void> {
    const clubId = this.clubContext.currentClubId();
    if (!clubId) throw new Error('No club resolved.');
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody) throw new Error('Subject and message are both required.');

    const actor = this.auth.currentUser();
    const batch = writeBatch(this.firestore);
    const ref = doc(collection(this.firestore, CLUBS_COLLECTION, clubId, ANNOUNCEMENTS_COLLECTION));
    const announcement: Omit<Announcement, 'id'> = {
      subject: trimmedSubject,
      body: trimmedBody,
      createdAt: new Date().toISOString(),
      createdByEmail: actor?.email ?? '',
    };
    batch.set(ref, announcement);
    appendAuditEntry(this.firestore, batch, 'announcement.create', `Posted announcement "${trimmedSubject}"`, actor, clubId);
    await batch.commit();
  }
}
