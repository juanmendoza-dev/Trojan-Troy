import { useState, type ReactNode } from "react";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { MessageBubble } from "../components/MessageBubble";
import { VoiceMessageBubble } from "../components/VoiceMessageBubble";
import { Composer } from "../components/Composer";
import { AmbientOrbs } from "../components/AmbientOrbs";
import { Settings } from "../components/Settings";
import "./ChatScreen.css";

export type ChatMessage =
  | { id: string; from: "me" | "peer"; kind: "text"; text: string }
  | { id: string; from: "me" | "peer"; kind: "voice"; audioUrl: string }
  | { id: string; kind: "decryption-error" };

interface ChatScreenProps {
  roomCode: string;
  safetyNumber: string;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
  onLeave: () => void;
}

function renderMessage(message: ChatMessage): ReactNode {
  if (message.kind === "decryption-error") {
    return (
      <div className="message-row message-row--incoming">
        <div className="message-bubble message-bubble--incoming">[Message could not be decrypted]</div>
      </div>
    );
  }
  if (message.kind === "voice") {
    // duration hardcoded — real clip length isn't threaded through ChatMessage yet
    return <VoiceMessageBubble from={message.from} audioUrl={message.audioUrl} durationLabel="0:23" />;
  }
  return <MessageBubble from={message.from} text={message.text} />;
}

export function ChatScreen({
  roomCode,
  safetyNumber,
  messages,
  onSend,
  onSendVoice,
  onLeave,
}: ChatScreenProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="chat-screen">
      <AmbientOrbs />
      <TitleBar roomCode={roomCode} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="chat-screen__body">
        <Sidebar roomCode={roomCode} onNewChat={() => {}} />
        <div className="chat-screen__main">
          <div className="chat-screen__messages">
            <div className="chat-screen__day-divider">Today</div>
            {messages.map((message) => (
              <div key={message.id}>{renderMessage(message)}</div>
            ))}
          </div>
          <Composer onSend={onSend} onSendVoice={onSendVoice} />
        </div>
      </div>
      {settingsOpen && (
        <Settings
          roomCode={roomCode}
          safetyNumber={safetyNumber}
          onLeave={onLeave}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
