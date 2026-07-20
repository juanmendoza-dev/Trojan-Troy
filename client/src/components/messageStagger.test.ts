import { describe, expect, it } from "vitest";
import { staggerDelayMs } from "./messageStagger";

describe("staggerDelayMs", () => {
  it("returns 0 for the first message", () => {
    const messages = [{ timestamp: 1000 }];
    expect(staggerDelayMs(messages, 0)).toBe(0);
  });

  it("returns 0 when the previous message arrived long before (not a burst)", () => {
    const messages = [{ timestamp: 1000 }, { timestamp: 5000 }];
    expect(staggerDelayMs(messages, 1)).toBe(0);
  });

  it("stacks delay across consecutive rapid messages", () => {
    const messages = [{ timestamp: 1000 }, { timestamp: 1100 }, { timestamp: 1250 }];
    expect(staggerDelayMs(messages, 0)).toBe(0);
    expect(staggerDelayMs(messages, 1)).toBe(70);
    expect(staggerDelayMs(messages, 2)).toBe(140);
  });

  it("caps the delay at 280ms for long bursts", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ timestamp: i * 100 }));
    expect(staggerDelayMs(messages, 9)).toBe(280);
  });

  it("resets the burst after a gap even mid-conversation", () => {
    const messages = [{ timestamp: 0 }, { timestamp: 100 }, { timestamp: 5000 }, { timestamp: 5100 }];
    expect(staggerDelayMs(messages, 3)).toBe(70);
  });
});
