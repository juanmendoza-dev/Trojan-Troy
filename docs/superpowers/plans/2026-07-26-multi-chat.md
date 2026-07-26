# Multi-Chat (Concurrent 1:1 Sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user have up to 5 chats open at once, each fully live (connected, decrypting, running cover traffic) even when backgrounded, switchable via a left-side chat list — replacing today's one-chat-at-a-time app.

**Architecture:** Today's `App.tsx` is one big component holding exactly one of everything (one `RelayClient`, one ratchet session, one message list, one cover-traffic timer) in flat refs/state. React component instances already give us a session map for free: the entire body of today's `App.tsx` becomes `ChatSessionController`, a component mounted once per open chat via `sessions.map(...)`, each instance automatically getting its own independent refs/state/timers. A slimmed-down `App.tsx` becomes the shell: it owns global settings (profile, Ghost Mode, theme), the `sessions` array, and renders a new `ChatList` alongside all open `ChatSessionController`s (inactive ones hidden with CSS `display:none`, which keeps their connections/timers running — not unmounted). No server changes.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (pure-logic unit tests only — this codebase has no jsdom/RTL component-test setup), a scratch Playwright project for live multi-browser verification (not committed to the repo, per existing project convention).

## Global Constraints

- Max 5 concurrent chat sessions (`MAX_CHAT_SESSIONS`), counting sessions in **any** status (connecting/waiting/handshake/safety-number/chat/error) — a chat mid-handshake still holds a connection slot.
- No server changes. Each open chat is its own real WebSocket connection/room, exactly like today's single chat, just N of them.
- Ghost Mode and the active profile / share-profile preference are **global** — one value shared by every open session, not per-chat.
- Chat labels default to `Chat N` (N = a monotonically increasing creation counter, never reused after a chat closes) and are renamable inline; labels are **session-only**, never persisted to storage.
- Closing a chat disconnects and wipes its keys **immediately** — no confirmation dialog.
- A backgrounded chat keeps receiving, decrypting, and running its cover-traffic + presence heartbeat exactly as if it were foregrounded. Only read-ack timing is gated on being the active chat (see Task 2).
- Unread list-row previews are suppressed (dot only) whenever Ghost Mode is on.
- Zero chats open → unchanged full-screen Start/Join hero. ≥1 chat open → the chat-list shell.

Every task's requirements implicitly include the above.

---

## Task 1: Pure logic — chat session bookkeeping (cap + default label)

**Files:**
- Create: `client/src/protocol/chatSessions.ts`
- Test: `client/src/protocol/chatSessions.test.ts`

**Interfaces:**
- Produces: `MAX_CHAT_SESSIONS: number`, `canAddSession(currentCount: number): boolean`, `nextSessionLabel(ordinal: number): string` — used by Task 7 (`App.tsx` shell).

- [ ] **Step 1: Write the failing test**

```ts
// client/src/protocol/chatSessions.test.ts
import { describe, expect, it } from "vitest";
import { canAddSession, MAX_CHAT_SESSIONS, nextSessionLabel } from "./chatSessions";

describe("canAddSession", () => {
  it("allows adding below the cap", () => {
    expect(canAddSession(0)).toBe(true);
    expect(canAddSession(MAX_CHAT_SESSIONS - 1)).toBe(true);
  });

  it("blocks adding at the cap", () => {
    expect(canAddSession(MAX_CHAT_SESSIONS)).toBe(false);
  });

  it("blocks adding above the cap", () => {
    expect(canAddSession(MAX_CHAT_SESSIONS + 1)).toBe(false);
  });
});

describe("nextSessionLabel", () => {
  it("labels by ordinal, not by current open count", () => {
    expect(nextSessionLabel(1)).toBe("Chat 1");
    expect(nextSessionLabel(7)).toBe("Chat 7");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `client/`): `npm test -- chatSessions`
Expected: FAIL — `Cannot find module './chatSessions'`

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/protocol/chatSessions.ts
// Pure chat-session bookkeeping: how many concurrent chats are allowed, and
// what a newly-opened one is called by default. Kept separate from the React
// wiring (App.tsx) so it's unit-testable in isolation, matching
// presenceState.ts / readAckDecision.ts.

export const MAX_CHAT_SESSIONS = 5;

// Whether another chat can be opened given how many currently exist (any
// status counts — a chat mid-handshake still holds a connection slot).
export function canAddSession(currentCount: number): boolean {
  return currentCount < MAX_CHAT_SESSIONS;
}

// Default label for a newly created chat. `ordinal` is a monotonically
// increasing counter the caller owns (incremented on every create, never
// reused after a chat closes) — NOT the current open count, so labels don't
// collide once earlier chats have closed.
export function nextSessionLabel(ordinal: number): string {
  return `Chat ${ordinal}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chatSessions`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/protocol/chatSessions.ts client/src/protocol/chatSessions.test.ts
git commit -m "feat: add chat-session cap and label logic"
```

---

## Task 2: Pure logic — read-ack focus gate

**Why this exists:** Read-ack timing currently keys off `document.hasFocus()` globally. With multiple simultaneously-live chats, a chat must only count as "focused" (eligible to send read acks) when it is both the selected chat **and** the window has focus — otherwise a backgrounded chat would leak read receipts, defeating the whole point of Section 5 of the design spec.

**Files:**
- Create: `client/src/protocol/chatFocus.ts`
- Test: `client/src/protocol/chatFocus.test.ts`

