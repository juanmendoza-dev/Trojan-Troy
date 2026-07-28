import { describe, it, expect } from "vitest";
import {
  shouldOffer,
  jitteredRekeyInterval,
  nextOfferId,
  PQ_REKEY_INTERVAL_MS,
  PQ_REKEY_JITTER_FRAC,
  PQ_REKEY_MESSAGES,
  PQ_REKEY_FLOOR_MS,
  MAX_OFFER_ID,
} from "./pqRekey";

const base = {
  now: 100_000,
  lastOfferAt: 100_000 - PQ_REKEY_INTERVAL_MS,
  contentSentSinceOffer: 0,
  interval: PQ_REKEY_INTERVAL_MS,
};

describe("pqRekey", () => {
  it("offers once the interval has elapsed", () => {
    expect(shouldOffer(base)).toBe(true);
  });

  it("waits while the interval has not elapsed", () => {
    expect(shouldOffer({ ...base, lastOfferAt: base.now - PQ_REKEY_INTERVAL_MS / 2 })).toBe(false);
  });

  it("offers early on message volume", () => {
    expect(
      shouldOffer({
        ...base,
        lastOfferAt: base.now - PQ_REKEY_INTERVAL_MS / 2,
        contentSentSinceOffer: PQ_REKEY_MESSAGES,
      })
    ).toBe(true);
  });

  it("respects the floor even when the volume trigger fires", () => {
    expect(
      shouldOffer({
        ...base,
        lastOfferAt: base.now - (PQ_REKEY_FLOOR_MS - 1),
        contentSentSinceOffer: PQ_REKEY_MESSAGES * 10,
      })
    ).toBe(false);
  });

  it("respects the floor even when a tiny interval is configured", () => {
    expect(
      shouldOffer({ ...base, lastOfferAt: base.now - 100, interval: 10 })
    ).toBe(false);
  });

  it("jitters within bounds and never below the floor", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const out = jitteredRekeyInterval(PQ_REKEY_INTERVAL_MS, PQ_REKEY_JITTER_FRAC, () => r);
      expect(out).toBeGreaterThanOrEqual(PQ_REKEY_INTERVAL_MS * (1 - PQ_REKEY_JITTER_FRAC) - 1);
      expect(out).toBeLessThanOrEqual(PQ_REKEY_INTERVAL_MS * (1 + PQ_REKEY_JITTER_FRAC) + 1);
    }
    // A base under the floor is clamped up, not honoured.
    expect(jitteredRekeyInterval(100, 0.3, () => 0)).toBe(PQ_REKEY_FLOOR_MS);
  });

  it("jitter is actually applied (not a constant)", () => {
    const low = jitteredRekeyInterval(PQ_REKEY_INTERVAL_MS, PQ_REKEY_JITTER_FRAC, () => 0);
    const high = jitteredRekeyInterval(PQ_REKEY_INTERVAL_MS, PQ_REKEY_JITTER_FRAC, () => 0.999);
    expect(low).toBeLessThan(high);
  });

  it("offer ids advance monotonically and wrap past a u16 without hitting 0", () => {
    expect(nextOfferId(0)).toBe(1);
    expect(nextOfferId(1)).toBe(2);
    expect(nextOfferId(MAX_OFFER_ID - 1)).toBe(MAX_OFFER_ID);
    expect(nextOfferId(MAX_OFFER_ID)).toBe(1);
  });
});
