# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two users can open Trojan Troy, pair up via a shared room code, exchange public keys, and land on a safety-number screen showing a matching fingerprint on both sides — with the relay server never seeing a private key, a derived session key, or the safety number itself.

**Architecture:** Two independent TypeScript packages, `/server` (Node.js + `ws`, an in-memory room pairing relay that forwards opaque JSON envelopes) and `/client` (React + Vite, all crypto done client-side with libsodium.js). No accounts, no database — pairing is by shareable room code, sessions are ephemeral.

**Tech Stack:** TypeScript on both sides, Node.js + `ws` (server), React + Vite (client), libsodium.js (`libsodium-wrappers`) for X25519 key exchange and hashing, Vitest for tests on both packages.

## Global Constraints

- Never implement custom cryptographic primitives — libsodium.js only, no hand-rolled crypto (`AGENTS.md`, `roadmap.md`).
- The relay server only ever routes opaque JSON envelopes — it must never parse, inspect, or derive anything from envelope payloads beyond the `type` field needed to route (`decisions.md`).
- No user accounts. Pairing is room-code based (`decisions.md`).
- Session keys are ephemeral — generated in memory per session, never persisted to disk or `localStorage` (`decisions.md`, spec).
- Commit messages must be short, plain-language, human-sounding — no AI-flavored verbosity, no extra trailers (`AGENTS.md`).
- Every commit must be GPG-signed and authored as the human git identity already configured on this machine — never as an AI agent, never co-authored by one (`AGENTS.md`).
- **On this machine, run `git commit` via PowerShell, not the Bash/Git-Bash tool.** Git Bash's bundled `gpg` reads a different keyring than the native Windows `gpg`, so signing silently fails there even though signing works fine from PowerShell. `git add`, `git push`, and other non-signing git commands are fine from either shell.
- Commit early and often — one commit per task minimum, more if a task's steps naturally split (`AGENTS.md`).

---

## File Structure

```
server/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  src/
    rooms.ts          # RoomManager — pure pairing/forwarding logic, no sockets
    rooms.test.ts
    server.ts          # Wires RoomManager to a real WebSocketServer
    server.test.ts      # Integration test with real ws clients
    index.ts            # Entry point: starts the relay on PORT

client/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  index.html
  src/
    main.tsx
    App.tsx                        # Screen state machine, wires net + crypto together
    crypto/
      encoding.ts                  # base64 <-> Uint8Array helpers
      encoding.test.ts
      keys.ts                      # generateKeypair, deriveSessionKeys
      keys.test.ts
      safetyNumber.ts              # computeSafetyNumber
      safetyNumber.test.ts
    net/
      relayClient.ts               # WebSocket wrapper, envelope framing, testable via DI
      relayClient.test.ts
    screens/
      StartJoinScreen.tsx
      WaitingScreen.tsx
      SafetyNumberScreen.tsx

.gitignore            # root — node_modules, dist (belt-and-suspenders alongside per-package ones)
README.md              # modified — add "Development" run instructions
progress.md            # modified — Phase 1 status + log entry
```

---

### Task 1: Server package scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/.gitignore`
- Create: `.gitignore` (repo root)

**Interfaces:**
- Produces: a working `npm test` / `npm run dev` / `npm run build` toolchain in `server/` that Task 2 builds real code on top of.

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "trojan-troy-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/ws": "^8.5.10",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `server/.gitignore`**

```
node_modules
dist
```

- [ ] **Step 5: Create root `.gitignore`**

```
node_modules
dist
```

- [ ] **Step 6: Install dependencies and verify the toolchain**

Run: `cd server && npm install && npm test`
Expected: `npm install` completes with no errors; `npm test` prints something like `No test files found, exiting with code 0` and exits 0 (this is expected — no test files exist yet).

- [ ] **Step 7: Commit** (run from PowerShell)

```bash
git add server/package.json server/tsconfig.json server/vitest.config.ts server/.gitignore .gitignore
git commit -m "Scaffold server package"
```

---

### Task 2: Room manager (pairing + forwarding logic)

