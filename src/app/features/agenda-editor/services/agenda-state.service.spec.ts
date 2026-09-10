import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AgendaStateService } from './agenda-state.service';
import { CommitteeRosterService } from './committee-roster.service';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { AgendaItem, CommitteeMember } from '../models/agenda.models';

// AgendaStateService only ever calls roleDefs.activeRoles() (to default a new
// agenda item's role) — nothing here exercises that path, so a stub avoids
// needing RoleDefinitionService's real Firestore dependency in this suite.
const fakeRoleDefinitionService = { activeRoles: () => [] } as unknown as RoleDefinitionService;

// CommitteeRosterService is Firestore-backed and its real data arrives
// asynchronously even on the first read — this suite needs a signal-backed
// fake so AgendaStateService.cmt (a computed over committeeRoster.all())
// reacts live to assign()/unassign(), exactly like the real service.
class FakeCommitteeRosterService {
  private readonly roster = signal<CommitteeMember[]>([]);
  // Defaults to true so every existing test (none of which care about the
  // ready()-gated reseed timing) keeps working unchanged — tests that
  // specifically need to control when Firestore "arrives" (e.g. the
  // reseed-vs-loadSnapshot race below) call `.set(false)` right after
  // construction, then `.set(true)` later to simulate a delayed arrival.
  readonly readySignal = signal(true);
  all(): CommitteeMember[] {
    return this.roster();
  }
  ready(): boolean {
    return this.readySignal();
  }
  assign(roleId: string, name: string, email: string, phone: string): Promise<void> {
    this.roster.update((members) => [...members.filter((m) => m.roleId !== roleId), { roleId, name, email, phone }]);
    return Promise.resolve();
  }
  unassign(roleId: string): Promise<void> {
    this.roster.update((members) => members.filter((m) => m.roleId !== roleId));
    return Promise.resolve();
  }
}

function makeService(): { state: AgendaStateService; roster: CommitteeRosterService } {
  TestBed.configureTestingModule({
    providers: [
      { provide: RoleDefinitionService, useValue: fakeRoleDefinitionService },
      { provide: CommitteeRosterService, useClass: FakeCommitteeRosterService },
    ],
  });
  return {
    state: TestBed.inject(AgendaStateService),
    roster: TestBed.inject(CommitteeRosterService),
  };
}

describe('AgendaStateService — cmt', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('reflects the committee roster live — no separate state or method to call', async () => {
    const { state, roster } = makeService();
    expect(state.cmt()).toEqual([]);

    await roster.assign('president', 'Naledi K.', 'naledi@example.com', '');

    expect(state.cmt()).toEqual([{ roleId: 'president', name: 'Naledi K.', email: 'naledi@example.com', phone: '' }]);
  });

  it('reflects an unassign the same way', async () => {
    const { state, roster } = makeService();
    await roster.assign('secretary', 'Thabo M.', '', '');
    expect(state.cmt().length).toBe(1);

    await roster.unassign('secretary');

    expect(state.cmt()).toEqual([]);
  });
});

