import { useState } from "react";
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
  // or theme switch — only when a message genuinely arrives.
  const [decryptIn] = useState(() => {
    const should = from === "peer" && CIPHER_THEMES.has(theme) && !decryptedIds.has(id);
    if (should) decryptedIds.add(id);
    return should;
  });

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
