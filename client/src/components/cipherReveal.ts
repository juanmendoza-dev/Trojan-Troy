// Pure timing helper for the "decrypt-in" message reveal. Given how long the
// reveal has been running and the message length, it returns how many leading
// characters have locked into their real value; the rest render as shimmering
// cipher noise. Kept pure (no DOM) so it can be unit-tested — the rAF/DOM side
// lives in CipherText.

export const CIPHER_REVEAL_MS = 420;

export function lockedCharCount(
  elapsedMs: number,
  totalChars: number,
  durationMs: number = CIPHER_REVEAL_MS
): number {
  if (totalChars <= 0) return 0;
  if (elapsedMs <= 0) return 0;
  if (durationMs <= 0 || elapsedMs >= durationMs) return totalChars;
  const revealed = Math.floor((elapsedMs / durationMs) * totalChars);
  return Math.min(totalChars, Math.max(0, revealed));
}
