import { describe, expect, it } from "vitest";
import { shouldSendPresence, parsePresenceState, PRESENCE_HEARTBEAT_MS } from "./presenceState";

describe("shouldSendPresence", () => {
  const base = { lastSentState: "idle" as const, lastSentAt: 0, now: 0, ghostMode: false };

  it("sends immediately when the state changes (idle → typing)", () => {
    expect(shouldSendPresence({ ...base, nextState: "typing", now: 100 })).toBe(true);
  });

  it("sends immediately when switching activities (typing → recording)", () => {
    expect(
      shouldSendPresence({ ...base, nextState: "recording", lastSentState: "typing", now: 100 })
    ).toBe(true);
  });

  it("sends the stop (typing → idle)", () => {
    expect(
      shouldSendPresence({ ...base, nextState: "idle", lastSentState: "typing", now: 100 })
    ).toBe(true);
  });

  it("throttles an unchanged active state within the heartbeat interval", () => {
    expect(
      shouldSendPresence({
        ...base,
        nextState: "typing",
        lastSentState: "typing",
        lastSentAt: 0,
        now: PRESENCE_HEARTBEAT_MS - 1,
      })
    ).toBe(false);
  });

  it("re-sends an unchanged active state once the heartbeat interval elapses", () => {
    expect(
      shouldSendPresence({
        ...base,
        nextState: "typing",
        lastSentState: "typing",
        lastSentAt: 0,
        now: PRESENCE_HEARTBEAT_MS,
      })
    ).toBe(true);
  });

  it("never heartbeats an unchanged idle state", () => {
    expect(
      shouldSendPresence({
        ...base,
        nextState: "idle",
        lastSentState: "idle",
        now: PRESENCE_HEARTBEAT_MS * 10,
      })
    ).toBe(false);
  });

  it("suppresses everything when ghost mode is on, even a state change", () => {
    expect(shouldSendPresence({ ...base, nextState: "typing", ghostMode: true, now: 100 })).toBe(
      false
    );
  });
});

describe("parsePresenceState", () => {
  it("accepts the three known states", () => {
    expect(parsePresenceState("idle")).toBe("idle");
    expect(parsePresenceState("typing")).toBe("typing");
    expect(parsePresenceState("recording")).toBe("recording");
  });

  it("rejects anything unrecognized", () => {
    expect(parsePresenceState("typo")).toBeNull();
    expect(parsePresenceState(undefined)).toBeNull();
    expect(parsePresenceState(null)).toBeNull();
    expect(parsePresenceState(42)).toBeNull();
    expect(parsePresenceState({ state: "typing" })).toBeNull();
  });
});
