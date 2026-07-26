// Whether this chat session currently counts as "focused" for read-ack
// purposes: only when it is the selected row in the chat list AND the
// browser window itself has focus. A backgrounded chat still receives and
// decrypts messages and keeps its cover traffic running — it just doesn't
// send read acks until the user actually looks at it. See design spec
// Section 5 (docs/superpowers/specs/2026-07-26-multi-chat-design.md).
export function isSessionFocused(input: { isActive: boolean; windowFocused: boolean }): boolean {
  return input.isActive && input.windowFocused;
}
