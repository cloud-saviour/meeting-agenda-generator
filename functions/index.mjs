// Cloud Functions for the Agora Agenda Generator.
//
// This is the ONLY Cloud Function in the project so far — everything else is
// a static Angular app talking directly to Firestore (see CLAUDE.md). It
// exists to close the one known gap the app's Firestore-only design can't
// close on its own: actually emailing a club's newsletter subscribers when
// an admin posts an announcement (see the "Club email subscription and
// announcements" section of CLAUDE.md, and features/club-subscription/ on
// the client).
//
// DEPLOYING THIS REQUIRES CONFIGURATION THAT HAS NOT BEEN DONE YET — see
// functions/README.md for the exact steps (Blaze plan, a Resend account and
// verified sending domain, the RESEND_API_KEY/MAIL_FROM_ADDRESS secrets).
// Until those secrets are set, sendAnnouncementEmail() below deploys and
// runs safely: it logs a warning and returns without sending anything,
// rather than throwing or silently pretending to send. That's deliberate —
// this file is meant to be reviewable and deployable NOW, with the actual
// email-sending switched on later by configuration alone, no code change.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

// Cloud Functions v2 secrets — set once with:
//   firebase functions:secrets:set RESEND_API_KEY --project production
//   firebase functions:secrets:set MAIL_FROM_ADDRESS --project production
// Never put real values here or in any committed file — see functions/README.md.
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const MAIL_FROM_ADDRESS = defineSecret('MAIL_FROM_ADDRESS');
// Optional — only used to build a "manage your subscription" line in the
// email footer. Falls back to plain wording (no link) if unset.
const APP_BASE_URL = defineSecret('APP_BASE_URL');

initializeApp();
const firestore = getFirestore();

/**
 * Fires once per new `clubs/{clubId}/announcements/{announcementId}` doc —
 * i.e. every time SubscriptionService.postAnnouncement() runs on the client
 * (see admin-announcements/pages/admin-announcements.component.ts). Reads
 * that club's subscriber list and emails each of them the announcement.
 *
 * Idempotent: Cloud Functions triggers are at-least-once, not exactly-once,
 * so a retry (rare, but real) must not double-email everyone. Guarded by
 * checking (and then setting) `emailedAt` on the announcement doc itself —
 * the same doc this function was triggered by — inside the send path, so a
 * concurrent retry that loses the race just no-ops.
 *
 * No batching/queueing here on purpose: a club's subscriber list is small
 * (this is a single-club or few-club deployment, not a mass sender), so a
 * plain sequential loop is simpler to read and debug than a batched job,
 * and easily revisited later if a club's list ever grows large enough to
 * need it.
 */
export const sendAnnouncementEmail = onDocumentCreated(
  { document: 'clubs/{clubId}/announcements/{announcementId}', secrets: [RESEND_API_KEY, MAIL_FROM_ADDRESS, APP_BASE_URL] },
  async (event) => {
    const { clubId, announcementId } = event.params;
    const announcementRef = event.data.ref;
    const announcement = event.data.data();

    const apiKey = RESEND_API_KEY.value();
    const fromAddress = MAIL_FROM_ADDRESS.value();
    if (!apiKey || !fromAddress) {
      // Deliberate no-op, not an error — see this file's header comment.
      // The announcement itself was already saved by the client and is
      // already showing as a public news item; nothing here is lost by
      // waiting until these secrets are configured to actually mail it.
      logger.warn(
        `sendAnnouncementEmail: RESEND_API_KEY/MAIL_FROM_ADDRESS not configured — skipping email for clubs/${clubId}/announcements/${announcementId}. See functions/README.md.`
      );
      return;
    }

    // Idempotency guard — see this function's own doc comment above.
    const fresh = await announcementRef.get();
    if (fresh.data()?.emailedAt) {
      logger.info(`sendAnnouncementEmail: clubs/${clubId}/announcements/${announcementId} already emailed — skipping.`);
      return;
    }

    const [clubSnap, subscribersSnap] = await Promise.all([
      firestore.doc(`clubs/${clubId}`).get(),
      firestore.collection(`clubs/${clubId}/subscribers`).get(),
    ]);
    const clubName = clubSnap.exists ? clubSnap.data().name : 'this club';
    const emails = subscribersSnap.docs.map((d) => d.data().email).filter(Boolean);

    if (emails.length === 0) {
      logger.info(`sendAnnouncementEmail: no subscribers for club ${clubId} — nothing to send.`);
      await announcementRef.update({ emailedAt: Timestamp.now(), emailRecipientCount: 0 });
      return;
    }

    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);

    const baseUrl = APP_BASE_URL.value();
    const footer = baseUrl
      ? `\n\n---\nYou're receiving this because you subscribed to ${clubName}'s emails. To stop, visit ${baseUrl} and unsubscribe with this email address.`
      : `\n\n---\nYou're receiving this because you subscribed to ${clubName}'s emails. To stop, use the "Unsubscribe" option where you subscribed, with this email address.`;
    const text = `${announcement.body}${footer}`;

    // One send per recipient (not one email with everyone in "to"/"bcc"),
    // so a bad address for one subscriber never affects the others, and no
    // recipient's address is exposed to any other. Sequential, not
    // Promise.all — a small club's list is short enough that this is fine,
    // and it avoids bursting past a mail provider's rate limit.
    let sent = 0;
    for (const email of emails) {
      try {
        await resend.emails.send({
          from: fromAddress,
          to: email,
          subject: `${clubName}: ${announcement.subject}`,
          text,
        });
        sent++;
      } catch (err) {
        logger.error(`sendAnnouncementEmail: failed to send to one subscriber of club ${clubId}`, err);
      }
    }

    await announcementRef.update({ emailedAt: Timestamp.now(), emailRecipientCount: sent });
    logger.info(`sendAnnouncementEmail: sent ${sent}/${emails.length} for clubs/${clubId}/announcements/${announcementId}.`);
  }
);
