import type { FormEvent } from "react";

export interface ChatMessage {
  id: string;
  from: "me" | "peer" | "decryption-error";
  text: string;
}

interface ChatScreenProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export function ChatScreen({ messages, onSend }: ChatScreenProps) {
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
          <li key={message.id}>
            {message.from === "decryption-error"
              ? "[Message could not be decrypted]"
              : `${message.from === "me" ? "You" : "Them"}: ${message.text}`}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSend}>
        <input name="message" placeholder="Type a message" autoComplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
