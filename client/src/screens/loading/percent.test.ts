import { describe, expect, it } from "vitest";
import { percentAt } from "./percent";

describe("percentAt", () => {
  it("is 0 at the start", () => {
    expect(percentAt(0, 2600)).toBe(0);
  });

  it("hits the mockup's keyframe stops", () => {
    expect(percentAt(2600 * 0.45, 2600)).toBeCloseTo(62, 0);
    expect(percentAt(2600 * 0.7, 2600)).toBeCloseTo(88, 0);
    expect(percentAt(2600 * 0.92, 2600)).toBeCloseTo(100, 0);
  });

  it("clamps to 100 past the end and never exceeds it", () => {
    expect(percentAt(2600, 2600)).toBe(100);
    expect(percentAt(5000, 2600)).toBe(100);
  });

  it("clamps to 0 for negative elapsed time", () => {
    expect(percentAt(-10, 2600)).toBe(0);
  });
});
