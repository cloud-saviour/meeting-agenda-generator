export interface MeetingData {
  no: string;
  date: string;
  arr: string;
  st: string;
  theme: string;
  word: string;
  club: string;
  sub: string;
  addr: string;
  mission: string;
  vpe: string;
  hotSeat: string;
  reserve: string;
  apologies: string;
  period: string;
  web: string;
  fb: string;
}

export interface AgendaRowItem {
  id: number;
  type: 'row';
  title: string;
  person: string;
  roleId: string;
  roleVisible: boolean;
  /** One-off role text for this row only (e.g. "Acting VPE"), overriding roleId's resolved label. */
  customRoleLabel: string | null;
  duration: number;
}

export interface AgendaDualItem {
  id: number;
  type: 'dual';
  durationA: number;
  items: [DualSubItem, DualSubItem];
}

export interface DualSubItem {
  title: string;
  person: string;
  roleId: string;
  roleVisible: boolean;
  customRoleLabel: string | null;
}

export interface AgendaSpecialItem {
  id: number;
  type: 'speakers' | 'evaluators';
}

export interface AgendaRecessItem {
  id: number;
  type: 'recess';
  title: string;
  duration: number;
}

export interface AgendaNotesItem {
  id: number;
  type: 'notes';
  text: string;
}

export type AgendaItem =
  | AgendaRowItem
  | AgendaDualItem
  | AgendaSpecialItem
  | AgendaRecessItem
  | AgendaNotesItem;

export interface Speaker {
  id: number;
  name: string;
  level: string;
  timeLo: number;
  timeHi: number;
  title: string;
  evaluator: string;
  roleId: string;
  roleVisible: boolean;
}

export interface CommitteeMember {
  roleId: string;
  name: string;
  email: string;
  phone: string;
}

export interface AgendaSnapshot extends MeetingData {
  agItems: AgendaItem[];
  spks: Speaker[];
  cmt: CommitteeMember[];
  logoLeft?: string;
  logoRight?: string;
  /** Role ids the admin has taken over from check-in — see AgendaStateService.overriddenRoles. */
  overriddenRoles?: string[];
}