**Files:**
- Create: `server/src/rooms.ts`
- Test: `server/src/rooms.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no dependency on `ws`).
- Produces: `RoomManager` class and `Peer` interface, used by Task 3's `server.ts`.
  - `interface Peer { send(data: string): void }`
  - `class RoomManager { constructor(ttlMs?: number); createRoom(creator: Peer): string; joinRoom(code: string, joiner: Peer): { ok: true } | { ok: false; message: string }; forward(sender: Peer, message: string): void; disconnect(peer: Peer): void; hasRoom(code: string): boolean }`

- [ ] **Step 1: Write the failing tests**

Create `server/src/rooms.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { RoomManager, type Peer } from "./rooms";

function fakePeer(): Peer & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    send: (data: string) => messages.push(data),
  };
}

describe("RoomManager", () => {
  it("creates a room and returns a 6-character code", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();

    const code = rooms.createRoom(creator);

    expect(code).toHaveLength(6);
    expect(rooms.hasRoom(code)).toBe(true);
  });

  it("pairs a joiner with the creator and notifies both", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const code = rooms.createRoom(creator);

    const result = rooms.joinRoom(code, joiner);

    expect(result).toEqual({ ok: true });
    expect(creator.messages).toContain(JSON.stringify({ type: "peer-connected" }));
    expect(joiner.messages).toContain(JSON.stringify({ type: "peer-connected" }));
  });

  it("rejects joining a room that does not exist", () => {
    const rooms = new RoomManager();
    const joiner = fakePeer();

    const result = rooms.joinRoom("NOPE12", joiner);

    expect(result).toEqual({ ok: false, message: "Room not found" });
  });

  it("rejects joining a room that already has two peers", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const thirdWheel = fakePeer();
    const code = rooms.createRoom(creator);
    rooms.joinRoom(code, joiner);

    const result = rooms.joinRoom(code, thirdWheel);

    expect(result).toEqual({ ok: false, message: "Room is full" });
  });

  it("forwards a message from one peer to the other, not back to the sender", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const code = rooms.createRoom(creator);
    rooms.joinRoom(code, joiner);

    rooms.forward(creator, "hello");

    expect(joiner.messages).toContain("hello");
    expect(creator.messages).not.toContain("hello");
  });

  it("notifies the remaining peer and keeps the room on a two-peer disconnect", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const joiner = fakePeer();
    const code = rooms.createRoom(creator);
    rooms.joinRoom(code, joiner);

    rooms.disconnect(creator);

    expect(joiner.messages).toContain(JSON.stringify({ type: "peer-disconnected" }));
    expect(rooms.hasRoom(code)).toBe(true);
  });

  it("deletes the room when the last peer disconnects", () => {
    const rooms = new RoomManager();
    const creator = fakePeer();
    const code = rooms.createRoom(creator);

    rooms.disconnect(creator);

    expect(rooms.hasRoom(code)).toBe(false);
  });

  it("expires an unjoined room after the TTL", () => {
    vi.useFakeTimers();
    const rooms = new RoomManager(1000);
    const creator = fakePeer();
    const code = rooms.createRoom(creator);

    vi.advanceTimersByTime(1001);

    expect(rooms.hasRoom(code)).toBe(false);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './rooms'` (or similar), since `rooms.ts` doesn't exist yet.

- [ ] **Step 3: Implement `server/src/rooms.ts`**

```ts
export interface Peer {
  send(data: string): void;
}

interface Room {
  code: string;
  peers: Peer[];
  timeout: ReturnType<typeof setTimeout>;
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private peerRooms = new Map<Peer, string>();

  constructor(private ttlMs: number = DEFAULT_TTL_MS) {}

  private generateCode(): string {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    return code;
  }

  createRoom(creator: Peer): string {
    let code = this.generateCode();
    while (this.rooms.has(code)) {
      code = this.generateCode();
    }
    const timeout = setTimeout(() => {
      this.rooms.delete(code);
    }, this.ttlMs);
    this.rooms.set(code, { code, peers: [creator], timeout });
    this.peerRooms.set(creator, code);
    return code;
  }

  joinRoom(code: string, joiner: Peer): { ok: true } | { ok: false; message: string } {
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, message: "Room not found" };
    }
    if (room.peers.length >= 2) {
      return { ok: false, message: "Room is full" };
    }
    clearTimeout(room.timeout);
    room.peers.push(joiner);
    this.peerRooms.set(joiner, code);
    for (const peer of room.peers) {
      peer.send(JSON.stringify({ type: "peer-connected" }));
    }
    return { ok: true };
  }

  forward(sender: Peer, message: string): void {
    const code = this.peerRooms.get(sender);
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    for (const peer of room.peers) {
      if (peer !== sender) {
        peer.send(message);
      }
    }
  }

  disconnect(peer: Peer): void {
    const code = this.peerRooms.get(peer);
    if (!code) return;
    this.peerRooms.delete(peer);
    const room = this.rooms.get(code);
    if (!room) return;
    room.peers = room.peers.filter((p) => p !== peer);
    if (room.peers.length === 0) {
      clearTimeout(room.timeout);
      this.rooms.delete(code);
    } else {
      for (const p of room.peers) {
        p.send(JSON.stringify({ type: "peer-disconnected" }));
      }
    }
  }

  hasRoom(code: string): boolean {
    return this.rooms.has(code);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit** (run from PowerShell)

```bash
git add server/src/rooms.ts server/src/rooms.test.ts
git commit -m "Add room pairing logic"
```

---

### Task 3: Wire the room manager to a real WebSocket server

**Files:**
- Create: `server/src/server.ts`
- Create: `server/src/index.ts`
- Test: `server/src/server.test.ts`

**Interfaces:**
- Consumes: `RoomManager`, `Peer` from `./rooms` (Task 2).
- Produces: `startRelay(port: number): WebSocketServer` from `./server.ts` — a real server other tasks don't need to touch again in this phase.

- [ ] **Step 1: Write the failing test**

Create `server/src/server.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { startRelay } from "./server";

let server: ReturnType<typeof startRelay> | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function waitForListening(s: ReturnType<typeof startRelay>): Promise<void> {
  return new Promise((resolve) => s.once("listening", resolve));
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once("open", () => resolve()));
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

describe("relay server", () => {
  it("pairs a creator and a joiner and forwards messages between them", async () => {
    server = startRelay(0);
    await waitForListening(server);
    const port = (server.address() as AddressInfo).port;
    const url = `ws://localhost:${port}`;

    const alice = new WebSocket(url);
    await waitForOpen(alice);
    alice.send(JSON.stringify({ type: "create" }));
    const created = await waitForMessage(alice);
    expect(created.type).toBe("created");
    const roomCode = created.roomCode;
    expect(typeof roomCode).toBe("string");

    const bob = new WebSocket(url);
    await waitForOpen(bob);

    const aliceConnected = waitForMessage(alice);
    bob.send(JSON.stringify({ type: "join", roomCode }));
    const bobConnected = await waitForMessage(bob);
    expect(bobConnected.type).toBe("peer-connected");
    expect((await aliceConnected).type).toBe("peer-connected");

    const bobReceives = waitForMessage(bob);
    alice.send(JSON.stringify({ type: "pubkey", payload: "abc123" }));
    const forwarded = await bobReceives;
    expect(forwarded).toEqual({ type: "pubkey", payload: "abc123" });

    alice.close();
    bob.close();
  });

  it("sends an error and does not crash when joining a nonexistent room", async () => {
    server = startRelay(0);
    await waitForListening(server);
    const port = (server.address() as AddressInfo).port;
    const url = `ws://localhost:${port}`;

    const client = new WebSocket(url);
    await waitForOpen(client);
    client.send(JSON.stringify({ type: "join", roomCode: "NOPE12" }));
    const response = await waitForMessage(client);

    expect(response).toEqual({ type: "error", message: "Room not found" });
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './server'`.

- [ ] **Step 3: Implement `server/src/server.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS — 9 tests passing (7 from Task 2, 2 new).

- [ ] **Step 5: Create the entry point `server/src/index.ts`**

```ts
import { startRelay } from "./server.js";

const PORT = Number(process.env.PORT) || 8080;
startRelay(PORT);
console.log(`Relay listening on ws://localhost:${PORT}`);
```

- [ ] **Step 6: Verify the server actually starts**

Run: `cd server && npm run dev`
Expected: prints `Relay listening on ws://localhost:8080` and keeps running. Stop it with Ctrl+C before continuing.

- [ ] **Step 7: Commit** (run from PowerShell)

```bash
git add server/src/server.ts server/src/server.test.ts server/src/index.ts
git commit -m "Wire relay server to room manager"
```

---

### Task 4: Client package scaffold

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`
- Create: `client/vitest.config.ts`
- Create: `client/.gitignore`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`

**Interfaces:**
- Produces: a working `npm run dev` / `npm run build` / `npm test` toolchain in `client/`, plus a placeholder `App.tsx` that Task 8 replaces with the real screen state machine.

- [ ] **Step 1: Create `client/package.json`**

```json
{
  "name": "trojan-troy-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "libsodium-wrappers": "^0.7.15",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/libsodium-wrappers": "^0.7.14",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `client/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 4: Create `client/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `client/.gitignore`**

```
node_modules
dist
```

- [ ] **Step 6: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trojan Troy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `client/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 8: Create a placeholder `client/src/App.tsx`**

```tsx
export default function App() {
  return <div>Trojan Troy</div>;
}
```

- [ ] **Step 9: Install dependencies and verify the toolchain**

Run: `cd client && npm install && npm test`
Expected: `npm install` completes with no errors; `npm test` prints `No test files found, exiting with code 0` and exits 0.

Run: `cd client && npm run dev`
Expected: Vite starts and prints a local URL (e.g. `http://localhost:5173`). Open it — page shows "Trojan Troy". Stop with Ctrl+C before continuing.

- [ ] **Step 10: Commit** (run from PowerShell)

```bash
git add client/package.json client/tsconfig.json client/vite.config.ts client/vitest.config.ts client/.gitignore client/index.html client/src/main.tsx client/src/App.tsx
git commit -m "Scaffold client package"
```

---

### Task 5: Crypto module — encoding, keys, safety number

**Files:**
- Create: `client/src/crypto/encoding.ts`
- Test: `client/src/crypto/encoding.test.ts`
- Create: `client/src/crypto/keys.ts`
- Test: `client/src/crypto/keys.test.ts`
- Create: `client/src/crypto/safetyNumber.ts`
- Test: `client/src/crypto/safetyNumber.test.ts`

**Interfaces:**
- Consumes: `libsodium-wrappers`.
- Produces (used by Task 7's `App.tsx`):
  - `toBase64(bytes: Uint8Array): Promise<string>`, `fromBase64(value: string): Promise<Uint8Array>` from `./encoding`
  - `interface Keypair { publicKey: Uint8Array; privateKey: Uint8Array }`
  - `generateKeypair(): Promise<Keypair>` from `./keys`
  - `deriveSessionKeys(own: Keypair, peerPublicKey: Uint8Array, role: "initiator" | "responder"): Promise<{ rx: Uint8Array; tx: Uint8Array }>` from `./keys`
  - `computeSafetyNumber(publicKeyA: Uint8Array, publicKeyB: Uint8Array): Promise<string>` from `./safetyNumber`

- [ ] **Step 1: Write the failing test for encoding**

Create `client/src/crypto/encoding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "./encoding";

describe("encoding", () => {
  it("round-trips bytes through base64", async () => {
    await sodium.ready;
    const original = sodium.randombytes_buf(32);

    const encoded = await toBase64(original);
    const decoded = await fromBase64(encoded);

    expect(decoded).toEqual(original);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test`
Expected: FAIL — `Cannot find module './encoding'`.

- [ ] **Step 3: Implement `client/src/crypto/encoding.ts`**

```ts
import sodium from "libsodium-wrappers";

export async function toBase64(bytes: Uint8Array): Promise<string> {
  await sodium.ready;
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function fromBase64(value: string): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Write the failing tests for keys**

Create `client/src/crypto/keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { generateKeypair, deriveSessionKeys } from "./keys";

describe("keys", () => {
  it("generates a keypair with 32-byte public and private keys", async () => {
    const kp = await generateKeypair();
    expect(kp.publicKey).toHaveLength(32);
    expect(kp.privateKey).toHaveLength(32);
  });

  it("derives matching session keys for both sides of the exchange", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();

    const aliceKeys = await deriveSessionKeys(alice, bob.publicKey, "initiator");
    const bobKeys = await deriveSessionKeys(bob, alice.publicKey, "responder");

    await sodium.ready;
    expect(sodium.memcmp(aliceKeys.tx, bobKeys.rx)).toBe(true);
    expect(sodium.memcmp(aliceKeys.rx, bobKeys.tx)).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Cannot find module './keys'`.

- [ ] **Step 7: Implement `client/src/crypto/keys.ts`**

```ts
import sodium from "libsodium-wrappers";

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface SessionKeys {
  rx: Uint8Array;
  tx: Uint8Array;
}

export async function generateKeypair(): Promise<Keypair> {
  await sodium.ready;
  const kp = sodium.crypto_kx_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function deriveSessionKeys(
  own: Keypair,
  peerPublicKey: Uint8Array,
  role: "initiator" | "responder"
): Promise<SessionKeys> {
  await sodium.ready;
  const result =
    role === "initiator"
      ? sodium.crypto_kx_client_session_keys(own.publicKey, own.privateKey, peerPublicKey)
      : sodium.crypto_kx_server_session_keys(own.publicKey, own.privateKey, peerPublicKey);
  return { rx: result.sharedRx, tx: result.sharedTx };
}
```

`role` reflects who created the room (`"initiator"`) vs. who joined (`"responder"`) — arbitrary but must be consistent, since libsodium's `crypto_kx` requires exactly one side to compute client-style keys and the other server-style keys for the derived rx/tx pairs to match.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS — 3 tests passing.

- [ ] **Step 9: Write the failing tests for safety number**

Create `client/src/crypto/safetyNumber.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { computeSafetyNumber } from "./safetyNumber";

describe("computeSafetyNumber", () => {
  it("is deterministic regardless of argument order", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);

    const ab = await computeSafetyNumber(a, b);
    const ba = await computeSafetyNumber(b, a);

    expect(ab).toBe(ba);
  });

  it("formats as space-separated groups of 5 digits", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);

    const result = await computeSafetyNumber(a, b);

    expect(result).toMatch(/^(\d{5} )*\d{5}$/);
  });

  it("produces a different number for a different key pair", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const c = sodium.randombytes_buf(32);

    const ab = await computeSafetyNumber(a, b);
    const ac = await computeSafetyNumber(a, c);

    expect(ab).not.toBe(ac);
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Cannot find module './safetyNumber'`.

- [ ] **Step 11: Implement `client/src/crypto/safetyNumber.ts`**

```ts
import sodium from "libsodium-wrappers";

export async function computeSafetyNumber(
  publicKeyA: Uint8Array,
  publicKeyB: Uint8Array
): Promise<string> {
  await sodium.ready;
  const [first, second] = [publicKeyA, publicKeyB].sort((a, b) =>
    sodium.to_hex(a).localeCompare(sodium.to_hex(b))
  );
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);
  const digest = sodium.crypto_generichash(20, combined);

  const decimal = Array.from(digest)
    .map((byte) => byte.toString().padStart(3, "0"))
    .join("");

  const groups: string[] = [];
  for (let i = 0; i < decimal.length; i += 5) {
    groups.push(decimal.slice(i, i + 5));
  }
  return groups.join(" ");
}
```

Sorting the two public keys before hashing (rather than hashing them in whatever order they're passed) is what makes the result order-independent — both users' clients hash "their public key and the peer's" in the same canonical order regardless of who's "A" and who's "B".

- [ ] **Step 12: Run tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS — 6 tests passing.

- [ ] **Step 13: Commit** (run from PowerShell)

```bash
git add client/src/crypto
git commit -m "Add crypto module: keys, encoding, safety number"
```

---

### Task 6: Relay client wrapper

**Files:**
- Create: `client/src/net/relayClient.ts`
- Test: `client/src/net/relayClient.test.ts`

**Interfaces:**
- Produces (used by Task 7's `App.tsx`):
  - `type Envelope = { type: "create" } | { type: "created"; roomCode: string } | { type: "join"; roomCode: string } | { type: "peer-connected" } | { type: "peer-disconnected" } | { type: "pubkey"; payload: string } | { type: "error"; message: string }`
  - `class RelayClient { constructor(url: string, createWebSocket?: WebSocketFactory); onMessage(listener: (envelope: Envelope) => void): () => void; waitForOpen(): Promise<void>; send(envelope: Envelope): void; close(): void }`

- [ ] **Step 1: Write the failing tests**

Create `client/src/net/relayClient.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RelayClient, type MinimalWebSocket } from "./relayClient";

function fakeSocket(): MinimalWebSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send: (data: string) => sent.push(data),
    close: () => {},
    onopen: null,
    onmessage: null,
    onclose: null,
  };
}

describe("RelayClient", () => {
  it("sends envelopes as JSON over the socket", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    client.send({ type: "create" });

    expect(socket.sent).toEqual([JSON.stringify({ type: "create" })]);
  });

  it("notifies listeners when a message arrives", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    socket.onmessage?.({ data: JSON.stringify({ type: "created", roomCode: "ABC123" }) });

    expect(received).toEqual([{ type: "created", roomCode: "ABC123" }]);
  });

  it("stops notifying a listener after it unsubscribes", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    const unsubscribe = client.onMessage((envelope) => received.push(envelope));
    unsubscribe();

    socket.onmessage?.({ data: JSON.stringify({ type: "peer-connected" }) });

    expect(received).toEqual([]);
  });

  it("resolves waitForOpen when the socket opens", async () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    const opened = client.waitForOpen();
    socket.onopen?.();

    await expect(opened).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Cannot find module './relayClient'`.

- [ ] **Step 3: Implement `client/src/net/relayClient.ts`**

```ts
export type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  | { type: "pubkey"; payload: string }
  | { type: "error"; message: string };

export interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

export type WebSocketFactory = (url: string) => MinimalWebSocket;

const defaultFactory: WebSocketFactory = (url) =>
  new WebSocket(url) as unknown as MinimalWebSocket;

export class RelayClient {
  private ws: MinimalWebSocket;
  private listeners = new Set<(envelope: Envelope) => void>();

  constructor(url: string, createWebSocket: WebSocketFactory = defaultFactory) {
    this.ws = createWebSocket(url);
    this.ws.onmessage = (event) => {
      const envelope = JSON.parse(event.data) as Envelope;
      for (const listener of this.listeners) {
        listener(envelope);
      }
    };
  }

  onMessage(listener: (envelope: Envelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForOpen(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.onopen = () => resolve();
    });
  }

  send(envelope: Envelope): void {
    this.ws.send(JSON.stringify(envelope));
  }

  close(): void {
    this.ws.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit** (run from PowerShell)

```bash
git add client/src/net
git commit -m "Add relay client wrapper"
```

---

### Task 7: Screens — start/join, waiting, safety number

**Files:**
- Create: `client/src/screens/StartJoinScreen.tsx`
- Create: `client/src/screens/WaitingScreen.tsx`
- Create: `client/src/screens/SafetyNumberScreen.tsx`

**Interfaces:**
- Produces (used by Task 8's `App.tsx`):
  - `StartJoinScreen({ onStart: () => void; onJoin: (code: string) => void })`
  - `WaitingScreen({ roomCode: string })`
  - `SafetyNumberScreen({ safetyNumber: string; onVerified: () => void })`

These are presentational components with no network/crypto logic — per the approved spec, this phase's UI is verified manually (two browser windows), not with component tests, so this task has no automated test step.

- [ ] **Step 1: Create `client/src/screens/StartJoinScreen.tsx`**

```tsx
import type { FormEvent } from "react";

interface StartJoinScreenProps {
  onStart: () => void;
  onJoin: (code: string) => void;
}

export function StartJoinScreen({ onStart, onJoin }: StartJoinScreenProps) {
  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("roomCode") ?? "").trim().toUpperCase();
    if (code) onJoin(code);
  };

  return (
    <div>
      <h1>Trojan Troy</h1>
      <button onClick={onStart}>Start a chat</button>
      <form onSubmit={handleJoin}>
        <input name="roomCode" placeholder="Enter room code" />
        <button type="submit">Join a chat</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Create `client/src/screens/WaitingScreen.tsx`**

```tsx
interface WaitingScreenProps {
  roomCode: string;
}

export function WaitingScreen({ roomCode }: WaitingScreenProps) {
  return (
    <div>
      <h1>Waiting for your friend...</h1>
      <p>Share this code:</p>
      <code>{roomCode}</code>
    </div>
  );
}
```

- [ ] **Step 3: Create `client/src/screens/SafetyNumberScreen.tsx`**

```tsx
interface SafetyNumberScreenProps {
  safetyNumber: string;
  onVerified: () => void;
}

export function SafetyNumberScreen({ safetyNumber, onVerified }: SafetyNumberScreenProps) {
  return (
    <div>
      <h1>Verify safety number</h1>
      <p>Compare this number with your friend, out loud or on a separate channel:</p>
      <code>{safetyNumber}</code>
      <button onClick={onVerified}>Verified</button>
    </div>
  );
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit** (run from PowerShell)

```bash
git add client/src/screens
git commit -m "Add start/join, waiting, and safety number screens"
```

---

### Task 8: Wire it all together in App.tsx

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `RelayClient`, `Envelope` from `../net/relayClient`; `generateKeypair`, `deriveSessionKeys`, `Keypair` from `../crypto/keys`; `computeSafetyNumber` from `../crypto/safetyNumber`; `toBase64`, `fromBase64` from `../crypto/encoding`; `StartJoinScreen`, `WaitingScreen`, `SafetyNumberScreen` from `../screens/*`.

This is the phase's integration point — no new unit-testable logic of its own, so this task is verified end-to-end manually per the approved spec's testing plan.

- [ ] **Step 1: Replace `client/src/App.tsx`**

```tsx
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
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual end-to-end test — this is the Phase 1 acceptance check**

1. In one terminal: `cd server && npm run dev` (leave running).
2. In another terminal: `cd client && npm run dev` (leave running).
3. Open the printed client URL in one browser window. Click "Start a chat." Note the room code shown.
4. Open the same URL in a second browser window (or a private/incognito window). Enter the room code from step 3 and click "Join a chat."
5. **Expected:** both windows transition to the safety number screen, and the digit groups shown are byte-for-byte identical on both sides.
6. Close one window. **Expected:** the other window shows "Your friend disconnected."
7. Stop both dev servers with Ctrl+C.

- [ ] **Step 4: Commit** (run from PowerShell)

```bash
git add client/src/App.tsx
git commit -m "Wire key exchange and safety number screen into App"
```

---

### Task 9: Run instructions and progress log

**Files:**
- Modify: `README.md`
- Modify: `progress.md`

- [ ] **Step 1: Add a Development section to `README.md`**

Append to the end of `README.md`:

```markdown

## Development

Two packages, run separately:

```bash
cd server && npm install && npm run dev   # relay on ws://localhost:8080
cd client && npm install && npm run dev   # web app, prints its own URL
```

Open the client URL in two browser windows to simulate two users: "Start a chat" in one, "Join a chat" with the shown code in the other.
```

- [ ] **Step 2: Update `progress.md`**

Update the status table's Phase 1 row from "Not started" to "Complete — key exchange + safety number screen working end-to-end." Add a log entry:

```markdown
- **2026-07-18** — Phase 1 complete: room-code pairing relay (`/server`),
  React client with libsodium.js key exchange and safety-number screen
  (`/client`). Verified end-to-end with two browser windows landing on a
  matching safety number. See
  `docs/superpowers/plans/2026-07-18-phase1-foundation.md`.
```

- [ ] **Step 3: Commit** (run from PowerShell)

```bash
git add README.md progress.md
git commit -m "Document Phase 1 run instructions, mark complete"
```

- [ ] **Step 4: Push everything**

```bash
git push
```