describe('AgendaStateService — role/person sync across agenda items', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  function rowItem(id: number, roleId: string, person = ''): AgendaItem {
    return { id, type: 'row', title: `Row ${id}`, person, roleId, roleVisible: true, customRoleLabel: null, duration: 5 } as AgendaItem;
  }

  function dualItem(id: number, roleIdA: string, personA = '', roleIdB = '', personB = ''): AgendaItem {
    return {
      id,
      type: 'dual',
      durationA: 10,
      items: [
        { title: 'A', person: personA, roleId: roleIdA, roleVisible: true, customRoleLabel: null },
        { title: 'B', person: personB, roleId: roleIdB, roleVisible: true, customRoleLabel: null },
      ],
    } as AgendaItem;
  }

  it('typing a person into a row fills every other row and dual sub-item sharing that roleId', () => {
    const { state } = makeService();
    state.agItems.set([
      rowItem(1, 'timer'),
      rowItem(2, 'timer'),
      dualItem(3, 'timer', '', 'grammarian', ''),
    ]);

    state.updateAgItem(1, 'person', 'Alice');

    const items = state.agItems();
    expect((items[0] as any).person).toBe('Alice');
    expect((items[1] as any).person).toBe('Alice');
    expect((items[2] as any).items[0].person).toBe('Alice');
    expect((items[2] as any).items[1].person).toBe('');
  });

  it('editing an already-synced row re-syncs the whole group to the new value', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer', 'Alice'), rowItem(2, 'timer', 'Alice')]);

    state.updateAgItem(2, 'person', 'Bob');

    const items = state.agItems();
    expect((items[0] as any).person).toBe('Bob');
    expect((items[1] as any).person).toBe('Bob');
  });

  it('clearing a synced row clears the whole group', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer', 'Alice'), rowItem(2, 'timer', 'Alice')]);

    state.updateAgItem(1, 'person', '');

    const items = state.agItems();
    expect((items[0] as any).person).toBe('');
    expect((items[1] as any).person).toBe('');
  });

  it('assigning a role to a blank-person row inherits the group\'s existing name', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer', 'Bob'), rowItem(2, '')]);

    state.updateAgItem(2, 'roleId', 'timer');

    const items = state.agItems();
    expect((items[1] as any).roleId).toBe('timer');
    expect((items[1] as any).person).toBe('Bob');
  });

  it('assigning a role with no existing group name leaves the row blank', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, ''), rowItem(2, '')]);

    state.updateAgItem(1, 'roleId', 'grammarian');

    expect((state.agItems()[0] as any).person).toBe('');
  });

  it('does not leak a row\'s stale person into its newly-assigned role group', () => {
    const { state } = makeService();
    // row 1 starts on 'timer' with a name, then switches to 'grammarian'
    // which has no assigned name yet — its old 'timer' name must not carry over.
    state.agItems.set([rowItem(1, 'timer', 'Alice'), rowItem(2, 'grammarian', '')]);

    state.updateAgItem(1, 'roleId', 'grammarian');

    const items = state.agItems();
    expect((items[0] as any).person).toBe('');
    expect((items[1] as any).person).toBe('');
  });

  it('items with a different or empty roleId are unaffected', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer'), rowItem(2, 'grammarian', 'Existing'), rowItem(3, '')]);

    state.updateAgItem(1, 'person', 'Alice');

    const items = state.agItems();
    expect((items[1] as any).person).toBe('Existing');
    expect((items[2] as any).person).toBe('');
  });

  it('recess items are unaffected', () => {
    const { state } = makeService();
    const recess: AgendaItem = { id: 2, type: 'recess', title: 'Recess', duration: 15 } as AgendaItem;
    state.agItems.set([rowItem(1, 'timer'), recess]);

    state.updateAgItem(1, 'person', 'Alice');

    expect(state.agItems()[1]).toEqual(recess);
  });

  it('setRoleOverridden() toggles a roleId in and out of overriddenRoles()', () => {
    const { state } = makeService();

    state.setRoleOverridden('timer', true);
    expect(state.overriddenRoles().has('timer')).toBe(true);

    state.setRoleOverridden('timer', false);
    expect(state.overriddenRoles().has('timer')).toBe(false);
  });

  it('applyRolePerson() propagates to every row/dual-sub-item sharing that roleId, same as updateAgItem', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer'), rowItem(2, 'timer'), dualItem(3, 'timer', '', 'grammarian', '')]);

    state.applyRolePerson('timer', 'Naledi K.');

    const items = state.agItems();
    expect((items[0] as any).person).toBe('Naledi K.');
    expect((items[1] as any).person).toBe('Naledi K.');
    expect((items[2] as any).items[0].person).toBe('Naledi K.');
    expect((items[2] as any).items[1].person).toBe('');
  });

  it('getRolePerson() reflects whatever applyRolePerson last synced for that roleId', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer', ''), rowItem(2, 'timer', '')]);

    expect(state.getRolePerson('timer')).toBe('');

    state.applyRolePerson('timer', 'Naledi K.');
    expect(state.getRolePerson('timer')).toBe('Naledi K.');
  });

  it('getRolePerson() returns an empty string when no item has that roleId', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer', 'Naledi K.')]);

    expect(state.getRolePerson('grammarian')).toBe('');
  });

  it('propagates through updateDualSubItem the same way as updateAgItem', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'timer'), dualItem(2, 'timer', '', 'grammarian', '')]);

    state.updateDualSubItem(2, 0, 'person', 'Carol');

    const items = state.agItems();
    expect((items[0] as any).person).toBe('Carol');
    expect((items[1] as any).items[0].person).toBe('Carol');
    expect((items[1] as any).items[1].person).toBe('');
  });

  it('re-firing the same roleId (no-op) does not wipe the row\'s own person, even as the sole holder of that role', () => {
    const { state } = makeService();
    state.agItems.set([rowItem(1, 'generalEvaluator', 'Jane')]);

    state.updateAgItem(1, 'roleId', 'generalEvaluator');

    expect((state.agItems()[0] as any).person).toBe('Jane');
  });

  it('re-firing the same roleId on a dual sub-item (no-op) does not wipe its own person', () => {
    const { state } = makeService();
    state.agItems.set([dualItem(1, 'generalEvaluator', 'Jane', 'grammarian', '')]);

    state.updateDualSubItem(1, 0, 'roleId', 'generalEvaluator');

    expect((state.agItems()[0] as any).items[0].person).toBe('Jane');
  });

  it('assigning one dual sub-item to the roleId its sibling already holds does not wipe the sibling', () => {
    const { state } = makeService();
    // items[0] holds 'impromptuMaster' with a name already; items[1] is being
    // switched to the SAME roleId as its sibling — the sibling must survive,
    // and (per the group-sync invariant) items[1] should adopt its name.
    state.agItems.set([dualItem(1, 'impromptuMaster', 'Alice', 'grammarian', '')]);

    state.updateDualSubItem(1, 1, 'roleId', 'impromptuMaster');

    const dual = state.agItems()[0] as any;
    expect(dual.items[0].person).toBe('Alice');
    expect(dual.items[1].person).toBe('Alice');
  });
});

