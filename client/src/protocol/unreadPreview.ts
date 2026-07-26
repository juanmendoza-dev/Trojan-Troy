import type { ChatMessage } from "../screens/ChatScreen";

// Preview text for a chat-list row when this chat has an unseen message.
// Ghost Mode suppresses the content (dot-only in the list) so a glance at the
// chat list can't read what a peer just said — see design spec Section 6,
// "Unread preview vs. Ghost Mode."
export function formatUnreadPreview(message: ChatMessage, ghostMode: boolean): string {
  if (ghostMode) return "•";
  if (message.kind === "text") return message.text;
  if (message.kind === "voice") return "Voice message";
  return "Message";
}
