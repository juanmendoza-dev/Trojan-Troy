# Phase 3 Voice Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Async, end-to-end encrypted voice messages between the two paired clients — record a clip, encrypt it, send it over the existing relay, recipient decrypts and plays it.

**Architecture:** Extract the byte-level `crypto_secretbox_easy` logic already living in `crypto/messages.ts` into a shared `crypto/secretbox.ts` primitive, so a new `crypto/media.ts` can encrypt/decrypt raw audio bytes without duplicating nonce handling. A new `audio/recorder.ts` wraps `MediaRecorder`/`getUserMedia` with a 60-second auto-stop cap. A new `VoiceRecorder.tsx` component drives the record → preview → send/discard flow and is embedded in `ChatScreen.tsx`, whose `ChatMessage` type becomes a discriminated union covering text, voice, and decryption-error variants. One new pass-through envelope type (`voice`) requires zero server changes, exactly like Phase 2's `ciphertext`.

**Tech Stack:** TypeScript, React, Vite, Vitest, libsodium-wrappers (`crypto_secretbox_easy`), browser `MediaRecorder`/`getUserMedia` APIs — no new npm dependencies.

## Global Constraints

- Never implement custom cryptographic primitives — libsodium.js only, no hand-rolled crypto (`AGENTS.md`, `roadmap.md`).
- The relay server only ever routes opaque JSON envelopes — it must never parse, inspect, or derive anything from envelope payloads beyond the `type` field needed to route (`decisions.md`). No server code changes in this plan.
- Voice messages are async only — record, encrypt, send, decrypt, play. No live/streaming calling or true peer-to-peer networking (`roadmap.md`, `decisions.md`, `AGENTS.md`).
- Each voice clip is capped at 60 seconds and sent as a single encrypted blob — no chunking or progressive upload (`docs/superpowers/specs/2026-07-18-phase3-voice-messages-design.md`).
- Voice encryption uses `crypto_secretbox_easy` with the session's `tx`/`rx` keys and a fresh random nonce per clip, base64-encoded as `nonce || ciphertext` — identical scheme to Phase 2's text messages, via a shared `crypto/secretbox.ts` primitive (Phase 3 spec).
- The `voice` envelope's `mimeType` field travels unencrypted (it's a codec label, not content) — a stated, accepted metadata trade-off, not a bug (Phase 3 spec, Known Limitations).
- A recorded clip must be previewable (listen back, discard, or send) before it is ever encrypted or transmitted (Phase 3 spec).
- A `voice` message that fails to decrypt must not crash the session — same `decryption-error` placeholder behavior as text (Phase 3 spec, Phase 2 spec).
- Chat messages and recorded/decrypted audio are ephemeral — held in memory only, never persisted to disk or `localStorage`; object URLs are revoked when the chat session ends (Phase 3 spec).
- Commit messages must be short, plain-language, human-sounding — no AI-flavored verbosity, no extra trailers (`AGENTS.md`).
- Every commit must be GPG-signed and authored as the human git identity already configured on this machine — never as an AI agent, never co-authored by one (`AGENTS.md`).
- **On this machine, run `git commit` via PowerShell, not the Bash/Git-Bash tool.** Git Bash's bundled `gpg` reads a different keyring than the native Windows `gpg`, so signing silently fails there even though signing works fine from PowerShell. `git add`, `git push`, and other non-signing git commands are fine from either shell. (A `post-commit` hook on this machine already auto-pushes every commit — no manual `git push` step needed.)
- Commit early and often — one commit per task minimum, more if a task's steps naturally split (`AGENTS.md`).

---

## File Structure

```
client/src/
  crypto/
    secretbox.ts          # NEW — encryptBytes / decryptBytes (crypto_secretbox_easy), extracted from messages.ts
    secretbox.test.ts       # NEW
    messages.ts              # modified — becomes a thin string<->bytes wrapper over secretbox.ts
    media.ts                  # NEW — encryptVoiceClip / decryptVoiceClip (Blob <-> secretbox.ts)
    media.test.ts               # NEW
  audio/
    recorder.ts                  # NEW — MediaRecorder/getUserMedia wrapper, 60s auto-stop
  screens/
    VoiceRecorder.tsx              # NEW — record/preview/send/discard state machine
    ChatScreen.tsx                   # modified — ChatMessage becomes a discriminated union, renders voice messages, hosts VoiceRecorder
  net/
    relayClient.ts                    # modified — +1 Envelope variant: { type: "voice"; payload: string; mimeType: string }
  App.tsx                                # modified — encrypts/decrypts voice clips, wires VoiceRecorder in/out, revokes object URLs on unmount

progress.md                                # modified — Phase 3 status + log entry
```

