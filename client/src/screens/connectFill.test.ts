import { describe, expect, it } from "vitest";
import { connectingFill, CONNECT_FILL_CEILING } from "./connectFill";

describe("connectingFill", () => {
  it("starts at 0", () => {
    expect(connectingFill(0)).toBe(0);
  });

  it("clamps negative elapsed time to 0", () => {
    expect(connectingFill(-500)).toBe(0);
  });

  it("climbs fast to ~80% within the first ~1.1s", () => {
    expect(connectingFill(1100)).toBeCloseTo(80, 0);
    // Already well past halfway a few hundred ms in.
    expect(connectingFill(550)).toBeGreaterThan(55);
  });

  it("eases into the 85–92% hold band after the fast climb", () => {
    const midHold = connectingFill(6000);
    expect(midHold).toBeGreaterThanOrEqual(85);
    expect(midHold).toBeLessThan(CONNECT_FILL_CEILING);
  });

  it("never reaches the ceiling on its own, even on a ~60s cold start", () => {
    expect(connectingFill(60000)).toBeLessThan(CONNECT_FILL_CEILING);
    expect(connectingFill(60000)).toBeGreaterThan(90);
  });

  it("is monotonically increasing", () => {
    let prev = -1;
    for (let t = 0; t <= 60000; t += 250) {
      const v = connectingFill(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
