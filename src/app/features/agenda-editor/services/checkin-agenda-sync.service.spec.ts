import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CheckinAgendaSyncService } from './checkin-agenda-sync.service';
import { AgendaStateService } from './agenda-state.service';
import { CommitteeRosterService } from './committee-roster.service';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { CheckinStateService } from '../../checkin/services/checkin-state.service';
import { Attendee, CheckinMeeting, CheckinSpeaker, RoleClaim } from '../../checkin/models/checkin.models';

const fakeRoleDefinitionService = { activeRoles: () => [] } as unknown as RoleDefinitionService;

const fakeCommitteeRosterService = {
  all: () => [],
  ready: () => true,
} as unknown as CommitteeRosterService;

/**
 * Signal-backed stand-in for the Firestore-backed CheckinStateService — the
 * sync only ever reads meeting()/roles()/speakers()/apologies(), so nothing
 * here needs the emulator (the transactional mutators it doesn't touch are
 * covered in checkin-state.service.emulator.spec.ts).
 */
class FakeCheckinStateService {
  readonly meetingSignal = signal<CheckinMeeting>({
    id: 'M1', date: '', theme: '', word: '', start: '', maxSpeakers: 3, club: '', sub: '', addr: '',
  });
  readonly rolesSignal = signal<Record<string, RoleClaim>>({});
  readonly speakersSignal = signal<CheckinSpeaker[]>([]);
  readonly apologiesSignal = signal<Attendee[]>([]);

  meeting() { return this.meetingSignal(); }
  roles() { return this.rolesSignal(); }
  speakers() { return this.speakersSignal(); }
  apologies() { return this.apologiesSignal(); }
}

function apology(uid: string, name: string): Attendee {
  return { uid, name, joinedAt: '18:00' };
}

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: RoleDefinitionService, useValue: fakeRoleDefinitionService },
      { provide: CommitteeRosterService, useValue: fakeCommitteeRosterService },
    ],
  });
  const state = TestBed.inject(AgendaStateService);
  const checkin = new FakeCheckinStateService();
  const sync = TestBed.inject(CheckinAgendaSyncService);
  state.updateMeeting({ no: 'M1' });
  return { sync, state, checkin: checkin as unknown as CheckinStateService, fake: checkin };
}

describe('CheckinAgendaSyncService — apologies', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it('imports a check-in apology into the agenda free-text field', () => {
    ctx.fake.apologiesSignal.set([apology('u1', 'Bob')]);
    ctx.sync.apply('M1', ctx.state, ctx.checkin);

    expect(ctx.state.meeting().apologies).toBe('Bob');
    expect(ctx.state.meeting().apologySyncUids).toEqual({ u1: 'Bob' });
  });

  // The bug this pins down: clearing the field used to undo itself, because
  // the next sync saw the name missing and re-appended it — and the sync
  // re-runs on every check-in change, so it came back almost immediately.
  it('does NOT re-add a name the admin has since deleted, even while the person is still apologized', () => {
    ctx.fake.apologiesSignal.set([apology('u1', 'Bob')]);
    ctx.sync.apply('M1', ctx.state, ctx.checkin);
    expect(ctx.state.meeting().apologies).toBe('Bob');

    ctx.state.updateMeeting({ apologies: '' }); // admin clears the field
    ctx.sync.apply('M1', ctx.state, ctx.checkin); // still apologized in check-in

    expect(ctx.state.meeting().apologies).toBe('');
  });

  it('still imports a DIFFERENT person who apologizes after the admin cleared the field', () => {
    ctx.fake.apologiesSignal.set([apology('u1', 'Bob')]);
    ctx.sync.apply('M1', ctx.state, ctx.checkin);
    ctx.state.updateMeeting({ apologies: '' });

    ctx.fake.apologiesSignal.set([apology('u1', 'Bob'), apology('u2', 'Carol')]);
    ctx.sync.apply('M1', ctx.state, ctx.checkin);

    expect(ctx.state.meeting().apologies).toBe('Carol');
  });

  it('retracts a sync-added name once that person re-attends', () => {
    ctx.fake.apologiesSignal.set([apology('u1', 'Bob'), apology('u2', 'Carol')]);
    ctx.sync.apply('M1', ctx.state, ctx.checkin);
    expect(ctx.state.meeting().apologies).toBe('Bob, Carol');

    ctx.fake.apologiesSignal.set([apology('u2', 'Carol')]); // Bob re-attended
    ctx.sync.apply('M1', ctx.state, ctx.checkin);

    expect(ctx.state.meeting().apologies).toBe('Carol');
    expect(ctx.state.meeting().apologySyncUids).toEqual({ u2: 'Carol' });
  });

  it('re-imports someone who apologizes again after having re-attended', () => {
    ctx.fake.apologiesSignal.set([apology('u1', 'Bob')]);
    ctx.sync.apply('M1', ctx.state, ctx.checkin);

    ctx.fake.apologiesSignal.set([]); // re-attended — retracted
    ctx.sync.apply('M1', ctx.state, ctx.checkin);
    expect(ctx.state.meeting().apologies).toBe('');

    ctx.fake.apologiesSignal.set([apology('u1', 'Bob')]); // apologized again
    ctx.sync.apply('M1', ctx.state, ctx.checkin);
    expect(ctx.state.meeting().apologies).toBe('Bob');
  });

  it("leaves the admin's own hand-typed prose alone", () => {
    ctx.state.updateMeeting({ apologies: 'Bob and Carol send apologies' });
    ctx.fake.apologiesSignal.set([apology('u9', 'Dineo')]);
    ctx.sync.apply('M1', ctx.state, ctx.checkin);

    expect(ctx.state.meeting().apologies).toBe('Bob and Carol send apologies, Dineo');
  });

  it('ignores check-in data belonging to a different meeting number', () => {
    ctx.fake.apologiesSignal.set([apology('u1', 'Bob')]);
    ctx.sync.apply('M2', ctx.state, ctx.checkin); // checkin.meeting().id is 'M1'

    expect(ctx.state.meeting().apologies).toBe('');
  });
});
