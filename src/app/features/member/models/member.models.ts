export interface MemberProfile {
  uid: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

/** One meeting's worth of a given member's involvement, derived by scanning checkins/* — see MemberHistoryService. */
export interface MemberHistoryEntry {
  meetingId: string;
  date: string;
  theme: string;
  attended: boolean;
  rolesClaimed: string[];
  spoke: boolean;
  evaluatedSpeakerId: string | null;
}
