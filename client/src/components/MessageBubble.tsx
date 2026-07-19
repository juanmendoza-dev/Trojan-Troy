import "./MessageBubble.css";

interface MessageBubbleProps {
  from: "me" | "peer";
  text: string;
}

export function MessageBubble({ from, text }: MessageBubbleProps) {
  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div className={from === "me" ? "message-bubble message-bubble--outgoing" : "message-bubble message-bubble--incoming"}>
        {text}
      </div>
    </div>
  );
}
