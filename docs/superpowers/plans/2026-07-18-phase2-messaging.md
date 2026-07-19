# Phase 2 Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the session keys Phase 1 already derives to real end-to-end encrypted text messaging between the two paired clients, over the existing relay.

**Architecture:** A new `client/src/crypto/messages.ts` module encrypts/decrypts with `crypto_secretbox_easy` using the existing `tx`/`rx` session keys. One new pass-through envelope type (`ciphertext`) requires zero server changes — the relay already forwards anything that isn't `create`/`join` verbatim. A new `ChatScreen` component and updated `App.tsx` wiring complete the flow: verify safety number → chat unlocks → send/receive encrypted messages.

**Tech Stack:** TypeScript, React, Vite, Vitest, libsodium-wrappers (`crypto_secretbox_easy`) — same stack as Phase 1, no new dependencies.

## Global Constraints

- Never implement custom cryptographic primitives — libsodium.js only, no hand-rolled crypto (`AGENTS.md`, `roadmap.md`).
- The relay server only ever routes opaque JSON envelopes — it must never parse, inspect, or derive anything from envelope payloads beyond the `type` field needed to route (`decisions.md`). No server code changes in this plan.
- No user accounts. Pairing is room-code based (`decisions.md`).
- Session keys AND chat messages are ephemeral — generated/held in memory per session only, never persisted to disk or `localStorage` (`decisions.md`, Phase 2 spec). A page refresh loses the whole conversation; no reconnect logic.
- Message encryption uses `crypto_secretbox_easy` with the session's `tx` (send) / `rx` (receive) keys and a fresh random nonce per message, base64-encoded as `nonce || ciphertext` (`docs/superpowers/specs/2026-07-18-phase2-messaging-design.md`, `decisions.md`).
- Chat is 1:1 only — no group chat in any phase of Version A (Phase 2 spec).
- The safety number must be verified before chat unlocks — there is no path to the chat screen that skips clicking "Verified" (Phase 2 spec).
- A `ciphertext` message that fails to decrypt must not crash the session — show a distinct "could not be decrypted" placeholder and continue (Phase 2 spec).
- Commit messages must be short, plain-language, human-sounding — no AI-flavored verbosity, no extra trailers (`AGENTS.md`).
- Every commit must be GPG-signed and authored as the human git identity already configured on this machine — never as an AI agent, never co-authored by one (`AGENTS.md`).
- **On this machine, run `git commit` via PowerShell, not the Bash/Git-Bash tool.** Git Bash's bundled `gpg` reads a different keyring than the native Windows `gpg`, so signing silently fails there even though signing works fine from PowerShell. `git add`, `git push`, and other non-signing git commands are fine from either shell. (A `post-commit` hook on this machine already auto-pushes every commit — no manual `git push` step needed.)
- Commit early and often — one commit per task minimum, more if a task's steps naturally split (`AGENTS.md`).

---

## File Structure

```
client/src/
  crypto/
    messages.ts          # encryptMessage / decryptMessage (crypto_secretbox_easy)
    messages.test.ts
  screens/
    ChatScreen.tsx        # message list + input, presentational only, exports ChatMessage type
  net/
    relayClient.ts         # modified — +1 Envelope variant: { type: "ciphertext"; payload: string }
  App.tsx                  # modified — captures session keys, wires ChatScreen in/out

progress.md                 # modified — Phase 2 status + log entry
```

`README.md` is not touched — Phase 2 needs no new run instructions, same two dev servers as Phase 1.

No server-side files change in this plan — `server/src/server.ts` already forwards any envelope type it doesn't recognize (`create`/`join`) verbatim, per its own comment: "Anything else (e.g. 'pubkey', and later 'ciphertext') is an opaque blob the relay just forwards without inspecting."

---

### Task 1: Message encryption module

**Files:**
- Create: `client/src/crypto/messages.ts`
- Test: `client/src/crypto/messages.test.ts`

