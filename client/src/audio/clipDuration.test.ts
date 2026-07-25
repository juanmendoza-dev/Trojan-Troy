import { describe, expect, it } from "vitest";
import { formatClipDuration } from "./clipDuration";

describe("formatClipDuration", () => {
  it("formats sub-minute durations as m:ss", () => {
    expect(formatClipDuration(5_000)).toBe("0:05");
    expect(formatClipDuration(23_000)).toBe("0:23");
  });

  it("formats durations over a minute", () => {
    expect(formatClipDuration(75_000)).toBe("1:15");
    expect(formatClipDuration(600_000)).toBe("10:00");
  });

  it("rounds to the nearest second", () => {
    expect(formatClipDuration(5_400)).toBe("0:05");
    expect(formatClipDuration(5_600)).toBe("0:06");
  });

  it("treats zero, negative, NaN, and Infinity as 0:00", () => {
    expect(formatClipDuration(0)).toBe("0:00");
    expect(formatClipDuration(-1_000)).toBe("0:00");
    expect(formatClipDuration(Number.NaN)).toBe("0:00");
    expect(formatClipDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