describe('AgendaStateService — resetAll', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('blanks the meeting number, deliberately, so the fresh agenda stays un-addressable', () => {
    const { state } = makeService();
    state.updateMeeting({ no: '160', theme: 'Something' });

    state.resetAll();

    expect(state.meeting().no).toBe('');
  });

  it('clears speakers and overridden roles', () => {
    const { state } = makeService();
    state.addSpeaker({ name: 'Alice' });
    state.setRoleOverridden('timer', true);

    state.resetAll();

    expect(state.spks()).toEqual([]);
    expect(state.overriddenRoles().size).toBe(0);
  });

  it('resets agenda items back to the default template', () => {
    const { state } = makeService();
    const defaultLength = state.agItems().length;
    state.agItems.set([]);

    state.resetAll();

    expect(state.agItems().length).toBe(defaultLength);
  });

  it('leaves the committee roster untouched — there is no separate state to reset', async () => {
    const { state, roster } = makeService();
    await roster.assign('president', 'Persisted Name', '', '');
    const cmtBefore = state.cmt();

    state.resetAll();

    expect(state.cmt()).toEqual(cmtBefore);
  });

  it('resets logos back to their defaults', () => {
    const { state } = makeService();
    state.setLogo('left', 'data:custom-logo');

    state.resetAll();

    expect(state.logoLeft()).toBe('logo.png');
  });
});

describe('AgendaStateService — committee-roster reseed vs loadSnapshot race', () => {
  // Regression coverage for a real bug: AgendaViewerComponent (/preview),
  // AdminAgendasComponent.open(), and JSON import all call
  // setAgItemsFromSnapshot() (via AgendaImportExportService.loadSnapshot())
  // to hydrate a specific agenda's real content. If CommitteeRosterService's
  // ready() only flips true AFTER that load — a genuine race, since Firestore
  // data always arrives asynchronously — the one-time reseed effect used to
  // fire anyway and silently overwrite the just-loaded content with a fresh
  // defaultAgenda() template. Caught by inspecting a live /preview tab: the
  // published snapshot had a real role claim, but AgendaStateService.agItems()
  // showed an unrelated id sequence with blank person fields, matching
  // defaultAgenda()'s output exactly. See CLAUDE.md's "real gotcha" section
  // on CommitteeRosterService/ready() for the seeding mechanism this guards.
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  function makeRaceService(): { state: AgendaStateService; roster: FakeCommitteeRosterService } {
    TestBed.configureTestingModule({
      providers: [
        { provide: RoleDefinitionService, useValue: fakeRoleDefinitionService },
        { provide: CommitteeRosterService, useClass: FakeCommitteeRosterService },
      ],
    });
    const roster = TestBed.inject(CommitteeRosterService) as unknown as FakeCommitteeRosterService;
    roster.readySignal.set(false); // Firestore hasn't delivered committee data yet
    return { state: TestBed.inject(AgendaStateService), roster };
  }

  it('does not clobber a loaded snapshot with a fresh default agenda when ready() flips true AFTER setAgItemsFromSnapshot()', () => {
    const { state, roster } = makeRaceService();

    const loadedItems: AgendaItem[] = [
      {
        id: 30,
        type: 'row',
        title: 'Introductions',
        person: 'Admin',
        roleId: 'toastmaster',
        roleVisible: true,
        customRoleLabel: null,
        duration: 16,
      } as AgendaItem,
    ];
    state.setAgItemsFromSnapshot(loadedItems);
    expect(state.agItems()).toEqual(loadedItems);

    // Committee-roster data arrives late — after the real snapshot was already loaded.
    roster.readySignal.set(true);
    TestBed.tick();

    expect(state.agItems()).toEqual(loadedItems);
  });

  it('still performs the one-time reseed normally when ready() flips true BEFORE any snapshot is loaded', () => {
    // Regression guard the other direction: confirms the fix only gates the
    // reseed behind "has a snapshot been loaded," not disables it outright.
    const { state, roster } = makeRaceService();
    const beforeReseed = state.agItems();

    roster.readySignal.set(true);
    TestBed.tick();

    expect(state.agItems()).not.toBe(beforeReseed);
  });
});
