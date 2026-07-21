import "./MessageBubble.css";
import { STATUS_TICKS, type MessageStatus } from "../protocol/messageStatus";

interface MessageBubbleProps {
  from: "me" | "peer";
  text: string;
  status?: MessageStatus;
  delayMs?: number;
}

export function MessageBubble({ from, text, status, delayMs = 0 }: MessageBubbleProps) {
  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div
        className={
          from === "me" ? "message-bubble message-bubble--outgoing" : "message-bubble message-bubble--incoming"
        }
        style={{ animationDelay: `${delayMs}ms` }}
      >
        {text}
      </div>
      {status && <span className={`message-status message-status--${status}`}>{STATUS_TICKS[status]}</span>}
    </div>
  );
}
