import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import {
  AgendaItem,
  CommitteeMember,
  MeetingData,
  Speaker,
} from '../models/agenda.models';
import { defaultAgenda } from './default-agenda';
import { APP_LOCALE } from '../../../core/utils/locale';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { CommitteeRosterService } from './committee-roster.service';

const DEFAULT_LOGO_LEFT = 'logo.png';
const DEFAULT_LOGO_RIGHT = 'crown.png';

/** `vpe` ("Mission Contact VPE name") is seeded from the committee roster's
 * VP Education member, same as default-agenda.ts seeds agenda item rows —
 * a one-time default the admin can still freely retype, not a live sync. */
function defaultMeeting(no: string, cmt: CommitteeMember[]): MeetingData {
  const vpEducation = cmt.find((m) => m.roleId === 'vpEducation');
  return {
    no,
    date: new Date().toISOString().slice(0, 10),
    arr: '18:00',
    st: '18:15',
    theme: '',
    word: '',
    club: '"King\'s Speakers" Club #12',
    sub: 'Phobians,',
    addr: '378 Queen\'s Cres, Lynnwood, Pretoria, 0001',
    mission:
      'Agora empowers you to become a brilliant communicator and a confident leader who will actively build a better world.',
    vpe: vpEducation?.name || '',
    hotSeat: '',
    reserve: '',
    apologies: '',
    period: 'Aug 2025 – February 2026',
    web: 'http://www.agoraspeakers.org/',
    fb: 'Agora Speakers South Africa',
  };
}

@Injectable({ providedIn: 'root' })
export class AgendaStateService {
  private readonly roleDefs = inject(RoleDefinitionService);
  private readonly committeeRoster = inject(CommitteeRosterService);

  // ── Private counters ──────────────────────────────────────────────────────
  private agId = 0;
  private spId = 0;

  // ── State signals ─────────────────────────────────────────────────────────
  // Blank `no` on construction, deliberately — same reasoning as resetAll():
  // with auto-save now live, a non-blank default here would let the very
  // first page load of /admin silently overwrite a real saved agenda under
  // whatever number was hardcoded, before the admin touches anything.
  // Uses committeeRoster.all() directly, not this.cmt() — `cmt` is declared
  // below and wouldn't be initialized yet at this point in construction.
  readonly meeting = signal<MeetingData>(defaultMeeting('', this.committeeRoster.all()));

  readonly spks = signal<Speaker[]>([]);

  // Seeded from the persistent committee roster so every agenda starts
  // prepopulated with the admin-assigned members; from here on `cmt` is a
  // per-agenda working copy (frozen at export time), kept in sync with the
  // roster only through `updateCommitteeMember()`.
  readonly cmt = signal<CommitteeMember[]>(
    JSON.parse(JSON.stringify(this.committeeRoster.all()))
  );

  readonly agItems = signal<AgendaItem[]>(defaultAgenda(this.cmt(), () => ++this.agId));

  // Role ids the admin has taken over from check-in (see setRoleOverridden) —
  // excluded from future "Pull from Check-in" imports, and pushed to
  // CheckinStateService so members can no longer claim them either.
  readonly overriddenRoles = signal<Set<string>>(new Set());

  readonly logoLeft = signal<string>(DEFAULT_LOGO_LEFT);
  readonly logoRight = signal<string>(DEFAULT_LOGO_RIGHT);

