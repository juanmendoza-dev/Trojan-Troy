import { describe, expect, it } from "vitest";
import {
  nextAction,
  jitteredInterval,
  coverBodyLen,
  COVER_INTERVAL_MS,
  COVER_JITTER_FRAC,
  COVER_INTERVAL_FLOOR_MS,
} from "./coverTraffic";
import { frame } from "../crypto/framing";

describe("nextAction", () => {
  it("flushes a queued real message regardless of timing (strict model)", () => {
    expect(nextAction({ now: 0, lastContentSentAt: 0, hasQueuedReal: true, interval: 1500 })).toBe("flush-real");
  });
  it("emits cover once the interval has elapsed with nothing queued", () => {
    expect(nextAction({ now: 1500, lastContentSentAt: 0, hasQueuedReal: false, interval: 1500 })).toBe("cover");
  });
  it("waits before the interval elapses", () => {
    expect(nextAction({ now: 1499, lastContentSentAt: 0, hasQueuedReal: false, interval: 1500 })).toBe("wait");
  });
});

describe("jitteredInterval", () => {
  it("returns the base with no jitter at rand=0.5", () => {
    expect(jitteredInterval(COVER_INTERVAL_MS, COVER_JITTER_FRAC, () => 0.5)).toBe(COVER_INTERVAL_MS);
  });
  it("stays within +/- jitterFrac of the base across the rand range", () => {
    for (const r of [0, 0.1, 0.3, 0.6, 0.9, 0.999]) {
      const v = jitteredInterval(COVER_INTERVAL_MS, COVER_JITTER_FRAC, () => r);
      expect(v).toBeGreaterThanOrEqual(COVER_INTERVAL_MS * (1 - COVER_JITTER_FRAC) - 1);
      expect(v).toBeLessThanOrEqual(COVER_INTERVAL_MS * (1 + COVER_JITTER_FRAC) + 1);
    }
  });
  it("never returns below the floor (guards a misconfigured tiny base)", () => {
    expect(jitteredInterval(100, 0.9, () => 0)).toBe(COVER_INTERVAL_FLOOR_MS);
  });
});

describe("coverBodyLen", () => {
  it("lands only in buckets real content uses (>=256, never the 64 primer bucket)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const len = frame({ channel: "cover", id: "", body: new Uint8Array(coverBodyLen(Math.random)) }).length;
      // Real c:0 text is always >=256 (its 36-char UUID id overflows the 64
      // bucket), so cover must never land in 64 or it's size-classified as decoy.
      expect([256, 1024]).toContain(len);
      seen.add(len);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2); // varied, not pinned to one size
  });
});
