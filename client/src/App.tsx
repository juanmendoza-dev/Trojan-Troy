import { useState } from "react";
import { RelayClient, type Envelope } from "./net/relayClient";
import { generateKeypair, deriveSessionKeys, type Keypair } from "./crypto/keys";
import { computeSafetyNumber } from "./crypto/safetyNumber";
import { toBase64, fromBase64 } from "./crypto/encoding";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { WaitingScreen } from "./screens/WaitingScreen";
import { SafetyNumberScreen } from "./screens/SafetyNumberScreen";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";

type Screen =
  | { name: "start" }
  | { name: "waiting"; roomCode: string }
  | { name: "safety-number"; safetyNumber: string }
  | { name: "error"; message: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "start" });

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
        const peerPublicKey = await fromBase64(envelope.payload);
        await deriveSessionKeys(own, peerPublicKey, role);
        const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey);
        setScreen({ name: "safety-number", safetyNumber });
      }
    });

    client.send({ type: "pubkey", payload: await toBase64(own.publicKey) });
  }

  async function handleStart() {
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    await client.waitForOpen();
    client.onMessage((envelope) => {
      if (envelope.type === "created") {
        setScreen({ name: "waiting", roomCode: envelope.roomCode });
      }
      if (envelope.type === "peer-connected") {
        void exchangeKeys(client, own, "initiator");
      }
    });
    client.send({ type: "create" });
  }

  async function handleJoin(roomCode: string) {
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    await client.waitForOpen();
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
        onVerified={() => {
          // Phase 2 wires the derived session keys to encrypted messaging here.
        }}
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
