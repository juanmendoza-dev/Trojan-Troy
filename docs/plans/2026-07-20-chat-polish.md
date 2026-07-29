# Chat Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give chat bubbles theme-specific, richer entrance animation, and add WhatsApp-style delivered/read receipts (with a Ghost Mode that suppresses the read signal) to the existing chat surface.

**Architecture:** Two independent pieces sharing the same codebase area. (1) CSS-only per-theme entrance keyframes replacing the single shared `msgIn`, plus small stagger/tick/composer motion layered on top — no new dependencies. (2) A `messageId` cleartext field threaded through the existing envelope protocol, two new pass-through envelope types (`delivered`/`read`) the relay forwards unchanged, and two small pure logic modules (status advancement, read-ack trigger decision) wired into `App.tsx`'s existing message-handling flow. No server changes at all.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`environment: "node"`, no jsdom/React Testing Library — matches this project's existing convention of testing only pure logic, not components).

## Global Constraints

- No new npm dependencies — hand-rolled CSS transitions/keyframes only.
- Entrance animation durations: Apple 0.25s, Iris Glass 0.6s, Pulse Slate 0.4s.
- Stagger: 70ms per message within a burst (messages arriving within 400ms of each other), capped at 280ms total.
- `messageId` is sent as a cleartext field alongside ciphertext (`{ type: "ciphertext", payload, messageId }` / `{ type: "voice", payload, mimeType, messageId }`) — not embedded in the encrypted payload. See `decisions.md` (2026-07-20) — this is a deliberate, already-logged tradeoff, not up for re-litigation in this plan.
- Two new envelope types, forwarded by the relay unchanged (no server code changes): `{ type: "delivered", messageId }`, `{ type: "read", messageId }`.
- Status only ever advances forward: `sent → delivered → read`, never backward.
- Only the sender's most recent own message shows a status indicator (1 grey check = sent, 2 grey checks = delivered, 2 blue checks = read). Incoming (peer) messages never show one.
- "Read" fires only when `document.hasFocus()` and `document.visibilityState === "visible"` — not simply on successful decrypt (that's "delivered").
- Ghost Mode: a `Settings` toggle, `localStorage` key `trojan-troy-ghost-mode`, default **off**. When on, `read` envelopes are never sent; `delivered` envelopes are unaffected.
- `App.tsx`'s `Screen` union and its existing state-transition logic (`handleStart`/`handleJoin`/`exchangeKeys`'s screen transitions) are unchanged — this plan only adds message-handling logic within the existing `chat` state, not new screens.
- Every task must leave the app compiling and typechecking cleanly (`npm run typecheck`, `npm run test` in `client/`).

Spec: `docs/superpowers/specs/2026-07-20-chat-polish-design.md`.

---

### Task 1: Message status pure logic

**Files:**
- Create: `client/src/protocol/messageStatus.ts`
- Test: `client/src/protocol/messageStatus.test.ts`

**Interfaces:**
- Produces: `MessageStatus = "sent" | "delivered" | "read"`, `advanceStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus` — consumed by Task 5 (App.tsx wiring) and Task 7 (ChatMessage type/UI).

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/protocol/messageStatus.test.ts
import { describe, expect, it } from "vitest";
import { advanceStatus } from "./messageStatus";

