import { useEffect, useRef, useState, type ReactNode } from "react";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { MessageBubble } from "../components/MessageBubble";
import { VoiceMessageBubble } from "../components/VoiceMessageBubble";
import { Composer } from "../components/Composer";
import { Settings } from "../components/Settings";
import type { MessageStatus } from "../protocol/messageStatus";
import { staggerDelayMs } from "../components/messageStagger";
import { formatClipDuration } from "../audio/clipDuration";
import { endsGroup } from "../components/messageGrouping";
import { MessageAvatar } from "../components/MessageAvatar";
import { ProfileCard } from "../components/ProfileCard";
import { PresenceIndicator } from "../components/PresenceIndicator";
import type { PresenceState } from "../protocol/presenceState";
import type { PeerProfile } from "../profiles/profileModel";
import "./ChatScreen.css";

export type ChatMessage =
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "text"; text: string; status?: MessageStatus }
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "voice"; audioUrl: string; durationMs: number; status?: MessageStatus }
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

// The same 640px line the stylesheets use (documented in styles/base.css). It
// lives here rather than in a shared hook because ChatScreen is the only thing
// that needs to know: below it the sidebar is a drawer, above it the sidebar is
// always on screen — and so its visualizers must keep running.
const MOBILE_QUERY = "(max-width: 640px)";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return isMobile;
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
        durationLabel={formatClipDuration(message.durationMs)}
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
  const [roomHidden, setRoomHidden] = useState(false);
  const [openCard, setOpenCard] = useState<{ data: PeerProfile; anchor: DOMRect } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const messagesRef = useRef<HTMLDivElement>(null);
  const peerCard: PeerProfile = peerProfile ?? { name: "Anonymous", avatar: null, device: null };

  // Widening past the breakpoint puts the sidebar back on screen for good, so
  // don't leave stale drawer state behind — it would keep the viz paused.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // Escape closes the drawer, same as tapping the scrim. Settings and the profile
  // card have their own Escape handlers, so stand down while either is on top.
  useEffect(() => {
    if (!drawerOpen || settingsOpen || openCard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, settingsOpen, openCard]);

  // Keep the newest message in view.
  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, peerPresence]);

  // …and re-pin whenever the column itself gets shorter, which is what the soft
  // keyboard opening looks like from in here: --app-height drops, this box
  // shrinks, and the newest message would otherwise slide up out of sight.
  useEffect(() => {
    const element = messagesRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const lastMeIndex = messages.reduce(
    (acc, message, index) => (message.kind !== "decryption-error" && message.from === "me" ? index : acc),
    -1
  );

  // Text the user has sent, newest last — feeds the sidebar's live "data" visualizer.
  const sentTexts = messages.flatMap((m) => (m.kind === "text" && m.from === "me" ? [m.text] : []));

  return (
    <div className="chat-screen">
      <TitleBar
        roomCode={roomCode}
        peerProfile={peerProfile}
        roomHidden={roomHidden}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        drawerOpen={drawerOpen}
      />
      <div className="chat-screen__body">
        <Sidebar
          roomCode={roomCode}
          onNewChat={onLeave}
          sentMessages={sentTexts}
          roomHidden={roomHidden}
          onToggleRoomHidden={() => setRoomHidden((v) => !v)}
          open={drawerOpen}
          paused={isMobile && !drawerOpen}
        />
        {isMobile && drawerOpen && (
          <button
            type="button"
            className="chat-screen__scrim"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <div className="chat-screen__main">
          <div className="chat-screen__messages" ref={messagesRef}>
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
