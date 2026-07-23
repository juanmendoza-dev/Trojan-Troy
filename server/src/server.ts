import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { RoomManager, type Peer } from "./rooms.js";

interface Envelope {
  type: string;
  roomCode?: string;
}

// --- Abuse-control defaults (all in-memory, no new deps). --------------------
// maxPayload is sized to the largest legitimate encrypted voice envelope: a 60s
// Opus clip (~1 MB) framed + padded to a 16 KiB bucket, AEAD-tagged, base64'd
// (~1.33x) and wrapped in a small JSON envelope lands near ~1.35 MB. 2 MiB
// leaves headroom; `ws` rejects anything bigger with close code 1009 *before*
// buffering it, instead of inheriting ws's 100 MiB default. (Review H3.)
const DEFAULT_MAX_PAYLOAD = 2 * 1024 * 1024;
const DEFAULT_MAX_CONNECTIONS = 1000;
const DEFAULT_MAX_CONNECTIONS_PER_IP = 30;
// Token bucket per connection: a normal 2-person chat peaks at a few msgs/sec
// (presence heartbeats every 2.5s, user-paced text/voice), so this is generous
// for real use but trips a flood well before it costs anything.
const DEFAULT_MSG_BURST = 60;
const DEFAULT_MSG_REFILL_PER_SEC = 30;

// WebSocket close codes we use for policy rejections.
const CLOSE_POLICY = 1008; // rate-limit / protocol abuse
const CLOSE_TRY_LATER = 1013; // at capacity

export interface RelayOptions {
  maxPayload?: number;
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  maxRooms?: number;
  msgBurst?: number;
  msgRefillPerSec?: number;
  roomTtlMs?: number;
}

interface ConnState {
  ip: string;
  tokens: number;
  lastRefill: number;
}

// Refill then try to spend one token. Returns false when the bucket is empty,
// i.e. the connection is sending faster than the sustained rate allows.
function consumeToken(state: ConnState, burst: number, refillPerSec: number): boolean {
  const now = Date.now();
  const elapsedSec = (now - state.lastRefill) / 1000;
  state.tokens = Math.min(burst, state.tokens + elapsedSec * refillPerSec);
  state.lastRefill = now;
  if (state.tokens < 1) return false;
  state.tokens -= 1;
  return true;
}

export function startRelay(port: number, options: RelayOptions = {}): WebSocketServer {
  const maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const maxConnectionsPerIp = options.maxConnectionsPerIp ?? DEFAULT_MAX_CONNECTIONS_PER_IP;
  const msgBurst = options.msgBurst ?? DEFAULT_MSG_BURST;
  const msgRefillPerSec = options.msgRefillPerSec ?? DEFAULT_MSG_REFILL_PER_SEC;

  const rooms = new RoomManager(options.roomTtlMs, options.maxRooms);
  const wss = new WebSocketServer({ port, maxPayload });

  let totalConnections = 0;
  const connectionsPerIp = new Map<string, number>();

  wss.on("error", (err) => {
    console.error("WebSocketServer error:", err);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? "unknown";

    // Global and per-IP connection caps: bound how much one source (or the
    // whole server) can hold open. Reject over-cap sockets right away.
    const ipCount = connectionsPerIp.get(ip) ?? 0;
    if (totalConnections >= maxConnections || ipCount >= maxConnectionsPerIp) {
      ws.close(CLOSE_TRY_LATER, "Too many connections");
      return;
    }
    totalConnections++;
    connectionsPerIp.set(ip, ipCount + 1);

    const state: ConnState = { ip, tokens: msgBurst, lastRefill: Date.now() };
    const peer: Peer = { send: (data: string) => ws.send(data) };

    ws.on("error", (err) => {
      console.error("WebSocket connection error:", err);
    });

    ws.on("message", (raw) => {
      // Per-connection message-rate throttle; close on breach.
      if (!consumeToken(state, msgBurst, msgRefillPerSec)) {
        ws.close(CLOSE_POLICY, "Rate limit exceeded");
        return;
      }

      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw.toString());
      } catch {
        peer.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        return;
      }

      if (envelope.type === "create") {
        if (rooms.atRoomCapacity()) {
          peer.send(JSON.stringify({ type: "error", message: "Server at capacity" }));
          return;
        }
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

      // Anything else (e.g. "pubkey", and the unified "msg" envelope) is an
      // opaque blob the relay just forwards without inspecting.
      rooms.forward(peer, raw.toString());
    });

    ws.on("close", () => {
      rooms.disconnect(peer);
      totalConnections--;
      const remaining = (connectionsPerIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) connectionsPerIp.delete(ip);
      else connectionsPerIp.set(ip, remaining);
    });
  });

  return wss;
}
