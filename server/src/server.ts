import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { RoomManager, isValidRoomCode, type Peer } from "./rooms.js";

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
// for real use but trips a flood well before it costs anything. (Review H3.)
const DEFAULT_MSG_BURST = 60;
const DEFAULT_MSG_REFILL_PER_SEC = 30;
// A tighter bucket just for `join` attempts: a real user joins once, so this
// still lets legitimate use through while throttling blind room-code
// enumeration to a crawl. (Review M1.)
const DEFAULT_JOIN_BURST = 10;
const DEFAULT_JOIN_REFILL_PER_SEC = 1;
// Ping every connection on this interval; a socket that misses a whole interval
// without a pong is presumed dead and terminated. Reaps half-open sockets that
// would otherwise accumulate forever. (Review H3.)
const DEFAULT_HEARTBEAT_MS = 30_000;

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
  joinBurst?: number;
  joinRefillPerSec?: number;
  heartbeatIntervalMs?: number;
  // If set, only these exact origins (plus localhost) may connect. Overrides
  // the ALLOWED_ORIGINS env var; mainly here for tests.
  allowedOrigins?: string[];
  roomTtlMs?: number;
}

// `ws` doesn't type per-socket app state, so we tag the heartbeat liveness flag
// onto the socket the way the ws docs recommend.
interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

interface ConnState {
  ip: string;
  msg: Bucket;
  join: Bucket;
}

// Refill then try to spend one token. Returns false when the bucket is empty,
// i.e. the caller is going faster than the sustained rate allows.
function consume(bucket: Bucket, burst: number, refillPerSec: number): boolean {
  const now = Date.now();
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsedSec * refillPerSec);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A loopback origin — always allowed so `npm run dev` keeps working regardless
// of the configured allowlist.
function isLocalhostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

// Resolve the origin allowlist from options (tests) or the ALLOWED_ORIGINS env
// var (comma-separated). Returns null when none is configured — the caller then
// fails OPEN so a missing env var can't accidentally lock out production.
function resolveAllowedOrigins(options: RelayOptions): string[] | null {
  if (options.allowedOrigins) return options.allowedOrigins;
  const env = process.env.ALLOWED_ORIGINS;
  if (!env) return null;
  const list = env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

export function startRelay(port: number, options: RelayOptions = {}): WebSocketServer {
  const maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const maxConnectionsPerIp = options.maxConnectionsPerIp ?? DEFAULT_MAX_CONNECTIONS_PER_IP;
  const msgBurst = options.msgBurst ?? DEFAULT_MSG_BURST;
  const msgRefillPerSec = options.msgRefillPerSec ?? DEFAULT_MSG_REFILL_PER_SEC;
  const joinBurst = options.joinBurst ?? DEFAULT_JOIN_BURST;
  const joinRefillPerSec = options.joinRefillPerSec ?? DEFAULT_JOIN_REFILL_PER_SEC;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;

  const allowedOrigins = resolveAllowedOrigins(options);
  if (!allowedOrigins && !process.env.VITEST) {
    console.warn(
      "[relay] ALLOWED_ORIGINS is unset — accepting connections from any origin. " +
        "Set ALLOWED_ORIGINS (comma-separated) in production to lock this down.",
    );
  }

  // Cross-site WebSocket hijack guard. Fail-safe by design: browserless clients
  // (no Origin header) and localhost are always allowed, and an unconfigured
  // allowlist fails OPEN rather than rejecting live production traffic. (L5.)
  function isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true;
    if (isLocalhostOrigin(origin)) return true;
    if (!allowedOrigins) return true;
    return allowedOrigins.includes(origin);
  }

  const rooms = new RoomManager(options.roomTtlMs, options.maxRooms);
  const wss = new WebSocketServer({
    port,
    maxPayload,
    verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) =>
      isOriginAllowed(info.origin),
  });

  let totalConnections = 0;
  const connectionsPerIp = new Map<string, number>();

  // Heartbeat sweep: terminate any socket that didn't pong since the last tick,
  // then ping the rest. `unref` so it can't by itself keep the process alive.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const tracked = client as TrackedSocket;
      if (tracked.isAlive === false) {
        tracked.terminate();
        continue;
      }
      tracked.isAlive = false;
      tracked.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  wss.on("error", (err) => {
    console.error("WebSocketServer error:", err);
  });

  wss.on("close", () => {
    clearInterval(heartbeat);
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

    const now = Date.now();
    const state: ConnState = {
      ip,
      msg: { tokens: msgBurst, lastRefill: now },
      join: { tokens: joinBurst, lastRefill: now },
    };
    const peer: Peer = { send: (data: string) => ws.send(data) };

    const tracked = ws as TrackedSocket;
    tracked.isAlive = true;
    ws.on("pong", () => {
      tracked.isAlive = true;
    });

    ws.on("error", (err) => {
      console.error("WebSocket connection error:", err);
    });

    ws.on("message", (raw) => {
      // Per-connection message-rate throttle; close on breach.
      if (!consume(state.msg, msgBurst, msgRefillPerSec)) {
        ws.close(CLOSE_POLICY, "Rate limit exceeded");
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        peer.send(JSON.stringify({ type: "error", message: "Invalid message" }));
        return;
      }

      // Only the structural create/join branches below are validated.
      // Everything else — "pubkey" and the unified opaque "msg" envelope that
      // carries all real traffic — is forwarded verbatim; the E2EE layer relies
      // on the relay never inspecting it, so this path must stay untouched.
      const envelope = isPlainObject(parsed) ? parsed : null;
      const type = envelope && typeof envelope.type === "string" ? envelope.type : undefined;

      if (type === "create") {
        if (rooms.atRoomCapacity()) {
          peer.send(JSON.stringify({ type: "error", message: "Server at capacity" }));
          return;
        }
        const code = rooms.createRoom(peer);
        peer.send(JSON.stringify({ type: "created", roomCode: code }));
        return;
      }

      if (type === "join") {
        // Dedicated join-attempt throttle on top of the message throttle, to
        // make blind room-code enumeration impractical.
        if (!consume(state.join, joinBurst, joinRefillPerSec)) {
          ws.close(CLOSE_POLICY, "Too many join attempts");
          return;
        }
        const roomCode = envelope?.roomCode;
        if (!isValidRoomCode(roomCode)) {
          peer.send(JSON.stringify({ type: "error", message: "Invalid room code" }));
          return;
        }
        const result = rooms.joinRoom(roomCode, peer);
        if (!result.ok) {
          peer.send(JSON.stringify({ type: "error", message: result.message }));
        }
        return;
      }

      // Opaque pass-through: forward verbatim, never inspected.
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
