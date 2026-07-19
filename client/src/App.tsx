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

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";

type Screen =
  | { name: "start" }
  | { name: "waiting"; roomCode: string }
  | { name: "safety-number"; safetyNumber: string }
  | { name: "chat" }
  | { name: "error"; message: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sessionKeysRef = useRef<SessionKeys | null>(null);
  const clientRef = useRef<RelayClient | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  useEffect(() => {
    return () => {
      for (const message of messagesRef.current) {
        if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
      }
    };
  }, []);

  async function exchangeKeys(
    client: RelayClient,
    own: Keypair,
    role: "initiator" | "responder"
  ) {
    client.onMessage(async (envelope: Envelope) => {
      if (envelope.type === "peer-disconnected") {
        setScreen({ name: "error", message: "Your friend disconnected." });
        return;
      }
      if (envelope.type === "pubkey") {
        try {
          const peerPublicKey = await fromBase64(envelope.payload);
          sessionKeysRef.current = await deriveSessionKeys(own, peerPublicKey, role);
          const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey);
          setScreen({ name: "safety-number", safetyNumber });
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
    client.onMessage((envelope) => {
      if (envelope.type === "created") {
        setScreen({ name: "waiting", roomCode: envelope.roomCode });
      }
      if (envelope.type === "peer-connected") {
        void exchangeKeys(client, own, "initiator");
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
        void exchangeKeys(client, own, "responder");
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

  if (screen.name === "start") {
    return <StartJoinScreen onStart={handleStart} onJoin={handleJoin} />;
  }
  if (screen.name === "waiting") {
    return <WaitingScreen roomCode={screen.roomCode} />;
  }
  if (screen.name === "safety-number") {
    return (
      <SafetyNumberScreen
        safetyNumber={screen.safetyNumber}
        onVerified={() => setScreen({ name: "chat" })}
      />
    );
  }
  if (screen.name === "chat") {
    return <ChatScreen messages={messages} onSend={handleSend} onSendVoice={handleSendVoice} />;
  }
  return (
    <div>
      <h1>Something went wrong</h1>
      <p>{screen.message}</p>
    </div>
  );
}
