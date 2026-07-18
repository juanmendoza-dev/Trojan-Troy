import { WebSocketServer, type WebSocket } from "ws";
import { RoomManager, type Peer } from "./rooms.js";

interface Envelope {
  type: string;
  roomCode?: string;
}

export function startRelay(port: number): WebSocketServer {
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    const peer: Peer = { send: (data: string) => ws.send(data) };

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
