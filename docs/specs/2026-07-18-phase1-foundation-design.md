# Phase 1 — Foundation: Design Spec

Status: Approved
Date: 2026-07-18

## Purpose

Phase 1 of `roadmap.md`: key generation and key exchange between two users,
plus a safety-number verification screen so both users can confirm they're
talking to each other and not a man-in-the-middle. This is the foundation
everything else (Phase 2 encrypted messaging, Phase 3 voice) builds on.

## Scope

In scope for this spec:
- Client web app skeleton (React + Vite + TypeScript).
- Relay server skeleton (Node.js + WebSocket, TypeScript).
- Room-code pairing (no accounts).
- X25519 keypair generation and key exchange via libsodium.js.
- Safety-number computation and verification screen.

Out of scope (later phases / explicitly deferred):
- Actual chat message encryption/decryption (Phase 2).
- Voice messages (Phase 3).
- Visual polish (Phase 4) — this phase just needs to work, not look good.
- Desktop (Electron) wrapper — added later around the same web app.
- Persistent user identity / accounts — see "Ephemeral session keys" below.
- Message/room persistence — relay is in-memory only.

## Architecture

```
/client   React + Vite web app (TypeScript)
/server   Node.js WebSocket relay (TypeScript)
```

Two independent packages, no monorepo tooling (npm workspaces, Turborepo,
etc.) — not worth the setup cost for two packages and a two-person team.

**Pairing model:** no accounts. One user starts a session and gets a
shareable room code/link; the other joins with it. The relay pairs the two
WebSocket connections into a room and forwards opaque messages between them.
It never inspects payload content — not in Phase 1 (key-exchange blobs) and
not in Phase 2 (ciphertext).

## Components

### Relay server (`/server`)
- In-memory map: `roomCode → { socketA, socketB? }`.
- `create` — client connects, asks for a new room, server generates a code
  (short, human-shareable, e.g. 6 alphanumeric characters) and returns it.
- `join` — second client connects with a room code; if the room exists and
  has one open slot, the server pairs them and emits a `peer-connected`
  event to both sides.
- `relay` — any message from one peer in a paired room is forwarded
  verbatim to the other peer. The server does not parse or validate the
  payload beyond the outer envelope (see Message envelope below).
- Room teardown: either socket disconnecting closes the room and notifies
  the other side (`peer-disconnected`).
- Room TTL: a room with no second joiner expires after 10 minutes and is
  discarded.

### Client crypto module (`/client`)
Thin wrapper around libsodium.js, no crypto logic inlined into UI code:
- `generateKeypair()` — wraps `crypto_kx_keypair()`.
- `deriveSessionKeys(ownKeypair, peerPublicKey, role)` — wraps
  `crypto_kx_client_session_keys` / `crypto_kx_server_session_keys`
  (role is decided by who created vs. joined the room — arbitrary but must
  be consistent so both sides derive matching rx/tx keys).
- `computeSafetyNumber(publicKeyA, publicKeyB)` — hashes both public keys
  together (sorted/concatenated deterministically so both clients get the
  same result regardless of order) with `crypto_generichash`, formats the
  digest as grouped digits (Signal-style) for display.

### Client UI (`/client`)
- **Start / Join screen** — "Start a chat" (create room) or "Join a chat"
  (enter code).
- **Waiting screen** — shown after creating a room, displays the
  shareable code/link, waits for `peer-connected`.
- **Safety number screen** — shown once both public keys have been
  exchanged and session keys derived. Displays the computed safety number
  and a "Verified" confirmation control.

## Data flow

1. User A clicks "Start a chat" → client generates an X25519 keypair
   (`generateKeypair`) → opens a WebSocket to the relay → sends `create` →
   relay creates a room, returns the room code.
2. User A shares the code/link with User B (out of band — text, call,
   whatever).
3. User B clicks "Join a chat", enters the code → client generates its own
   keypair → opens a WebSocket → sends `join` with the code → relay pairs
   the sockets → both clients receive `peer-connected`.
4. Each client sends its public key to the relay, which forwards it to the
   peer (`{ type: "pubkey", payload: <base64 public key> }`).
5. On receiving the peer's public key, each client independently calls
   `deriveSessionKeys` and `computeSafetyNumber`. Both computations happen
   entirely client-side — the relay never sees a private key or the
   derived session keys, and can't compute the safety number itself.
6. UI transitions to the safety number screen. Both users compare the
   number out of band and mark it verified locally.

## Message envelope (client ↔ relay)

Every WebSocket message is a small JSON envelope so the relay can route
without understanding payloads:

```ts
type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  | { type: "pubkey"; payload: string }   // base64
  | { type: "error"; message: string };
```

Phase 2 will add a `type: "ciphertext"` variant reusing this same envelope
and relay logic — the relay code does not need to change shape, just grow
one more pass-through message type.

## Ephemeral session keys

Keypairs are generated fresh per session and held only in memory — nothing
is persisted to disk or `localStorage`. This means the safety number
verifies "this session" rather than "this person, permanently" the way
Signal's identity-key-based safety number does.

This is a deliberate scope cut for Version A (see `decisions.md`). If a
future version wants persistent identity, that requires: local key
storage, a key-rotation/backup story, and re-verification UI when a key
changes — meaningfully more work, not something to bolt on casually.

## Error handling

- Room code not found, already full, or expired → relay sends
  `{ type: "error", message: ... }`; UI shows a clear message and returns
  to the Start/Join screen.
- Peer disconnects before or during key exchange → UI shows
  "peer disconnected," returns to the Start/Join screen. No reconnect
  attempt in Phase 1 — user just starts over.
- WebSocket connection drop (network issue) → UI shows a connection-lost
  state; user can refresh to retry. No automatic reconnect logic in this
  phase.

## Testing

- **Crypto module** (`/client`): unit tests for `generateKeypair`,
  `deriveSessionKeys` (both clients' derived keys must match given the
  same two public keys), and `computeSafetyNumber` (deterministic
  regardless of argument order). Pure functions, no network/UI needed.
- **Relay** (`/server`): unit tests for room lifecycle — create, join,
  forward, disconnect/teardown, TTL expiry — using a lightweight WebSocket
  test client against a locally started server instance.
- **Manual/integration**: two browser windows against a local relay,
  confirm both sides land on the same safety number.
