import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AgendaStateService } from './agenda-state.service';
import { CommitteeRosterService } from './committee-roster.service';
import { StorageService } from '../../../core/services/storage.service';
import { AgendaItem, CommitteeMember } from '../models/agenda.models';

class FakeStorage {
  private store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}

function makeService(): { state: AgendaStateService; roster: CommitteeRosterService } {
  TestBed.configureTestingModule({
    providers: [{ provide: StorageService, useClass: FakeStorage }],
  });
  return {
    state: TestBed.inject(AgendaStateService),
    roster: TestBed.inject(CommitteeRosterService),
  };
}

describe('AgendaStateService — committee methods', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('updateCommitteeMember', () => {
    it('updates name/email/phone on the committee member at the given index', () => {
      const { state } = makeService();

      state.updateCommitteeMember(0, 'name', 'Naledi K.');
      state.updateCommitteeMember(0, 'email', 'naledi@example.com');
      state.updateCommitteeMember(0, 'phone', '0821234567');

      const updated = state.cmt()[0];
      expect(updated.name).toBe('Naledi K.');
      expect(updated.email).toBe('naledi@example.com');
      expect(updated.phone).toBe('0821234567');
    });

    it('only touches the targeted index, leaving other slots untouched', () => {
      const { state } = makeService();

      state.updateCommitteeMember(2, 'name', 'Third Slot');

      const cmt = state.cmt();
      expect(cmt[2].name).toBe('Third Slot');
      expect(cmt.filter((m) => m.name === 'Third Slot').length).toBe(1);
    });

    it('is a safe no-op when the index is out of range', () => {
      const { state } = makeService();
      const before = state.cmt();

      state.updateCommitteeMember(99, 'name', 'Should Not Apply');

      const after = state.cmt();
      expect(after).toEqual(before);
      expect(after.some((m) => m.name === 'Should Not Apply')).toBe(false);
    });

    it('regression guard: with multiple slots sharing the same (blank) roleId, only the targeted slot changes', () => {
      // This is the actual first-time-setup scenario: every committee slot
      // starts with roleId === '' until an admin assigns a role, so several
      // slots can legitimately share the same roleId value at once. Since
      // updateCommitteeMember addresses by array position (not by roleId
      // value), picking a role for one slot must never affect another slot
      // that happens to share the same current roleId.
      const { state } = makeService();

      const allBlank: CommitteeMember[] = [
        { roleId: '', name: '', email: '', phone: '' },
        { roleId: '', name: '', email: '', phone: '' },
        { roleId: '', name: '', email: '', phone: '' },
      ];
      state.cmt.set(allBlank);

      state.updateCommitteeMember(1, 'roleId', 'secretary');

      const [first, second, third] = state.cmt();
      expect(first.roleId).toBe('');
      expect(second.roleId).toBe('secretary');
      expect(third.roleId).toBe('');
    });
  });

  describe('saveCommitteeRoster', () => {
    it('persists the current cmt array into CommitteeRosterService', () => {
      const { state, roster } = makeService();

      state.updateCommitteeMember(0, 'name', 'Persisted Name');
      state.saveCommitteeRoster();

      expect(roster.all()[0].name).toBe('Persisted Name');
      expect(roster.all().length).toBe(state.cmt().length);
    });
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

  it('leaves the committee roster untouched', () => {
    const { state } = makeService();
    state.updateCommitteeMember(0, 'name', 'Persisted Name');
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
