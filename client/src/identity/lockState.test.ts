import { describe, it, expect } from "vitest";
import { shouldRelock, DEFAULT_LOCK_TIMEOUT_MS } from "./lockState";

describe("lockState", () => {
  it("does not re-lock within the timeout", () => {
    expect(shouldRelock(1000, 1000 + 60_000, DEFAULT_LOCK_TIMEOUT_MS)).toBe(false);
  });

  it("re-locks once the idle gap reaches the timeout", () => {
    expect(shouldRelock(1000, 1000 + DEFAULT_LOCK_TIMEOUT_MS, DEFAULT_LOCK_TIMEOUT_MS)).toBe(true);
  });

  it("treats fresh activity as not-yet-locked", () => {
    const now = 10_000;
    expect(shouldRelock(now, now, DEFAULT_LOCK_TIMEOUT_MS)).toBe(false);
  });
});
