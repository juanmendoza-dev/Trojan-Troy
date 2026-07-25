import { describe, expect, it } from "vitest";
import { deviceFromUserAgent } from "./device";

describe("deviceFromUserAgent", () => {
  it("trusts the UA-Client-Hints mobile flag when present", () => {
    expect(deviceFromUserAgent("anything", true)).toBe("phone");
    expect(deviceFromUserAgent("iPhone lies here", false)).toBe("computer");
  });

  it("falls back to a user-agent sniff", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("phone");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("phone");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("computer");
    expect(deviceFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("computer");
  });
});
