import { describe, it, expect } from 'vitest';
import { defaultAgenda } from './default-agenda';
import { CommitteeMember } from '../models/agenda.models';

function nextIdCounter() {
  let n = 0;
  return () => ++n;
}

describe('defaultAgenda', () => {
  it('assigns sequential ids via the provided nextId callback', () => {
    const items = defaultAgenda([], nextIdCounter());
    const ids = items.map((i) => i.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('seeds President/Secretary/VPE names from the committee array when present', () => {
    const cmt: CommitteeMember[] = [
      { role: 'President', name: 'Ada', email: '', phone: '' },
      { role: 'Secretary', name: 'Grace', email: '', phone: '' },
      { role: 'VP Education', name: 'Alan', email: '', phone: '' },
    ];
    const items = defaultAgenda(cmt, nextIdCounter());
    const welcome = items.find((i) => i.type === 'row' && i.title === 'Welcome');
    const callToOrder = items.find((i) => i.type === 'row' && i.title === 'Call to order');
    const programme = items.find((i) => i.type === 'row' && i.title === 'Programme Information');

    expect(welcome && 'person' in welcome ? welcome.person : undefined).toBe('Ada');
    expect(callToOrder && 'person' in callToOrder ? callToOrder.person : undefined).toBe('Grace');
    expect(programme && 'person' in programme ? programme.person : undefined).toBe('Alan');
  });

  it('falls back to empty person strings when committee members are unnamed', () => {
    const items = defaultAgenda([], nextIdCounter());
    const welcome = items.find((i) => i.type === 'row' && i.title === 'Welcome');
    expect(welcome && 'person' in welcome ? welcome.person : undefined).toBe('');
  });

  it('produces the expected item count and ordering', () => {
    const items = defaultAgenda([], nextIdCounter());
    expect(items.length).toBe(22);
    expect(items[0].type).toBe('row');
    expect(items[8].type).toBe('dual');
    expect(items[9].type).toBe('speakers');
    expect(items[13].type).toBe('evaluators');
    expect(items[items.length - 1].type).toBe('row');
  });
});
