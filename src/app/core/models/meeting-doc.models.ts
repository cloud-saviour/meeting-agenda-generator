/** Firestore collection holding one shared header document per meeting number. */
export const MEETINGS_COLLECTION = 'meetings';

/**
 * The meeting header fields that both the agenda editor and the check-in
 * page display — one document at `meetings/{meetingNo}`, the single stored
 * copy. Written only inside SavedAgendaService.save() / PublishedAgendaService.publish()'s
 * existing batches; read live by CheckinStateService. Field names match the
 * check-in read model (`start`, not the agenda's `st`).
 */
export interface MeetingDoc {
  date: string;
  theme: string;
  word: string;
  start: string;
  club: string;
  sub: string;
  addr: string;
}

/** Structural subset of an AgendaSnapshot — keeps core/ independent of the agenda-editor feature. */
export interface MeetingDocSource {
  date: string;
  theme: string;
  word: string;
  st: string;
  club: string;
  sub: string;
  addr: string;
}

export function meetingDocFromSnapshot(s: MeetingDocSource): MeetingDoc {
  return { date: s.date, theme: s.theme, word: s.word, start: s.st, club: s.club, sub: s.sub, addr: s.addr };
}