describe("advanceStatus", () => {
  it("advances from sent to delivered", () => {
    expect(advanceStatus("sent", "delivered")).toBe("delivered");
  });

  it("advances from delivered to read", () => {
    expect(advanceStatus("delivered", "read")).toBe("read");
  });

  it("advances directly from sent to read", () => {
    expect(advanceStatus("sent", "read")).toBe("read");
  });

  it("never regresses from read to delivered", () => {
    expect(advanceStatus("read", "delivered")).toBe("read");
  });

  it("never regresses from delivered to sent", () => {
    expect(advanceStatus("delivered", "sent")).toBe("delivered");
  });

  it("is a no-op when the status is unchanged", () => {
    expect(advanceStatus("delivered", "delivered")).toBe("delivered");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `client/`): `npm run test -- messageStatus`
Expected: FAIL — `Cannot find module './messageStatus'`.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/protocol/messageStatus.ts
export type MessageStatus = "sent" | "delivered" | "read";

const STATUS_RANK: Record<MessageStatus, number> = { sent: 0, delivered: 1, read: 2 };

export function advanceStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- messageStatus`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add client/src/protocol/messageStatus.ts client/src/protocol/messageStatus.test.ts
git commit -m "Add message status advancement logic"
```

---

### Task 2: Read-ack decision pure logic

**Files:**
- Create: `client/src/protocol/readAckDecision.ts`
- Test: `client/src/protocol/readAckDecision.test.ts`

**Interfaces:**
- Produces: `ReadAckInput { isFocused: boolean; isVisible: boolean; ghostMode: boolean; alreadyAcked: boolean }`, `shouldSendReadAck(input: ReadAckInput): boolean` — consumed by Task 5 (App.tsx wiring).

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/protocol/readAckDecision.test.ts
import { describe, expect, it } from "vitest";
import { shouldSendReadAck } from "./readAckDecision";

describe("shouldSendReadAck", () => {
  it("sends when focused, visible, not ghost mode, not already acked", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: true, ghostMode: false, alreadyAcked: false })
    ).toBe(true);
  });

  it("does not send when the tab is not focused", () => {
    expect(
      shouldSendReadAck({ isFocused: false, isVisible: true, ghostMode: false, alreadyAcked: false })
    ).toBe(false);
  });

  it("does not send when the tab is not visible", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: false, ghostMode: false, alreadyAcked: false })
    ).toBe(false);
  });

  it("does not send when ghost mode is on, even if focused and visible", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: true, ghostMode: true, alreadyAcked: false })
    ).toBe(false);
  });

  it("does not send when already acked", () => {
    expect(
      shouldSendReadAck({ isFocused: true, isVisible: true, ghostMode: false, alreadyAcked: true })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `client/`): `npm run test -- readAckDecision`
Expected: FAIL — `Cannot find module './readAckDecision'`.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/protocol/readAckDecision.ts
export interface ReadAckInput {
  isFocused: boolean;
  isVisible: boolean;
  ghostMode: boolean;
  alreadyAcked: boolean;
}

export function shouldSendReadAck(input: ReadAckInput): boolean {
  if (input.ghostMode) return false;
  if (input.alreadyAcked) return false;
  return input.isFocused && input.isVisible;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- readAckDecision`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add client/src/protocol/readAckDecision.ts client/src/protocol/readAckDecision.test.ts
git commit -m "Add read-ack trigger decision logic"
```

---

### Task 3: Message stagger pure logic

**Files:**
- Create: `client/src/components/messageStagger.ts`
- Test: `client/src/components/messageStagger.test.ts`

**Interfaces:**
- Produces: `TimestampedMessage { timestamp: number }`, `staggerDelayMs(messages: TimestampedMessage[], index: number): number` — consumed by Task 7 (`ChatScreen.tsx`).

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/components/messageStagger.test.ts
import { describe, expect, it } from "vitest";
import { staggerDelayMs } from "./messageStagger";

describe("staggerDelayMs", () => {
  it("returns 0 for the first message", () => {
    const messages = [{ timestamp: 1000 }];
    expect(staggerDelayMs(messages, 0)).toBe(0);
  });

  it("returns 0 when the previous message arrived long before (not a burst)", () => {
    const messages = [{ timestamp: 1000 }, { timestamp: 5000 }];
    expect(staggerDelayMs(messages, 1)).toBe(0);
  });

  it("stacks delay across consecutive rapid messages", () => {
    const messages = [{ timestamp: 1000 }, { timestamp: 1100 }, { timestamp: 1250 }];
    expect(staggerDelayMs(messages, 0)).toBe(0);
    expect(staggerDelayMs(messages, 1)).toBe(70);
    expect(staggerDelayMs(messages, 2)).toBe(140);
  });

  it("caps the delay at 280ms for long bursts", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ timestamp: i * 100 }));
    expect(staggerDelayMs(messages, 9)).toBe(280);
  });

  it("resets the burst after a gap even mid-conversation", () => {
    const messages = [{ timestamp: 0 }, { timestamp: 100 }, { timestamp: 5000 }, { timestamp: 5100 }];
    expect(staggerDelayMs(messages, 3)).toBe(70);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `client/`): `npm run test -- messageStagger`
Expected: FAIL — `Cannot find module './messageStagger'`.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/components/messageStagger.ts
export interface TimestampedMessage {
  timestamp: number;
}

const BURST_WINDOW_MS = 400;
const STAGGER_STEP_MS = 70;
const MAX_STAGGER_MS = 280;

export function staggerDelayMs(messages: TimestampedMessage[], index: number): number {
  let burstPosition = 0;
  for (let i = index; i > 0; i--) {
    if (messages[i].timestamp - messages[i - 1].timestamp <= BURST_WINDOW_MS) {
      burstPosition++;
    } else {
      break;
    }
  }
  return Math.min(burstPosition * STAGGER_STEP_MS, MAX_STAGGER_MS);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- messageStagger`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add client/src/components/messageStagger.ts client/src/components/messageStagger.test.ts
git commit -m "Add message stagger delay logic"
```

---

### Task 4: Extend the envelope protocol

**Files:**
- Modify: `client/src/net/relayClient.ts`
- Modify: `client/src/net/relayClient.test.ts`

**Interfaces:**
- Produces: `Envelope` type gains `messageId` on `ciphertext`/`voice`, plus new `delivered`/`read` variants — consumed by Task 5 (`App.tsx`).

- [ ] **Step 1: Write the failing tests**

Add to `client/src/net/relayClient.test.ts`, inside the existing `describe("RelayClient", ...)` block, after the `"sends envelopes as JSON over the socket"` test:

```ts
  it("includes messageId when sending a ciphertext envelope", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);

    client.send({ type: "ciphertext", payload: "encrypted", messageId: "abc-123" });

    expect(socket.sent).toEqual([
      JSON.stringify({ type: "ciphertext", payload: "encrypted", messageId: "abc-123" }),
    ]);
  });

  it("passes through delivered and read acks", () => {
    const socket = fakeSocket();
    const client = new RelayClient("ws://test", () => socket);
    const received: unknown[] = [];
    client.onMessage((envelope) => received.push(envelope));

    socket.onmessage?.({ data: JSON.stringify({ type: "delivered", messageId: "abc-123" }) });
    socket.onmessage?.({ data: JSON.stringify({ type: "read", messageId: "abc-123" }) });

    expect(received).toEqual([
      { type: "delivered", messageId: "abc-123" },
      { type: "read", messageId: "abc-123" },
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `client/`): `npm run test -- relayClient`
Expected: FAIL — TypeScript error, `messageId` does not exist on type `{ type: "ciphertext"; payload: string }`, and `"delivered"`/`"read"` are not assignable to `Envelope["type"]`.

- [ ] **Step 3: Write the implementation**

In `client/src/net/relayClient.ts`, replace the `Envelope` type:

```ts
export type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  | { type: "pubkey"; payload: string }
  | { type: "ciphertext"; payload: string; messageId: string }
  | { type: "voice"; payload: string; mimeType: string; messageId: string }
  | { type: "delivered"; messageId: string }
  | { type: "read"; messageId: string }
  | { type: "error"; message: string };
```

(was missing `messageId` on `ciphertext`/`voice`, and had no `delivered`/`read` variants — everything else in the file is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- relayClient`
Expected: PASS, 11 tests (9 existing + 2 new).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: FAIL at this point — `App.tsx` still sends `ciphertext`/`voice` envelopes without `messageId` (Task 5 fixes this). This is expected; do not fix `App.tsx` in this task.

- [ ] **Step 6: Commit**

```powershell
git add client/src/net/relayClient.ts client/src/net/relayClient.test.ts
git commit -m "Add messageId and delivered/read envelope types"
```

---

### Task 5: Wire messageId, delivered, and read into the app

**Files:**
- Modify: `client/src/screens/ChatScreen.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `advanceStatus`, `MessageStatus` from Task 1; `shouldSendReadAck` from Task 2; the extended `Envelope` type from Task 4.
- Produces: `ChatMessage` gains `timestamp: number` and (on `text`/`voice` variants) `status?: MessageStatus` — consumed by Task 7 (bubble UI). `ghostModeRef` (hardcoded off in this task) — replaced with real state in Task 6.

- [ ] **Step 1: Update the `ChatMessage` type**

In `client/src/screens/ChatScreen.tsx`, add the import and replace the type:

```tsx
import type { MessageStatus } from "../protocol/messageStatus";
```

```tsx
export type ChatMessage =
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "text"; text: string; status?: MessageStatus }
  | { id: string; timestamp: number; from: "me" | "peer"; kind: "voice"; audioUrl: string; status?: MessageStatus }
  | { id: string; timestamp: number; kind: "decryption-error" };
```

(was missing `timestamp` on all three variants and `status` on the two message variants.)

- [ ] **Step 2: Typecheck to see the resulting errors in App.tsx**

Run (from `client/`): `npm run typecheck`
Expected: FAIL — several errors in `App.tsx` where `ChatMessage` objects are constructed without `timestamp` (this is the map of every place Step 3 needs to touch).

- [ ] **Step 3: Update `App.tsx` imports and add the module-level read-ack helper**

Replace the import block at the top of `client/src/App.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RelayClient, type Envelope } from "./net/relayClient";
import { generateKeypair, deriveSessionKeys, type Keypair, type SessionKeys } from "./crypto/keys";
import { computeSafetyNumber } from "./crypto/safetyNumber";
import { toBase64, fromBase64 } from "./crypto/encoding";
import { encryptMessage, decryptMessage } from "./crypto/messages";
import { encryptVoiceClip, decryptVoiceClip } from "./crypto/media";
import { advanceStatus } from "./protocol/messageStatus";
import { shouldSendReadAck } from "./protocol/readAckDecision";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { WaitingScreen } from "./screens/WaitingScreen";
import { SafetyNumberScreen } from "./screens/SafetyNumberScreen";
import { ChatScreen, type ChatMessage } from "./screens/ChatScreen";
import { useTheme } from "./theme/ThemeContext";
import { LoadingScreen } from "./screens/loading/LoadingScreen";
import { HandshakeJourney } from "./screens/HandshakeJourney";
import { parseScreenOverride } from "./dev/screenOverride";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";

function maybeSendReadAck(
  client: RelayClient,
  pendingReadIdRef: { current: string | null },
  ghostModeRef: { current: boolean }
) {
  const messageId = pendingReadIdRef.current;
  if (!messageId) return;
  const send = shouldSendReadAck({
    isFocused: document.hasFocus(),
    isVisible: document.visibilityState === "visible",
    ghostMode: ghostModeRef.current,
    alreadyAcked: false,
  });
  if (send) {
    client.send({ type: "read", messageId });
    pendingReadIdRef.current = null;
  }
}
```

(new: the `advanceStatus`/`shouldSendReadAck` imports and the `maybeSendReadAck` function, placed at module scope — not inside the component — specifically so it takes its ref objects as plain parameters and never risks a stale closure over component state. Everything else in the import block and `RELAY_URL` line is unchanged.)

- [ ] **Step 4: Add new refs and the focus/visibility effect inside `App()`**

Immediately after this existing block:

```tsx
  const sessionKeysRef = useRef<SessionKeys | null>(null);
  const clientRef = useRef<RelayClient | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const { setTheme } = useTheme();
```

add:

```tsx
  const pendingReadIdRef = useRef<string | null>(null);
  const ghostModeRef = useRef(false);

  useEffect(() => {
    function handleFocusChange() {
      const client = clientRef.current;
      if (client) maybeSendReadAck(client, pendingReadIdRef, ghostModeRef);
    }
    document.addEventListener("visibilitychange", handleFocusChange);
    window.addEventListener("focus", handleFocusChange);
    return () => {
      document.removeEventListener("visibilitychange", handleFocusChange);
      window.removeEventListener("focus", handleFocusChange);
    };
  }, []);
```

(`ghostModeRef` is hardcoded off for now — Task 6 replaces this line with real state backed by `localStorage` and a Settings toggle. Everything else in `App()` below this point, up to `exchangeKeys`, is unchanged.)

- [ ] **Step 5: Update `exchangeKeys`'s `ciphertext`/`voice`/new envelope handling**

Replace the `ciphertext` and `voice` blocks inside `exchangeKeys`'s `client.onMessage` callback:

```tsx
      if (envelope.type === "ciphertext") {
        const keys = sessionKeysRef.current;
        const client = clientRef.current;
        if (!keys || !client) return;
        try {
          const text = await decryptMessage(keys.rx, envelope.payload);
          setMessages((prev) => [
            ...prev,
            { id: envelope.messageId, timestamp: Date.now(), from: "peer", kind: "text", text },
          ]);
          client.send({ type: "delivered", messageId: envelope.messageId });
          pendingReadIdRef.current = envelope.messageId;
          maybeSendReadAck(client, pendingReadIdRef, ghostModeRef);
        } catch {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
          ]);
        }
        return;
      }
      if (envelope.type === "voice") {
        const keys = sessionKeysRef.current;
        const client = clientRef.current;
        if (!keys || !client) return;
        try {
          const blob = await decryptVoiceClip(keys.rx, envelope.payload, envelope.mimeType);
          const audioUrl = URL.createObjectURL(blob);
          setMessages((prev) => [
            ...prev,
            { id: envelope.messageId, timestamp: Date.now(), from: "peer", kind: "voice", audioUrl },
          ]);
          client.send({ type: "delivered", messageId: envelope.messageId });
          pendingReadIdRef.current = envelope.messageId;
          maybeSendReadAck(client, pendingReadIdRef, ghostModeRef);
        } catch {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
          ]);
        }
        return;
      }
      if (envelope.type === "delivered" || envelope.type === "read") {
        setMessages((prev) =>
          prev.map((message) =>
            message.kind !== "decryption-error" && message.id === envelope.messageId
              ? { ...message, status: advanceStatus(message.status ?? "sent", envelope.type) }
              : message
          )
        );
      }
