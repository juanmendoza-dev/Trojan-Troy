// Pure scheduling decisions for the post-quantum ratchet's in-band rekey (round-2
// feature A). The timer, the ML-KEM calls, and the sends live in App.tsx; this
// module holds only testable decisions, matching coverTraffic.ts / presenceState.ts.
//
// Cadence rationale: a fold every ~30s bounds how long a compromise survives
// before the root chain re-secures with post-quantum material. It is deliberately
// NOT per-message — ML-KEM-768 keys are ~1.1KB, and at cover traffic's ~1/sec that
// would multiply bandwidth for a guarantee that a 30s window already delivers. The
// honest claim is "re-secures every ~30 seconds", not "every message is PQ".

export const PQ_REKEY_INTERVAL_MS = 30_000;
export const PQ_REKEY_JITTER_FRAC = 0.3;
// A busy conversation should rekey on volume too, not just elapsed time.
export const PQ_REKEY_MESSAGES = 200;
// Never hammer: even with a misconfigured interval, offers stay this far apart.
export const PQ_REKEY_FLOOR_MS = 5_000;

export interface PqRekeyInput {
  now: number;
  lastOfferAt: number;
  contentSentSinceOffer: number;
  interval: number;
}

// Offer when either the jittered interval has elapsed or enough content has gone
// out since the last offer — whichever comes first — but never inside the floor.
export function shouldOffer(input: PqRekeyInput): boolean {
  const elapsed = input.now - input.lastOfferAt;
  if (elapsed < PQ_REKEY_FLOOR_MS) return false;
  return elapsed >= input.interval || input.contentSentSinceOffer >= PQ_REKEY_MESSAGES;
}

export function jitteredRekeyInterval(
  base: number,
  jitterFrac: number,
  rand: () => number
): number {
  const delta = (rand() * 2 - 1) * jitterFrac; // [-jitterFrac, +jitterFrac)
  return Math.max(PQ_REKEY_FLOOR_MS, Math.round(base * (1 + delta)));
}

// Offer ids are u16 because that is what fits the sealed header's fold counter's
// sibling field on the wire. Skipping 0 keeps "no offer yet" unambiguous.
export const MAX_OFFER_ID = 0xffff;

export function nextOfferId(current: number): number {
  const next = current + 1;
  return next > MAX_OFFER_ID ? 1 : next;
}
