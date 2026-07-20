import { useEffect, useRef, useState } from "react";
import { RelayClient, type Envelope } from "./net/relayClient";
import { generateKeypair, deriveSessionKeys, type Keypair, type SessionKeys } from "./crypto/keys";
import { computeSafetyNumber } from "./crypto/safetyNumber";
import { toBase64, fromBase64 } from "./crypto/encoding";
import { encryptMessage, decryptMessage } from "./crypto/messages";
import { encryptVoiceClip, decryptVoiceClip } from "./crypto/media";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { WaitingScreen } from "./screens/WaitingScreen";
import { SafetyNumberScreen } from "./screens/SafetyNumberScreen";
import { ChatScreen, type ChatMessage } from "./screens/ChatScreen";
import { useTheme } from "./theme/ThemeContext";
import { LoadingScreen } from "./screens/loading/LoadingScreen";
import { parseScreenOverride } from "./dev/screenOverride";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";

type Screen =
  | { name: "start" }
  | { name: "waiting"; roomCode: string }
  | { name: "handshake"; roomCode: string }
  | { name: "safety-number"; roomCode: string; safetyNumber: string }
  | { name: "chat"; roomCode: string }
  | { name: "error"; message: string };

export default function App() {
  const devOverride = import.meta.env.DEV ? parseScreenOverride(window.location.search) : null;
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sessionKeysRef = useRef<SessionKeys | null>(null);
  const clientRef = useRef<RelayClient | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const { loadingScheme, setTheme } = useTheme();

  useEffect(() => {
    return () => {
      for (const message of messagesRef.current) {
        if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (devOverride?.theme) setTheme(devOverride.theme);
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
        setScreen({ name: "error", message: "Your friend disconnected." });
        return;
      }
      if (envelope.type === "pubkey") {
        try {
          const peerPublicKey = await fromBase64(envelope.payload);
          sessionKeysRef.current = await deriveSessionKeys(own, peerPublicKey, role);
          const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey);
          const elapsed = performance.now() - handshakeStart;
          if (elapsed < HANDSHAKE_MIN_MS) {
            await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_MIN_MS - elapsed));
          }
          if (disconnected) return;
          setScreen({ name: "safety-number", roomCode, safetyNumber });
        } catch {
          setScreen({ name: "error", message: "Key exchange failed." });
        }
        return;
      }
      if (envelope.type === "ciphertext") {
        const keys = sessionKeysRef.current;
        if (!keys) return;
        try {
          const text = await decryptMessage(keys.rx, envelope.payload);
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), from: "peer", kind: "text", text },
          ]);
        } catch {
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), kind: "decryption-error" }]);
        }
        return;
      }
      if (envelope.type === "voice") {
        const keys = sessionKeysRef.current;
        if (!keys) return;
        try {
          const blob = await decryptVoiceClip(keys.rx, envelope.payload, envelope.mimeType);
          const audioUrl = URL.createObjectURL(blob);
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), from: "peer", kind: "voice", audioUrl },
          ]);
        } catch {
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), kind: "decryption-error" }]);
        }
      }
    });

    client.send({ type: "pubkey", payload: await toBase64(own.publicKey) });
  }

  async function handleStart() {
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    clientRef.current = client;
    try {
      await client.waitForOpen();
    } catch {
      setScreen({ name: "error", message: "Could not connect to the relay." });
      return;
    }
    let currentRoomCode = "";
    client.onMessage((envelope) => {
      if (envelope.type === "created") {
        currentRoomCode = envelope.roomCode;
        setScreen({ name: "waiting", roomCode: envelope.roomCode });
      }
      if (envelope.type === "peer-connected") {
        setScreen({ name: "handshake", roomCode: currentRoomCode });
        void exchangeKeys(client, own, "initiator", currentRoomCode);
      }
      if (envelope.type === "error") {
        setScreen({ name: "error", message: envelope.message });
      }
    });
    client.send({ type: "create" });
  }

  async function handleJoin(roomCode: string) {
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    clientRef.current = client;
    try {
      await client.waitForOpen();
    } catch {
      setScreen({ name: "error", message: "Could not connect to the relay." });
      return;
    }
    client.onMessage((envelope) => {
      if (envelope.type === "error") {
        setScreen({ name: "error", message: envelope.message });
      }
      if (envelope.type === "peer-connected") {
        setScreen({ name: "handshake", roomCode });
        void exchangeKeys(client, own, "responder", roomCode);
      }
    });
    client.send({ type: "join", roomCode });
  }

  async function handleSend(text: string) {
    const keys = sessionKeysRef.current;
    const client = clientRef.current;
    if (!keys || !client) return;
    const payload = await encryptMessage(keys.tx, text);
    client.send({ type: "ciphertext", payload });
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), from: "me", kind: "text", text }]);
  }

  async function handleSendVoice(blob: Blob, mimeType: string) {
    const keys = sessionKeysRef.current;
    const client = clientRef.current;
    if (!keys || !client) return;
    const payload = await encryptVoiceClip(keys.tx, blob);
    client.send({ type: "voice", payload, mimeType });
    const audioUrl = URL.createObjectURL(blob);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), from: "me", kind: "voice", audioUrl },
    ]);
  }

  if (devOverride?.screen === "loading") {
    return <LoadingScreen roomCode="K7F-2QX" scheme={loadingScheme} />;
  }
  if (devOverride?.screen === "chat") {
    return (
      <ChatScreen
        roomCode="K7F-2QX"
        messages={[
          { id: "1", from: "peer", kind: "text", text: "did you check the safety number?" },
          { id: "2", from: "me", kind: "text", text: "yep — 21934 07741 66012 — matches on my end" },
          { id: "3", from: "me", kind: "text", text: "got it — nothing between us but ciphertext." },
        ]}
        onSend={() => {}}
        onSendVoice={() => {}}
      />
    );
  }
  if (screen.name === "start") {
    return <StartJoinScreen onStart={handleStart} onJoin={handleJoin} />;
  }
  if (screen.name === "waiting") {
    return <WaitingScreen roomCode={screen.roomCode} />;
  }
  if (screen.name === "handshake") {
    return <LoadingScreen roomCode={screen.roomCode} scheme={loadingScheme} />;
  }
  if (screen.name === "safety-number") {
    return (
      <SafetyNumberScreen
        safetyNumber={screen.safetyNumber}
        onVerified={() => setScreen({ name: "chat", roomCode: screen.roomCode })}
      />
    );
  }
  if (screen.name === "chat") {
    return (
      <ChatScreen
        roomCode={screen.roomCode}
        messages={messages}
        onSend={handleSend}
        onSendVoice={handleSendVoice}
      />
    );
  }
  return (
    <div>
      <h1>Something went wrong</h1>
      <p>{screen.message}</p>
    </div>
  );
}