  // ── Computed ──────────────────────────────────────────────────────────────
  readonly agendaFileName = computed(() => {
    const d = this.meeting();
    const dt = d.date ? new Date(d.date + 'T00:00:00') : null;
    const datePart = dt
      ? dt.toLocaleDateString(APP_LOCALE, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'draft';
    return `Agora Agenda - Meeting ${d.no || '?'} - ${datePart}`;
  });

  // Guards the one-time catch-up seed below — set on its first (and only) run.
  private hasSeededFromCommitteeRoster = false;

  constructor() {
    // committeeRoster.all() is read synchronously above (meeting/cmt/agItems
    // field initializers), but CommitteeRosterService is Firestore-backed —
    // its real data arrives asynchronously even on the very first read, so
    // those synchronous reads may have seeded from its pre-load placeholder.
    // This effect catches up exactly once, the moment `ready()` flips true —
    // NOT the moment `all()` first changes, since `all()`'s placeholder value
    // is itself a defined, non-empty-looking array (7 blank slots), so the
    // effect's own first (pre-Firestore) run would otherwise consume it and
    // set the guard before real data ever arrives. After the real seed,
    // `cmt` is the admin's independently-editable working copy, same as ever
    // (see the `cmt` field comment above).
    effect(() => {
      const ready = this.committeeRoster.ready();
      const roster = this.committeeRoster.all();
      untracked(() => {
        if (!ready || this.hasSeededFromCommitteeRoster) return;
        this.hasSeededFromCommitteeRoster = true;
        this.cmt.set(JSON.parse(JSON.stringify(roster)));
        this.agItems.set(defaultAgenda(this.cmt(), () => ++this.agId));
        const vpEducation = roster.find((m) => m.roleId === 'vpEducation');
        if (vpEducation?.name && !this.meeting().vpe) {
          this.meeting.update((m) => ({ ...m, vpe: vpEducation.name }));
        }
      });
    });
  }

  // ── Meeting methods ───────────────────────────────────────────────────────
  updateMeeting(patch: Partial<MeetingData>): void {
    this.meeting.update((m) => ({ ...m, ...patch }));
  }

  // ── AgendaItem methods ────────────────────────────────────────────────────
  addAgItem(type: AgendaItem['type']): void {
    const id = ++this.agId;
    const defaultRoleId = this.roleDefs.activeRoles()[0]?.id ?? '';
    let item: AgendaItem;

    switch (type) {
      case 'row':
        item = {
          id,
          type: 'row',
          title: 'New item',
          person: '',
          roleId: defaultRoleId,
          roleVisible: true,
          customRoleLabel: null,
          duration: 5,
        } as AgendaItem;
        break;
      case 'dual':
        item = {
          id,
          type: 'dual',
          durationA: 10,
          items: [
            { title: 'Session A', person: '', roleId: defaultRoleId, roleVisible: true, customRoleLabel: null },
            { title: 'Session B', person: '', roleId: defaultRoleId, roleVisible: true, customRoleLabel: null },
          ],
        } as AgendaItem;
        break;
      case 'speakers':
        item = { id, type: 'speakers' } as AgendaItem;
        break;
      case 'evaluators':
        item = { id, type: 'evaluators' } as AgendaItem;
        break;
      case 'recess':
        item = { id, type: 'recess', title: 'Recess', duration: 15 } as AgendaItem;
        break;
      case 'notes':
        item = { id, type: 'notes', text: '' } as AgendaItem;
        break;
      default:
        item = {
          id,
          type: 'row',
          title: 'New item',
          person: '',
          roleId: defaultRoleId,
          roleVisible: true,
          customRoleLabel: null,
          duration: 5,
        } as AgendaItem;
    }

    this.agItems.update((items) => [...items, item]);
  }

  removeAgItem(id: number): void {
    this.agItems.update((items) => items.filter((i) => i.id !== id));
  }

  updateAgItem(id: number, field: string, value: any): void {
    this.agItems.update((items) => {
      const before = items.find((i) => i.id === id);
      let updated = items.map((i) => (i.id === id ? ({ ...i, [field]: value } as AgendaItem) : i));
      const edited = updated.find((i) => i.id === id);
      if (edited?.type !== 'row') return updated;

      if (field === 'person' && edited.roleId) {
        updated = this.applyGroupPerson(updated, edited.roleId, value);
      } else if (field === 'roleId' && value && before?.type === 'row' && before.roleId !== value) {
        const groupPerson = this.findGroupPerson(updated, value, { id });
        updated = this.applyGroupPerson(updated, value, groupPerson);
      }
      return updated;
    });
  }

  updateDualSubItem(id: number, subIdx: 0 | 1, field: string, value: any): void {
    this.agItems.update((items) => {
      const beforeItem = items.find((i) => i.id === id);
      const beforeSub = beforeItem?.type === 'dual' ? beforeItem.items[subIdx] : undefined;

      let updated = items.map((i) => {
        if (i.id !== id || i.type !== 'dual') return i;
        const newSubs: [typeof i.items[0], typeof i.items[1]] = [
          { ...i.items[0] },
          { ...i.items[1] },
        ];
        newSubs[subIdx] = { ...newSubs[subIdx], [field]: value };
        return { ...i, items: newSubs } as AgendaItem;
      });
      const editedItem = updated.find((i) => i.id === id);
      const editedSub = editedItem?.type === 'dual' ? editedItem.items[subIdx] : undefined;
      if (!editedSub) return updated;

      if (field === 'person' && editedSub.roleId) {
        updated = this.applyGroupPerson(updated, editedSub.roleId, value);
      } else if (field === 'roleId' && value && beforeSub && beforeSub.roleId !== value) {
        const groupPerson = this.findGroupPerson(updated, value, { id, subIdx });
        updated = this.applyGroupPerson(updated, value, groupPerson);
      }
      return updated;
    });
  }

  // ── Role/person sync helpers ─────────────────────────────────────────────
  // The same roleId legitimately appears in multiple agenda rows (e.g.
  // "Timekeeper (explain role)" and "Timekeeper's Report" both use `timer`).
  // These keep every row/dual-sub-item sharing a roleId showing the same
  // person, in sync in both directions: editing or clearing the name on any
  // one of them propagates to the rest, and reassigning a row/sub-item's
  // role pulls in whatever name the rest of the new group already has (or
  // clears it, if the new group has none yet).

  /**
   * First person found for roleId elsewhere in the agenda, skipping only the
   * specific row or dual sub-item identified by `exclude` — not its sibling
   * sub-item, which may independently hold the same roleId and must still be
   * considered (and never accidentally wiped by the caller treating "the
   * whole dual container" as excluded).
   */
  private findGroupPerson(
    items: AgendaItem[],
    roleId: string,
    exclude?: { id: number; subIdx?: 0 | 1 }
  ): string {
    for (const i of items) {
      if (i.type === 'row') {
        if (i.roleId !== roleId) continue;
        if (exclude?.id === i.id && exclude.subIdx === undefined) continue;
        return i.person;
      }
      if (i.type === 'dual') {
        if (i.items[0].roleId === roleId && !(exclude?.id === i.id && exclude.subIdx === 0)) {
          return i.items[0].person;
        }
        if (i.items[1].roleId === roleId && !(exclude?.id === i.id && exclude.subIdx === 1)) {
          return i.items[1].person;
        }
      }
    }
    return '';
  }

  /** Sets person on every row/dual-sub-item whose roleId matches, leaving everything else untouched. */
  private applyGroupPerson(items: AgendaItem[], roleId: string, person: string): AgendaItem[] {
    return items.map((i) => {
      if (i.type === 'row' && i.roleId === roleId) {
        return i.person === person ? i : { ...i, person };
      }
      if (i.type === 'dual') {
        const a = i.items[0].roleId === roleId ? { ...i.items[0], person } : i.items[0];
        const b = i.items[1].roleId === roleId ? { ...i.items[1], person } : i.items[1];
        return a === i.items[0] && b === i.items[1] ? i : { ...i, items: [a, b] as [typeof a, typeof b] };
      }
      return i;
    });
  }

  // ── Check-in override ─────────────────────────────────────────────────────
  setRoleOverridden(roleId: string, overridden: boolean): void {
    this.overriddenRoles.update((s) => {
      const next = new Set(s);
      overridden ? next.add(roleId) : next.delete(roleId);
      return next;
    });
  }

  /** Sets person for every row/dual-sub-item sharing roleId — the public entry point for the check-in live sync. */
  applyRolePerson(roleId: string, person: string): void {
    this.agItems.update((items) => this.applyGroupPerson(items, roleId, person));
  }

  /** Current person for roleId (first row/dual-sub-item match, '' if none) — read counterpart to applyRolePerson. */
  getRolePerson(roleId: string): string {
    return this.findGroupPerson(this.agItems(), roleId);
  }

  moveAgItem(fromIdx: number, toIdx: number): void {
    this.agItems.update((items) => {
      const arr = [...items];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  }

  resetToDefaultAgenda(): void {
    this.agId = 0;
    this.agItems.set(defaultAgenda(this.cmt(), () => ++this.agId));
  }

  /**
   * Full reset for "New Agenda" — blanks the meeting number deliberately (see
   * SavedAgendaService/AgendaEditorComponent's auto-save guard) so the fresh
   * agenda stays un-addressable, and doesn't overwrite any other meeting's
   * saved copy, until the admin types a real number into the meeting-details
   * form. `cmt` is intentionally left untouched — stays seeded from the
   * persistent committee roster, same as construction.
   */
  resetAll(): void {
    this.agId = 0;
    this.spId = 0;
    this.meeting.set(defaultMeeting('', this.cmt()));
    this.spks.set([]);
    this.overriddenRoles.set(new Set());
    this.agItems.set(defaultAgenda(this.cmt(), () => ++this.agId));
    this.logoLeft.set(DEFAULT_LOGO_LEFT);
    this.logoRight.set(DEFAULT_LOGO_RIGHT);
  }

  /** Replaces agenda items wholesale (e.g. from an imported snapshot) and resets the id counter. */
  setAgItemsFromSnapshot(items: AgendaItem[]): void {
    this.agId = items.reduce((max, i) => Math.max(max, i.id), 0);
    this.agItems.set(JSON.parse(JSON.stringify(items)));
  }

  /** Replaces speakers wholesale (e.g. from an imported snapshot), reassigning fresh ids. */
  setSpeakersFromSnapshot(spks: Speaker[]): void {
    this.spId = 0;
    this.spks.set([]);
    for (const s of spks) this.addSpeaker(s);
  }

  // ── Speaker methods ───────────────────────────────────────────────────────
  addSpeaker(d?: Partial<Speaker>): void {
    const id = ++this.spId;
    const speaker: Speaker = {
      id,
      name: d?.name ?? '',
      level: d?.level ?? '',
      timeLo: d?.timeLo ?? 7,
      timeHi: d?.timeHi ?? 10,
      title: d?.title ?? '',
      evaluator: d?.evaluator ?? '',
      roleId: d?.roleId ?? 'evaluator',
      roleVisible: d?.roleVisible ?? true,
    };
    this.spks.update((spks) => [...spks, speaker]);
  }

  removeSpeaker(id: number): void {
    this.spks.update((spks) => spks.filter((s) => s.id !== id));
  }

  updateSpeaker(id: number, field: keyof Speaker, value: any): void {
    this.spks.update((spks) =>
      spks.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, [field]: value };
        // Enforce timeLo <= timeHi
        if (field === 'timeLo' && updated.timeLo > updated.timeHi) {
          updated.timeHi = updated.timeLo;
        }
        if (field === 'timeHi' && updated.timeHi < updated.timeLo) {
          updated.timeLo = updated.timeHi;
        }
        return updated;
      })
    );
  }