**Interfaces:**
- Produces: `isSessionFocused(input: { isActive: boolean; windowFocused: boolean }): boolean` — consumed by Task 4 (`ChatSessionController`'s read-ack path).

- [ ] **Step 1: Write the failing test**

```ts
// client/src/protocol/chatFocus.test.ts
import { describe, expect, it } from "vitest";
import { isSessionFocused } from "./chatFocus";

describe("isSessionFocused", () => {
  it("is focused when active and the window has focus", () => {
    expect(isSessionFocused({ isActive: true, windowFocused: true })).toBe(true);
  });

  it("is not focused when not the active chat, even if the window has focus", () => {
    expect(isSessionFocused({ isActive: false, windowFocused: true })).toBe(false);
  });

  it("is not focused when the window itself doesn't have focus", () => {
    expect(isSessionFocused({ isActive: true, windowFocused: false })).toBe(false);
  });

  it("is not focused when neither condition holds", () => {
    expect(isSessionFocused({ isActive: false, windowFocused: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chatFocus`
Expected: FAIL — `Cannot find module './chatFocus'`

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/protocol/chatFocus.ts
// Whether this chat session currently counts as "focused" for read-ack
// purposes: only when it is the selected row in the chat list AND the
// browser window itself has focus. A backgrounded chat still receives and
// decrypts messages and keeps its cover traffic running — it just doesn't
// send read acks until the user actually looks at it. See design spec
// Section 5 (docs/superpowers/specs/2026-07-26-multi-chat-design.md).
export function isSessionFocused(input: { isActive: boolean; windowFocused: boolean }): boolean {
  return input.isActive && input.windowFocused;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chatFocus`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/protocol/chatFocus.ts client/src/protocol/chatFocus.test.ts
git commit -m "feat: add per-session read-ack focus gate"
```

---

## Task 3: Pure logic — unread list-row preview text

**Files:**
- Create: `client/src/protocol/unreadPreview.ts`
- Test: `client/src/protocol/unreadPreview.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (from `client/src/screens/ChatScreen.tsx`, already exists — a union with `kind: "text" | "voice" | "decryption-error"`, `text: string` on the text variant).
- Produces: `formatUnreadPreview(message: ChatMessage, ghostMode: boolean): string` — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/protocol/unreadPreview.test.ts
import { describe, expect, it } from "vitest";
import { formatUnreadPreview } from "./unreadPreview";
import type { ChatMessage } from "../screens/ChatScreen";

const textMessage: ChatMessage = { id: "1", timestamp: 0, from: "peer", kind: "text", text: "hey there" };
const voiceMessage: ChatMessage = {
  id: "2",
  timestamp: 0,
  from: "peer",
  kind: "voice",
  audioUrl: "blob:x",
  durationMs: 1200,
};
const errorMessage: ChatMessage = { id: "3", timestamp: 0, kind: "decryption-error" };

describe("formatUnreadPreview", () => {
  it("shows the text for a text message", () => {
    expect(formatUnreadPreview(textMessage, false)).toBe("hey there");
  });

  it("shows a generic label for a voice message", () => {
    expect(formatUnreadPreview(voiceMessage, false)).toBe("Voice message");
  });

  it("shows a dot only, regardless of message kind, when Ghost Mode is on", () => {
    expect(formatUnreadPreview(textMessage, true)).toBe("•");
    expect(formatUnreadPreview(voiceMessage, true)).toBe("•");
  });

  it("falls back to a generic label for a decryption-error message", () => {
    expect(formatUnreadPreview(errorMessage, false)).toBe("Message");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- unreadPreview`
Expected: FAIL — `Cannot find module './unreadPreview'`

- [ ] **Step 3: Write minimal implementation**

```ts
// client/src/protocol/unreadPreview.ts
import type { ChatMessage } from "../screens/ChatScreen";

// Preview text for a chat-list row when this chat has an unseen message.
// Ghost Mode suppresses the content (dot-only in the list) so a glance at the
// chat list can't read what a peer just said — see design spec Section 6,
// "Unread preview vs. Ghost Mode."
export function formatUnreadPreview(message: ChatMessage, ghostMode: boolean): string {
  if (ghostMode) return "•";
  if (message.kind === "text") return message.text;
  if (message.kind === "voice") return "Voice message";
  return "Message";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- unreadPreview`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/protocol/unreadPreview.ts client/src/protocol/unreadPreview.test.ts
git commit -m "feat: add ghost-mode-aware unread preview formatting"
```

---

## Task 4: Extract `ChatSessionController` (one live chat, mountable N times)

**Why this is safe:** Every ref/state in today's `App.tsx` (`sessionCryptoRef`, `clientRef`, `messages`, `coverTimerRef`, etc.) is created via `useRef`/`useState` **inside** the component function. React already gives each mounted instance of a component its own independent copies. Renaming `App` to `ChatSessionController`, parameterizing what used to be module-level singletons (profile, Ghost Mode, which screen to start on) as props, and mounting N instances is enough to get N independent live sessions — no manual session-map data structure needed.

**Two safety rules that must be followed exactly (see rationale below), because getting them wrong reintroduces exactly the bugs multi-chat is supposed to avoid:**
1. **Every prop the long-lived `onMessage` handler reads must go through a ref mirror** (`isActiveRef`, `ghostModeRef`, `shareProfileRef`, `activeProfileRef`) — the handler is registered once per connection attempt and closes over whatever it captures at registration time (this is why `ghostModeRef` already exists in today's code). Reading the `isActive` **prop** directly inside the read-ack path instead of `isActiveRef.current` would silently make backgrounded chats send read receipts — a privacy regression, not just a bug.
2. **`onSummaryChange` is only ever called from a `useEffect`, never during render**, and only depends on the session's own local `screen.name`/`unreadPreview` state (not on the callback prop's identity) — this is both correctness (calling a parent setState during render throws) and performance (5 sessions reporting on every unrelated parent re-render would churn).

**Files:**
- Create: `client/src/session/ChatSessionController.tsx`
- Modify: `client/src/App.tsx` (Task 7 rewrites this fully — no changes here yet)

**Interfaces:**
- Consumes: `isSessionFocused` (Task 2), `formatUnreadPreview` (Task 3), `RelayClient`/`Envelope`/`PROTOCOL_VERSION` (`net/relayClient`), `initSession`/`sealContent`/`sealStatic`/`openMsg`/`SessionCrypto` (`protocol/ratchetSession`), everything else already used by today's `App.tsx`.
- Produces: `ChatSessionController` (a `forwardRef` component), `type InitialAction = { kind: "start" } | { kind: "join"; roomCode: string }`, `type ChatSessionSummary = { status: "connecting" | "waiting" | "handshake" | "safety-number" | "chat" | "error"; unreadPreview: string | null }`, `type ChatSessionHandle = { close: () => void }` — all consumed by Task 7 (`App.tsx` shell).

- [ ] **Step 1: Create the file**

```tsx
// client/src/session/ChatSessionController.tsx
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import sodium from "libsodium-wrappers";
import { RelayClient, type Envelope, PROTOCOL_VERSION } from "../net/relayClient";
import { generateKeypair, deriveSessionKeys, type Keypair, type SessionKeys } from "../crypto/keys";
import { generateKemKeypair, kemEncapsulate, kemDecapsulate } from "../crypto/pqkem";
import { computeSafetyNumber } from "../crypto/safetyNumber";
import { toBase64, fromBase64 } from "../crypto/encoding";
import { measureClipDurationMs } from "../audio/clipDuration";
import { frame, type Frame } from "../crypto/framing";
import {
  initSession,
  sealContent,
  sealStatic,
  openMsg,
  type SessionCrypto,
} from "../protocol/ratchetSession";
import { advanceStatus } from "../protocol/messageStatus";
import { shouldSendReadAck } from "../protocol/readAckDecision";
import {
  shouldSendPresence,
  parsePresenceState,
  PRESENCE_EXPIRY_MS,
  type PresenceState,
  jitteredHeartbeatMs,
} from "../protocol/presenceState";
import {
  nextAction,
  jitteredInterval,
  coverBodyLen,
  COVER_INTERVAL_MS,
  COVER_JITTER_FRAC,
} from "../protocol/coverTraffic";
import { isSessionFocused } from "../protocol/chatFocus";
import { formatUnreadPreview } from "../protocol/unreadPreview";
import { WaitingScreen } from "../screens/WaitingScreen";
import { SafetyNumberScreen } from "../screens/SafetyNumberScreen";
import { ChatScreen, type ChatMessage } from "../screens/ChatScreen";
import { LoadingScreen } from "../screens/loading/LoadingScreen";
import { HandshakeJourney } from "../screens/HandshakeJourney";
import { ErrorScreen } from "../screens/ErrorScreen";
import { scenarioFromServerMessage, type ErrorScenario } from "../screens/errorScenario";
import { detectDevice } from "../profiles/device";
import type { ActiveProfile, PeerProfile } from "../profiles/profileModel";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const EMPTY_BODY = new Uint8Array(0);
const HANDSHAKE_MIN_MS = 2600;

export type InitialAction = { kind: "start" } | { kind: "join"; roomCode: string };

export interface ChatSessionSummary {
  status: "connecting" | "waiting" | "handshake" | "safety-number" | "chat" | "error";
  /** Preview text for the chat-list row when this chat isn't active and has
   *  an unseen message; null when there's nothing unread. */
  unreadPreview: string | null;
}

export interface ChatSessionControllerProps {
  initialAction: InitialAction;
  /** Whether this is the chat currently selected in the list — gates read-ack
   *  timing (design spec Section 5) and clears unreadPreview when true. */
  isActive: boolean;
  activeProfile: ActiveProfile;
  shareProfile: boolean;
  onShareProfileChange: (next: boolean) => void;
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  onSummaryChange: (summary: ChatSessionSummary) => void;
  /** This chat has been torn down (closed, or its own dead-end error screen
   *  dismissed) — the parent should drop it from its session list. */
  onClosed: () => void;
}

export interface ChatSessionHandle {
  /** Imperatively tear down this session, as if its own close button had
   *  been clicked. Used by the chat list's per-row close button, which lives
   *  outside this component's own rendered tree. */
  close: () => void;
}

type SessionScreen =
  | { name: "connecting" }
  | { name: "waiting"; roomCode: string }
  | { name: "handshake"; roomCode: string }
  | { name: "safety-number"; roomCode: string; safetyNumber: string }
  | { name: "chat"; roomCode: string; safetyNumber: string }
  | {
      name: "error";
      scenario: ErrorScenario;
      retry?: { kind: "start" } | { kind: "join"; roomCode: string };
    };

function isSilentContentDrop(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : "";
  return (
    msg.includes("replayed") ||
    msg.includes("stale") ||
    msg.includes("too many skipped") ||
    msg.includes("no receiving chain")
  );
}

function zeroizeSession(sc: SessionCrypto | null) {
  if (!sc) return;
  const r = sc.ratchet;
  sodium.memzero(r.RK);
  if (r.CKs) sodium.memzero(r.CKs);
  if (r.CKr) sodium.memzero(r.CKr);
  sodium.memzero(r.DHs.privateKey);
  for (const mk of r.MKSKIPPED.values()) sodium.memzero(mk);
  r.MKSKIPPED.clear();
  for (const key of Object.values(sc.txSub)) sodium.memzero(key);
  for (const key of Object.values(sc.rxSub)) sodium.memzero(key);
  sodium.memzero(sc.rootKey);
}

async function sendAck(client: RelayClient, sc: SessionCrypto, kind: "delivered" | "read", id: string) {
  client.send(await sealStatic(sc, "ack", frame({ channel: "ack", id, kind, body: EMPTY_BODY })));
}

export const ChatSessionController = forwardRef<ChatSessionHandle, ChatSessionControllerProps>(
  function ChatSessionController(
    {
      initialAction,
      isActive,
      activeProfile,
      shareProfile,
      onShareProfileChange,
      ghostMode,
      onGhostModeChange,
      onSummaryChange,
      onClosed,
    },
    ref
  ) {
    const [screen, setScreen] = useState<SessionScreen>({ name: "connecting" });
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [unreadPreview, setUnreadPreview] = useState<string | null>(null);
    const [peerPresence, setPeerPresence] = useState<PresenceState>("idle");
    const [peerProfile, setPeerProfile] = useState<PeerProfile | null>(null);
    const [ownDevice] = useState(detectDevice);

    const sessionCryptoRef = useRef<SessionCrypto | null>(null);
    const outboxRef = useRef<Uint8Array[]>([]);
    const lastContentSentRef = useRef(0);
    const coverTimerRef = useRef<number | null>(null);
    const clientRef = useRef<RelayClient | null>(null);
    const listenerCleanupsRef = useRef<Array<() => void>>([]);
    const messagesRef = useRef<ChatMessage[]>(messages);
    messagesRef.current = messages;
    const pendingReadIdsRef = useRef<Set<string>>(new Set());
    const presenceExpiryRef = useRef<number | null>(null);
    const presenceSentRef = useRef<{ state: PresenceState; at: number }>({ state: "idle", at: 0 });

    // Ref mirrors of every prop the long-lived onMessage handler reads (it's
    // registered once per connection attempt and closes over whatever it
    // captures then — see Safety Rule 1 above).
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;
    const ghostModeRef = useRef(ghostMode);
    ghostModeRef.current = ghostMode;
    const shareProfileRef = useRef(shareProfile);
    shareProfileRef.current = shareProfile;
    const activeProfileRef = useRef(activeProfile);
    activeProfileRef.current = activeProfile;

    const selfCard: PeerProfile = {
      name: activeProfile.kind === "named" ? activeProfile.profile.name : "Anonymous",
      avatar: activeProfile.kind === "named" ? activeProfile.profile.avatar : null,
      device: ownDevice,
    };

    // Report status + unread-preview up whenever either actually changes.
    // Never called during render (Safety Rule 2) — only from this effect,
    // which depends on this session's own local state, not on the callback
    // prop's identity (deliberately omitted from the deps below).
    useEffect(() => {
      onSummaryChange({ status: screen.name, unreadPreview });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen.name, unreadPreview]);

    // Selecting this chat clears its unread marker.
    useEffect(() => {
      if (isActive) setUnreadPreview(null);
    }, [isActive]);

    useEffect(() => {
      function handleFocusChange() {
        const client = clientRef.current;
        const sc = sessionCryptoRef.current;
        if (client && sc) void maybeSendReadAck(client, sc);
      }
      document.addEventListener("visibilitychange", handleFocusChange);
      window.addEventListener("focus", handleFocusChange);
      return () => {
        document.removeEventListener("visibilitychange", handleFocusChange);
        window.removeEventListener("focus", handleFocusChange);
      };
    }, []);

    useEffect(() => {
      return () => {
        for (const message of messagesRef.current) {
          if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
        }
      };
    }, []);

    useEffect(() => {
      return () => {
        if (presenceExpiryRef.current !== null) clearTimeout(presenceExpiryRef.current);
      };
    }, []);

    // Cover traffic: unconditional on `isActive` — a backgrounded chat keeps
    // emitting at the same jittered baseline as the foregrounded one (design
    // spec Section 5: "stays fully live" means indistinguishable from the
    // outside, not just functionally connected).
    useEffect(() => {
      if (screen.name !== "chat") return;
      let cancelled = false;
      function scheduleCover() {
        if (cancelled) return;
        const interval = jitteredInterval(COVER_INTERVAL_MS, COVER_JITTER_FRAC, Math.random);
        coverTimerRef.current = window.setTimeout(async () => {
          const sc = sessionCryptoRef.current;
          const client = clientRef.current;
          if (sc && client && sc.ratchet.CKs) {
            const action = nextAction({
              now: performance.now(),
              lastContentSentAt: lastContentSentRef.current,
              hasQueuedReal: false,
              interval,
            });
            if (action === "cover") {
              const body = sodium.randombytes_buf(coverBodyLen(Math.random));
              await sendContentFrame(sc, client, frame({ channel: "cover", id: "", body }));
            }
          }
          scheduleCover();
        }, interval);
      }
      scheduleCover();
      return () => {
        cancelled = true;
        if (coverTimerRef.current !== null) {
          clearTimeout(coverTimerRef.current);
          coverTimerRef.current = null;
        }
      };
    }, [screen.name]);

    async function maybeSendReadAck(client: RelayClient, sc: SessionCrypto) {
      if (pendingReadIdsRef.current.size === 0) return;
      const send = shouldSendReadAck({
        isFocused: isSessionFocused({ isActive: isActiveRef.current, windowFocused: document.hasFocus() }),
        isVisible: document.visibilityState === "visible",
        ghostMode: ghostModeRef.current,
        alreadyAcked: false,
      });
      if (!send) return;
      for (const messageId of pendingReadIdsRef.current) {
        await sendAck(client, sc, "read", messageId);
      }
      pendingReadIdsRef.current.clear();
    }

    async function sendPresence(next: PresenceState) {
      const client = clientRef.current;
      const sc = sessionCryptoRef.current;
      if (!client || !sc) return;
      const now = performance.now();
      const last = presenceSentRef.current;
      if (
        !shouldSendPresence({
          nextState: next,
          lastSentState: last.state,
          lastSentAt: last.at,
          now,
          ghostMode: ghostModeRef.current,
          heartbeatMs: jitteredHeartbeatMs(Math.random),
        })
      ) {
        return;
      }
      presenceSentRef.current = { state: next, at: now };
      const body = textEncoder.encode(JSON.stringify({ state: next }));
      client.send(await sealStatic(sc, "presence", frame({ channel: "presence", id: "", body })));
    }

    function showPeerPresence(next: PresenceState) {
      if (presenceExpiryRef.current !== null) {
        clearTimeout(presenceExpiryRef.current);
        presenceExpiryRef.current = null;
      }
      setPeerPresence(next);
      if (next !== "idle") {
        presenceExpiryRef.current = window.setTimeout(() => {
          setPeerPresence("idle");
          presenceExpiryRef.current = null;
        }, PRESENCE_EXPIRY_MS);
      }
    }

    async function exchangeKeys(
      client: RelayClient,
      own: Keypair,
      role: "initiator" | "responder",
      roomCode: string
    ) {
      const handshakeStart = performance.now();
      let disconnected = false;
      const kemKeypair = role === "responder" ? generateKemKeypair() : null;
      let classicalKeys: SessionKeys | null = null;
      let peerPub: Uint8Array | null = null;
      const inbound: Extract<Envelope, { type: "msg" }>[] = [];

      async function finishHandshake(sessionKeys: SessionKeys, peerPublicKey: Uint8Array, pqSecret: Uint8Array) {
        const sc = await initSession(sessionKeys, role, own, peerPublicKey, pqSecret);
        sessionCryptoRef.current = sc;
        if (shareProfileRef.current && activeProfileRef.current.kind === "named") {
          const self = activeProfileRef.current.profile;
          const card = JSON.stringify({ name: self.name, avatar: self.avatar, device: ownDevice });
          client.send(
            await sealStatic(sc, "profile", frame({ channel: "profile", id: "", body: textEncoder.encode(card) }))
          );
        }
        if (role === "initiator") {
          await sendContentFrame(sc, client, frame({ channel: "primer", id: "", body: EMPTY_BODY }));
        }
        const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey, sc.rootKey);
        const elapsed = performance.now() - handshakeStart;
        if (elapsed < HANDSHAKE_MIN_MS) {
          await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_MIN_MS - elapsed));
        }
        if (disconnected) return;
        setScreen({ name: "safety-number", roomCode, safetyNumber });
        const queued = inbound.splice(0);
        for (const env of queued) await handleMsg(env);
      }

      async function handleMsg(envelope: Extract<Envelope, { type: "msg" }>) {
        const sc = sessionCryptoRef.current;
        const client = clientRef.current;
        if (!sc || !client) return;
        let received: Frame;
        try {
          received = await openMsg(sc, envelope);
        } catch (err) {
          if (envelope.c === 0 && !isSilentContentDrop(err)) {
            setMessages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
            ]);
          }
          return;
        }
        if (envelope.c === 0) void flushOutbox();

        switch (received.channel) {
          case "primer":
            break;
          case "cover":
            break;
          case "text": {
            const text = textDecoder.decode(received.body);
            showPeerPresence("idle");
            const incoming: ChatMessage = { id: received.id, timestamp: Date.now(), from: "peer", kind: "text", text };
            setMessages((prev) => [...prev, incoming]);
            if (!isActiveRef.current) setUnreadPreview(formatUnreadPreview(incoming, ghostModeRef.current));
            void sendAck(client, sc, "delivered", received.id);
            pendingReadIdsRef.current.add(received.id);
            void maybeSendReadAck(client, sc);
            break;
          }
          case "voice": {
            const blob = new Blob([new Uint8Array(received.body)], { type: received.mimeType ?? "audio/webm" });
            const audioUrl = URL.createObjectURL(blob);
            const durationMs = await measureClipDurationMs(blob).catch(() => 0);
            showPeerPresence("idle");
            const incoming: ChatMessage = {
              id: received.id,
              timestamp: Date.now(),
              from: "peer",
              kind: "voice",
              audioUrl,
              durationMs,
            };
            setMessages((prev) => [...prev, incoming]);
            if (!isActiveRef.current) setUnreadPreview(formatUnreadPreview(incoming, ghostModeRef.current));
            void sendAck(client, sc, "delivered", received.id);
            pendingReadIdsRef.current.add(received.id);
            void maybeSendReadAck(client, sc);
            break;
          }
          case "presence": {
            try {
              const state = parsePresenceState(JSON.parse(textDecoder.decode(received.body))?.state);
              if (state) showPeerPresence(state);
            } catch {
              // Ignore a malformed presence body.
            }
            break;
          }
          case "ack": {
            if (received.kind) {
              const kind = received.kind;
              setMessages((prev) =>
                prev.map((message) =>
                  message.kind !== "decryption-error" && message.id === received.id
                    ? { ...message, status: advanceStatus(message.status ?? "sent", kind) }
                    : message
                )
              );
            }
            break;
          }
          case "profile": {
            try {
              const card = JSON.parse(textDecoder.decode(received.body));
              if (card && typeof card.name === "string") {
                setPeerProfile({
                  name: card.name,
                  avatar: typeof card.avatar === "string" ? card.avatar : null,
                  device: card.device === "phone" || card.device === "computer" ? card.device : null,
                });
              }
            } catch {
              // Ignore a malformed profile card.
            }
            break;
          }
        }
      }

      listenerCleanupsRef.current.push(
        client.onMessage(async (envelope: Envelope) => {
          if (envelope.type === "peer-disconnected") {
            disconnected = true;
            setScreen({ name: "error", scenario: "friend_left" });
            return;
          }
          if (envelope.type === "pubkey") {
            if (sessionCryptoRef.current || peerPub) {
              setScreen({ name: "error", scenario: "handshake_failed" });
              return;
            }
            if (envelope.v !== PROTOCOL_VERSION) {
              setScreen({ name: "error", scenario: "handshake_failed" });
              return;
            }
            try {
              peerPub = await fromBase64(envelope.payload);
              classicalKeys = await deriveSessionKeys(own, peerPub, role);
              if (role === "initiator") {
                if (!envelope.kem) {
                  setScreen({ name: "error", scenario: "handshake_failed" });
                  return;
                }
                const { cipherText, sharedSecret } = kemEncapsulate(await fromBase64(envelope.kem));
                client.send({ type: "kemct", payload: await toBase64(cipherText) });
                await finishHandshake(classicalKeys, peerPub, sharedSecret);
              }
            } catch {
              setScreen({ name: "error", scenario: "handshake_failed" });
            }
            return;
          }
          if (envelope.type === "kemct") {
            if (role !== "responder" || !classicalKeys || !peerPub || !kemKeypair || sessionCryptoRef.current) {
              setScreen({ name: "error", scenario: "handshake_failed" });
              return;
            }
            try {
              const sharedSecret = kemDecapsulate(await fromBase64(envelope.payload), kemKeypair.secretKey);
              await finishHandshake(classicalKeys, peerPub, sharedSecret);
            } catch {
              setScreen({ name: "error", scenario: "handshake_failed" });
            }
            return;
          }
          if (envelope.type === "msg") {
            if (!sessionCryptoRef.current) {
              inbound.push(envelope);
              return;
            }
            await handleMsg(envelope);
            return;
          }
        })
      );

      const payload = await toBase64(own.publicKey);
      if (kemKeypair) {
        client.send({ type: "pubkey", payload, v: PROTOCOL_VERSION, kem: await toBase64(kemKeypair.publicKey) });
      } else {
        client.send({ type: "pubkey", payload, v: PROTOCOL_VERSION });
      }
    }

    async function sendContentFrame(sc: SessionCrypto, client: RelayClient, frameBytes: Uint8Array) {
      lastContentSentRef.current = performance.now();
      client.send(await sealContent(sc, frameBytes));
    }

    async function sendContent(frameBytes: Uint8Array) {
      const sc = sessionCryptoRef.current;
      const client = clientRef.current;
      if (!sc || !client) return;
      if (!sc.ratchet.CKs) {
        outboxRef.current.push(frameBytes);
        return;
      }
      await sendContentFrame(sc, client, frameBytes);
    }

    async function flushOutbox() {
      const sc = sessionCryptoRef.current;
      const client = clientRef.current;
      if (!sc || !client || !sc.ratchet.CKs || outboxRef.current.length === 0) return;
      const pending = outboxRef.current;
      outboxRef.current = [];
      for (const frameBytes of pending) {
        await sendContentFrame(sc, client, frameBytes);
      }
    }

    async function handleSend(text: string) {
      const sc = sessionCryptoRef.current;
      const client = clientRef.current;
      if (!sc || !client) return;
      const id = crypto.randomUUID();
      await sendContent(frame({ channel: "text", id, body: textEncoder.encode(text) }));
      setMessages((prev) => [...prev, { id, timestamp: Date.now(), from: "me", kind: "text", text, status: "sent" }]);
    }

    async function handleSendVoice(blob: Blob, mimeType: string) {
      const sc = sessionCryptoRef.current;
      const client = clientRef.current;
      if (!sc || !client) return;
      const id = crypto.randomUUID();
      const body = new Uint8Array(await blob.arrayBuffer());
      await sendContent(frame({ channel: "voice", id, mimeType, body }));
      const audioUrl = URL.createObjectURL(blob);
      const durationMs = await measureClipDurationMs(blob).catch(() => 0);
      setMessages((prev) => [
        ...prev,
        { id, timestamp: Date.now(), from: "me", kind: "voice", audioUrl, durationMs, status: "sent" },
      ]);
    }

    // Disconnects and wipes this session's own crypto/timers/refs, but does
    // NOT tell the parent to drop the row — used by closeSession() and by
    // retryConnect() (which immediately reconnects afterward).
    function disposeConnection() {
      for (const dispose of listenerCleanupsRef.current) dispose();
      listenerCleanupsRef.current = [];
      clientRef.current?.close();
      clientRef.current = null;
      zeroizeSession(sessionCryptoRef.current);
      sessionCryptoRef.current = null;
      outboxRef.current = [];
      pendingReadIdsRef.current.clear();
      if (presenceExpiryRef.current !== null) {
        clearTimeout(presenceExpiryRef.current);
        presenceExpiryRef.current = null;
      }
      if (coverTimerRef.current !== null) {
        clearTimeout(coverTimerRef.current);
        coverTimerRef.current = null;
      }
      presenceSentRef.current = { state: "idle", at: 0 };
      setPeerPresence("idle");
      setPeerProfile(null);
      for (const message of messagesRef.current) {
        if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
      }
      setMessages([]);
    }

    function closeSession() {
      disposeConnection();
      onClosed();
    }

    async function startConnection() {
      const own = await generateKeypair();
      const client = new RelayClient(RELAY_URL);
      clientRef.current = client;
      try {
        await client.waitForOpen();
      } catch {
        client.close();
        clientRef.current = null;
        setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "start" } });
        return;
      }
      let currentRoomCode = "";
      listenerCleanupsRef.current.push(
        client.onMessage((envelope) => {
          if (envelope.type === "created") {
            currentRoomCode = envelope.roomCode;
            setScreen({ name: "waiting", roomCode: envelope.roomCode });
          }
          if (envelope.type === "peer-connected") {
            setScreen({ name: "handshake", roomCode: currentRoomCode });
            void exchangeKeys(client, own, "initiator", currentRoomCode);
          }
          if (envelope.type === "error") {
            setScreen({
              name: "error",
              scenario: scenarioFromServerMessage(envelope.message),
              retry: { kind: "start" },
            });
          }
        })
      );
      client.send({ type: "create" });
    }

    async function joinConnection(roomCode: string) {
      const own = await generateKeypair();
      const client = new RelayClient(RELAY_URL);
      clientRef.current = client;
      try {
        await client.waitForOpen();
      } catch {
        client.close();
        clientRef.current = null;
        setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "join", roomCode } });
        return;
      }
      listenerCleanupsRef.current.push(
        client.onMessage((envelope) => {
          if (envelope.type === "error") {
            setScreen({
              name: "error",
              scenario: scenarioFromServerMessage(envelope.message),
              retry: { kind: "join", roomCode },
            });
          }
          if (envelope.type === "peer-connected") {
            setScreen({ name: "handshake", roomCode });
            void exchangeKeys(client, own, "responder", roomCode);
          }
        })
      );
      client.send({ type: "join", roomCode });
    }

    function connect() {
      if (initialAction.kind === "start") void startConnection();
      else void joinConnection(initialAction.roomCode);
    }

    function retryConnect() {
      disposeConnection();
      setScreen({ name: "connecting" });
      connect();
    }

    useImperativeHandle(ref, () => ({ close: closeSession }));

    // Kick off the connection attempt exactly once, on mount, using whatever
    // this session was created with. There is no "start screen" here — the
    // App shell already decided (create vs. join, and with what room code)
    // before this component ever mounted (design spec Section 3).
    useEffect(() => {
      connect();
      return () => disposeConnection();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (screen.name === "connecting") {
      return (
        <HandshakeJourney activeKey="connecting">
          <LoadingScreen roomCode={initialAction.kind === "join" ? initialAction.roomCode : ""} />
        </HandshakeJourney>
      );
    }
    if (screen.name === "waiting") {
      return <WaitingScreen roomCode={screen.roomCode} onCancel={closeSession} />;
    }
    if (screen.name === "handshake" || screen.name === "safety-number" || screen.name === "chat") {
      let content;
      if (screen.name === "handshake") {
        content = <LoadingScreen roomCode={screen.roomCode} />;
      } else if (screen.name === "safety-number") {
        content = (
          <SafetyNumberScreen
            roomCode={screen.roomCode}
            safetyNumber={screen.safetyNumber}
            onVerified={() =>
              setScreen({ name: "chat", roomCode: screen.roomCode, safetyNumber: screen.safetyNumber })
            }
            onMismatch={() => {
              disposeConnection();
              setScreen({ name: "error", scenario: "handshake_failed" });
            }}
          />
        );
      } else {
        content = (
          <ChatScreen
            roomCode={screen.roomCode}
            safetyNumber={screen.safetyNumber}
            messages={messages}
            selfCard={selfCard}
            peerProfile={peerProfile}
            ghostMode={ghostMode}
            onGhostModeChange={onGhostModeChange}
            shareProfile={shareProfile}
            onShareProfileChange={onShareProfileChange}
            peerPresence={peerPresence}
            onPresence={sendPresence}
            onSend={handleSend}
            onSendVoice={handleSendVoice}
            onLeave={closeSession}
          />
        );
      }
      return <HandshakeJourney activeKey={screen.name}>{content}</HandshakeJourney>;
    }
    const retry = screen.retry;
    return <ErrorScreen scenario={screen.scenario} onNewChat={closeSession} onRetry={retry ? retryConnect : undefined} />;
  }
);
```

- [ ] **Step 2: Typecheck**

Run (from `client/`): `npm run typecheck`
Expected: no errors referencing `ChatSessionController.tsx`. (`App.tsx` will still error until Task 7 — ignore those for now.)

- [ ] **Step 3: Commit**

```bash
git add client/src/session/ChatSessionController.tsx
git commit -m "feat: extract ChatSessionController from App.tsx for multi-instance use"
```

---

## Task 5: Relocate the data monitor out of the old Sidebar; add header-bar toggles

**Why:** The chat list (Task 6) takes over the left column the old `Sidebar` occupied. `Sidebar`'s "New chat" button and room-code "active card" are superseded by the chat list and by `TitleBar` (which already shows room code + verified badge per chat, since it's rendered inside `ChatScreen`). Only the data-monitor visualizer and the room-code eye-toggle need a new home: both move into `TitleBar` (an entry-point button that reveals a `MonitorPanel`, and an eye-icon next to the room code) per design spec Section 2.

**Files:**
- Create: `client/src/components/MonitorPanel.tsx`, `client/src/components/MonitorPanel.css`
- Modify: `client/src/components/TitleBar.tsx`
- Modify: `client/src/screens/ChatScreen.tsx`
- Delete: `client/src/components/Sidebar.tsx`, `client/src/components/Sidebar.css`

**Interfaces:**
- Produces: `MonitorPanel({ sentMessages: string[] })` — a component ChatScreen mounts conditionally.
- Modifies: `TitleBarProps` gains `roomHidden: boolean` (was optional, now always passed), `onToggleRoomHidden: () => void`, `monitorOpen: boolean`, `onToggleMonitor: () => void`.

- [ ] **Step 1: Create `MonitorPanel.tsx`, porting the monitor logic out of `Sidebar.tsx`**

```tsx
// client/src/components/MonitorPanel.tsx
import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { DataMonitor, EyeToggle } from "./DataMonitor";
import "./MonitorPanel.css";