```

(was using `crypto.randomUUID()` for the receiver's own id — now reuses the sender's `envelope.messageId` so both sides agree on the same id, sends a `delivered` ack immediately, and attempts a `read` ack right away if the tab is already focused. The new `delivered`/`read` branch updates whichever sent message matches, using Task 1's forward-only rule. The `pubkey` and `peer-disconnected` blocks above these, and the `client.send({ type: "pubkey", ... })` line after, are unchanged.)

- [ ] **Step 6: Update `handleSend`, `handleSendVoice`, and `handleLeave`**

Replace all three functions:

```tsx
  async function handleSend(text: string) {
    const keys = sessionKeysRef.current;
    const client = clientRef.current;
    if (!keys || !client) return;
    const payload = await encryptMessage(keys.tx, text);
    const id = crypto.randomUUID();
    client.send({ type: "ciphertext", payload, messageId: id });
    setMessages((prev) => [
      ...prev,
      { id, timestamp: Date.now(), from: "me", kind: "text", text, status: "sent" },
    ]);
  }

  async function handleSendVoice(blob: Blob, mimeType: string) {
    const keys = sessionKeysRef.current;
    const client = clientRef.current;
    if (!keys || !client) return;
    const payload = await encryptVoiceClip(keys.tx, blob);
    const id = crypto.randomUUID();
    client.send({ type: "voice", payload, mimeType, messageId: id });
    const audioUrl = URL.createObjectURL(blob);
    setMessages((prev) => [
      ...prev,
      { id, timestamp: Date.now(), from: "me", kind: "voice", audioUrl, status: "sent" },
    ]);
  }

  function handleLeave() {
    clientRef.current?.close();
    clientRef.current = null;
    sessionKeysRef.current = null;
    pendingReadIdRef.current = null;
    for (const message of messagesRef.current) {
      if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
    }
    setMessages([]);
    setScreen({ name: "start" });
  }
