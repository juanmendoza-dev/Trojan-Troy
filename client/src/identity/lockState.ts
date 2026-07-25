// Pure decision for the at-rest vault's idle re-lock (session timeout). The
// vault re-locks once the idle gap since the last activity reaches the timeout;
// any activity resets the clock by updating lastActivity. Timer wiring lives in
// App.tsx — this is the testable rule, matching presenceState.ts / lockState's
// sibling pure modules.

export const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export function shouldRelock(lastActivity: number, now: number, timeoutMs: number): boolean {
  return now - lastActivity >= timeoutMs;
}
