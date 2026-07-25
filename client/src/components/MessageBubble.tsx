import { useEffect, useState } from "react";
import "./MessageBubble.css";
import type { MessageStatus } from "../protocol/messageStatus";
import { useTheme } from "../theme/ThemeContext";
import { CipherText } from "./CipherText";

interface MessageBubbleProps {
  id: string;
  from: "me" | "peer";
  text: string;
  status?: MessageStatus;
  delayMs?: number;
}

const STATUS_TICKS: Record<MessageStatus, string> = {
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
};

// Incoming messages on the dark themes "decrypt" into view once, on arrival.
// Your own messages appear instantly — there's nothing to decrypt.
const CIPHER_THEMES = new Set(["iris", "pulse"]);
const decryptedIds = new Set<string>();

export function MessageBubble({ id, from, text, status, delayMs = 0 }: MessageBubbleProps) {
  const { theme } = useTheme();
  // Decide once, on mount, so the reveal never replays on re-render, scroll,
  // or theme switch — only when a message genuinely arrives. This initializer
  // must stay a pure read (no mutating `decryptedIds` here): React 18
  // StrictMode double-invokes it in dev, and a mutating initializer sees its
  // own first call's side effect on the second call, always resolving to
  // `false` — silently cancelling the reveal every time. The actual claim
  // happens in the effect below instead, where double-invocation is safe
  // (Set.add is idempotent).
  const [decryptIn] = useState(
    () => from === "peer" && CIPHER_THEMES.has(theme) && !decryptedIds.has(id)
  );

  useEffect(() => {
    if (decryptIn) decryptedIds.add(id);
  }, [decryptIn, id]);

  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div
        className={
          from === "me" ? "message-bubble message-bubble--outgoing" : "message-bubble message-bubble--incoming"
        }
        style={{ animationDelay: `${delayMs}ms` }}
        data-decrypting={decryptIn || undefined}
      >
        {decryptIn ? <CipherText text={text} /> : text}
      </div>
      {status && <span className={`message-status message-status--${status}`}>{STATUS_TICKS[status]}</span>}
    </div>
  );
}