```

(each send now generates its own `id` up front so it can both go on the wire as `messageId` and key the optimistic local message; `handleLeave` additionally resets `pendingReadIdRef`.)

- [ ] **Step 7: Update the dev-override sample messages**

Replace the sample `messages` array in the `devOverride?.screen === "chat"` block:

```tsx
          messages={[
            {
              id: "1",
              timestamp: Date.now() - 3000,
              from: "peer",
              kind: "text",
              text: "did you check the safety number?",
            },
            {
              id: "2",
              timestamp: Date.now() - 2000,
              from: "me",
              kind: "text",
              text: "yep — 21934 07741 66012 — matches on my end",
              status: "delivered",
            },
            {
              id: "3",
              timestamp: Date.now() - 1000,
              from: "me",
              kind: "text",
              text: "got it — nothing between us but ciphertext.",
              status: "read",
            },
          ]}
```

(adds `timestamp` to satisfy the updated `ChatMessage` type, and `status` so the dev preview demonstrates the read-receipt indicator.)

- [ ] **Step 8: Typecheck and run tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all existing tests still pass (39 + the new tests from Tasks 1-4).

- [ ] **Step 9: Commit**

```powershell
git add client/src/screens/ChatScreen.tsx client/src/App.tsx
git commit -m "Wire messageId and delivered/read acks into the chat flow"
```

---

### Task 6: Ghost Mode setting

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/screens/ChatScreen.tsx`
- Modify: `client/src/components/Settings.tsx`
- Modify: `client/src/components/Settings.css`

**Interfaces:**
- Consumes: `ghostModeRef` (declared in Task 5).
- Produces: `ghostMode: boolean`, `onGhostModeChange: (next: boolean) => void` props threaded from `App.tsx` through `ChatScreen` to `Settings`.

- [ ] **Step 1: Add Ghost Mode state and persistence in `App.tsx`**

Add this constant alongside the existing `RELAY_URL` line:

```tsx
const GHOST_MODE_STORAGE_KEY = "trojan-troy-ghost-mode";
```

Replace the line `const ghostModeRef = useRef(false);` (added in Task 5) with:

```tsx
  const [ghostMode, setGhostMode] = useState<boolean>(
    () => localStorage.getItem(GHOST_MODE_STORAGE_KEY) === "true"
  );
  const ghostModeRef = useRef(ghostMode);
  ghostModeRef.current = ghostMode;

  function updateGhostMode(next: boolean) {
    localStorage.setItem(GHOST_MODE_STORAGE_KEY, String(next));
    setGhostMode(next);
  }
```

