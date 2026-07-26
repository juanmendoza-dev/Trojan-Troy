// Pure chat-session bookkeeping: how many concurrent chats are allowed, and
// what a newly-opened one is called by default. Kept separate from the React
// wiring (App.tsx) so it's unit-testable in isolation, matching
// presenceState.ts / readAckDecision.ts.

export const MAX_CHAT_SESSIONS = 5;

// Whether another chat can be opened given how many currently exist (any
// status counts — a chat mid-handshake still holds a connection slot).
export function canAddSession(currentCount: number): boolean {
  return currentCount < MAX_CHAT_SESSIONS;
}

// Default label for a newly created chat. `ordinal` is a monotonically
// increasing counter the caller owns (incremented on every create, never
// reused after a chat closes) — NOT the current open count, so labels don't
// collide once earlier chats have closed.
export function nextSessionLabel(ordinal: number): string {
  return `Chat ${ordinal}`;
}
