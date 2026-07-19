const STOPS: [fraction: number, percent: number][] = [
  [0, 0],
  [0.45, 62],
  [0.7, 88],
  [0.92, 100],
];

export function percentAt(elapsedMs: number, totalMs: number): number {
  const fraction = Math.max(0, Math.min(1, elapsedMs / totalMs));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [f0, p0] = STOPS[i];
    const [f1, p1] = STOPS[i + 1];
    if (fraction >= f0 && fraction <= f1) {
      const t = (fraction - f0) / (f1 - f0);
      return Math.round(p0 + t * (p1 - p0));
    }
  }
  return 100;
}