  // ── Committee methods ─────────────────────────────────────────────────────
  // Addressed by array position, not roleId: cmt is a fixed-length, never-
  // reordered list of edit-form rows, and multiple rows can legitimately
  // share the same roleId (e.g. all unassigned, roleId === '') — a value
  // lookup would be ambiguous there, while position never is. This is
  // unrelated to (and doesn't reintroduce) the positional-index bug fixed
  // elsewhere: readers like the preview/DOCX footer and default-agenda still
  // resolve *who holds a given role* via roleId, never via array position —
  // this method only identifies *which row the edit form is patching*.
  updateCommitteeMember(index: number, field: keyof CommitteeMember, value: string): void {
    this.cmt.update((members) =>
      members.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }

  /** Persists the current committee list so future agendas start prepopulated with it. */
  saveCommitteeRoster(): void {
    this.committeeRoster.replaceAll(this.cmt());
  }

  // ── Logo methods ──────────────────────────────────────────────────────────
  setLogo(side: 'left' | 'right', dataUrl: string): void {
    if (side === 'left') {
      this.logoLeft.set(dataUrl);
    } else {
      this.logoRight.set(dataUrl);
    }
  }

  resetLogo(side: 'left' | 'right'): void {
    if (side === 'left') {
      this.logoLeft.set(DEFAULT_LOGO_LEFT);
    } else {
      this.logoRight.set(DEFAULT_LOGO_RIGHT);
    }
  }
}
