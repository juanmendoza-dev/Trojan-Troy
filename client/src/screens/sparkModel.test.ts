import { describe, expect, it } from "vitest";
import { MAX_PARTICLES, sampleTrailColor, sparkCountForFrame } from "./sparkModel";

describe("sampleTrailColor", () => {
  it("returns the first stop at 0", () => {
    expect(sampleTrailColor(0)).toEqual({ r: 255, g: 107, b: 107 });
  });

  it("returns the last stop at 1", () => {
    expect(sampleTrailColor(1)).toEqual({ r: 196, g: 143, b: 255 });
  });

  it("returns the middle stop at 0.5", () => {
    expect(sampleTrailColor(0.5)).toEqual({ r: 126, g: 217, b: 183 });
  });

  it("clamps out-of-range input to the endpoints", () => {
    expect(sampleTrailColor(-1)).toEqual({ r: 255, g: 107, b: 107 });
    expect(sampleTrailColor(2)).toEqual({ r: 196, g: 143, b: 255 });
  });

  it("interpolates between adjacent stops", () => {
    // 0.125 is halfway between stop 0 and stop 1
    expect(sampleTrailColor(0.125)).toEqual({ r: 255, g: 152, b: 109 });
  });
});

describe("sparkCountForFrame", () => {
  it("emits nothing when stationary or moving left", () => {
    expect(sparkCountForFrame({ velocity: 0, progress: 1, poolSize: 0 })).toBe(0);
    expect(sparkCountForFrame({ velocity: -0.8, progress: 1, poolSize: 0 })).toBe(0);
  });

  it("scales up with velocity", () => {
    const slow = sparkCountForFrame({ velocity: 0.3, progress: 0.5, poolSize: 0 });
    const fast = sparkCountForFrame({ velocity: 1.2, progress: 0.5, poolSize: 0 });
    expect(fast).toBeGreaterThan(slow);
  });

  it("scales up with progress", () => {
    const early = sparkCountForFrame({ velocity: 1.2, progress: 0, poolSize: 0 });
    const late = sparkCountForFrame({ velocity: 1.2, progress: 1, poolSize: 0 });
    expect(late).toBeGreaterThan(early);
  });

  it("caps the velocity factor — faster than V_MAX doesn't emit more", () => {
    const atMax = sparkCountForFrame({ velocity: 1.2, progress: 1, poolSize: 0 });
    const overMax = sparkCountForFrame({ velocity: 10, progress: 1, poolSize: 0 });
    expect(overMax).toBe(atMax);
  });

  it("never exceeds the remaining pool headroom", () => {
    expect(sparkCountForFrame({ velocity: 5, progress: 1, poolSize: MAX_PARTICLES - 2 })).toBe(2);
  });

  it("emits nothing when the pool is full", () => {
    expect(sparkCountForFrame({ velocity: 5, progress: 1, poolSize: MAX_PARTICLES })).toBe(0);
  });
});
