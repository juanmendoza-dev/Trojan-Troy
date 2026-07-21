import { describe, expect, it } from "vitest";
import {
  barHeightPx,
  barVisual,
  CONNECT_COMPLETE_HOLD_MS,
  COMPLETE_MS,
  EXIT_MS,
  HOLD_EASE,
  SETTLE_MS,
  SIGNATURE_EASE,
} from "./barPhases";

describe("barVisual", () => {
  it("is empty and instant while idle", () => {
    const v = barVisual("idle");
    expect(v.widthPct).toBe(0);
    expect(v.transitionMs).toBe(0);
    expect(v.sheen).toBe(false);
    expect(v.breathe).toBe(false);
    expect(v.settle).toBe(false);
  });

  it("surges fast toward ~82% on the signature ease", () => {
    const v = barVisual("surge");
    expect(v.widthPct).toBe(82);
    expect(v.easing).toBe(SIGNATURE_EASE);
    expect(v.sheen).toBe(false);
  });

  it("holds near the top with both alive layers on a slow creep ease", () => {
    const v = barVisual("hold");
    expect(v.widthPct).toBe(92);
    expect(v.widthPct).toBeLessThan(100);
    expect(v.easing).toBe(HOLD_EASE);
    expect(v.sheen).toBe(true);
    expect(v.breathe).toBe(true);
  });

  it("completes to 100% with the alive layers off", () => {
    const v = barVisual("complete");
    expect(v.widthPct).toBe(100);
    expect(v.sheen).toBe(false);
    expect(v.breathe).toBe(false);
    expect(v.settle).toBe(false);
  });

  it("stays at 100% and settles through settle and exit", () => {
    for (const phase of ["settle", "exit"] as const) {
      const v = barVisual(phase);
      expect(v.widthPct).toBe(100);
      expect(v.settle).toBe(true);
      expect(v.sheen).toBe(false);
    }
  });
});

describe("barHeightPx", () => {
  it("is 4px thin, 8px pill", () => {
    expect(barHeightPx("thin")).toBe(4);
    expect(barHeightPx("pill")).toBe(8);
  });
});

describe("CONNECT_COMPLETE_HOLD_MS", () => {
  it("covers the full complete + settle + exit sequence", () => {
    expect(CONNECT_COMPLETE_HOLD_MS).toBe(COMPLETE_MS + SETTLE_MS + EXIT_MS);
  });
});
