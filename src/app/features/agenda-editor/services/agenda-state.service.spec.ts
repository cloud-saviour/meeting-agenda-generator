import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AgendaStateService } from './agenda-state.service';
import { CommitteeRosterService } from './committee-roster.service';
import { StorageService } from '../../../core/services/storage.service';
import { CommitteeMember } from '../models/agenda.models';

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
