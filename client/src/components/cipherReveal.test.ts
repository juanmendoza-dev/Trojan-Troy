import { describe, expect, it } from "vitest";
import { lockedCharCount, cipherRevealDuration, CIPHER_REVEAL_MS } from "./cipherReveal";

describe("lockedCharCount", () => {
  it("locks nothing at the start", () => {
    expect(lockedCharCount(0, 10)).toBe(0);
    expect(lockedCharCount(-50, 10)).toBe(0);
  });

  it("locks everything once the duration elapses", () => {
    expect(lockedCharCount(CIPHER_REVEAL_MS, 10)).toBe(10);
    expect(lockedCharCount(CIPHER_REVEAL_MS + 200, 10)).toBe(10);
  });

  it("reveals left-to-right proportionally", () => {
    expect(lockedCharCount(CIPHER_REVEAL_MS / 2, 10)).toBe(5);
    expect(lockedCharCount(CIPHER_REVEAL_MS / 4, 8)).toBe(2);
  });

  it("never exceeds the total length", () => {
    expect(lockedCharCount(CIPHER_REVEAL_MS * 10, 4)).toBe(4);
  });

  it("handles empty text and non-positive durations", () => {
    expect(lockedCharCount(100, 0)).toBe(0);
    expect(lockedCharCount(100, 10, 0)).toBe(10);
  });
});

describe("cipherRevealDuration", () => {
  it("holds a calm minimum for short messages", () => {
    expect(cipherRevealDuration(0)).toBe(700);
    expect(cipherRevealDuration(3)).toBeGreaterThanOrEqual(700);
  });

  it("grows with message length", () => {
    expect(cipherRevealDuration(40)).toBeGreaterThan(cipherRevealDuration(5));
  });

  it("caps long messages so they never drag on", () => {
    expect(cipherRevealDuration(10000)).toBe(2400);
  });
});
