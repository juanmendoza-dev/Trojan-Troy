// Pure timing helpers for the "decrypt-in" message reveal. Given how long the
// reveal has been running and the message length, `lockedCharCount` returns how
// many leading characters have locked into their real value; the rest render as
// shimmering cipher noise. Kept pure (no DOM) so it can be unit-tested — the
// rAF/DOM side lives in CipherText.

// Fallback reveal duration. A calm ~1.5s reads as "decrypting" rather than a
// flicker; CipherText normally uses the length-adaptive value below.
export const CIPHER_REVEAL_MS = 1500;

// How often the unlocked tail re-randomizes. Deliberately slower than a frame so
// the scramble reads as intentional "cipher flips" instead of 60fps noise; the
// lock front itself still advances every frame for a smooth reveal.
export const CIPHER_SCRAMBLE_INTERVAL_MS = 45;

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

// Length-adaptive reveal duration: short messages resolve quickly, long ones
// take a little longer, both bounded so nothing feels instant or sluggish.
export function cipherRevealDuration(textLength: number): number {
  const ms = 700 + textLength * 22;
  return Math.max(700, Math.min(2400, ms));
}
