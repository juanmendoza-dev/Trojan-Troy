// client/src/net/inviteLink.ts

/**
 * Build the shareable invite link for a room, e.g.
 * "https://troy.app/#K7F-2QX". Origin and pathname are passed in (rather than
 * read from `window.location` in here) so this stays pure and testable — the
 * caller hands in the current location. Works unchanged on localhost and the
 * deployed URL.
 */
export function buildInviteLink(origin: string, pathname: string, code: string): string {
  return `${origin}${pathname}#${code}`;
}

/**
 * Pull a room code out of a URL hash, e.g. "#K7F-2QX" → "K7F-2QX". Normalized
 * the same way the join form normalizes typed input (trim + uppercase).
 * Returns null when there's no usable code. The format isn't validated here —
 * the relay rejects bad codes via its existing `error` envelope.
 */
export function parseInviteCode(hash: string): string | null {
  const code = hash.replace(/^#/, "").trim().toUpperCase();
  return code.length > 0 ? code : null;
}
