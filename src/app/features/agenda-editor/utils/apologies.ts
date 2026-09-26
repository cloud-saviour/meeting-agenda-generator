/**
 * The agenda stores apologies as ONE comma-separated string
 * (`MeetingData.apologies`) - that is what the preview and the DOCX print, and
 * what the check-in sync appends to and retracts from. The editor's
 * add/remove list is only a friendlier view over that same string, so nothing
 * stored or printed changes.
 */

/** The names in the stored string, in order (blank entries dropped). */
export function parseApologies(text: string): string[] {
  return text.split(',').map((n) => n.trim()).filter(Boolean);
}

/** Appends a name. A comma inside a name would split it into two, so it becomes a space. Duplicates (any case) are ignored. */
export function addApology(text: string, name: string): string {
  const clean = name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const names = parseApologies(text);
  if (!clean || names.some((n) => n.toLowerCase() === clean.toLowerCase())) return names.join(', ');
  return [...names, clean].join(', ');
}

/** Removes the name at `index` of `parseApologies(text)`. */
export function removeApology(text: string, index: number): string {
  return parseApologies(text).filter((_, i) => i !== index).join(', ');
}
