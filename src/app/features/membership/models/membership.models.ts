/**
 * `pending`  — the member asked to join and no admin has decided yet.
 * `active`   — a club admin approved them.
 * `rejected` — a club admin declined; the member may ask again.
 * `removed`  — an admin removed a former active member; they may ask again.
 */
export type MembershipStatus = 'pending' | 'active' | 'rejected' | 'removed';

/** Doc at `clubs/{clubId}/memberships/{uid}` — one row per person per club. */
export interface Membership {
  uid: string;
  /** Copied from the member's profile so an admin can read who is asking without reading `members`. */
  email: string;
  displayName: string;
  status: MembershipStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedByUid: string | null;
  decidedByEmail: string | null;
}

/** What an admin can move a request or member to. */
export type MembershipDecision = 'active' | 'rejected' | 'removed';
