import { describe, expect, it } from "vitest";
import { isSessionFocused } from "./chatFocus";

describe("isSessionFocused", () => {
  it("is focused when active and the window has focus", () => {
    expect(isSessionFocused({ isActive: true, windowFocused: true })).toBe(true);
  });

  it("is not focused when not the active chat, even if the window has focus", () => {
    expect(isSessionFocused({ isActive: false, windowFocused: true })).toBe(false);
  });

  it("is not focused when the window itself doesn't have focus", () => {
    expect(isSessionFocused({ isActive: true, windowFocused: false })).toBe(false);
  });

  it("is not focused when neither condition holds", () => {
    expect(isSessionFocused({ isActive: false, windowFocused: false })).toBe(false);
  });
});
