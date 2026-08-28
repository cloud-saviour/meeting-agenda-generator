import { describe, it, expect } from 'vitest';
import { computeAgendaTimeline } from './agenda-timeline';
import { AgendaItem, Speaker } from '../models/agenda.models';

function row(id: number, duration: number): AgendaItem {
  return { id, type: 'row', title: `Item ${id}`, person: '', roleLabel: null, duration };
}

function speaker(timeHi: number): Speaker {
  return { id: 1, name: 'Speaker', level: '', timeLo: 5, timeHi, title: '', evaluator: '' };
}

describe('computeAgendaTimeline', () => {
  it('advances the clock by each row/recess item duration in order', () => {
    const items: AgendaItem[] = [row(1, 5), row(2, 10)];
    const timeline = computeAgendaTimeline(items, [], '18:00');
    expect(timeline[0]).toEqual({ kind: 'row', time: '18h00' });
    expect(timeline[1]).toEqual({ kind: 'row', time: '18h05' });
  });

  it('dual item emits two times and advances the clock by the sum of speaker timeHi+2, plus an extra +1 minute', () => {
    const items: AgendaItem[] = [
      { id: 1, type: 'dual', durationA: 10, items: [
        { title: 'A', person: '', roleLabel: null },
        { title: 'B', person: '', roleLabel: null },
      ] },
      row(2, 0),
    ];
    const spks = [speaker(7), speaker(5)];
    const timeline = computeAgendaTimeline(items, spks, '18:00');
    expect(timeline[0]).toEqual({ kind: 'dual', timeA: '18h00', timeB: '18h10' });
    // clock after dual: 18:10 + (7+2) + (5+2) + 1 = 18:10 + 17 = 18:27
    expect(timeline[1]).toEqual({ kind: 'row', time: '18h27' });
  });

  it('evaluators item advances the clock by 4 minutes per speaker', () => {
    const items: AgendaItem[] = [{ id: 1, type: 'evaluators' }, row(2, 0)];
    const timeline = computeAgendaTimeline(items, [speaker(7), speaker(7), speaker(7)], '18:00');
    expect(timeline[0]).toEqual({ kind: 'evaluators' });
    expect(timeline[1]).toEqual({ kind: 'row', time: '18h12' });
  });

  it('evaluators item with zero speakers does not advance the clock', () => {
    const items: AgendaItem[] = [{ id: 1, type: 'evaluators' }, row(2, 0)];
    const timeline = computeAgendaTimeline(items, [], '18:00');
    expect(timeline[1]).toEqual({ kind: 'row', time: '18h00' });
  });

  it('speakers item does not advance the clock', () => {
    const items: AgendaItem[] = [{ id: 1, type: 'speakers' }, row(2, 0)];
    const timeline = computeAgendaTimeline(items, [speaker(7)], '18:00');
    expect(timeline[0]).toEqual({ kind: 'speakers' });
    expect(timeline[1]).toEqual({ kind: 'row', time: '18h00' });
  });

  it('notes item does not advance the clock', () => {
    const items: AgendaItem[] = [{ id: 1, type: 'notes', text: 'hello' }, row(2, 0)];
    const timeline = computeAgendaTimeline(items, [], '18:00');
    expect(timeline[0]).toEqual({ kind: 'notes' });
    expect(timeline[1]).toEqual({ kind: 'row', time: '18h00' });
  });

  it('defaults the start time to 18:15 when unset', () => {
    const timeline = computeAgendaTimeline([row(1, 0)], [], '');
    expect(timeline[0]).toEqual({ kind: 'row', time: '18h15' });
  });

  it('produces the expected sequence for a representative mixed agenda (golden regression)', () => {
    const items: AgendaItem[] = [
      row(1, 2),
      row(2, 3),
      { id: 3, type: 'dual', durationA: 10, items: [
        { title: 'Impromptu', person: '', roleLabel: null },
        { title: 'Prepared',  person: '', roleLabel: null },
      ] },
      { id: 4, type: 'speakers' },
      { id: 5, type: 'recess', title: 'Recess', duration: 15 },
      { id: 6, type: 'evaluators' },
      row(7, 2),
    ];
    const spks = [speaker(7), speaker(10)];
    const timeline = computeAgendaTimeline(items, spks, '18:15');

    // Manually traced clock, starting at 18:15 (1095 + 15 = 1110... see below, using minutes-since-midnight):
    //  row(1,2):     tick -> "18h15", t: 1095 -> 1097
    //  row(2,3):     tick -> "18h17", t: 1097 -> 1100
    //  dual(10):     tA "18h20" (t->1110), tB "18h30", then t += (7+2)+(10+2)+1 = 22 -> t=1132
    //  speakers:     no change, t=1132
    //  recess(15):   tick -> "18h52", t: 1132 -> 1147
    //  evaluators:   t += 4*2 = 8 -> t=1155
    //  row(7,2):     tick -> "19h15", t: 1155 -> 1157
    expect(timeline).toEqual([
      { kind: 'row', time: '18h15' },
      { kind: 'row', time: '18h17' },
      { kind: 'dual', timeA: '18h20', timeB: '18h30' },
      { kind: 'speakers' },
      { kind: 'row', time: '18h52' },
      { kind: 'evaluators' },
      { kind: 'row', time: '19h15' },
    ]);
  });
});
