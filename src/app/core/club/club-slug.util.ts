/** Mirrors firestore.rules' clubs/clubSlugs create rule: lowercase letters/digits joined by single hyphens, at most 40 characters. */
export const CLUB_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CLUB_SLUG_MAX_LENGTH = 40;

export function isValidClubSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= CLUB_SLUG_MAX_LENGTH && CLUB_SLUG_PATTERN.test(slug);
}

/** Suggests a slug from a club name: strips accents, lowercases, collapses anything non-alphanumeric to single hyphens. */
export function suggestClubSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CLUB_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}