(mirrors the existing `messagesRef.current = messages` pattern already used just above it in the same component.)

- [ ] **Step 2: Pass the props down from `App.tsx`**

In the `devOverride?.screen === "chat"` block, add to the `<ChatScreen>` props:

```tsx
          ghostMode={ghostMode}
          onGhostModeChange={updateGhostMode}
```

In the real `chat` screen's `<ChatScreen>` render (inside the `screen.name === "handshake" || ... "chat"` block's `else` branch), add the same two props.

- [ ] **Step 3: Thread the props through `ChatScreen.tsx`**

Update `ChatScreenProps` and the component signature:

```tsx
interface ChatScreenProps {
  roomCode: string;
  safetyNumber: string;
  messages: ChatMessage[];
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
  onLeave: () => void;
}
```

```tsx
export function ChatScreen({
  roomCode,
  safetyNumber,
  messages,
  ghostMode,
  onGhostModeChange,
  onSend,
  onSendVoice,
  onLeave,
}: ChatScreenProps) {
```

Pass them to `<Settings>`:

```tsx
        <Settings
          roomCode={roomCode}
          safetyNumber={safetyNumber}
          ghostMode={ghostMode}
          onGhostModeChange={onGhostModeChange}
          onLeave={onLeave}
          onClose={() => setSettingsOpen(false)}
        />
```

- [ ] **Step 4: Add the Privacy section to `Settings.tsx`**

Update `SettingsProps` and the component signature:

```tsx
interface SettingsProps {
  roomCode: string;
  safetyNumber: string;
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  onLeave: () => void;
  onClose: () => void;
}

export function Settings({
  roomCode,
  safetyNumber,
  ghostMode,
  onGhostModeChange,
  onLeave,
  onClose,
}: SettingsProps) {
```

Insert a new section between the existing "Session" section and the existing "About" section:

```tsx
        <div className="settings__section">
          <div className="settings__section-label">Privacy</div>
          <div className="settings__row">
            <span className="settings__row-label">Ghost mode</span>
            <label className="settings__toggle">
              <input
                type="checkbox"
                checked={ghostMode}
                onChange={(event) => onGhostModeChange(event.target.checked)}
              />
              <span className="settings__toggle-track" />
            </label>
          </div>
          <p className="settings__about-text">
            When on, your peer never sees a "read" receipt for messages you open — they'll still see
            "delivered."
          </p>
        </div>
```

- [ ] **Step 5: Add the toggle switch styling**

Append to `client/src/components/Settings.css`:

```css
.settings__toggle {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 22px;
  flex: none;
  cursor: pointer;
}
.settings__toggle input {
  position: absolute;
  inset: 0;
  opacity: 0;
  margin: 0;
  cursor: pointer;
}
.settings__toggle-track {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: var(--radius-pill);
  transition: background 0.2s ease;
}
.settings__toggle-track::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s ease;
}
.settings__toggle input:checked + .settings__toggle-track {
  background: var(--accent);
}
.settings__toggle input:checked + .settings__toggle-track::before {
  transform: translateX(18px);
}
```

- [ ] **Step 6: Typecheck and run tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all tests still pass.

- [ ] **Step 7: Commit**

```powershell
git add client/src/App.tsx client/src/screens/ChatScreen.tsx client/src/components/Settings.tsx client/src/components/Settings.css
git commit -m "Add Ghost Mode setting"
```

---

### Task 7: Themed bubble entrance, status ticks, and stagger

**Files:**
- Modify: `client/src/styles/keyframes.css`
- Modify: `client/src/components/MessageBubble.tsx`
- Modify: `client/src/components/MessageBubble.css`
- Modify: `client/src/components/VoiceMessageBubble.tsx`
- Modify: `client/src/components/VoiceMessageBubble.css`
- Modify: `client/src/screens/ChatScreen.tsx`

**Interfaces:**
- Consumes: `MessageStatus` from Task 1, `staggerDelayMs`/`TimestampedMessage` from Task 3, the `timestamp`/`status` fields on `ChatMessage` from Task 5.

- [ ] **Step 1: Add the new entrance keyframes**

Append to `client/src/styles/keyframes.css` (after the existing `crossfadeOut` line):

```css
@keyframes bubbleInApple { 0% { opacity: 0; transform: translateY(10px) scale(0.92); box-shadow: 0 0 0 rgba(0, 0, 0, 0); } 70% { box-shadow: 0 6px 14px rgba(0, 0, 0, 0.10); } 100% { opacity: 1; transform: translateY(0) scale(1); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); } }
@keyframes bubbleInIris { 0% { opacity: 0; transform: translateY(10px); filter: blur(6px); } 100% { opacity: 1; transform: translateY(0); filter: blur(0); } }
@keyframes bubbleInPulse { 0% { opacity: 0; transform: scale(0.85); box-shadow: 0 0 0 0 rgba(167, 139, 250, 0); } 55% { transform: scale(1.04); box-shadow: 0 0 16px 2px rgba(167, 139, 250, 0.35); } 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(167, 139, 250, 0); } }
```

- [ ] **Step 2: Rewrite `MessageBubble.css`**

Replace the full contents of `client/src/components/MessageBubble.css`:

