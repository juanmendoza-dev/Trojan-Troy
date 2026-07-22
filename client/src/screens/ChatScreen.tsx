import { useState, type ReactNode } from "react";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { MessageBubble } from "../components/MessageBubble";
import { VoiceMessageBubble } from "../components/VoiceMessageBubble";
import { Composer } from "../components/Composer";
import { Settings } from "../components/Settings";
import type { MessageStatus } from "../protocol/messageStatus";
import { staggerDelayMs } from "../components/messageStagger";
import { endsGroup } from "../components/messageGrouping";
import { MessageAvatar } from "../components/MessageAvatar";
import { ProfileCard } from "../components/ProfileCard";
import { PresenceIndicator } from "../components/PresenceIndicator";
import type { PresenceState } from "../protocol/presenceState";
import type { PeerProfile } from "../profiles/profileModel";
import "./ChatScreen.css";

export type ChatMessage =
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "text"; text: string; status?: MessageStatus }
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "voice"; audioUrl: string; status?: MessageStatus }
  | { id: string; timestamp: number; kind: "decryption-error" };

interface ChatScreenProps {
  roomCode: string;
  safetyNumber: string;
  messages: ChatMessage[];
  peerProfile?: PeerProfile | null;
  selfCard: PeerProfile;
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  shareProfile: boolean;
  onShareProfileChange: (next: boolean) => void;
  peerPresence: PresenceState;
  onPresence: (state: PresenceState) => void;
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
  onLeave: () => void;
}

function renderMessage(
  message: ChatMessage,
  showStatus: boolean,
  delayMs: number,
  avatar: ReactNode
): ReactNode {
  if (message.kind === "decryption-error") {
    return (
      <div className="message-row message-row--incoming">
        {avatar}
        <div className="message-row__stack">
          <div className="message-bubble message-bubble--incoming">[Message could not be decrypted]</div>
        </div>
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
        avatar={avatar}
      />
    );
  }
  return (
    <MessageBubble
      id={message.id}
      from={message.from}
      text={message.text}
      status={status}
      delayMs={delayMs}
      avatar={avatar}
    />
  );
}

export function ChatScreen({
  roomCode,
  safetyNumber,
  messages,
  peerProfile,
  selfCard,
  ghostMode,
  onGhostModeChange,
  shareProfile,
  onShareProfileChange,
  peerPresence,
  onPresence,
  onSend,
  onSendVoice,
  onLeave,
}: ChatScreenProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openCard, setOpenCard] = useState<{ data: PeerProfile; anchor: DOMRect } | null>(null);
  const peerCard: PeerProfile = peerProfile ?? { name: "Anonymous", avatar: null, device: null };

  const lastMeIndex = messages.reduce(
    (acc, message, index) => (message.kind !== "decryption-error" && message.from === "me" ? index : acc),
    -1
  );

  return (
    <div className="chat-screen">
      <TitleBar roomCode={roomCode} peerProfile={peerProfile} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="chat-screen__body">
        <Sidebar roomCode={roomCode} onNewChat={() => {}} />
        <div className="chat-screen__main">
          <div className="chat-screen__messages">
            <div className="chat-screen__day-divider">Today</div>
            {messages.map((message, index) => {
              const isError = message.kind === "decryption-error";
              const fromMe = !isError && message.from === "me";
              const card = fromMe ? selfCard : peerCard;
              const avatar =
                !isError && endsGroup(messages, index) ? (
                  <MessageAvatar
                    avatar={card.avatar}
                    onOpen={(anchor) => setOpenCard({ data: card, anchor })}
                  />
                ) : (
                  <span className="message-row__avatar-gap" aria-hidden="true" />
                );
              return (
                <div key={message.id}>
                  {renderMessage(message, index === lastMeIndex, staggerDelayMs(messages, index), avatar)}
                </div>
              );
            })}
            <PresenceIndicator state={peerPresence} />
          </div>
          <Composer
            onSend={onSend}
            onSendVoice={onSendVoice}
            onTypingChange={(isTyping) => onPresence(isTyping ? "typing" : "idle")}
            onRecordingChange={(isRecording) => onPresence(isRecording ? "recording" : "idle")}
          />
        </div>
      </div>
      {settingsOpen && (
        <Settings
          roomCode={roomCode}
          safetyNumber={safetyNumber}
          ghostMode={ghostMode}
          onGhostModeChange={onGhostModeChange}
          shareProfile={shareProfile}
          onShareProfileChange={onShareProfileChange}
          onLeave={onLeave}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {openCard && (
        <ProfileCard card={openCard.data} anchor={openCard.anchor} onClose={() => setOpenCard(null)} />
      )}
    </div>
  );
}
