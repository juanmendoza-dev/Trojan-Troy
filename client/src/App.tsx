import { useEffect, useRef, useState, type ReactNode } from "react";
import { RelayClient, type Envelope } from "./net/relayClient";
import { parseInviteCode } from "./net/inviteLink";
import { generateKeypair, deriveSessionKeys, type Keypair, type SessionKeys } from "./crypto/keys";
import { computeSafetyNumber } from "./crypto/safetyNumber";
import { toBase64, fromBase64 } from "./crypto/encoding";
import { encryptMessage, decryptMessage } from "./crypto/messages";
import { encryptVoiceClip, decryptVoiceClip } from "./crypto/media";
import { advanceStatus } from "./protocol/messageStatus";
import { shouldSendReadAck } from "./protocol/readAckDecision";
import {
  shouldSendPresence,
  parsePresenceState,
  PRESENCE_EXPIRY_MS,
  type PresenceState,
} from "./protocol/presenceState";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { type ConnectStatus } from "./screens/ConnectingBar";
import { CONNECT_COMPLETE_HOLD_MS } from "./screens/barPhases";
import { WaitingScreen } from "./screens/WaitingScreen";
import { SafetyNumberScreen } from "./screens/SafetyNumberScreen";
import { ChatScreen, type ChatMessage } from "./screens/ChatScreen";
import { useTheme } from "./theme/ThemeContext";
import { LoadingScreen } from "./screens/loading/LoadingScreen";
import { HandshakeJourney } from "./screens/HandshakeJourney";
import { ErrorScreen } from "./screens/ErrorScreen";
import { scenarioFromServerMessage, type ErrorScenario } from "./screens/errorScenario";
import { ProfileModal } from "./components/ProfileModal";
import { resolveActiveProfile, ANONYMOUS_ID, type Profile, type PeerProfile } from "./profiles/profileModel";
import {
  listProfiles,
  putProfile,
  deleteProfile,
  getActiveProfileId,
  getShareProfile,
  setActiveProfileId as persistActiveProfileId,
  setShareProfile as persistShareProfile,
} from "./profiles/profileStore";
import { detectDevice } from "./profiles/device";
import { parseScreenOverride } from "./dev/screenOverride";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";
const GHOST_MODE_STORAGE_KEY = "trojan-troy-ghost-mode";

function maybeSendReadAck(
  client: RelayClient,
  pendingReadIdRef: { current: string | null },
  ghostModeRef: { current: boolean }
) {
  const messageId = pendingReadIdRef.current;
  if (!messageId) return;
  const send = shouldSendReadAck({
    isFocused: document.hasFocus(),
    isVisible: document.visibilityState === "visible",
    ghostMode: ghostModeRef.current,
    alreadyAcked: false,
  });
  if (send) {
    client.send({ type: "read", messageId });
    pendingReadIdRef.current = null;
  }
}

type Screen =
  | { name: "start" }
  | { name: "waiting"; roomCode: string }
  | { name: "handshake"; roomCode: string }
  | { name: "safety-number"; roomCode: string; safetyNumber: string }
  | { name: "chat"; roomCode: string; safetyNumber: string }
  | {
      name: "error";
      scenario: ErrorScenario;
      /** How to replay the failed action, if it can be retried in place. */
      retry?: { kind: "start" } | { kind: "join"; roomCode: string };
    };