No server-side files change in this plan — `server/src/server.ts` already forwards any envelope type it doesn't recognize (`create`/`join`) verbatim.

---

### Task 1: Shared secretbox primitive

**Files:**
- Create: `client/src/crypto/secretbox.ts`
- Test: `client/src/crypto/secretbox.test.ts`
- Modify: `client/src/crypto/messages.ts`

**Interfaces:**
- Consumes: `libsodium-wrappers`; `toBase64`, `fromBase64` from `./encoding` (existing).
- Produces (used by Task 2's `media.ts`, and by this task's refactored `messages.ts`):
  - `encryptBytes(key: Uint8Array, plaintext: Uint8Array): Promise<string>`
  - `decryptBytes(key: Uint8Array, payload: string): Promise<Uint8Array>` — rejects if the ciphertext fails authentication (tampered, corrupted, or wrong key).

- [ ] **Step 1: Write the failing tests**

Create `client/src/crypto/secretbox.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encryptBytes, decryptBytes } from "./secretbox";

describe("secretbox", () => {
  it("round-trips bytes through encrypt and decrypt", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const plaintext = sodium.from_string("hello, world");

    const encrypted = await encryptBytes(key, plaintext);
    const decrypted = await decryptBytes(key, encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it("rejects a tampered ciphertext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptBytes(key, sodium.from_string("hello, world"));

    const bytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

    await expect(decryptBytes(key, tampered)).rejects.toThrow();
  });

  it("rejects when decrypted with the wrong key", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const wrongKey = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptBytes(key, sodium.from_string("hello, world"));

    await expect(decryptBytes(wrongKey, encrypted)).rejects.toThrow();
  });

  it("uses a different nonce each call, producing different ciphertext for the same plaintext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const plaintext = sodium.from_string("hello, world");

    const first = await encryptBytes(key, plaintext);
    const second = await encryptBytes(key, plaintext);

    expect(first).not.toBe(second);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Cannot find module './secretbox'`.

- [ ] **Step 3: Implement `client/src/crypto/secretbox.ts`**

```ts
import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "./encoding";

export async function encryptBytes(key: Uint8Array, plaintext: Uint8Array): Promise<string> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return toBase64(combined);
}

export async function decryptBytes(key: Uint8Array, payload: string): Promise<Uint8Array> {
  await sodium.ready;
  const combined = await fromBase64(payload);
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
  return sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS — 4 new `secretbox` tests passing.

- [ ] **Step 5: Refactor `client/src/crypto/messages.ts` to use the shared primitive**

Replace the file contents with:

```ts
import sodium from "libsodium-wrappers";
import { encryptBytes, decryptBytes } from "./secretbox";

export async function encryptMessage(key: Uint8Array, plaintext: string): Promise<string> {
  await sodium.ready;
  return encryptBytes(key, sodium.from_string(plaintext));
}

export async function decryptMessage(key: Uint8Array, payload: string): Promise<string> {
  const plaintext = await decryptBytes(key, payload);
  await sodium.ready;
  return sodium.to_string(plaintext);
}
```

- [ ] **Step 6: Run the full test suite to confirm the refactor is behavior-preserving**

Run: `cd client && npm test`
Expected: PASS — the existing `messages.test.ts` tests pass unchanged, alongside the new `secretbox.test.ts` tests (19 previous + 4 new = 23 total).

- [ ] **Step 7: Commit** (run from PowerShell)

```bash
git add client/src/crypto/secretbox.ts client/src/crypto/secretbox.test.ts client/src/crypto/messages.ts
git commit -m "Extract shared secretbox primitive from messages"
```

---

### Task 2: Voice clip encryption module

**Files:**
- Create: `client/src/crypto/media.ts`
- Test: `client/src/crypto/media.test.ts`

**Interfaces:**
- Consumes: `encryptBytes`, `decryptBytes` from `./secretbox` (Task 1).
- Produces (used by Task 5's `App.tsx`):
  - `encryptVoiceClip(key: Uint8Array, blob: Blob): Promise<string>`
  - `decryptVoiceClip(key: Uint8Array, payload: string, mimeType: string): Promise<Blob>` — rejects if the ciphertext fails authentication.

- [ ] **Step 1: Write the failing tests**

Create `client/src/crypto/media.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encryptVoiceClip, decryptVoiceClip } from "./media";

