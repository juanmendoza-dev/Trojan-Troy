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
import { decideAccess } from "./net/accessControl";
import { shouldRelock, DEFAULT_LOCK_TIMEOUT_MS } from "./identity/lockState";
import {
  initIdentity,
  lockVault,
  hasPin,
  getIdentityKeypair,
  getDisplayName,
  getAliases,
  getContact,
  upsertContact,
  blockedSet,
} from "./identity/identity";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { UnlockScreen } from "./screens/UnlockScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
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
import { parseScreenOverride } from "./dev/screenOverride";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";
const GHOST_MODE_STORAGE_KEY = "trojan-troy-ghost-mode";
const CONTACTS_ONLY_STORAGE_KEY = "trojan-troy-contacts-only";

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

type AppState = "loading" | "setup" | "unlock" | "ready";

type Screen =
  | { name: "start" }
  | { name: "waiting"; roomCode: string }
  | { name: "handshake"; roomCode: string }
  | {
      name: "safety-number";
      roomCode: string;
      safetyNumber: string;
      recognized: boolean;
      contactName?: string;
    }
  | { name: "chat"; roomCode: string; safetyNumber: string }
  | {
      name: "error";
      scenario: ErrorScenario;
      /** How to replay the failed action, if it can be retried in place. */
      retry?: { kind: "start" } | { kind: "join"; roomCode: string };
    };

