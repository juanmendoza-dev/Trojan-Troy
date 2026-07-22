// Pure content + mapping for the error screen (see ErrorScreen.tsx).
//
// The scenarios, status labels, and headline pools come straight from the
// Fable error-screen handoff ("Trojan Troy - Error Screen.html"). The screen
// picks one headline at random from the matching pool; everything here is pure
// so it can be unit-tested, in the spirit of barPhases.ts / sparkModel.ts.

export type ErrorScenario =
  | "friend_left"
  | "server_unreachable"
  | "bad_code"
  | "room_full"
  | "handshake_failed"
  | "not_a_contact";

export interface ScenarioContent {
  /** Uppercase mono label above the headline. */
  label: string;
  /** Headline pool — one is picked at random when the screen mounts. */
  lines: string[];
}

export const ERROR_SCENARIOS: Record<ErrorScenario, ScenarioContent> = {
  friend_left: {
    label: "peer disconnected",
    lines: [
      "They left. You're on the island now.",
      "Your friend swam for it.",
      "Gone. Probably somewhere with better wifi.",
      "They logged off to touch actual sand.",
      "Connection severed. Coconut acquired.",
    ],
  },
  server_unreachable: {
    label: "relay unreachable",
    lines: [
      "The relay's on a break. Very tropical of it.",
      "Server's not picking up. Bold of it.",
      "Couldn't reach the relay. It's napping.",
    ],
  },
  bad_code: {
    label: "room not found",
    lines: ["That room code? Fictional.", "No such room. You made it up.", "That code leads nowhere. Nice try."],
  },
  room_full: {
    label: "room full",
    lines: ["Room's full. This island seats two.", "Two's company. That room's already company."],
  },
  handshake_failed: {
    label: "handshake failed",
    lines: ["The handshake fell apart. Awkward.", "Couldn't agree on a secret. Trust issues."],
  },
  not_a_contact: {
    label: "connection refused",
    lines: [
      "Contacts-only mode is on — that key isn't one you've verified.",
      "Unknown key. You're only letting verified contacts in right now.",
      "Not on your list. The door stayed shut.",
    ],
  },
};

// The relay reports failures as short human strings — the server's
// "Room not found" / "Room is full" (rooms.ts) and the client's own
// "Relay connection …" messages (relayClient.ts). Match on those to pick a
// scenario; anything else is treated as a relay-level problem. Substring +
// lower-case so a small wording change doesn't silently fall through.
export function scenarioFromServerMessage(message: string): ErrorScenario {
  const m = message.toLowerCase();
  if (m.includes("not found")) return "bad_code";
  if (m.includes("full")) return "room_full";
  return "server_unreachable";
}

// Pick a headline from the scenario's pool. `rand` is a 0..1 value (the caller
// passes Math.random()); clamped so rand === 1 stays in range.
export function pickHeadline(scenario: ErrorScenario, rand: number): string {
  const { lines } = ERROR_SCENARIOS[scenario];
  const i = Math.min(lines.length - 1, Math.max(0, Math.floor(rand * lines.length)));
  return lines[i];
}
