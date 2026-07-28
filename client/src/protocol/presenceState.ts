// Pure presence-signal logic for the typing/recording indicator. The timer/DOM
// and crypto wiring live in App.tsx and PresenceIndicator.tsx; this module holds
// only the pure decisions so they can be unit-tested, matching messageStatus.ts
// and readAckDecision.ts.

export type PresenceState = "idle" | "typing" | "recording";

// How often an ongoing activity re-broadcasts while it continues. Deliberately
// shorter than PRESENCE_EXPIRY_MS so the peer's indicator never flickers off
// mid-activity if a single heartbeat is dropped.
export const PRESENCE_HEARTBEAT_MS = 2500;

// How long the receiver keeps showing an indicator after the last event before
// auto-clearing it — a safety net for a dropped "idle"/stop event.
export const PRESENCE_EXPIRY_MS = 5000;

// +/- jitter on the heartbeat so presence resends don't tick like a metronome
// (a weak timing fingerprint). Bounded so the max stays below
// PRESENCE_EXPIRY_MS — the peer's indicator must never flicker off between beats.
export const PRESENCE_HEARTBEAT_JITTER_FRAC = 0.3;

export function jitteredHeartbeatMs(rand: () => number): number {
  const delta = (rand() * 2 - 1) * PRESENCE_HEARTBEAT_JITTER_FRAC;
  return Math.round(PRESENCE_HEARTBEAT_MS * (1 + delta));
}

export interface PresenceSendInput {
  nextState: PresenceState;
  lastSentState: PresenceState;
  lastSentAt: number;
  now: number;
  ghostMode: boolean;
  /** Overrides PRESENCE_HEARTBEAT_MS for this check (caller passes a jittered value). */
  heartbeatMs?: number;
}

// Whether the sender should emit a presence event right now. Ghost Mode
// suppresses everything; a state change sends immediately; an unchanged active
// state re-sends only once per heartbeat interval; idle never heartbeats.
export function shouldSendPresence(input: PresenceSendInput): boolean {
  if (input.ghostMode) return false;
  if (input.nextState !== input.lastSentState) return true;
  if (input.nextState === "idle") return false;
  return input.now - input.lastSentAt >= (input.heartbeatMs ?? PRESENCE_HEARTBEAT_MS);
}

// Defensive parse of a decrypted presence payload's state field — anything
// unrecognized is dropped (null), like RelayClient's malformed-message handling.
export function parsePresenceState(raw: unknown): PresenceState | null {
  return raw === "idle" || raw === "typing" || raw === "recording" ? raw : null;
}
