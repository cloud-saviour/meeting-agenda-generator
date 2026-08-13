export interface Attendee {
  uid: string;
  name: string;
  joinedAt: string;
}

export interface RoleClaim {
  name: string;
  uid: string;
}

export interface SignupSpeaker {
  id: string;
  name: string;
  uid: string;
  title: string;
  level: string;
  timePref: string;
  evaluator: RoleClaim | null;
}

export interface SignupMeeting {
  id: string;
  date: string;
  theme: string;
  word: string;
  start: string;
  maxSpeakers: number;
}

export interface SignupSnapshot {
  meeting: SignupMeeting;
  attendees: Attendee[];
  roles: Record<string, RoleClaim>;
  speakers: SignupSpeaker[];
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