```css
.message-row {
  display: flex;
}
.message-row--incoming {
  justify-content: flex-start;
}
.message-row--outgoing {
  flex-direction: column;
  align-items: flex-end;
}
.message-bubble {
  max-width: 420px;
  padding: 11px 16px;
  font-size: 15px;
  line-height: 1.47;
  letter-spacing: -0.224px;
  border-radius: var(--radius-bubble);
  transition: transform 0.2s ease;
  overflow-wrap: break-word;
  word-break: break-word;
  animation: bubbleInApple 0.25s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.message-bubble--incoming {
  background: var(--bubble-incoming-bg);
  color: var(--text-primary);
  border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 5px;
}
.message-bubble--outgoing {
  background: var(--bubble-outgoing-bg);
  color: var(--bubble-outgoing-text);
  border-radius: var(--radius-bubble) var(--radius-bubble) 5px var(--radius-bubble);
}
:root[data-theme="iris"] .message-bubble,
:root[data-theme="pulse"] .message-bubble {
  border: 1px solid var(--border);
  font-size: 14px;
  line-height: 1.5;
}
:root[data-theme="apple"] .message-bubble:hover {
  transform: translateY(-1px);
}
:root[data-theme="iris"] .message-bubble:hover,
:root[data-theme="pulse"] .message-bubble:hover {
  transform: translateY(-2px);
}
:root[data-theme="iris"] .message-bubble {
  position: relative;
  overflow: hidden;
  animation-name: bubbleInIris;
  animation-duration: 0.6s;
}
:root[data-theme="iris"] .message-bubble::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  animation: sheen 0.9s ease-in-out both;
  pointer-events: none;
}
:root[data-theme="pulse"] .message-bubble {
  animation-name: bubbleInPulse;
  animation-duration: 0.4s;
}
.message-status {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 3px;
  letter-spacing: 1px;
  animation: checkPop 0.3s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  transition: color 0.3s ease;
}
.message-status--read {
  color: var(--accent);
}
```

(the base `msgIn` animation on `.message-row` is gone — entrance now animates `.message-bubble`/`.voice-bubble` directly, since a box-shadow/blur effect on the full-width row would render oversized. `.message-row--outgoing` becomes a column so the new `.message-status` indicator stacks under the bubble, right-aligned. Apple gets its own subtle hover lift, matching Iris/Pulse's existing one but smaller. Bubble colors, radius, and the iris/pulse border treatment are unchanged.)

- [ ] **Step 3: Update `MessageBubble.tsx`**

```tsx
// client/src/components/MessageBubble.tsx
import "./MessageBubble.css";
import type { MessageStatus } from "../protocol/messageStatus";

interface MessageBubbleProps {
  from: "me" | "peer";
  text: string;
  status?: MessageStatus;
  delayMs?: number;
}

const STATUS_TICKS: Record<MessageStatus, string> = {
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
};

export function MessageBubble({ from, text, status, delayMs = 0 }: MessageBubbleProps) {
  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div
        className={
          from === "me" ? "message-bubble message-bubble--outgoing" : "message-bubble message-bubble--incoming"
        }
        style={{ animationDelay: `${delayMs}ms` }}
      >
        {text}
      </div>
      {status && <span className={`message-status message-status--${status}`}>{STATUS_TICKS[status]}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Update `VoiceMessageBubble.tsx`**

```tsx
// client/src/components/VoiceMessageBubble.tsx
import { useRef, useState } from "react";
import type { MessageStatus } from "../protocol/messageStatus";
import "./VoiceMessageBubble.css";

interface VoiceMessageBubbleProps {
  from: "me" | "peer";
  audioUrl: string;
  durationLabel: string;
  status?: MessageStatus;
  delayMs?: number;
}

const BAR_HEIGHTS = [10, 20, 14, 24, 12, 22, 9, 18, 13, 21];

const STATUS_TICKS: Record<MessageStatus, string> = {
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
};

export function VoiceMessageBubble({
  from,
  audioUrl,
  durationLabel,
  status,
  delayMs = 0,
}: VoiceMessageBubbleProps) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }

  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div className="voice-bubble" style={{ animationDelay: `${delayMs}ms` }}>
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <button className="voice-bubble__play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="voice-bubble__waveform" data-playing={playing}>
          {BAR_HEIGHTS.map((height, index) => (
            <span
              key={index}
              className="voice-bubble__bar"
              style={{ height, animationDelay: `${index * 0.15}s` }}
            />
          ))}
        </div>
        <span className="voice-bubble__duration">{durationLabel}</span>
      </div>
      {status && <span className={`message-status message-status--${status}`}>{STATUS_TICKS[status]}</span>}
    </div>
  );
}
```

- [ ] **Step 5: Add entrance animation to `VoiceMessageBubble.css`**

Append to `client/src/components/VoiceMessageBubble.css`:

```css
.voice-bubble {
  animation: bubbleInApple 0.25s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
:root[data-theme="iris"] .voice-bubble {
  position: relative;
  overflow: hidden;
  animation-name: bubbleInIris;
  animation-duration: 0.6s;
}
:root[data-theme="iris"] .voice-bubble::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  animation: sheen 0.9s ease-in-out both;
  pointer-events: none;
}
:root[data-theme="pulse"] .voice-bubble {
  animation-name: bubbleInPulse;
  animation-duration: 0.4s;
}
```

(this is a second, separate rule for `.voice-bubble` — the existing `.voice-bubble { display: flex; ... }` rule earlier in the file already sets its other properties and is untouched; CSS merges both rule blocks for the same selector.)

- [ ] **Step 6: Wire status + stagger into `ChatScreen.tsx`**

Add the import:

```tsx
import { staggerDelayMs } from "../components/messageStagger";
```

Replace `renderMessage`:

```tsx
function renderMessage(message: ChatMessage, showStatus: boolean, delayMs: number): ReactNode {
  if (message.kind === "decryption-error") {
    return (
      <div className="message-row message-row--incoming">
        <div className="message-bubble message-bubble--incoming">[Message could not be decrypted]</div>
      </div>
    );
  }
  const status = showStatus ? message.status : undefined;
  if (message.kind === "voice") {
    return (
      <VoiceMessageBubble
        from={message.from}
        audioUrl={message.audioUrl}
        durationLabel="0:23"
        status={status}
        delayMs={delayMs}
      />
    );
  }
  return <MessageBubble from={message.from} text={message.text} status={status} delayMs={delayMs} />;
}
```

Inside the `ChatScreen` component body, before the `return`, add:

```tsx
  const lastMeIndex = messages.reduce(
    (acc, message, index) => (message.kind !== "decryption-error" && message.from === "me" ? index : acc),
    -1
  );
