import { describe, expect, it } from "vitest";
import { canAddSession, MAX_CHAT_SESSIONS, nextSessionLabel } from "./chatSessions";

describe("canAddSession", () => {
  it("allows adding below the cap", () => {
    expect(canAddSession(0)).toBe(true);
    expect(canAddSession(MAX_CHAT_SESSIONS - 1)).toBe(true);
  });

  it("blocks adding at the cap", () => {
    expect(canAddSession(MAX_CHAT_SESSIONS)).toBe(false);
  });

  it("blocks adding above the cap", () => {
    expect(canAddSession(MAX_CHAT_SESSIONS + 1)).toBe(false);
  });
});

describe("nextSessionLabel", () => {
  it("labels by ordinal, not by current open count", () => {
    expect(nextSessionLabel(1)).toBe("Chat 1");
    expect(nextSessionLabel(7)).toBe("Chat 7");
  });
});