describe("media", () => {
  it("round-trips a Blob through encrypt and decrypt, preserving mime type", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const original = new Blob([new Uint8Array([1, 2, 3, 4, 5])], {
      type: "audio/webm;codecs=opus",
    });

    const encrypted = await encryptVoiceClip(key, original);
    const decrypted = await decryptVoiceClip(key, encrypted, "audio/webm;codecs=opus");

    expect(decrypted.type).toBe("audio/webm;codecs=opus");
    const decryptedBytes = new Uint8Array(await decrypted.arrayBuffer());
    expect(decryptedBytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("rejects a tampered payload", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const original = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const encrypted = await encryptVoiceClip(key, original);

    const bytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

    await expect(decryptVoiceClip(key, tampered, "audio/webm")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npm test`
Expected: FAIL — `Cannot find module './media'`.

- [ ] **Step 3: Implement `client/src/crypto/media.ts`**

```ts
import { encryptBytes, decryptBytes } from "./secretbox";

export async function encryptVoiceClip(key: Uint8Array, blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return encryptBytes(key, bytes);
}

export async function decryptVoiceClip(
  key: Uint8Array,
  payload: string,
  mimeType: string
): Promise<Blob> {
  const bytes = await decryptBytes(key, payload);
  return new Blob([bytes], { type: mimeType });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npm test`
Expected: PASS — 2 new `media` tests passing (23 previous + 2 new = 25 total).

- [ ] **Step 5: Commit** (run from PowerShell)

```bash
git add client/src/crypto/media.ts client/src/crypto/media.test.ts
git commit -m "Add voice clip encryption module"
```

---

### Task 3: Audio recorder wrapper

**Files:**
- Create: `client/src/audio/recorder.ts`

**Interfaces:**
- Consumes: browser `MediaRecorder`, `navigator.mediaDevices.getUserMedia` (globals, via the DOM lib already in `tsconfig.json`).
- Produces (used by Task 4's `VoiceRecorder.tsx`):
  - `MAX_RECORDING_MS: number` (60000)
  - `class RecordingPermissionError extends Error`
  - `class RecordingUnsupportedError extends Error`
  - `interface RecordingHandle { stop(): void; result: Promise<{ blob: Blob; mimeType: string }> }`
  - `startRecording(): Promise<RecordingHandle>` — rejects with `RecordingUnsupportedError` if no preferred mime type is supported, or `RecordingPermissionError` if `getUserMedia` is denied/fails. `RecordingHandle.result` resolves whether recording is stopped manually (via `stop()`) or automatically at the 60s cap.

`MediaRecorder`/`getUserMedia` are not available under Vitest's `node` test environment (confirmed in `client/vitest.config.ts`), so this task has no automated test — verified manually in Task 5's end-to-end check, per the approved spec's testing plan.

- [ ] **Step 1: Implement `client/src/audio/recorder.ts`**

```ts
const MIME_TYPE_PREFERENCE = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

export const MAX_RECORDING_MS = 60_000;

export class RecordingPermissionError extends Error {}
export class RecordingUnsupportedError extends Error {}

export interface RecordingHandle {
  stop(): void;
  result: Promise<{ blob: Blob; mimeType: string }>;
}

export async function startRecording(): Promise<RecordingHandle> {
  const mimeType = MIME_TYPE_PREFERENCE.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    throw new RecordingUnsupportedError("No supported audio recording format.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new RecordingPermissionError("Microphone access denied.");
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const result = new Promise<{ blob: Blob; mimeType: string }>((resolve) => {
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
    };
  });

  recorder.start();
  const autoStopTimer = setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, MAX_RECORDING_MS);

  return {
    stop() {
      clearTimeout(autoStopTimer);
      if (recorder.state === "recording") recorder.stop();
    },
    result,
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit** (run from PowerShell)

```bash
git add client/src/audio/recorder.ts
git commit -m "Add audio recorder wrapper"
```

---

### Task 4: Voice recorder UI component

**Files:**
- Create: `client/src/screens/VoiceRecorder.tsx`

**Interfaces:**
- Consumes: `startRecording`, `MAX_RECORDING_MS`, `RecordingPermissionError`, `RecordingUnsupportedError`, `type RecordingHandle` from `../audio/recorder` (Task 3).
- Produces (used by Task 5's `ChatScreen.tsx`):
  - `VoiceRecorder({ onSend: (blob: Blob, mimeType: string) => void })`

This is a presentational component driving the record/preview/send/discard state machine — no automated test, verified manually in Task 5's end-to-end check, same as Phase 1/2's browser-API-heavy UI precedent.

- [ ] **Step 1: Create `client/src/screens/VoiceRecorder.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import {
  startRecording,
  MAX_RECORDING_MS,
  RecordingPermissionError,
  RecordingUnsupportedError,
  type RecordingHandle,
} from "../audio/recorder";

interface VoiceRecorderProps {
  onSend: (blob: Blob, mimeType: string) => void;
}

type RecorderState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "preview"; blob: Blob; mimeType: string; audioUrl: string }
  | { status: "error"; message: string };

export function VoiceRecorder({ onSend }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const handleRef = useRef<RecordingHandle | null>(null);

  useEffect(() => {
    if (state.status !== "recording") return;
    const interval = setInterval(() => setElapsedMs((ms) => ms + 250), 250);
    return () => clearInterval(interval);
  }, [state.status]);

  async function handleStart() {
    try {
      const handle = await startRecording();
      handleRef.current = handle;
      setElapsedMs(0);
      setState({ status: "recording" });
      handle.result.then(({ blob, mimeType }) => {
        setState({ status: "preview", blob, mimeType, audioUrl: URL.createObjectURL(blob) });
      });
    } catch (error) {
      const message =
        error instanceof RecordingPermissionError
          ? "Microphone access denied."
          : error instanceof RecordingUnsupportedError
            ? "Voice recording isn't supported in this browser."
            : "Could not start recording.";
      setState({ status: "error", message });
    }
  }

  function handleStop() {
    handleRef.current?.stop();
  }

  function handleDiscard() {
    if (state.status === "preview") URL.revokeObjectURL(state.audioUrl);
    setState({ status: "idle" });
  }

  function handleSend() {
    if (state.status !== "preview") return;
    onSend(state.blob, state.mimeType);
    setState({ status: "idle" });
  }

  if (state.status === "idle") {
    return <button onClick={handleStart}>Record voice message</button>;
  }
  if (state.status === "recording") {
    return (
      <div>
        <span>
          Recording... {Math.floor(elapsedMs / 1000)}s / {MAX_RECORDING_MS / 1000}s
        </span>
        <button onClick={handleStop}>Stop</button>
      </div>
    );
  }
  if (state.status === "preview") {
    return (
      <div>
        <audio src={state.audioUrl} controls />
        <button onClick={handleSend}>Send</button>
        <button onClick={handleDiscard}>Discard</button>
      </div>
    );
  }
  return (
    <div>
      <span>{state.message}</span>
      <button onClick={() => setState({ status: "idle" })}>Dismiss</button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit** (run from PowerShell)

```bash
git add client/src/screens/VoiceRecorder.tsx
git commit -m "Add voice recorder UI component"
```

---

### Task 5: Wire voice messages into chat

**Files:**
- Modify: `client/src/screens/ChatScreen.tsx`
- Modify: `client/src/net/relayClient.ts`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `VoiceRecorder` from `./VoiceRecorder` (Task 4); `encryptVoiceClip`, `decryptVoiceClip` from `./crypto/media` (Task 2); everything `App.tsx` already imports from Phase 1/2.
- Produces: none — this is Phase 3's integration point, nothing later depends on it.

This task replaces Phase 2's flat `ChatMessage` interface with a discriminated union and wires it end to end in the same task, so every commit in this plan leaves the project typechecking cleanly — splitting the `ChatScreen` type change from its `App.tsx` consumer would leave a commit in between where `App.tsx` no longer matches the type it imports. No automated test for the UI pieces (presentational / browser-API-heavy, same precedent as Phase 1/2) — verified with a protocol-level script plus a final manual end-to-end check, per the approved spec's testing plan.

- [ ] **Step 1: Replace `client/src/screens/ChatScreen.tsx`**

```tsx
import type { FormEvent, ReactNode } from "react";
import { VoiceRecorder } from "./VoiceRecorder";

export type ChatMessage =
  | { id: string; from: "me" | "peer"; kind: "text"; text: string }
  | { id: string; from: "me" | "peer"; kind: "voice"; audioUrl: string }
  | { id: string; kind: "decryption-error" };

interface ChatScreenProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
}

function renderMessage(message: ChatMessage): ReactNode {
  if (message.kind === "decryption-error") {
    return "[Message could not be decrypted]";
  }
  const who = message.from === "me" ? "You" : "Them";
  if (message.kind === "voice") {
    return (
      <>
        {who}: <audio src={message.audioUrl} controls />
      </>
    );
  }
  return `${who}: ${message.text}`;
}

export function ChatScreen({ messages, onSend, onSendVoice }: ChatScreenProps) {
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
          <li key={message.id}>{renderMessage(message)}</li>
        ))}
      </ul>
      <form onSubmit={handleSend}>
        <input name="message" placeholder="Type a message" autoComplete="off" />
        <button type="submit">Send</button>
      </form>
      <VoiceRecorder onSend={onSendVoice} />
    </div>
  );
}
```

- [ ] **Step 2: Add the `voice` envelope variant**

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
  | { type: "voice"; payload: string; mimeType: string }
  | { type: "error"; message: string };
```

- [ ] **Step 3: Replace `client/src/App.tsx`**

```tsx
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
```

- [ ] **Step 4: Verify it typechecks**

Run: `cd client && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Protocol-level integration verification**

No browser automation tool is available in this environment (confirmed during Phase 1 — there is no Playwright/Puppeteer/similar tool). Write a throwaway, uncommitted Node/TypeScript script (not part of the client or server source tree, delete it when done) that proves the real wiring works without a browser:

- Start the real relay server (import and call `startRelay` from `server/src/server.ts`, or run its dev script as a subprocess).
- Open two real `ws` WebSocket connections, simulating client A (initiator) and client B (responder), speaking the exact protocol `App.tsx` drives: A sends `{type:"create"}`, gets `{type:"created", roomCode}`; B sends `{type:"join", roomCode}`; both receive `{type:"peer-connected"}`; both exchange `{type:"pubkey", payload}` using the real `client/src/crypto/keys.ts` + `encoding.ts`.
- Have each side derive session keys with the real `deriveSessionKeys` (A as `"initiator"`, B as `"responder"`).
- Using the real `client/src/crypto/media.ts`, have A build a `Blob` from an arbitrary byte array (standing in for a recorded clip — real audio bytes are irrelevant to the crypto/transport path being tested), encrypt it with `encryptVoiceClip` using its `tx` key, send `{type:"voice", payload, mimeType: "audio/webm;codecs=opus"}`, and assert B decrypts it via `decryptVoiceClip` with its `rx` key to a `Blob` whose bytes match the original exactly. Repeat in the other direction (B → A).
- Assert that a deliberately corrupted `voice` payload (flip a byte, same technique as Task 1's tampering test) fails to decrypt on the receiving side.
- Clean up: close both connections, stop the server process you started.

Expected: all assertions pass — both directions round-trip correctly, tampered voice payload fails to decrypt.

- [ ] **Step 6: Manual end-to-end test — this is the Phase 3 acceptance check**

1. In one terminal: `cd server && npm run dev` (leave running).
2. In another terminal: `cd client && npm run dev` (leave running).
3. Open the printed client URL in one browser window. Click "Start a chat." Note the room code.
4. Open the same URL in a second browser window (or private/incognito). Enter the room code and click "Join a chat."
5. Both windows reach the safety number screen. Click "Verified" on both.
6. **Expected:** both windows now show the chat screen with a "Record voice message" button.
7. In window A, click "Record voice message," allow microphone access, speak briefly, click "Stop." **Expected:** a preview player appears with Send/Discard buttons; play it back to confirm it sounds right.
8. Click "Discard." **Expected:** the recorder returns to idle, nothing was sent.
9. Record again, click "Stop," click "Send." **Expected:** the clip appears immediately in window A's list as "You: [audio player]", and in window B's list as "Them: [audio player]" shortly after — press play in window B and confirm the audio is audible and correct.
10. Record a clip in window A and let it run past 60 seconds without clicking Stop. **Expected:** recording auto-stops at 60s and enters preview automatically.
11. Send a text message from window B after the voice exchange. **Expected:** it appears interleaved correctly with the voice messages in both windows' chronological order.
12. Close one window. **Expected:** the other window shows "Your friend disconnected" (existing Phase 1 behavior, unchanged).
13. Stop both dev servers with Ctrl+C.

- [ ] **Step 7: Commit** (run from PowerShell)

```bash
git add client/src/screens/ChatScreen.tsx client/src/net/relayClient.ts client/src/App.tsx
git commit -m "Wire encrypted voice messages into chat"
```

---

### Task 6: Progress log

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Update `progress.md`**

Update the status table's Phase 3 row from "Not started" to "Complete — async encrypted voice messages working end-to-end." Add a log entry:

```markdown
- **2026-07-18** — Phase 3 complete: async end-to-end encrypted voice
  messages (`crypto_secretbox_easy` on raw audio bytes via a shared
  `secretbox.ts` primitive, reused from Phase 2's text encryption), one new
  pass-through envelope type (`voice`) and no server changes. Record →
  preview → send/discard flow with a 60-second cap, native `<audio>`
  playback, interleaved with text messages in the same chat list. Verified
  end-to-end with two browser windows recording, sending, and playing back
  voice clips. See `docs/superpowers/plans/2026-07-18-phase3-voice-messages.md`.
```

- [ ] **Step 2: Commit** (run from PowerShell)

```bash
git add progress.md
git commit -m "Mark Phase 3 complete"
```

---
