import { describe, expect, it } from "vitest";
import {
  ERROR_SCENARIOS,
  pickHeadline,
  scenarioFromServerMessage,
  type ErrorScenario,
} from "./errorScenario";

const ALL: ErrorScenario[] = [
  "friend_left",
  "server_unreachable",
  "bad_code",
  "room_full",
  "handshake_failed",
];

describe("scenarioFromServerMessage", () => {
  it("maps the relay's room errors", () => {
    expect(scenarioFromServerMessage("Room not found")).toBe("bad_code");
    expect(scenarioFromServerMessage("Room is full")).toBe("room_full");
  });

  it("treats connection failures as server_unreachable", () => {
    expect(scenarioFromServerMessage("Relay connection error.")).toBe("server_unreachable");
    expect(scenarioFromServerMessage("Relay connection closed.")).toBe("server_unreachable");
    expect(scenarioFromServerMessage("Could not connect to the relay.")).toBe("server_unreachable");
    expect(scenarioFromServerMessage("Invalid message")).toBe("server_unreachable");
  });

  it("is case-insensitive", () => {
    expect(scenarioFromServerMessage("ROOM NOT FOUND")).toBe("bad_code");
    expect(scenarioFromServerMessage("room is FULL")).toBe("room_full");
  });
});

describe("pickHeadline", () => {
  it("returns the first line at rand 0 and the last just under 1", () => {
    for (const scenario of ALL) {
      const { lines } = ERROR_SCENARIOS[scenario];
      expect(pickHeadline(scenario, 0)).toBe(lines[0]);
      expect(pickHeadline(scenario, 0.999)).toBe(lines[lines.length - 1]);
    }
  });

  it("clamps rand === 1 to the last line (never out of range)", () => {
    for (const scenario of ALL) {
      const { lines } = ERROR_SCENARIOS[scenario];
      expect(pickHeadline(scenario, 1)).toBe(lines[lines.length - 1]);
    }
  });

  it("only ever returns a headline from the scenario's own pool", () => {
    for (const scenario of ALL) {
      const { lines } = ERROR_SCENARIOS[scenario];
      for (const rand of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(lines).toContain(pickHeadline(scenario, rand));
      }
    }
  });
});

describe("ERROR_SCENARIOS", () => {
  it("has a non-empty label and pool for every scenario", () => {
    for (const scenario of ALL) {
      expect(ERROR_SCENARIOS[scenario].label.length).toBeGreaterThan(0);
      expect(ERROR_SCENARIOS[scenario].lines.length).toBeGreaterThan(0);
    }
  });
});
