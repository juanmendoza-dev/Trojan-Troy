// Pure cadence decisions for cover traffic (see the traffic-analysis spec).
// The timer, randomness source, and actual sends live in App.tsx; this module
// holds only testable decisions, matching presenceState.ts / readAckDecision.ts.

export type CoverAction = "flush-real" | "cover" | "wait";

// ~1 frame/sec baseline with +/-40% jitter. The floor guards against a
// misconfigured tiny interval approaching the relay's rate cap.
export const COVER_INTERVAL_MS = 1500;
export const COVER_JITTER_FRAC = 0.4;
export const COVER_INTERVAL_FLOOR_MS = 500;

export interface CoverInput {
  now: number;
  lastContentSentAt: number;
  hasQueuedReal: boolean;
  interval: number;
}

// Zero-latency model uses only "cover"/"wait" (real sends fire immediately, so
// hasQueuedReal is always false). "flush-real" supports the optional strict
// constant-rate model (off by default).
export function nextAction(input: CoverInput): CoverAction {
  if (input.hasQueuedReal) return "flush-real";
  if (input.now - input.lastContentSentAt >= input.interval) return "cover";
  return "wait";
}

export function jitteredInterval(base: number, jitterFrac: number, rand: () => number): number {
  const delta = (rand() * 2 - 1) * jitterFrac; // [-jitterFrac, +jitterFrac)
  return Math.max(COVER_INTERVAL_FLOOR_MS, Math.round(base * (1 + delta)));
}

// Pick a cover-body byte length so the padded frame lands in a bucket real
// content actually uses. Real c:0 text is ALWAYS >= 256: its id is a 36-char
// UUID, so meta alone (~63B) overflows the 64 bucket. Only the once-per-session
// primer lands in 64 — so cover must NEVER use 64, or a size-aware relay flags
// the steady 64-bucket stream as decoy on sight. Modal 256 (like a typical
// short text), occasional 1024 (a longer one). Ranges are overhead-aware for
// the "cover" channel's ~34B frame header so bucketFor lands where intended.
export function coverBodyLen(rand: () => number): number {
  if (rand() < 0.8) return 31 + Math.floor(rand() * 192); // 31..222 -> 256 bucket
  return 223 + Math.floor(rand() * 768); // 223..990 -> 1024 bucket
}
