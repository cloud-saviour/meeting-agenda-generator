export interface MemberProfile {
  uid: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

/** One meeting's worth of a given member's admin-confirmed involvement — see MemberHistoryService. */
export interface MemberHistoryEntry {
  meetingId: string;
  date: string;
  theme: string;
  attended: boolean;
  rolesConfirmed: string[];
  spoke: boolean;
  evaluatedSpeakerId: string | null;
}

/**
 * The Firestore doc shape at `memberHistory/{meetingId}_{uid}` — the
 * official, admin-confirmed record. Written only by AttendanceConfirmationService.
 * date/theme are denormalized here at first-confirm time so the dashboard
 * never needs to join against PublishedAgendaService.
 */
export interface MemberHistoryRecord {
  meetingId: string;
  uid: string;
  date: string;
  theme: string;
  attended: boolean;
  rolesConfirmed: string[];
  spoke: boolean;
  evaluatedSpeakerId: string | null;
  updatedAt: string;
}
