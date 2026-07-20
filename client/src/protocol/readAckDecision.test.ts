import { describe, expect, it } from "vitest";
import { shouldSendReadAck } from "./readAckDecision";

describe("shouldSendReadAck", () => {
  it("sends when focused, visible, not ghost mode, not already acked", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: true, ghostMode: false, alreadyAcked: false })
    ).toBe(true);
  });

  it("does not send when the tab is not focused", () => {
    expect(
      shouldSendReadAck({ isFocused: false, isVisible: true, ghostMode: false, alreadyAcked: false })
    ).toBe(false);
  });

  it("does not send when the tab is not visible", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: false, ghostMode: false, alreadyAcked: false })
    ).toBe(false);
  });

  it("does not send when ghost mode is on, even if focused and visible", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: true, ghostMode: true, alreadyAcked: false })
    ).toBe(false);
  });

  it("does not send when already acked", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: true, ghostMode: false, alreadyAcked: true })
    ).toBe(false);
  });
});