const MONITOR_KEY = "trojan-troy-monitor-visible";

interface MonitorPanelProps {
  /** Text the user has sent in this chat — feeds the live "data" visualizer. */
  sentMessages: string[];
}

// The data-monitor visualizer, entered from a toggle in the chat header
// (TitleBar). Extracted from the old per-chat Sidebar, which the chat list
// replaced — see design spec Section 2. The on/off preference for the
// visualizer rows themselves is a global UI setting (same localStorage key as
// before); the DataMonitor content is per-chat, fed this chat's own sent
// messages.
export function MonitorPanel({ sentMessages }: MonitorPanelProps) {
  const { theme } = useTheme();
  const sectionLabel = theme === "apple" ? (label: string) => label : (label: string) => label.toUpperCase();

  const [monitorOn, setMonitorOn] = useState(() => localStorage.getItem(MONITOR_KEY) !== "false");
  const [rendered, setRendered] = useState(monitorOn);
  useEffect(() => {
    if (monitorOn) {
      setRendered(true);
      return;
    }
    const t = window.setTimeout(() => setRendered(false), 550);
    return () => window.clearTimeout(t);
  }, [monitorOn]);
  const toggleMonitor = () =>
    setMonitorOn((v) => {
      const next = !v;
      localStorage.setItem(MONITOR_KEY, String(next));
      return next;
    });

  return (
    <div className="monitor-panel">
      <div className="monitor-panel__head">
        <div className="monitor-panel__label">
          {sectionLabel("vizualize ur ")}
          <span className="monitor-panel__data-blur">{sectionLabel("data")}</span>
        </div>
        <EyeToggle on={monitorOn} onToggle={toggleMonitor} />
      </div>
      {rendered && (
        <div className={`monitor-panel__wrap${monitorOn ? "" : " is-poofing"}`}>
          <DataMonitor messages={sentMessages} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `MonitorPanel.css`**

Start from `Sidebar.css`'s monitor-related rules (`.sidebar__monitor-head`, `.sidebar__label`, `.sidebar__data-blur`, the `dataBlur` keyframes) renamed to `.monitor-panel__*`. `Sidebar.css` does **not** define `.data-monitor-wrap`/`.data-monitor-wrap__ring` (referenced in the old JSX) — check `DataMonitor.css` for those rules and port/adapt whatever they contain into `.monitor-panel__wrap`. Layout changes from a fixed 256px-wide vertical column to a horizontal strip: use `flex-wrap: wrap` (or a horizontal-scroll row) for the five visualizer rows instead of a tall flex column, sized to sit comfortably between `TitleBar` and the message list. Exact spacing/sizing is a visual-polish call — verify with the Playwright screenshot in Step 5 and adjust.

- [ ] **Step 3: Add the two new toggles to `TitleBar.tsx`**

Modify `client/src/components/TitleBar.tsx`: change `roomHidden?: boolean` to required `roomHidden: boolean`, add `onToggleRoomHidden: () => void`, `monitorOpen: boolean`, `onToggleMonitor: () => void` to `TitleBarProps`. Add an eye-icon button next to `.title-bar__room` (reusing the `eye`/`eye-off` icons the old `Sidebar`'s room-eye button used) wired to `onToggleRoomHidden`, and a second icon button next to the existing settings button wired to `onToggleMonitor` (check `client/src/components/Icon.tsx` for an appropriate existing icon name — e.g. an activity/chart glyph; fall back to reusing `eye` if nothing fits better, or add one following that file's existing per-name SVG pattern).

- [ ] **Step 4: Update `ChatScreen.tsx`**

Remove the `Sidebar` import and its usage. Add `import { MonitorPanel } from "../components/MonitorPanel";`. Add `const [monitorOpen, setMonitorOpen] = useState(false);`. Pass `roomHidden`, `onToggleRoomHidden={() => setRoomHidden((v) => !v)}`, `monitorOpen`, `onToggleMonitor={() => setMonitorOpen((v) => !v)}` to `<TitleBar>`. Render `{monitorOpen && <MonitorPanel sentMessages={sentTexts} />}` directly below `<TitleBar>` and above `.chat-screen__body`. The `.chat-screen__body` flex row now has only one child (`.chat-screen__main`) — leave its CSS as-is, it degrades gracefully with a single flex item.

- [ ] **Step 5: Delete the old Sidebar and verify visually**

```bash
git rm client/src/components/Sidebar.tsx client/src/components/Sidebar.css
```

Run `npm run typecheck` — fix any remaining references (there should be none outside `ChatScreen.tsx`, already updated). Start the dev server (`npm run dev` in `client/`) with the existing `?screen=chat` dev override (see `client/src/dev/screenOverride.ts` for the exact query param) and confirm: the left sidebar is gone, `TitleBar` shows a working eye-toggle (masks/unmasks the room code) and a working monitor toggle (reveals/hides the `MonitorPanel` strip with live visualizers, fed by dev-override sample data).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/MonitorPanel.tsx client/src/components/MonitorPanel.css client/src/components/TitleBar.tsx client/src/screens/ChatScreen.tsx
git commit -m "refactor: move data monitor and room-code toggle into TitleBar, retire Sidebar"
```

---

## Task 6: `ChatList` component (the new left column)

**Files:**
- Create: `client/src/components/ChatList.tsx`, `client/src/components/ChatList.css`

**Interfaces:**
- Produces: `ChatList` component and `type ChatListRow = { id: string; label: string; status: "connecting" | "waiting" | "handshake" | "safety-number" | "chat" | "error"; unreadPreview: string | null }` — consumed by Task 7.

- [ ] **Step 1: Create `ChatList.tsx`**

```tsx
// client/src/components/ChatList.tsx
import { useState } from "react";
import { Icon } from "./Icon";
import "./ChatList.css";

export interface ChatListRow {
  id: string;
  label: string;
  status: "connecting" | "waiting" | "handshake" | "safety-number" | "chat" | "error";
  unreadPreview: string | null;
}

interface ChatListProps {
  rows: ChatListRow[];
  activeId: string | null;
  canAddNew: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onNewChat: () => void;
}

const STATUS_LABEL: Record<ChatListRow["status"], string> = {
  connecting: "Connecting…",
  waiting: "Waiting for peer…",
  handshake: "Sealing the line…",
  "safety-number": "Verify to continue",
  chat: "Live",
  error: "Disconnected",
};

export function ChatList({ rows, activeId, canAddNew, onSelect, onClose, onRename, onNewChat }: ChatListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  function startEditing(row: ChatListRow) {
    setEditingId(row.id);
    setDraftLabel(row.label);
  }
  function commitEditing() {
    if (editingId && draftLabel.trim()) onRename(editingId, draftLabel.trim());
    setEditingId(null);
  }

  return (
    <div className="chat-list">
      <button type="button" className="chat-list__new" onClick={onNewChat} disabled={!canAddNew}>
        <Icon name="plus" size={16} strokeWidth={2.25} />
        New chat
      </button>
      <div className="chat-list__rows">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`chat-list__row${row.id === activeId ? " chat-list__row--active" : ""}`}
            onClick={() => onSelect(row.id)}
          >
            <div className="chat-list__row-top">
              {editingId === row.id ? (
                <input
                  className="chat-list__label-input"
                  value={draftLabel}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  onBlur={commitEditing}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitEditing();
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="chat-list__label">{row.label}</span>
              )}
              <button
                type="button"
                className="chat-list__icon-button"
                aria-label={`Rename ${row.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  startEditing(row);
                }}
              >
                <Icon name="pencil" size={12} />
              </button>
              <button
                type="button"
                className="chat-list__icon-button"
                aria-label={`Close ${row.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(row.id);
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            <div className="chat-list__row-bottom">
              <span className={`chat-list__status chat-list__status--${row.status}`}>{STATUS_LABEL[row.status]}</span>
              {row.unreadPreview && row.id !== activeId && (
                <span className="chat-list__unread">
                  <span className="chat-list__unread-dot" aria-hidden="true" />
                  {row.unreadPreview}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the `pencil` icon exists**

Check `client/src/components/Icon.tsx` for a `"pencil"` entry in its icon-name set. If it's missing, add one following that file's existing per-name SVG pattern (a simple pencil/edit glyph, matching the stroke-width/viewBox conventions of neighboring icons like `"x"`/`"plus"`).

- [ ] **Step 3: Write `ChatList.css`**

```css
/* client/src/components/ChatList.css */
.chat-list {
  width: 256px;
  flex: none;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  gap: 8px;
  overflow-y: auto;
}
.chat-list__new {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--accent);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-pill);
  padding: 11px;
  font-family: var(--font-ui);
  font-size: 14px;
  cursor: pointer;
}
.chat-list__new:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.chat-list__rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  overflow-y: auto;
}
.chat-list__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 10px 12px;
  cursor: pointer;
}
.chat-list__row--active {
  border-color: var(--accent);
}
.chat-list__row-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chat-list__label {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-list__label-input {
  flex: 1;
  font-size: 13px;
  font-family: var(--font-ui);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 6px;
  color: var(--text-primary);
}
.chat-list__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 6px;
  cursor: pointer;
}
.chat-list__icon-button:hover {
  color: var(--text-primary);
}
.chat-list__row-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}
.chat-list__status--error {
  color: #e2685c;
}
.chat-list__status--chat {
  color: var(--accent);
}
.chat-list__unread {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 600;
}
.chat-list__unread-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--accent);
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors from `ChatList.tsx` (it isn't wired into the app yet — that's Task 7).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatList.tsx client/src/components/ChatList.css
git commit -m "feat: add ChatList component for the multi-chat side list"
```

---

## Task 7: Rebuild `App.tsx` as the multi-session shell + `NewChatModal`

**Files:**
- Create: `client/src/components/NewChatModal.tsx`, `client/src/components/NewChatModal.css`
- Modify: `client/src/App.tsx` (full rewrite)

**Interfaces:**
- Consumes: `ChatSessionController`, `InitialAction`, `ChatSessionSummary`, `ChatSessionHandle` (Task 4); `canAddSession`, `nextSessionLabel` (Task 1); `ChatList`, `ChatListRow` (Task 6).

- [ ] **Step 1: Create `NewChatModal.tsx`**

```tsx
// client/src/components/NewChatModal.tsx
import { StartJoinScreen } from "../screens/StartJoinScreen";
import type { ActiveProfile } from "../profiles/profileModel";
import "./NewChatModal.css";

interface NewChatModalProps {
  onStart: () => void;
  onJoin: (code: string) => void;
  activeProfile: ActiveProfile;
  onOpenProfiles: () => void;
  onClose: () => void;
}

// Wraps the existing Start/Join screen as a modal for opening an additional
// chat while others stay open underneath (design spec Section 3). Reuses
// StartJoinScreen unchanged; onStart/onJoin close this modal and hand off to
// a new chat-list row immediately, before the connection even resolves — so
// there's nothing left for this modal to show progress for.
export function NewChatModal({ onStart, onJoin, activeProfile, onOpenProfiles, onClose }: NewChatModalProps) {
  return (
    <div className="new-chat-modal__backdrop" onClick={onClose}>
      <div className="new-chat-modal__panel" onClick={(event) => event.stopPropagation()}>
        <StartJoinScreen
          onStart={onStart}
          onJoin={onJoin}
          connectStatus="idle"
          activeProfile={activeProfile}
          onOpenProfiles={onOpenProfiles}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `NewChatModal.css`**

```css
/* client/src/components/NewChatModal.css */
.new-chat-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 20, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.new-chat-modal__panel {
  position: relative;
  width: min(480px, 92vw);
  height: min(720px, 88vh);
  overflow: hidden;
  border-radius: var(--radius-card, 16px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
}
```

`StartJoinScreen` (and its `AmbientOrbs`) render inside `.new-chat-modal__panel`; because that ancestor has `position: relative` + `overflow: hidden`, any `position: fixed`/`100vw`/`100vh` rule inside `StartJoinScreen.css` will size against the *browser viewport*, not the panel — confirm this in Step 5's visual check and, if it looks wrong (orbs escaping the panel, content overflowing), apply the same fix as Task 8: change those rules from `fixed`/`vw`/`vh` to `absolute`/`inset: 0`/`100%` so they size against `.new-chat-modal__panel` instead.

- [ ] **Step 3: Rewrite `App.tsx`**

```tsx
// client/src/App.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { parseInviteCode } from "./net/inviteLink";
import {
  ChatSessionController,
  type ChatSessionHandle,
  type ChatSessionSummary,
  type InitialAction,
} from "./session/ChatSessionController";
import { canAddSession, nextSessionLabel } from "./protocol/chatSessions";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { WaitingScreen } from "./screens/WaitingScreen";
import { SafetyNumberScreen } from "./screens/SafetyNumberScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { LoadingScreen } from "./screens/loading/LoadingScreen";
import { HandshakeJourney } from "./screens/HandshakeJourney";
import { ErrorScreen } from "./screens/ErrorScreen";
import { ChatList, type ChatListRow } from "./components/ChatList";
import { NewChatModal } from "./components/NewChatModal";
import { ProfileModal } from "./components/ProfileModal";
import { resolveActiveProfile, ANONYMOUS_ID, type Profile } from "./profiles/profileModel";
import {
  listProfiles,
  putProfile,
  deleteProfile,
  getActiveProfileId,
  getShareProfile,
  setActiveProfileId as persistActiveProfileId,
  setShareProfile as persistShareProfile,
} from "./profiles/profileStore";
import { useTheme } from "./theme/ThemeContext";
import { parseScreenOverride } from "./dev/screenOverride";
import "./AppShell.css";

const GHOST_MODE_STORAGE_KEY = "trojan-troy-ghost-mode";

interface SessionEntry {
  id: string;
  initialAction: InitialAction;
  label: string;
}

export default function App() {
  const devOverride = import.meta.env.DEV ? parseScreenOverride(window.location.search) : null;
  const { setTheme } = useTheme();
  useEffect(() => {
    if (devOverride?.theme) setTheme(devOverride.theme);
  }, []);

  const [initialJoinCode] = useState<string | null>(() => parseInviteCode(window.location.hash));
  useEffect(() => {
    if (initialJoinCode && window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>(() => getActiveProfileId());
  const [profilesOpen, setProfilesOpen] = useState(false);
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);
  useEffect(() => {
    void listProfiles().then(setProfiles);
  }, []);
  function selectProfile(id: string) {
    persistActiveProfileId(id);
    setActiveProfileId(id);
  }
  async function handleCreateProfile(profile: Profile) {
    await putProfile(profile);
    setProfiles(await listProfiles());
    selectProfile(profile.id);
  }
  async function handleDeleteProfile(id: string) {
    await deleteProfile(id);
    setProfiles(await listProfiles());
    if (activeProfileId === id) selectProfile(ANONYMOUS_ID);
  }

  const [shareProfile, setShareProfile] = useState<boolean>(() => getShareProfile());
  function updateShareProfile(next: boolean) {
    persistShareProfile(next);
    setShareProfile(next);
  }
  const [ghostMode, setGhostMode] = useState<boolean>(
    () => localStorage.getItem(GHOST_MODE_STORAGE_KEY) === "true"
  );
  function updateGhostMode(next: boolean) {
    localStorage.setItem(GHOST_MODE_STORAGE_KEY, String(next));
    setGhostMode(next);
  }

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, ChatSessionSummary>>({});
  const [newChatOpen, setNewChatOpen] = useState(false);
  const nextOrdinalRef = useRef(1);
  const handlesRef = useRef<Map<string, ChatSessionHandle>>(new Map());

  function addSession(initialAction: InitialAction) {
    if (!canAddSession(sessions.length)) return;
    const id = crypto.randomUUID();
    const label = nextSessionLabel(nextOrdinalRef.current++);
    setSessions((prev) => [...prev, { id, initialAction, label }]);
    setActiveId(id);
    setNewChatOpen(false);
  }

  const handleSummaryChange = useCallback((id: string, summary: ChatSessionSummary) => {
    setSummaries((prev) => {
      const existing = prev[id];
      if (existing && existing.status === summary.status && existing.unreadPreview === summary.unreadPreview) {
        return prev;
      }
      return { ...prev, [id]: summary };
    });
  }, []);

  const handleSessionClosed = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setSummaries((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    handlesRef.current.delete(id);
  }, []);

  // If the active chat just closed, fall back to whichever chat remains.
  useEffect(() => {
    if (activeId && !sessions.some((s) => s.id === activeId)) {
      setActiveId(sessions.length > 0 ? sessions[sessions.length - 1].id : null);
    }
  }, [sessions, activeId]);

  const handleCloseRow = useCallback((id: string) => {
    handlesRef.current.get(id)?.close();
  }, []);

  const handleRename = useCallback((id: string, label: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  }, []);

  if (devOverride?.screen === "loading") {
    return (
      <HandshakeJourney activeKey="handshake">
        <LoadingScreen roomCode="K7F-2QX" />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "chat") {
    return (
      <HandshakeJourney activeKey="chat">
        <ChatScreen
          roomCode="K7F-2QX"
          safetyNumber="21934 07741 66012"
          messages={[
            { id: "1", timestamp: Date.now() - 3000, from: "peer", kind: "text", text: "did you check the safety number?" },
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
          ghostMode={ghostMode}
          onGhostModeChange={() => {}}
          shareProfile={false}
          onShareProfileChange={() => {}}
          selfCard={{ name: "You", avatar: null, device: "computer" }}
          peerProfile={{ name: "Jay", avatar: null, device: "phone" }}
          peerPresence="typing"
          onPresence={() => {}}
          onSend={() => {}}
          onSendVoice={() => {}}
          onLeave={() => {}}
        />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "waiting") {
    return <WaitingScreen roomCode="K7F-2QX" onCancel={() => {}} />;
  }
  if (devOverride?.screen === "safety") {
    return (
      <HandshakeJourney activeKey="safety-number">
        <SafetyNumberScreen
          roomCode="K7F-2QX"
          safetyNumber="21934 07741 66012 88304 55120 09937 41028 77650 30291 66104 82255 19073"
          onVerified={() => {}}
          onMismatch={() => {}}
        />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "connecting") {
    return (
      <StartJoinScreen
        onStart={() => {}}
        onJoin={() => {}}
        connectStatus="connecting"
        activeProfile={{ kind: "anonymous" }}
        onOpenProfiles={() => {}}
      />
    );
  }
  if (devOverride?.screen === "profiles") {
    const sample: Profile[] = [
      { id: "s1", name: "Jay", avatar: null, pinSalt: "", pinHash: "", createdAt: 0 },
      { id: "s2", name: "Work", avatar: null, pinSalt: "", pinHash: "", createdAt: 0 },
    ];
    return (
      <>
        <StartJoinScreen
          onStart={() => {}}
          onJoin={() => {}}
          connectStatus="idle"
          activeProfile={{ kind: "anonymous" }}
          onOpenProfiles={() => {}}
        />
        <ProfileModal
          profiles={sample}
          activeId={ANONYMOUS_ID}
          onSelectAnonymous={() => {}}
          onSelectNamed={() => {}}
          onCreate={() => {}}
          onDelete={() => {}}
          onClose={() => {}}
        />
      </>
    );
  }
  if (devOverride?.screen === "error") {
    const scenario = devOverride.scenario ?? "friend_left";
    const retryable = scenario === "server_unreachable" || scenario === "bad_code" || scenario === "room_full";
    return <ErrorScreen scenario={scenario} onNewChat={() => {}} onRetry={retryable ? () => {} : undefined} />;
  }

  if (sessions.length === 0) {
    return (
      <>
        <StartJoinScreen
          onStart={() => addSession({ kind: "start" })}
          onJoin={(code) => addSession({ kind: "join", roomCode: code })}
          connectStatus="idle"
          initialCode={initialJoinCode ?? undefined}
          activeProfile={activeProfile}
          onOpenProfiles={() => setProfilesOpen(true)}
        />
        {profilesOpen && (
          <ProfileModal
            profiles={profiles}
            activeId={activeProfileId}
            onSelectAnonymous={() => selectProfile(ANONYMOUS_ID)}
            onSelectNamed={(profile) => selectProfile(profile.id)}
            onCreate={handleCreateProfile}
            onDelete={handleDeleteProfile}
            onClose={() => setProfilesOpen(false)}
          />
        )}
      </>
    );
  }

  const rows: ChatListRow[] = sessions.map((s) => ({
    id: s.id,
    label: s.label,
    status: summaries[s.id]?.status ?? "connecting",
    unreadPreview: summaries[s.id]?.unreadPreview ?? null,
  }));

  return (
    <div className="app-shell">
      <ChatList
        rows={rows}
        activeId={activeId}
        canAddNew={canAddSession(sessions.length)}
        onSelect={setActiveId}
        onClose={handleCloseRow}
        onRename={handleRename}
        onNewChat={() => setNewChatOpen(true)}
      />
      <div className="app-shell__content">
        {sessions.map((s) => (
          <div key={s.id} style={{ display: s.id === activeId ? "contents" : "none" }}>
            <ChatSessionController
              ref={(handle) => {
                if (handle) handlesRef.current.set(s.id, handle);
                else handlesRef.current.delete(s.id);
              }}
              initialAction={s.initialAction}
              isActive={s.id === activeId}
              activeProfile={activeProfile}
              shareProfile={shareProfile}
              onShareProfileChange={updateShareProfile}
              ghostMode={ghostMode}
              onGhostModeChange={updateGhostMode}
              onSummaryChange={(summary) => handleSummaryChange(s.id, summary)}
              onClosed={() => handleSessionClosed(s.id)}
            />
          </div>
        ))}
      </div>
      {newChatOpen && (
        <NewChatModal
          onStart={() => addSession({ kind: "start" })}
          onJoin={(code) => addSession({ kind: "join", roomCode: code })}
          activeProfile={activeProfile}
          onOpenProfiles={() => setProfilesOpen(true)}
          onClose={() => setNewChatOpen(false)}
        />
      )}
      {profilesOpen && (
        <ProfileModal
          profiles={profiles}
          activeId={activeProfileId}
          onSelectAnonymous={() => selectProfile(ANONYMOUS_ID)}
          onSelectNamed={(profile) => selectProfile(profile.id)}
          onCreate={handleCreateProfile}
          onDelete={handleDeleteProfile}
          onClose={() => setProfilesOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `AppShell.css`**

```css
/* client/src/AppShell.css */
.app-shell {
  width: 100%;
  height: 100%;
  display: flex;
}
.app-shell__content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
}
```

- [ ] **Step 5: Typecheck and run the full existing suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; all existing tests still pass (this task doesn't touch any pure-logic module their tests cover).

- [ ] **Step 6: Manual smoke test — single chat still works end to end**

Start the relay (`server/`: `npm run dev`) and the client (`client/`: `npm run dev`) locally. Open the app, click "Start a chat", open the invite link in a second browser/profile, verify the handshake → safety-number → chat flow completes and a message round-trips — i.e. today's single-chat experience still works, just now inside the chat-list shell with one row.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.tsx client/src/AppShell.css client/src/components/NewChatModal.tsx client/src/components/NewChatModal.css
git commit -m "feat: rebuild App.tsx as a multi-session shell around ChatSessionController"
```

---

## Task 8: Constrain full-viewport screens to the content pane

**Why:** `HandshakeJourney.css`, `WaitingScreen.css`, `ErrorScreen.css`, and `StartJoinScreen.css` all use `position: fixed` and/or `100vw`/`100vh`, because until now they always filled the entire browser window. They now render inside `.app-shell__content` (next to the always-visible `ChatList`) or inside `.new-chat-modal__panel` — both of which are smaller than the full viewport. This is real visual-adaptation work, not a mechanical find-and-replace; budget a verify-and-adjust pass rather than expecting it to be right on the first try.

**Method:**
1. In each of the four CSS files, find every rule using `position: fixed`, `100vw`, or `100vh` on what is (or is inside) that screen's outermost element.
2. Change `position: fixed` → `position: absolute` and change the corresponding `top/left/width/height: 0/100vw/100vh` → `inset: 0` (or `width: 100%; height: 100%` where `inset` isn't already the pattern used).
3. This makes each rule size against the nearest `position: relative` **ancestor** instead of the viewport. `.app-shell__content` (Task 7) and `.new-chat-modal__panel` (Task 7) are both already `position: relative`, so no other structural change is needed.
4. `AmbientOrbs`' own CSS (`AmbientOrbs.css`) likely also assumes viewport-relative fixed positioning — apply the same fix there if it does.

**Files:**
- Modify: `client/src/screens/HandshakeJourney.css`, `client/src/screens/WaitingScreen.css`, `client/src/screens/ErrorScreen.css`, `client/src/screens/StartJoinScreen.css`, `client/src/components/AmbientOrbs.css` (as needed)

- [ ] **Step 1: Apply the method above to each file, one at a time**

Work through `HandshakeJourney.css` first (it wraps every non-error, non-hero screen), then `WaitingScreen.css`, `ErrorScreen.css`, `AmbientOrbs.css`, and finally `StartJoinScreen.css` (used both by the zero-chats hero, which legitimately stays full-viewport, and by `NewChatModal`, which doesn't — if the same rule needs to behave differently in the two contexts, scope the constrained version to `.new-chat-modal__panel &` rather than changing the hero's own full-viewport look).

- [ ] **Step 2: Visual verification — write a scratch Playwright screenshot script**

In the scratchpad directory (not the repo — this project has no committed browser-automation tooling; see `AGENTS.md`/project memory), create a throwaway script:

```js
// scratch-verify-panes.mjs (scratchpad dir, not committed)
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173/?screen=chat"); // adjust to the actual dev-override query param
await page.screenshot({ path: "chat-pane.png" });
await page.goto("http://localhost:5173/?screen=waiting");
await page.screenshot({ path: "waiting-pane.png" });
await page.goto("http://localhost:5173/?screen=loading");
await page.screenshot({ path: "loading-pane.png" });
await page.goto("http://localhost:5173/?screen=error");
await page.screenshot({ path: "error-pane.png" });
await browser.close();
```

Run it (`npm install playwright` once in the scratchpad dir if not already present; Chromium is already cached locally per project memory) against the running dev server, and inspect each screenshot for: content clipped or overflowing its container, `AmbientOrbs` escaping into the `ChatList` column, and the marquee/ticker strips still spanning correctly. Note these dev-override screens still render standalone (not inside the shell) — also manually open the real app (`+ New chat` while one chat is already open) to see `WaitingScreen`/`LoadingScreen` rendered live inside `.app-shell__content`, next to a populated `ChatList`, and adjust CSS until it looks intentional rather than broken.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/HandshakeJourney.css client/src/screens/WaitingScreen.css client/src/screens/ErrorScreen.css client/src/screens/StartJoinScreen.css client/src/components/AmbientOrbs.css
git commit -m "fix: constrain full-viewport screens to their containing pane"
```

---

## Task 9: End-to-end verification — concurrent live chats

**Files:** none (verification only, using a scratch Playwright script per this project's established convention for live multi-browser checks — see project memory on Playwright availability).

- [ ] **Step 1: Write a 3-context scratch script**

In the scratchpad dir, drive three independent `chromium.launch()` contexts (call them A, B, C) against the local dev client + relay:
1. A starts a chat, gets a room code; B joins it. Complete both safety-number screens (drag/click through, or use the existing dev keyboard-accessible path — see `SafetyNumberScreen.tsx`'s `Enter`/`Space` handling). A sends a text message; confirm it appears in B.
2. In A, click "+ New chat" and start a second chat; C joins it. Complete that handshake too. Confirm A's chat list now shows 2 rows, and A can switch between the A↔B chat and the A↔C chat via the list.
3. With A viewing the A↔C chat (A↔B backgrounded), have B send a message. Confirm: (a) A's chat-list row for A↔B shows an unread dot + preview (or "•" if Ghost Mode is toggled on first, to check that path too) without switching A's view away from A↔C; (b) after some seconds, inspect network traffic or timing logs to confirm the A↔B session's cover-traffic cadence continued while backgrounded (e.g. by adding a temporary `console.log` in the cover-traffic effect during this manual check, removed afterward) — this is the concrete verification of design spec Section 1/5's "stays fully live" requirement.
4. Switch A to the A↔B row; confirm the unread marker clears and (with Ghost Mode off) B eventually sees a "read" receipt — but only now, not while A was on the other tab.
5. Close the A↔C row from A's chat list; confirm C sees a "peer disconnected" error screen, while A↔B is completely unaffected and still live.
6. In A, open "+ New chat" four more times (reusing quick dummy rooms or just cancelling before completion, since a cap-counted session includes in-progress ones) until 5 total sessions exist; confirm "+ New chat" becomes disabled at 5, then re-enables after closing one.

- [ ] **Step 2: Fix any issues found**

Given the scope of Tasks 4–8, expect at least minor issues on first run (a missed `isActiveRef` read, a CSS overflow, a stale summary). Fix in the relevant task's files, re-run the affected part of the script, and commit the fix separately with a message describing what was wrong (not folded silently into an earlier task's commit).

- [ ] **Step 3: Run the full existing automated suite one more time**

Run (from `client/`): `npm run typecheck && npm test`
Run (from `server/`): `npm run typecheck && npm test` (unaffected by this feature, but confirm nothing regressed)
Expected: all green.

- [ ] **Step 4: No commit for this task itself**

Task 9 is verification; any fixes it surfaces are committed as part of Step 2 above, scoped to whichever task's files they belong to.
