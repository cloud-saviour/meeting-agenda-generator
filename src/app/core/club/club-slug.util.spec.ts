import { describe, expect, it } from 'vitest';
import { CLUB_SLUG_MAX_LENGTH, isValidClubSlug, suggestClubSlug } from './club-slug.util';

describe('suggestClubSlug', () => {
  it('lowercases and hyphenates a normal name', () => {
    expect(suggestClubSlug('Sandton Speakers Club')).toBe('sandton-speakers-club');
  });

  it('strips accents and punctuation, and collapses repeats', () => {
    expect(suggestClubSlug("  Café  --  King's & Queens!  ")).toBe('cafe-king-s-queens');
  });

  it('never ends or starts with a hyphen, even when truncated', () => {
    const slug = suggestClubSlug('a'.repeat(CLUB_SLUG_MAX_LENGTH - 1) + ' b');
    expect(slug.length).toBeLessThanOrEqual(CLUB_SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('returns an empty string for a name with no usable characters', () => {
    expect(suggestClubSlug('!!!')).toBe('');
  });
});

describe('isValidClubSlug', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    expect(isValidClubSlug('club-b')).toBe(true);
    expect(isValidClubSlug('kings-speakers-12')).toBe(true);
  });

  it('rejects uppercase, spaces, doubled/edge hyphens, empty and over-long slugs', () => {
    for (const bad of ['Club', 'my club', 'a--b', '-a', 'a-', '', 'a'.repeat(CLUB_SLUG_MAX_LENGTH + 1)]) {
      expect(isValidClubSlug(bad)).toBe(false);
    }
  });
});