```

Replace the messages `.map()` call:

```tsx
            {messages.map((message, index) => (
              <div key={message.id}>
                {renderMessage(message, index === lastMeIndex, staggerDelayMs(messages, index))}
              </div>
            ))}
```

(`renderMessage` gained two parameters — `showStatus`/`delayMs` — that read from the fields Task 5 already added to `ChatMessage`; `lastMeIndex` finds the sender's own most recent message so only that one ever shows a status indicator.)

- [ ] **Step 7: Typecheck and run tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all tests still pass.

- [ ] **Step 8: Commit**

```powershell
git add client/src/styles/keyframes.css client/src/components/MessageBubble.tsx client/src/components/MessageBubble.css client/src/components/VoiceMessageBubble.tsx client/src/components/VoiceMessageBubble.css client/src/screens/ChatScreen.tsx
git commit -m "Add themed bubble entrance animation, status ticks, and stagger"
```

---

### Task 8: Composer send micro-interaction

**Files:**
- Modify: `client/src/styles/keyframes.css`
- Modify: `client/src/components/Composer.tsx`
- Modify: `client/src/components/Composer.css`

**Interfaces:** none — self-contained, no other task depends on this one.

- [ ] **Step 1: Add the composer-sent keyframe**

Append to `client/src/styles/keyframes.css`:

```css
@keyframes composerSent { 0% { transform: scale(1); } 40% { transform: scale(0.985); } 100% { transform: scale(1); } }
```

- [ ] **Step 2: Add the transient "just sent" state to `Composer.tsx`**

Replace the full contents of `client/src/components/Composer.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import { VoiceRecorder } from "../screens/VoiceRecorder";
import "./Composer.css";

interface ComposerProps {
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
}

const SENT_ANIMATION_MS = 300;

export function Composer({ onSend, onSendVoice }: ComposerProps) {
  const [value, setValue] = useState("");
  const [justSent, setJustSent] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    setJustSent(true);
    setTimeout(() => setJustSent(false), SENT_ANIMATION_MS);
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className={`composer__input-wrap${justSent ? " composer__input-wrap--sent" : ""}`}>
        <input
          className="composer__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Message — encrypted end-to-end"
          autoComplete="off"
        />
        <span className="composer__caret" />
      </div>
      <VoiceRecorder onSend={onSendVoice} />
      <button className="composer__send-button" type="submit" aria-label="Send">
        ↑
      </button>
    </form>
  );
}
```

(only the `justSent` state, the `SENT_ANIMATION_MS` constant, the three new lines in `handleSubmit`, and the conditional class on `.composer__input-wrap` are new — everything else is unchanged.)

- [ ] **Step 3: Add the animation to `Composer.css`**

Append to `client/src/components/Composer.css`:

```css
.composer__input-wrap--sent {
  animation: composerSent 0.3s ease;
}
```

- [ ] **Step 4: Typecheck and run tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all tests still pass.

- [ ] **Step 5: Commit**

```powershell
git add client/src/styles/keyframes.css client/src/components/Composer.tsx client/src/components/Composer.css
git commit -m "Add a send micro-interaction to the composer"
```

---

### Task 9: Manual end-to-end verification

**Files:** none (verification only), plus:
- Modify: `progress.md`

**Interfaces:** none — this task exercises the finished feature.

- [ ] **Step 1: Start both dev servers**

Terminal 1:
```powershell
cd "C:\Users\superCookie\Desktop\Trojan Troy\server"
npm run dev
```

Terminal 2:
```powershell
cd "C:\Users\superCookie\Desktop\Trojan Troy\client"
npm run dev
```

Note the printed client URL (e.g. `http://localhost:5173`).

- [ ] **Step 2: Quick visual check via the dev override**

