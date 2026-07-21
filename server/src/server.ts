import { WebSocketServer, type WebSocket } from "ws";
import { RoomManager, type Peer } from "./rooms.js";

interface Envelope {
  type: string;
  roomCode?: string;
}

// Caps a single WebSocket frame. Comfortably fits a 60s Opus voice clip
// (base64-encoded ciphertext inside a JSON envelope) while preventing a peer
// from forcing the relay to buffer arbitrarily large frames.
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

export function startRelay(port: number): WebSocketServer {
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD_BYTES });

  wss.on("error", (err) => {
    console.error("WebSocketServer error:", err);
  });

  wss.on("connection", (ws: WebSocket) => {
    const peer: Peer = { send: (data: string) => ws.send(data) };

    ws.on("error", (err) => {
      console.error("WebSocket connection error:", err);
    });

    ws.on("message", (raw) => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw.toString());
      } catch {
        peer.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        return;
      }

      if (envelope.type === "create") {
        const code = rooms.createRoom(peer);
        peer.send(JSON.stringify({ type: "created", roomCode: code }));
        return;
      }

      if (envelope.type === "join") {
        const result = rooms.joinRoom(envelope.roomCode ?? "", peer);
        if (!result.ok) {
          peer.send(JSON.stringify({ type: "error", message: result.message }));
        }
        return;
      }

      // Anything else (e.g. "pubkey", and later "ciphertext") is an opaque
      // blob the relay just forwards without inspecting.
      rooms.forward(peer, raw.toString());
    });

    ws.on("close", () => {
      rooms.disconnect(peer);
    });
  });

  return wss;
}
