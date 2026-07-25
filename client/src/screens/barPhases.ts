// Pure phase → visual mapping and timings for the home screen's connecting bar.
//
// The values come straight from the Fable home handoff's spec sheet
// ("Trojan Troy Home.dc.html" → "Handoff tokens & timings"). The bar is
// phase-driven with CSS width transitions, exactly like the handoff — there is
// no per-frame JS fill. Kept pure and colocated with a test in the spirit of
// loading/percent.ts.
//
// Phases: idle → surge → hold (alive while the relay wakes) → complete →
// settle → exit. The relay is on a free tier that sleeps, so a cold start can
// take up to ~60s; the bar holds "alive" near the top and only reaches 100%
// when the real connection event lands (App flips status to "connected").

export type BarPhase = "idle" | "surge" | "hold" | "complete" | "settle" | "exit";
export type BarVariant = "thin" | "pill";

export const SIGNATURE_EASE = "cubic-bezier(0.2, 0.9, 0.3, 1)";
export const HOLD_EASE = "cubic-bezier(0.05, 0.4, 0.2, 1)";

// Phase durations (ms).
export const SURGE_MS = 1100; // width 0 → 82, decelerating
export const HOLD_MS = 30000; // width 82 → 92 slow creep, keeps a cold start alive
export const COMPLETE_MS = 500; // width → 100 on the real network event
export const SETTLE_MS = 350; // glow bloom → settle hold
export const EXIT_MS = 400; // bar fades out, then the screen advances

// Target fill widths (%).
const SURGE_PCT = 82;
const HOLD_PCT = 92;
const DONE_PCT = 100;

// How long the app holds after the real connection lands (complete → settle →
// exit) before swapping StartJoinScreen for the next screen. Mirrors the
// existing HANDSHAKE_MIN_MS "hold a beat before transitioning" precedent.
export const CONNECT_COMPLETE_HOLD_MS = COMPLETE_MS + SETTLE_MS + EXIT_MS;

export interface BarVisual {
  widthPct: number;
  transitionMs: number;
  easing: string;
  /** Moving light strip — an "alive" layer, independent of the fill %. */
  sheen: boolean;
  /** Breathing glow — an "alive" layer, independent of the fill %. */
  breathe: boolean;
  /** One-shot glow bloom-then-settle on completion. */
  settle: boolean;
}

export function barVisual(phase: BarPhase): BarVisual {
  switch (phase) {
    case "surge":
      return { widthPct: SURGE_PCT, transitionMs: SURGE_MS, easing: SIGNATURE_EASE, sheen: false, breathe: false, settle: false };
    case "hold":
      return { widthPct: HOLD_PCT, transitionMs: HOLD_MS, easing: HOLD_EASE, sheen: true, breathe: true, settle: false };
    case "complete":
      return { widthPct: DONE_PCT, transitionMs: COMPLETE_MS, easing: SIGNATURE_EASE, sheen: false, breathe: false, settle: false };
    case "settle":
    case "exit":
      return { widthPct: DONE_PCT, transitionMs: COMPLETE_MS, easing: SIGNATURE_EASE, sheen: false, breathe: false, settle: true };
    case "idle":
    default:
      return { widthPct: 0, transitionMs: 0, easing: SIGNATURE_EASE, sheen: false, breathe: false, settle: false };
  }
}

export function barHeightPx(variant: BarVariant): number {
  return variant === "pill" ? 8 : 4;
}
