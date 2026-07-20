export interface TimestampedMessage {
  timestamp: number;
}

const BURST_WINDOW_MS = 400;
const STAGGER_STEP_MS = 70;
const MAX_STAGGER_MS = 280;

export function staggerDelayMs(messages: TimestampedMessage[], index: number): number {
  let burstPosition = 0;
  for (let i = index; i > 0; i--) {
    if (messages[i].timestamp - messages[i - 1].timestamp <= BURST_WINDOW_MS) {
      burstPosition++;
    } else {
      break;
    }
  }
  return Math.min(burstPosition * STAGGER_STEP_MS, MAX_STAGGER_MS);
}
