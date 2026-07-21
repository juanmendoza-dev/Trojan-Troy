// Fill curve for the home screen's connecting bar. Pure + tested, in the same
// spirit as loading/percent.ts.
//
// The relay is on a free tier that sleeps: near-instant when warm, up to ~60s
// on a cold start. The bar can't know how long it'll take, so it can't run a
// timeline to 100% — instead it climbs fast to ~80%, eases into an 85–92% hold,
// and asymptotically approaches (but never reaches) a ceiling below 100%. It
// only snaps to 100% when the real connection event lands (handled by the
// component, not here). This keeps a long cold start from ever looking stalled.

// Fast initial climb: reach FAST_TARGET% by FAST_MS, decelerating into it.
const FAST_MS = 1100;
const FAST_TARGET = 80;

// After the fast climb, ease from FAST_TARGET toward CEILING with time constant
// EASE_TAU_MS. CEILING is only approached, never hit — so the bar is always
// "still going" until the connection truly completes.
const CEILING = 92;
const EASE_TAU_MS = 4200;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Percent (0–<92) the connecting bar should show after `elapsedMs` of a pending
 * connection. Monotonically increasing, never reaches CEILING on its own.
 */
export function connectingFill(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs);
  if (t <= FAST_MS) {
    // Quadratic ease-out so the fast climb decelerates smoothly into FAST_TARGET.
    const p = t / FAST_MS;
    const eased = 1 - (1 - p) * (1 - p);
    return round1(FAST_TARGET * eased);
  }
  const span = CEILING - FAST_TARGET;
  const eased = span * (1 - Math.exp(-(t - FAST_MS) / EASE_TAU_MS));
  // Stay a hair under the ceiling so the bar is never visually "done" until the
  // real connection event snaps it to 100%.
  return Math.min(round1(FAST_TARGET + eased), CEILING - 0.1);
}

export const CONNECT_FILL_CEILING = CEILING;
