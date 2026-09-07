/**
 * SHA-256 hex digest via the Web Crypto API — used to turn an anonymous
 * check-in's email into a stable, deterministic uid (same email → same
 * uid, every visit, any device) without ever storing the raw email on the
 * fully-public `checkins/{meetingId}` document. See CheckinStateService.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