export default function App() {
  const devOverride = import.meta.env.DEV ? parseScreenOverride(window.location.search) : null;
  const [appState, setAppState] = useState<AppState>(devOverride ? "ready" : "loading");
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [initialJoinCode] = useState<string | null>(() => parseInviteCode(window.location.hash));
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const sessionKeysRef = useRef<SessionKeys | null>(null);
  const clientRef = useRef<RelayClient | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const { setTheme } = useTheme();

  const screenRef = useRef(screen);
  screenRef.current = screen;

  // The name we present in the identity handshake (chosen in the "join as"
  // picker); null = anonymous. And the peer's asserted identity, set aside so we
  // can save/update the contact once the safety number is confirmed.
  const presentedNameRef = useRef<string | null>(null);
  const peerHandshakeRef = useRef<{ identityKey: string; presentedName?: string } | null>(null);

  const pendingReadIdRef = useRef<string | null>(null);
  const [ghostMode, setGhostMode] = useState<boolean>(
    () => localStorage.getItem(GHOST_MODE_STORAGE_KEY) === "true"
  );
  const ghostModeRef = useRef(ghostMode);
  ghostModeRef.current = ghostMode;

  const [contactsOnly, setContactsOnly] = useState<boolean>(
    () => localStorage.getItem(CONTACTS_ONLY_STORAGE_KEY) === "true"
  );
  const contactsOnlyRef = useRef(contactsOnly);
  contactsOnlyRef.current = contactsOnly;

  const [peerPresence, setPeerPresence] = useState<PresenceState>("idle");
  const presenceExpiryRef = useRef<number | null>(null);
  const presenceSentRef = useRef<{ state: PresenceState; at: number }>({ state: "idle", at: 0 });

  function updateGhostMode(next: boolean) {
    localStorage.setItem(GHOST_MODE_STORAGE_KEY, String(next));
    setGhostMode(next);
  }
  function updateContactsOnly(next: boolean) {
    localStorage.setItem(CONTACTS_ONLY_STORAGE_KEY, String(next));
    setContactsOnly(next);
  }

  // Load or create the persistent identity on mount, routing to Setup (no name
  // yet) or Unlock (PIN-protected) before the app proper. Skipped under a dev
  // screen override, which renders a single screen in isolation.
  useEffect(() => {
    if (devOverride) return;
    void (async () => {
      const status = await initIdentity();
      setAppState(status === "locked" ? "unlock" : status);
    })();
  }, []);

  // Idle re-lock: when a PIN is set and we're sitting idle on the start screen,
  // drop the vault and require unlock again. Never fires mid-chat — the active
  // session's keys are independent of the identity vault (see spec).
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    function bump() {
      lastActivityRef.current = Date.now();
    }
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    const interval = window.setInterval(() => {
      if (
        hasPin() &&
        screenRef.current.name === "start" &&
        shouldRelock(lastActivityRef.current, Date.now(), DEFAULT_LOCK_TIMEOUT_MS)
      ) {
        lockVault();
        setShowContacts(false);
        setAppState("unlock");
      }
    }, 30_000);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      window.clearInterval(interval);
    };
  }, []);

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
    ownEphemeral: Keypair,
    ownIdentity: Keypair,
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
      if (envelope.type === "identity") {
        try {
          const peerIdentityKey = envelope.identityPublicKey;
          // Access gate — keyed on the identity KEY, never the presented name —
          // before deriving any session key or revealing chat.
          const decision = decideAccess(peerIdentityKey, {
            contactsOnly: contactsOnlyRef.current,
            blocked: blockedSet(),
            knownContact: !!getContact(peerIdentityKey),
          });
          if (decision !== "allow") {
            disconnected = true;
            client.close();
            clientRef.current = null;
            setScreen({
              name: "error",
              scenario: decision === "refuse-unknown" ? "not_a_contact" : "handshake_failed",
            });
            return;
          }

          const peerIdentityPub = await fromBase64(envelope.identityPublicKey);
          const peerEphemeralPub = await fromBase64(envelope.ephemeralPublicKey);
          sessionKeysRef.current = await deriveSessionKeys(
            ownIdentity,
            peerIdentityPub,
            ownEphemeral,
            peerEphemeralPub,
            role
          );
          const safetyNumber = await computeSafetyNumber(ownIdentity.publicKey, peerIdentityPub);
          const existing = getContact(peerIdentityKey);
          const recognized = !!existing;
          const contactName = existing?.label || existing?.displayName || envelope.displayName;
          peerHandshakeRef.current = {
            identityKey: peerIdentityKey,
            presentedName: envelope.displayName,
          };

          const elapsed = performance.now() - handshakeStart;
          if (elapsed < HANDSHAKE_MIN_MS) {
            await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_MIN_MS - elapsed));
          }
          if (disconnected) return;
          setScreen({ name: "safety-number", roomCode, safetyNumber, recognized, contactName });
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

    client.send({
      type: "identity",
      ephemeralPublicKey: await toBase64(ownEphemeral.publicKey),
      identityPublicKey: await toBase64(ownIdentity.publicKey),
      displayName: presentedNameRef.current ?? undefined,
    });
  }

  async function handleStart(presentedName: string | null = presentedNameRef.current) {
    presentedNameRef.current = presentedName;
    setConnectStatus("connecting");
    const ephemeral = await generateKeypair();
    const identity = await getIdentityKeypair();
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
        void exchangeKeys(client, ephemeral, identity, "initiator", currentRoomCode);
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

  async function handleJoin(roomCode: string, presentedName: string | null = presentedNameRef.current) {
    presentedNameRef.current = presentedName;
    setConnectStatus("connecting");
    const ephemeral = await generateKeypair();
    const identity = await getIdentityKeypair();
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
        // drop the peer's identity envelope), but hold the finished bar a beat on
        // the home screen before swapping in the handshake/loading screen.
        setConnectStatus("connected");
        void exchangeKeys(client, ephemeral, identity, "responder", roomCode);
        window.setTimeout(() => {
          setConnectStatus("idle");
          setScreen((prev) => (prev.name === "start" ? { name: "handshake", roomCode } : prev));
        }, CONNECT_COMPLETE_HOLD_MS);
      }
    });
    client.send({ type: "join", roomCode });
  }

  // Confirmed the safety number (new or recognized) → save/update the contact
  // keyed on their identity key, then unlock chat.
  async function handleVerified(roomCode: string, safetyNumber: string) {
    const peer = peerHandshakeRef.current;
    if (peer) {
      try {
        await upsertContact({
          identityPublicKey: peer.identityKey,
          displayName: peer.presentedName,
          safetyNumber,
        });
      } catch {
        // Non-fatal (e.g. in-memory fallback) — chat still proceeds.
      }
    }
    setScreen({ name: "chat", roomCode, safetyNumber });
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
    peerHandshakeRef.current = null;
    if (presenceExpiryRef.current !== null) {
      clearTimeout(presenceExpiryRef.current);
      presenceExpiryRef.current = null;
    }
    presenceSentRef.current = { state: "idle", at: 0 };
    setPeerPresence("idle");
    setConnectStatus("idle");
    setShowContacts(false);
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
          contactsOnly={contactsOnly}
          onContactsOnlyChange={updateContactsOnly}
          onOpenContacts={() => {}}
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
    return <StartJoinScreen onStart={() => {}} onJoin={() => {}} connectStatus="connecting" />;
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

  if (appState === "loading") {
    return <div style={{ minHeight: "100vh", background: "#070912" }} />;
  }
  if (appState === "setup") {
    return <SetupScreen onComplete={() => setAppState("ready")} />;
  }
  if (appState === "unlock") {
    return <UnlockScreen onUnlocked={() => setAppState("ready")} />;
  }

  if (screen.name === "start") {
    return (
      <StartJoinScreen
        onStart={handleStart}
        onJoin={handleJoin}
        connectStatus={connectStatus}
        initialCode={initialJoinCode ?? undefined}
        displayName={getDisplayName()}
        aliases={getAliases()}
      />
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
          recognized={screen.recognized}
          contactName={screen.contactName}
          onVerified={() => void handleVerified(screen.roomCode, screen.safetyNumber)}
        />
      );
    } else {
      content = (
        <ChatScreen
          roomCode={screen.roomCode}
          safetyNumber={screen.safetyNumber}
          messages={messages}
          ghostMode={ghostMode}
          onGhostModeChange={updateGhostMode}
          contactsOnly={contactsOnly}
          onContactsOnlyChange={updateContactsOnly}
          onOpenContacts={() => setShowContacts(true)}
          peerPresence={peerPresence}
          onPresence={sendPresence}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
          onLeave={handleLeave}
        />
      );
    }
    return (
      <>
        <HandshakeJourney activeKey={screen.name}>{content}</HandshakeJourney>
        {showContacts && <ContactsScreen onBack={() => setShowContacts(false)} />}
      </>
    );
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
