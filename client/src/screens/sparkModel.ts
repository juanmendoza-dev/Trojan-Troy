// Pure math for the seal-slider spark effect (SealSparks). The deterministic
// tunables and decisions live here — no canvas, no DOM, no randomness — so
// they can be unit-tested in isolation, matching how percent.ts / barPhases.ts
// / readAckDecision.ts split pure logic out of their imperative callers.

// Trail gradient stops, matching .confirm-key__fill in SafetyNumberScreen.css
// (#FF6B6B → #FFC46E → #7ED9B7 → #8FA6FF → #C48FFF). Sparks are sampled from
// this so they look flung off the same rainbow the track already paints.
export const TRAIL_STOPS: readonly (readonly [number, number, number])[] = [
  [255, 107, 107],
  [255, 196, 110],
  [126, 217, 183],
  [143, 166, 255],
  [196, 143, 255],
];

export const MAX_PARTICLES = 160; // hard cap on live embers
export const EMIT_BASE = 6; // embers/frame at full intensity
export const V_MAX = 1.2; // px/ms drag speed that maps to full intensity

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// Sample the trail gradient at fraction 0..1 (clamped). 0 → first stop,
// 1 → last stop, evenly spaced in between with linear interpolation.
export function sampleTrailColor(fraction: number): Rgb {
  const t = Math.max(0, Math.min(1, fraction));
  const seg = t * (TRAIL_STOPS.length - 1);
  const i = Math.min(Math.floor(seg), TRAIL_STOPS.length - 2);
  const f = seg - i;
  const a = TRAIL_STOPS[i];
  const b = TRAIL_STOPS[i + 1];
  return {
    r: Math.round(a[0] + (b[0] - a[0]) * f),
    g: Math.round(a[1] + (b[1] - a[1]) * f),
    b: Math.round(a[2] + (b[2] - a[2]) * f),
  };
}

export interface SparkCountInput {
  velocity: number; // px/ms, signed (leftward is negative)
  progress: number; // 0..1
  poolSize: number; // current live particle count
}

// How many embers to spawn this frame. Rightward motion only; scales with
// both drag speed (velocityFactor) and how close to the seal (progress), and
// never overflows the pool cap.
export function sparkCountForFrame({ velocity, progress, poolSize }: SparkCountInput): number {
  if (velocity <= 0) return 0;
  const velocityFactor = Math.min(velocity / V_MAX, 1);
  const raw = EMIT_BASE * velocityFactor * (0.4 + progress);
  const headroom = Math.max(0, MAX_PARTICLES - poolSize);
  return Math.min(Math.round(raw), headroom);
}
