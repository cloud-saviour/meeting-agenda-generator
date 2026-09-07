import { describe, it, expect } from 'vitest';
import { scanOne } from './member-history.service';
import { CheckinSnapshot } from '../../checkin/models/checkin.models';

/**
 * MemberHistoryService.loadHistory() itself calls Firestore's collection()/
 * getDocs() directly (not injectable) — per this project's convention that
 * logic touching the real SDK is covered by the emulator spec, not a mock
 * (see member-history.service.emulator.spec.ts). This file covers only the
 * pure, Firestore-free scanOne() helper.
 */
function snapshot(overrides: Partial<CheckinSnapshot> = {}): CheckinSnapshot {
  return {
    meeting: { id: 'm1', date: '2026-01-01', theme: '', word: '', start: '18:15', maxSpeakers: 3 },
    attendees: [],
    roles: {},
    speakers: [],
    lockedRoles: [],
    ...overrides,
  };
}

describe('scanOne', () => {
  it('reports attendance, role claims, speaking, and evaluating for the given uid', () => {
    const data = snapshot({
      attendees: [{ uid: 'u1', name: 'Ada', joinedAt: '18:00' }],
      roles: { toastmaster: { uid: 'u1', name: 'Ada' }, timer: { uid: 'other', name: 'Bob' } },
      speakers: [
        { id: 's1', uid: 'other', name: 'Bob', title: 'T', level: 'L', timePref: '5-7', evaluator: { uid: 'u1', name: 'Ada' } },
      ],
    });

    const entry = scanOne('m1', data, 'u1');
    expect(entry.attended).toBe(true);
    expect(entry.rolesClaimed).toEqual(['toastmaster']);
    expect(entry.spoke).toBe(false);
    expect(entry.evaluatedSpeakerId).toBe('s1');
  });

  it('identifies when the given uid was the speaker, not the evaluator', () => {
    const data = snapshot({
      speakers: [{ id: 's1', uid: 'u1', name: 'Ada', title: 'T', level: 'L', timePref: '5-7', evaluator: null }],
    });
    const entry = scanOne('m1', data, 'u1');
    expect(entry.spoke).toBe(true);
    expect(entry.evaluatedSpeakerId).toBeNull();
  });

  it('reports nothing for a uid with no involvement', () => {
    const entry = scanOne('m1', snapshot(), 'stranger');
    expect(entry).toMatchObject({ attended: false, rolesClaimed: [], spoke: false, evaluatedSpeakerId: null });
  });
});
