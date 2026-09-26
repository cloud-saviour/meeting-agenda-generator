/**
 * A club's own identity/branding — replaces what used to be hardcoded
 * directly in AgendaStateService's defaultMeeting() (club name, address,
 * logos, mission statement). One document per club at `clubs/{clubId}`;
 * every other club-scoped collection lives at `clubs/{clubId}/<name>/...`
 * (see ClubContextService).
 *
 * `clubId` (the Firestore doc id, an opaque auto-id) is never the same as
 * `slug` — the doc id is internal and immutable, the slug is the
 * human-chosen, URL-facing segment (`/c/<slug>/...`) and could in
 * principle be renamed later without touching any subcollection path.
 * `ClubSlug` (below) is the pointer collection that resolves one to the
 * other; see firestore.rules for why it needs its own create-only rule
 * (same pattern as appAdmins/{uid} — first writer wins, no client can
 * hijack an existing slug).
 */
export interface Club {
  slug: string;
  name: string;
  subLine: string;
  addressLine: string;
  logoLeft: string;
  logoRight: string;
  missionStatement: string;
  website: string;
  facebookPage: string;
  createdAt: string;
  /** Deactivate/reactivate switch. `false` closes the club to everyone but
   *  platform admins (see ClubContextService.unavailable); the data is kept.
   *  New clubs are created active. */
  active: boolean;
}

/** Doc shape at `clubSlugs/{slug}` — the only way a URL segment resolves to a `clubId`. */
export interface ClubSlugPointer {
  clubId: string;
}
