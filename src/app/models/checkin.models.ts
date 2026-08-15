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
}

export const DEFAULT_ROLE_KEYS = [
  'toastmaster',
  'generalEvaluator',
  'grammarian',
  'timer',
  'ahCounter',
  'evaluationChairman',
] as const;

export const ROLE_LABELS: Record<string, string> = {
  toastmaster: 'Toastmaster of the Day',
  generalEvaluator: 'General Evaluator',
  grammarian: 'Grammarian',
  timer: 'Timer',
  ahCounter: 'Ah-Counter',
  evaluationChairman: 'Evaluation Chairman',
};
