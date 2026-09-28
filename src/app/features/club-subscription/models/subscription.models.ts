/** Doc shape at `clubs/{clubId}/subscribers/{sha256(email)}` — see SubscriptionService. */
export interface Subscriber {
  email: string;
  subscribedAt: string;
}

/**
 * Doc shape at `clubs/{clubId}/announcements/{id}` — an admin-composed club
 * news post. Public-read (see firestore.rules) so it works as a visible news
 * feed today, ahead of the (not-yet-built) email-sending phase that would one
 * day notify `subscribers` when one of these is created.
 */
export interface Announcement {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  createdByEmail: string;
  /**
   * Set by the `sendAnnouncementEmail` Cloud Function (`functions/index.mjs`)
   * once it has emailed this announcement to the club's subscribers — absent
   * until then (including forever, until that function is actually
   * configured and deployed; see functions/README.md and CLAUDE.md's Known
   * Gaps). Not read by the UI yet — groundwork for a future "Emailed to N
   * people" line on the admin announcements page.
   */
  emailedAt?: string;
  emailRecipientCount?: number;
}