export default function App() {
  const devOverride = import.meta.env.DEV ? parseScreenOverride(window.location.search) : null;
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [initialJoinCode] = useState<string | null>(() => parseInviteCode(window.location.hash));
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sessionKeysRef = useRef<SessionKeys | null>(null);
  const clientRef = useRef<RelayClient | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const { setTheme } = useTheme();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>(() => getActiveProfileId());
  const [profilesOpen, setProfilesOpen] = useState(false);
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);
  const [ownDevice] = useState(detectDevice);
  const selfCard: PeerProfile = {
    name: activeProfile.kind === "named" ? activeProfile.profile.name : "Anonymous",
    avatar: activeProfile.kind === "named" ? activeProfile.profile.avatar : null,
    device: ownDevice,
  };
  const activeProfileRef = useRef(activeProfile);
  activeProfileRef.current = activeProfile;
  const [shareProfile, setShareProfile] = useState<boolean>(() => getShareProfile());
  const shareProfileRef = useRef(shareProfile);
  shareProfileRef.current = shareProfile;
  function updateShareProfile(next: boolean) {
    persistShareProfile(next);
    setShareProfile(next);
  }
  const [peerProfile, setPeerProfile] = useState<PeerProfile | null>(null);

  useEffect(() => {
    void listProfiles().then(setProfiles);
  }, []);

  function selectProfile(id: string) {
    persistActiveProfileId(id);
    setActiveProfileId(id);
  }
  async function handleCreateProfile(profile: Profile) {
    await putProfile(profile);
    setProfiles(await listProfiles());
    selectProfile(profile.id);
  }
  async function handleDeleteProfile(id: string) {
    await deleteProfile(id);
    setProfiles(await listProfiles());
    if (activeProfileId === id) selectProfile(ANONYMOUS_ID);
  }

  const pendingReadIdRef = useRef<string | null>(null);
  const [ghostMode, setGhostMode] = useState<boolean>(
    () => localStorage.getItem(GHOST_MODE_STORAGE_KEY) === "true"
  );
  const ghostModeRef = useRef(ghostMode);
  ghostModeRef.current = ghostMode;

  const [peerPresence, setPeerPresence] = useState<PresenceState>("idle");
  const presenceExpiryRef = useRef<number | null>(null);
  const presenceSentRef = useRef<{ state: PresenceState; at: number }>({ state: "idle", at: 0 });

  function updateGhostMode(next: boolean) {
    localStorage.setItem(GHOST_MODE_STORAGE_KEY, String(next));
    setGhostMode(next);
  }

  // Show the peer's live presence, auto-clearing after PRESENCE_EXPIRY_MS as a
  // safety net for a dropped "idle"/stop event.
  function showPeerPresence(next: PresenceState) {
    if (presenceExpiryRef.current !== null) {
      clearTimeout(presenceExpiryRef.current);
      presenceExpiryRef.current = null;
    }
    setPeerPresence(next);
    if (next !== "idle") {
      presenceExpiryRef.current = window.setTimeout(() => {
        setPeerPresence("idle");
        presenceExpiryRef.current = null;
      }, PRESENCE_EXPIRY_MS);
    }
  }

  // Broadcast our own composition activity — encrypted, throttled to a heartbeat,
  // and suppressed by Ghost Mode (see protocol/presenceState.ts).
  async function sendPresence(next: PresenceState) {
    const client = clientRef.current;
    const keys = sessionKeysRef.current;
    if (!client || !keys) return;
    const now = performance.now();
    const last = presenceSentRef.current;
    if (
      !shouldSendPresence({
        nextState: next,
        lastSentState: last.state,
        lastSentAt: last.at,
        now,
        ghostMode: ghostModeRef.current,
      })
    ) {
      return;
    }
    presenceSentRef.current = { state: next, at: now };
    const payload = await encryptMessage(keys.tx, JSON.stringify({ state: next }));
    client.send({ type: "presence", payload });
  }

  useEffect(() => {
    function handleFocusChange() {
      const client = clientRef.current;
      if (client) maybeSendReadAck(client, pendingReadIdRef, ghostModeRef);
    }
    document.addEventListener("visibilitychange", handleFocusChange);
    window.addEventListener("focus", handleFocusChange);
    return () => {
      document.removeEventListener("visibilitychange", handleFocusChange);
      window.removeEventListener("focus", handleFocusChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const message of messagesRef.current) {
        if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (presenceExpiryRef.current !== null) clearTimeout(presenceExpiryRef.current);
    };
  }, []);

  useEffect(() => {
    if (devOverride?.theme) setTheme(devOverride.theme);
  }, []);

  // An invite link (…/#CODE) prefills the join form on load; drop the hash
  // afterward so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (initialJoinCode && window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const HANDSHAKE_MIN_MS = 2600;

  async function exchangeKeys(
    client: RelayClient,
    own: Keypair,
    role: "initiator" | "responder",
    roomCode: string
  ) {
    const handshakeStart = performance.now();
    let disconnected = false;
    client.onMessage(async (envelope: Envelope) => {
      if (envelope.type === "peer-disconnected") {
        disconnected = true;
        setScreen({ name: "error", scenario: "friend_left" });
        return;
      }
      if (envelope.type === "pubkey") {
        try {
          const peerPublicKey = await fromBase64(envelope.payload);
          sessionKeysRef.current = await deriveSessionKeys(own, peerPublicKey, role);
          if (shareProfileRef.current && activeProfileRef.current.kind === "named") {
            const self = activeProfileRef.current.profile;
            const card = JSON.stringify({ name: self.name, avatar: self.avatar, device: ownDevice });
            client.send({ type: "profile", payload: await encryptMessage(sessionKeysRef.current.tx, card) });
          }
          const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey);
          const elapsed = performance.now() - handshakeStart;
          if (elapsed < HANDSHAKE_MIN_MS) {
            await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_MIN_MS - elapsed));
          }
          if (disconnected) return;
          setScreen({ name: "safety-number", roomCode, safetyNumber });
        } catch {
          setScreen({ name: "error", scenario: "handshake_failed" });
        }
        return;
      }
      if (envelope.type === "ciphertext") {
        const keys = sessionKeysRef.current;
        const client = clientRef.current;
        if (!keys || !client) return;
        try {
          const text = await decryptMessage(keys.rx, envelope.payload);
          showPeerPresence("idle");
          setMessages((prev) => [
            ...prev,
            { id: envelope.messageId, timestamp: Date.now(), from: "peer", kind: "text", text },
          ]);
          client.send({ type: "delivered", messageId: envelope.messageId });
          pendingReadIdRef.current = envelope.messageId;
          maybeSendReadAck(client, pendingReadIdRef, ghostModeRef);
        } catch {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
          ]);
        }
        return;
      }
      if (envelope.type === "voice") {
        const keys = sessionKeysRef.current;
        const client = clientRef.current;
        if (!keys || !client) return;
        try {
          const blob = await decryptVoiceClip(keys.rx, envelope.payload, envelope.mimeType);
          const audioUrl = URL.createObjectURL(blob);
          showPeerPresence("idle");
          setMessages((prev) => [
            ...prev,
            { id: envelope.messageId, timestamp: Date.now(), from: "peer", kind: "voice", audioUrl },
          ]);
          client.send({ type: "delivered", messageId: envelope.messageId });
          pendingReadIdRef.current = envelope.messageId;
          maybeSendReadAck(client, pendingReadIdRef, ghostModeRef);
        } catch {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
          ]);
        }
        return;
      }
      if (envelope.type === "presence") {
        const keys = sessionKeysRef.current;
        if (!keys) return;
        try {
          const text = await decryptMessage(keys.rx, envelope.payload);
          const state = parsePresenceState(JSON.parse(text)?.state);
          if (state) showPeerPresence(state);
        } catch {
          // Ignore malformed/undecryptable presence — the next heartbeat recovers.
        }
        return;
      }
      if (envelope.type === "profile") {
        const keys = sessionKeysRef.current;
        if (!keys) return;
        try {
          const card = JSON.parse(await decryptMessage(keys.rx, envelope.payload));
          if (card && typeof card.name === "string") {
            setPeerProfile({
              name: card.name,
              avatar: typeof card.avatar === "string" ? card.avatar : null,
              device: card.device === "phone" || card.device === "computer" ? card.device : null,
            });
          }
        } catch {
          // Ignore a malformed/undecryptable profile card.
        }
        return;
      }
      if (envelope.type === "delivered" || envelope.type === "read") {
        setMessages((prev) =>
          prev.map((message) =>
            message.kind !== "decryption-error" && message.id === envelope.messageId
              ? { ...message, status: advanceStatus(message.status ?? "sent", envelope.type) }
              : message
          )
        );
      }
    });

    client.send({ type: "pubkey", payload: await toBase64(own.publicKey) });
  }

  async function handleStart() {
    setConnectStatus("connecting");
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    clientRef.current = client;
    try {
      await client.waitForOpen();
    } catch {
      setConnectStatus("idle");
      setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "start" } });
      return;
    }
    let currentRoomCode = "";
    client.onMessage((envelope) => {
      if (envelope.type === "created") {
        currentRoomCode = envelope.roomCode;
        const code = envelope.roomCode;
        // Snap the connecting bar to 100%, then hold a beat before advancing.
        setConnectStatus("connected");
        window.setTimeout(() => {
          setConnectStatus("idle");
          setScreen((prev) => (prev.name === "start" ? { name: "waiting", roomCode: code } : prev));
        }, CONNECT_COMPLETE_HOLD_MS);
      }
      if (envelope.type === "peer-connected") {
        setScreen({ name: "handshake", roomCode: currentRoomCode });
        void exchangeKeys(client, own, "initiator", currentRoomCode);
      }
      if (envelope.type === "error") {
        setConnectStatus("idle");
        setScreen({
          name: "error",
          scenario: scenarioFromServerMessage(envelope.message),
          retry: { kind: "start" },
        });
      }
    });
    client.send({ type: "create" });
  }

  async function handleJoin(roomCode: string) {
    setConnectStatus("connecting");
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    clientRef.current = client;
    try {
      await client.waitForOpen();
    } catch {
      setConnectStatus("idle");
      setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "join", roomCode } });
      return;
    }
    client.onMessage((envelope) => {
      if (envelope.type === "error") {
        setConnectStatus("idle");
        setScreen({
          name: "error",
          scenario: scenarioFromServerMessage(envelope.message),
          retry: { kind: "join", roomCode },
        });
      }
      if (envelope.type === "peer-connected") {
        // Start the key exchange right away (listeners stack — delaying it would
        // drop the peer's pubkey), but hold the finished bar a beat on the home
        // screen before swapping in the handshake/loading screen.
        setConnectStatus("connected");
        void exchangeKeys(client, own, "responder", roomCode);
        window.setTimeout(() => {
          setConnectStatus("idle");
          setScreen((prev) => (prev.name === "start" ? { name: "handshake", roomCode } : prev));
        }, CONNECT_COMPLETE_HOLD_MS);
      }
    });
    client.send({ type: "join", roomCode });
  }

  async function handleSend(text: string) {
    const keys = sessionKeysRef.current;
    const client = clientRef.current;
    if (!keys || !client) return;
    const payload = await encryptMessage(keys.tx, text);
    const id = crypto.randomUUID();
    client.send({ type: "ciphertext", payload, messageId: id });
    setMessages((prev) => [
      ...prev,
      { id, timestamp: Date.now(), from: "me", kind: "text", text, status: "sent" },
    ]);
  }

  async function handleSendVoice(blob: Blob, mimeType: string) {
    const keys = sessionKeysRef.current;
    const client = clientRef.current;
    if (!keys || !client) return;
    const payload = await encryptVoiceClip(keys.tx, blob);
    const id = crypto.randomUUID();
    client.send({ type: "voice", payload, mimeType, messageId: id });
    const audioUrl = URL.createObjectURL(blob);
    setMessages((prev) => [
      ...prev,
      { id, timestamp: Date.now(), from: "me", kind: "voice", audioUrl, status: "sent" },
    ]);
  }

  function handleLeave() {
    clientRef.current?.close();
    clientRef.current = null;
    sessionKeysRef.current = null;
    pendingReadIdRef.current = null;
    if (presenceExpiryRef.current !== null) {
      clearTimeout(presenceExpiryRef.current);
      presenceExpiryRef.current = null;
    }
    presenceSentRef.current = { state: "idle", at: 0 };
    setPeerPresence("idle");
    setPeerProfile(null);
    setConnectStatus("idle");
    for (const message of messagesRef.current) {
      if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
    }
    setMessages([]);
    setScreen({ name: "start" });
  }

  if (devOverride?.screen === "loading") {
    return (
      <HandshakeJourney activeKey="handshake">
        <LoadingScreen roomCode="K7F-2QX" />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "chat") {
    return (
      <HandshakeJourney activeKey="chat">
        <ChatScreen
          roomCode="K7F-2QX"
          safetyNumber="21934 07741 66012"
          messages={[
            {
              id: "1",
              timestamp: Date.now() - 3000,
              from: "peer",
              kind: "text",
              text: "did you check the safety number?",
            },
            {
              id: "2",
              timestamp: Date.now() - 2000,
              from: "me",
              kind: "text",
              text: "yep — 21934 07741 66012 — matches on my end",
              status: "delivered",
            },
            {
              id: "3",
              timestamp: Date.now() - 1000,
              from: "me",
              kind: "text",
              text: "got it — nothing between us but ciphertext.",
              status: "read",
            },
          ]}
          ghostMode={ghostMode}
          onGhostModeChange={updateGhostMode}
          shareProfile={false}
          onShareProfileChange={() => {}}
          selfCard={{ name: "You", avatar: null, device: "computer" }}
          peerProfile={{ name: "Jay", avatar: null, device: "phone" }}
          peerPresence="typing"
          onPresence={() => {}}
          onSend={() => {}}
          onSendVoice={() => {}}
          onLeave={() => {}}
        />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "waiting") {
    return <WaitingScreen roomCode="K7F-2QX" onCancel={() => {}} />;
  }
  if (devOverride?.screen === "safety") {
    return (
      <HandshakeJourney activeKey="safety-number">
        <SafetyNumberScreen
          roomCode="K7F-2QX"
          safetyNumber="21934 07741 66012 88304 55120 09937 41028 77650 30291 66104 82255 19073"
          onVerified={() => {}}
        />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "connecting") {
    // Holds the connecting bar in its "alive" cold-start state so the sheen +
    // breathing glow can be eyeballed without a live relay.
    return (
      <StartJoinScreen
        onStart={() => {}}
        onJoin={() => {}}
        connectStatus="connecting"
        activeProfile={{ kind: "anonymous" }}
        onOpenProfiles={() => {}}
      />
    );
  }
  if (devOverride?.screen === "profiles") {
    const sample: Profile[] = [
      { id: "s1", name: "Jay", avatar: null, pinSalt: "", pinHash: "", createdAt: 0 },
      { id: "s2", name: "Work", avatar: null, pinSalt: "", pinHash: "", createdAt: 0 },
    ];
    return (
      <>
        <StartJoinScreen
          onStart={() => {}}
          onJoin={() => {}}
          connectStatus="idle"
          activeProfile={{ kind: "anonymous" }}
          onOpenProfiles={() => {}}
        />
        <ProfileModal
          profiles={sample}
          activeId={ANONYMOUS_ID}
          onSelectAnonymous={() => {}}
          onSelectNamed={() => {}}
          onCreate={() => {}}
          onDelete={() => {}}
          onClose={() => {}}
        />
      </>
    );
  }
  if (devOverride?.screen === "error") {
    const scenario = devOverride.scenario ?? "friend_left";
    // Show "Try again" for the connection-time scenarios (mirrors the real
    // wiring, where only those carry a retry); peer-left / handshake show one.
    const retryable =
      scenario === "server_unreachable" || scenario === "bad_code" || scenario === "room_full";
    return (
      <ErrorScreen scenario={scenario} onNewChat={() => {}} onRetry={retryable ? () => {} : undefined} />
    );
  }
  if (screen.name === "start") {
    return (
      <>
        <StartJoinScreen
          onStart={handleStart}
          onJoin={handleJoin}
          connectStatus={connectStatus}
          initialCode={initialJoinCode ?? undefined}
          activeProfile={activeProfile}
          onOpenProfiles={() => setProfilesOpen(true)}
        />
        {profilesOpen && (
          <ProfileModal
            profiles={profiles}
            activeId={activeProfileId}
            onSelectAnonymous={() => selectProfile(ANONYMOUS_ID)}
            onSelectNamed={(profile) => selectProfile(profile.id)}
            onCreate={handleCreateProfile}
            onDelete={handleDeleteProfile}
            onClose={() => setProfilesOpen(false)}
          />
        )}
      </>
    );
  }
  if (screen.name === "waiting") {
    return <WaitingScreen roomCode={screen.roomCode} onCancel={handleLeave} />;
  }
  if (screen.name === "handshake" || screen.name === "safety-number" || screen.name === "chat") {
    let content: ReactNode;
    if (screen.name === "handshake") {
      content = <LoadingScreen roomCode={screen.roomCode} />;
    } else if (screen.name === "safety-number") {
      content = (
        <SafetyNumberScreen
          roomCode={screen.roomCode}
          safetyNumber={screen.safetyNumber}
          onVerified={() =>
            setScreen({ name: "chat", roomCode: screen.roomCode, safetyNumber: screen.safetyNumber })
          }
        />
      );
    } else {
      content = (
        <ChatScreen
          roomCode={screen.roomCode}
          safetyNumber={screen.safetyNumber}
          messages={messages}
          selfCard={selfCard}
          peerProfile={peerProfile}
          ghostMode={ghostMode}
          onGhostModeChange={updateGhostMode}
          shareProfile={shareProfile}
          onShareProfileChange={updateShareProfile}
          peerPresence={peerPresence}
          onPresence={sendPresence}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
          onLeave={handleLeave}
        />
      );
    }
    return <HandshakeJourney activeKey={screen.name}>{content}</HandshakeJourney>;
  }
  // Only the "error" variant remains.
  const retry = screen.retry;
  return (
    <ErrorScreen
      scenario={screen.scenario}
      onNewChat={handleLeave}
      onRetry={
        retry
          ? () => {
              // Tear down the failed attempt's client/state, then replay it.
              handleLeave();
              if (retry.kind === "start") void handleStart();
              else void handleJoin(retry.roomCode);
            }
          : undefined
      }
    />
  );
}
