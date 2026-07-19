import type { FormEvent, ReactNode } from "react";
import { VoiceRecorder } from "./VoiceRecorder";

export type ChatMessage =
  | { id: string; from: "me" | "peer"; kind: "text"; text: string }
  | { id: string; from: "me" | "peer"; kind: "voice"; audioUrl: string }
  | { id: string; kind: "decryption-error" };

interface ChatScreenProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
}

function renderMessage(message: ChatMessage): ReactNode {
  if (message.kind === "decryption-error") {
    return "[Message could not be decrypted]";
  }
  const who = message.from === "me" ? "You" : "Them";
  if (message.kind === "voice") {
    return (
      <>
        {who}: <audio src={message.audioUrl} controls />
      </>
    );
  }
  return `${who}: ${message.text}`;
}

export function ChatScreen({ messages, onSend, onSendVoice }: ChatScreenProps) {
  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = String(data.get("message") ?? "").trim();
    if (text) onSend(text);
    form.reset();
  };

  return (
    <div>
      <h1>Chat</h1>
      <ul>
        {messages.map((message) => (
          <li key={message.id}>{renderMessage(message)}</li>
        ))}
      </ul>
      <form onSubmit={handleSend}>
        <input name="message" placeholder="Type a message" autoComplete="off" />
        <button type="submit">Send</button>
      </form>
      <VoiceRecorder onSend={onSendVoice} />
    </div>
  );
}
