import { useState, type ReactNode } from "react";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { MessageBubble } from "../components/MessageBubble";
import { VoiceMessageBubble } from "../components/VoiceMessageBubble";
import { Composer } from "../components/Composer";
import { Settings } from "../components/Settings";
import type { MessageStatus } from "../protocol/messageStatus";
import { staggerDelayMs } from "../components/messageStagger";
import "./ChatScreen.css";

export type ChatMessage =
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "text"; text: string; status?: MessageStatus }
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "voice"; audioUrl: string; status?: MessageStatus }
  | { id: string; timestamp: number; kind: "decryption-error" };

interface ChatScreenProps {
  roomCode: string;
  safetyNumber: string;
  messages: ChatMessage[];
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
  onLeave: () => void;
}

function renderMessage(message: ChatMessage, showStatus: boolean, delayMs: number): ReactNode {
  if (message.kind === "decryption-error") {
    return (
      <div className="message-row message-row--incoming">
        <div className="message-bubble message-bubble--incoming">[Message could not be decrypted]</div>
      </div>
    );
  }
  const status = showStatus ? message.status : undefined;
  if (message.kind === "voice") {
    return (
      <VoiceMessageBubble
        from={message.from}
        audioUrl={message.audioUrl}
        durationLabel="0:23"
        status={status}
        delayMs={delayMs}
      />
    );
  }
  return <MessageBubble from={message.from} text={message.text} status={status} delayMs={delayMs} />;
}

export function ChatScreen({
  roomCode,
  safetyNumber,
  messages,
  ghostMode,
  onGhostModeChange,
  onSend,
  onSendVoice,
  onLeave,
}: ChatScreenProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const lastMeIndex = messages.reduce(
    (acc, message, index) => (message.kind !== "decryption-error" && message.from === "me" ? index : acc),
    -1
  );

  return (
    <div className="chat-screen">
      <TitleBar roomCode={roomCode} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="chat-screen__body">
        <Sidebar roomCode={roomCode} onNewChat={() => {}} />
        <div className="chat-screen__main">
          <div className="chat-screen__messages">
            <div className="chat-screen__day-divider">Today</div>
            {messages.map((message, index) => (
              <div key={message.id}>
                {renderMessage(message, index === lastMeIndex, staggerDelayMs(messages, index))}
              </div>
            ))}
          </div>
          <Composer onSend={onSend} onSendVoice={onSendVoice} />
        </div>
      </div>
      {settingsOpen && (
        <Settings
          roomCode={roomCode}
          safetyNumber={safetyNumber}
          ghostMode={ghostMode}
          onGhostModeChange={onGhostModeChange}
          onLeave={onLeave}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
