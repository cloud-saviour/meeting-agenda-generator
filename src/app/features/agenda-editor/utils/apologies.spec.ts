import { describe, expect, it } from 'vitest';
import { addApology, parseApologies, removeApology } from './apologies';

describe('apologies helpers', () => {
  it('parses a comma-separated string, trimming and dropping blanks', () => {
    expect(parseApologies(' Ann,Ben ,, Cy ')).toEqual(['Ann', 'Ben', 'Cy']);
    expect(parseApologies('')).toEqual([]);
  });

  it('adds a name, keeping the same comma-separated format', () => {
    expect(addApology('', 'Ann')).toBe('Ann');
    expect(addApology('Ann', '  Ben ')).toBe('Ann, Ben');
  });

  it('ignores a blank name or a duplicate (any case)', () => {
    expect(addApology('Ann', '   ')).toBe('Ann');
    expect(addApology('Ann', 'ann')).toBe('Ann');
  });

  it('turns a comma inside a name into a space so it stays one name', () => {
    expect(addApology('', 'Smith, John')).toBe('Smith John');
  });

  it('removes one name by position', () => {
    expect(removeApology('Ann, Ben, Cy', 1)).toBe('Ann, Cy');
    expect(removeApology('Ann', 0)).toBe('');
  });
});
