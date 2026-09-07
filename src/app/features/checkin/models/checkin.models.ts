export interface Attendee {
  uid: string;
  name: string;
  joinedAt: string;
}

export interface RoleClaim {
  name: string;
  uid: string;
}

export interface CheckinSpeaker {
  id: string;
  name: string;
  uid: string;
  title: string;
  level: string;
  timePref: string;
  evaluator: RoleClaim | null;
}

export interface CheckinMeeting {
  id: string;
  date: string;
  theme: string;
  word: string;
  start: string;
  maxSpeakers: number;
}

export interface CheckinSnapshot {
  meeting: CheckinMeeting;
  attendees: Attendee[];
  roles: Record<string, RoleClaim>;
  speakers: CheckinSpeaker[];
  /** Role ids the organizer has taken over in the Agenda Editor — hidden from claiming here. */
  lockedRoles: string[];
}

/**
 * The Firestore doc shape at `checkinContacts/{uid}` — admin-only-readable,
 * holds the *real* email behind a check-in identity. `checkins/**` itself
 * never stores raw email (only the derived uid, see `sha256Hex` in
 * core/utils/hash.ts) since that collection is fully public. This is the
 * one place a real email lives, foundation for a future reminder-email
 * feature — see CheckinContactsService.
 */
export interface CheckinContact {
  uid: string;
  name: string;
  email: string;
  updatedAt: string;
}