**Interfaces:**
- Consumes: `libsodium-wrappers`; `toBase64`, `fromBase64` from `./encoding`.
- Produces (used by Task 3's `App.tsx`):
  - `encryptMessage(key: Uint8Array, plaintext: string): Promise<string>`
  - `decryptMessage(key: Uint8Array, payload: string): Promise<string>` — rejects if the ciphertext fails authentication (tampered, corrupted, or wrong key).

- [ ] **Step 1: Write the failing tests**

Create `client/src/crypto/messages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encryptMessage, decryptMessage } from "./messages";

describe("messages", () => {
  it("round-trips plaintext through encrypt and decrypt", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();

    const encrypted = await encryptMessage(key, "hello, world");
    const decrypted = await decryptMessage(key, encrypted);

    expect(decrypted).toBe("hello, world");
  });

  it("rejects a tampered ciphertext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptMessage(key, "hello, world");

    const bytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

    await expect(decryptMessage(key, tampered)).rejects.toThrow();
  });

  it("rejects when decrypted with the wrong key", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const wrongKey = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptMessage(key, "hello, world");

    await expect(decryptMessage(wrongKey, encrypted)).rejects.toThrow();
  });

  it("uses a different nonce each call, producing different ciphertext for the same plaintext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();

    const first = await encryptMessage(key, "hello, world");
    const second = await encryptMessage(key, "hello, world");

    expect(first).not.toBe(second);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Cannot find module './messages'`.

- [ ] **Step 3: Implement `client/src/crypto/messages.ts`**

```ts
import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "./encoding";

export async function encryptMessage(key: Uint8Array, plaintext: string): Promise<string> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return toBase64(combined);
}

export async function decryptMessage(key: Uint8Array, payload: string): Promise<string> {
  await sodium.ready;
  const combined = await fromBase64(payload);
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(plaintext);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS — 4 tests passing (plus the existing 15 from Phase 1 — 19 total).

- [ ] **Step 5: Commit** (run from PowerShell)

```bash
git add client/src/crypto/messages.ts client/src/crypto/messages.test.ts
git commit -m "Add message encryption module"
```

---

### Task 2: Chat screen

**Files:**
- Create: `client/src/screens/ChatScreen.tsx`

**Interfaces:**
- Produces (used by Task 3's `App.tsx`):
  - `interface ChatMessage { id: string; from: "me" | "peer" | "decryption-error"; text: string }`
  - `ChatScreen({ messages: ChatMessage[]; onSend: (text: string) => void })`

This is a presentational component with no network/crypto logic — same as Phase 1's screens, this phase's UI is verified manually, so there is no automated test step for this task.

- [ ] **Step 1: Create `client/src/screens/ChatScreen.tsx`**

```tsx
import type { FormEvent } from "react";

export interface ChatMessage {
  id: string;
  from: "me" | "peer" | "decryption-error";
  text: string;
}

interface ChatScreenProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export function ChatScreen({ messages, onSend }: ChatScreenProps) {
  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = String(data.get("message") ?? "").trim();
    if (text) onSend(text);
    form.reset();
  };

  return (
    <div>
      <h1>Chat</h1>
      <ul>
        {messages.map((message) => (
          <li key={message.id}>
            {message.from === "decryption-error"
              ? "[Message could not be decrypted]"
              : `${message.from === "me" ? "You" : "Them"}: ${message.text}`}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSend}>
        <input name="message" placeholder="Type a message" autoComplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit** (run from PowerShell)

```bash
git add client/src/screens/ChatScreen.tsx
git commit -m "Add chat screen"
```

---

### Task 3: Wire messaging into App.tsx

**Files:**
- Modify: `client/src/net/relayClient.ts`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `encryptMessage`, `decryptMessage` from `./crypto/messages`; `ChatScreen`, `type ChatMessage` from `./screens/ChatScreen`; `type SessionKeys` from `./crypto/keys` (already exported); everything `App.tsx` already imports from Phase 1.
- Produces: none — this is Phase 2's integration point, nothing later depends on it.

This is the phase's second integration point — no new unit-testable logic of its own beyond the envelope type addition, so this task is verified with a protocol-level script plus a final manual end-to-end check, per the approved spec's testing plan.

- [ ] **Step 1: Add the `ciphertext` envelope variant**

In `client/src/net/relayClient.ts`, add one member to the existing `Envelope` union (the rest of the file is unchanged):

```ts
export type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  | { type: "pubkey"; payload: string }
  | { type: "ciphertext"; payload: string }
  | { type: "error"; message: string };
```

- [ ] **Step 2: Replace `client/src/App.tsx`**

```tsx
import { useRef, useState } from "react";
import { RelayClient, type Envelope } from "./net/relayClient";
import { generateKeypair, deriveSessionKeys, type Keypair, type SessionKeys } from "./crypto/keys";
import { computeSafetyNumber } from "./crypto/safetyNumber";
import { toBase64, fromBase64 } from "./crypto/encoding";
import { encryptMessage, decryptMessage } from "./crypto/messages";
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
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), from: "peer", text }]);
        } catch {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), from: "decryption-error", text: "" },
          ]);
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
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), from: "me", text }]);
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
    return <ChatScreen messages={messages} onSend={handleSend} />;
  }
  return (
    <div>
      <h1>Something went wrong</h1>
      <p>{screen.message}</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Protocol-level integration verification**

No browser automation tool is available in this environment (confirmed during Phase 1 — there is no Playwright/Puppeteer/similar tool). Write a throwaway, uncommitted Node/TypeScript script (not part of the client or server source tree, delete it when done) that proves the real wiring works without a browser:

- Start the real relay server (import and call `startRelay` from `server/src/server.ts`, or run its dev script as a subprocess).
- Open two real `ws` WebSocket connections, simulating client A (initiator) and client B (responder), speaking the exact protocol `App.tsx` drives: A sends `{type:"create"}`, gets `{type:"created", roomCode}`; B sends `{type:"join", roomCode}`; both receive `{type:"peer-connected"}`; both exchange `{type:"pubkey", payload}` using the real `client/src/crypto/keys.ts` + `encoding.ts` (not reimplemented).
- Have each side derive session keys with the real `deriveSessionKeys` (A as `"initiator"`, B as `"responder"`).
- Using the real `client/src/crypto/messages.ts`, have A encrypt a plaintext message with its `tx` key, send `{type:"ciphertext", payload}`, and assert B decrypts it with its `rx` key to the identical plaintext. Repeat in the other direction (B → A).
- Assert that a deliberately corrupted `ciphertext` payload (flip a byte, same technique as Task 1's tampering test) fails to decrypt on the receiving side, proving the failure path is real and not just typechecked.
- Clean up: close both connections, stop the server process you started.

Expected: all assertions pass — both directions round-trip correctly, tampered ciphertext fails to decrypt.

- [ ] **Step 5: Manual end-to-end test — this is the Phase 2 acceptance check**

1. In one terminal: `cd server && npm run dev` (leave running).
2. In another terminal: `cd client && npm run dev` (leave running).
3. Open the printed client URL in one browser window. Click "Start a chat." Note the room code.
4. Open the same URL in a second browser window (or private/incognito). Enter the room code and click "Join a chat."
5. Both windows reach the safety number screen. Click "Verified" on both.
6. **Expected:** both windows now show the chat screen.
7. Type a message in window A, send it. **Expected:** it appears in window A's list as "You: ..." immediately, and in window B's list as "Them: ..." shortly after.
8. Send a reply from window B. **Expected:** same, mirrored.
9. Close one window. **Expected:** the other window shows "Your friend disconnected" (existing Phase 1 behavior, unchanged).
10. Stop both dev servers with Ctrl+C.

- [ ] **Step 6: Commit** (run from PowerShell)

```bash
git add client/src/net/relayClient.ts client/src/App.tsx
git commit -m "Wire encrypted messaging into App"
```

---

### Task 4: Progress log

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Update `progress.md`**

Update the status table's Phase 2 row from "Not started" to "Complete — encrypted text messaging working end-to-end." Add a log entry:

```markdown
- **2026-07-18** — Phase 2 complete: real-time end-to-end encrypted text
  messaging (`crypto_secretbox_easy` with Phase 1's session keys), reusing
  the same relay and envelope pattern with one new pass-through type
  (`ciphertext`) and no server changes. Verified end-to-end with two
  browser windows exchanging messages after safety-number verification.
  See `docs/superpowers/plans/2026-07-18-phase2-messaging.md`.
```

- [ ] **Step 2: Commit** (run from PowerShell)

```bash
git add progress.md
git commit -m "Mark Phase 2 complete"
```

---