Open `http://localhost:5173/?screen=chat` — confirm: bubbles fade/scale/blur in per the active theme (switch themes via `?theme=apple` / `?theme=iris` / `?theme=pulse` alongside `?screen=chat`, per `client/src/dev/screenOverride.ts`'s existing query-param support), the last "me" message shows a "✓✓" indicator in the theme's accent color (the sample data sets its status to `"read"`), and Apple bubbles now lift slightly on hover just like Iris/Pulse already did.

- [ ] **Step 3: Write a scratch Playwright script for the full read-receipt flow**

Following the same pattern used for prior phases (no browser-automation tool available in this environment), install Playwright in the scratchpad if not already installed there from a prior session:

```powershell
mkdir "$env:TEMP\claude-scratch-chat-polish"
cd "$env:TEMP\claude-scratch-chat-polish"
npm init -y
npm install playwright
```

Write `verify.js`:

```js
const { chromium } = require("playwright");

const CLIENT_URL = "http://localhost:5173";

// Real OS-level window focus across multiple browser contexts is unreliable to
// script deterministically in headless Chromium. Instead, override
// document.hasFocus()/visibilityState per-context so the test can flip a
// page's simulated focus state on demand and check the app's actual reaction
// to it (App.tsx reads these two APIs fresh on every check, never caching
// them, so overriding them is equivalent from the app's point of view).
const FOCUS_CONTROL_SCRIPT = `
  window.__setFocused = function (focused) {
    document.hasFocus = () => focused;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (focused ? "visible" : "hidden"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(focused ? "focus" : "blur"));
  };
  window.__setFocused(false);
`;

async function pairSession(browser) {
  const initiatorCtx = await browser.newContext();
  const joinerCtx = await browser.newContext();
  await initiatorCtx.addInitScript(FOCUS_CONTROL_SCRIPT);
  await joinerCtx.addInitScript(FOCUS_CONTROL_SCRIPT);
  const initiator = await initiatorCtx.newPage();
  const joiner = await joinerCtx.newPage();

  const errors = [];
  for (const [label, page] of [["initiator", initiator], ["joiner", joiner]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[${label}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[${label}] ${err.message}`));
  }

  await initiator.goto(CLIENT_URL);
  await initiator.click("text=Start a chat");
  await initiator.waitForSelector("code");
  const roomCode = await initiator.locator("code").innerText();

  await joiner.goto(CLIENT_URL);
  await joiner.fill("input[name=roomCode]", roomCode);
  await joiner.click("text=Join a chat");

  await initiator.waitForSelector("text=Verify safety number");
  await joiner.waitForSelector("text=Verify safety number");
  await initiator.click("text=Verified");
  await joiner.click("text=Verified");

  await initiator.waitForSelector(".chat-screen");
  await joiner.waitForSelector(".chat-screen");

  return { initiator, joiner, errors };
}

(async () => {
  const browser = await chromium.launch();

  // Part 1: normal delivered -> read progression. Both pages start
  // simulated-unfocused (FOCUS_CONTROL_SCRIPT's default), so the message
  // should land as delivered-only until the joiner is explicitly focused.
  const s1 = await pairSession(browser);
  await s1.initiator.fill(".composer__input", "hello there");
  await s1.initiator.press(".composer__input", "Enter");
  await s1.joiner.waitForSelector("text=hello there");
  await s1.initiator.waitForFunction(
    () => document.querySelector(".message-status")?.textContent === "✓✓"
  );
  const deliveredIsRead = await s1.initiator
    .locator(".message-status")
    .evaluate((el) => el.classList.contains("message-status--read"));

  await s1.joiner.evaluate(() => window.__setFocused(true));
  await s1.initiator.waitForFunction(
    () => document.querySelector(".message-status")?.classList.contains("message-status--read"),
    { timeout: 5000 }
  );
  await s1.initiator.close();
  await s1.joiner.close();

  // Part 2: Ghost Mode suppresses the read ack even once focused.
  const s2 = await pairSession(browser);
  await s2.joiner.click('[aria-label="Settings"]');
  await s2.joiner.waitForSelector(".settings__panel");
  // The visible track sibling intentionally overlaps the (opacity: 0) checkbox
  // input for the toggle-switch visual, which trips Playwright's default
  // actionability check — force the click directly on the input instead, then
  // wait for React's re-render rather than assuming the click's own promise
  // resolving means the DOM has already reflected the new checked state.
  await s2.joiner.locator('.settings__toggle input[type="checkbox"]').click({ force: true });
  await s2.joiner.waitForFunction(
    () => document.querySelector('.settings__toggle input[type="checkbox"]')?.checked === true,
    { timeout: 3000 }
  );
  await s2.joiner.keyboard.press("Escape");

  await s2.initiator.fill(".composer__input", "checking ghost mode");
  await s2.initiator.press(".composer__input", "Enter");
  await s2.joiner.waitForSelector("text=checking ghost mode");
  await s2.initiator.waitForFunction(
    () => document.querySelector(".message-status")?.textContent === "✓✓"
  );

  await s2.joiner.evaluate(() => window.__setFocused(true));
  await s2.initiator.waitForTimeout(1000);
  const stayedDelivered = await s2.initiator
    .locator(".message-status")
    .evaluate((el) => !el.classList.contains("message-status--read"));
  await s2.initiator.close();
  await s2.joiner.close();

  await browser.close();

  console.log(JSON.stringify({ deliveredIsRead, stayedDelivered, errors1: s1.errors, errors2: s2.errors }, null, 2));

  if (s1.errors.length || s2.errors.length) {
    console.error("Console/page errors detected.");
    process.exit(1);
  }
  if (deliveredIsRead) {
    console.error("Expected the message to land as delivered-only before the joiner is focused.");
    process.exit(1);
  }
  if (!stayedDelivered) {
    console.error("Expected Ghost Mode to keep the tick on delivered, not read.");
    process.exit(1);
  }
  console.log("All checks passed.");
})();
```

- [ ] **Step 4: Run the script and review output**

Run: `node verify.js` (from `$env:TEMP\claude-scratch-chat-polish`, with both dev servers from Step 1 still running)
Expected: `All checks passed.` printed at the end, exit code 0. If a check fails, first determine whether the failure points to a real product bug (fix the relevant earlier task's code) or a script issue — e.g. a selector that doesn't match, or timing that's too tight (this project's prior verification passes have found real script bugs this way, not just product bugs — see `progress.md`'s 2026-07-19/2026-07-20 entries). Fix whichever is actually wrong and re-run.

- [ ] **Step 5: Update `progress.md`**

Add a dated entry under the existing log describing: the themed bubble entrance animations (per-theme keyframes, sheen/glow flourishes, stagger, Apple hover), the delivered/read receipt protocol (`messageId`, `delivered`/`read` envelope types, tab-focus-based read trigger), Ghost Mode, and how it was verified.

- [ ] **Step 6: Commit**

```powershell
git add progress.md
git commit -m "Verify chat polish end to end"
```
