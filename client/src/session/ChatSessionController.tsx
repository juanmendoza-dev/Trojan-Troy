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
    // Bumped every time a connection attempt starts or is torn down. Each
    // attempt captures the value it was given at birth and re-checks it after
    // every await that could have let a newer attempt (StrictMode's remount,
    // a real reconnect) start in the meantime. A mismatch means this attempt
    // has been superseded: it must close whatever socket it opened and must
    // never touch clientRef/sessionCryptoRef/setScreen/setMessages again.
    const connectionGenerationRef = useRef(0);
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

    // Selecting this chat clears its unread marker. Becoming active can also
    // satisfy the read-ack gate (isActive && windowFocused) on its own, with
    // no window focus/visibility event to trigger the check — e.g. switching
    // chat-list rows while the browser window itself never lost focus. So
    // this must re-check any acks left pending from while it was backgrounded.
    useEffect(() => {
      if (!isActive) return;
      setUnreadPreview(null);
      const client = clientRef.current;
      const sc = sessionCryptoRef.current;
      if (client && sc) void maybeSendReadAck(client, sc);
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
      roomCode: string,
      generation: number
    ) {
      const handshakeStart = performance.now();
      let disconnected = false;
      const kemKeypair = role === "responder" ? generateKemKeypair() : null;
      let classicalKeys: SessionKeys | null = null;
      let peerPub: Uint8Array | null = null;
      const inbound: Extract<Envelope, { type: "msg" }>[] = [];

      async function finishHandshake(sessionKeys: SessionKeys, peerPublicKey: Uint8Array, pqSecret: Uint8Array) {
        const sc = await initSession(sessionKeys, role, own, peerPublicKey, pqSecret);
        if (generation !== connectionGenerationRef.current) return;
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
        if (disconnected || generation !== connectionGenerationRef.current) return;
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
          if (generation !== connectionGenerationRef.current) return;
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
              if (generation !== connectionGenerationRef.current) return;
              if (role === "initiator") {
                if (!envelope.kem) {
                  setScreen({ name: "error", scenario: "handshake_failed" });
                  return;
                }
                const { cipherText, sharedSecret } = kemEncapsulate(await fromBase64(envelope.kem));
                if (generation !== connectionGenerationRef.current) return;
                client.send({ type: "kemct", payload: await toBase64(cipherText) });
                await finishHandshake(classicalKeys, peerPub, sharedSecret);
              }
            } catch {
              if (generation === connectionGenerationRef.current) {
                setScreen({ name: "error", scenario: "handshake_failed" });
              }
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
              if (generation !== connectionGenerationRef.current) return;
              await finishHandshake(classicalKeys, peerPub, sharedSecret);
            } catch {
              if (generation === connectionGenerationRef.current) {
                setScreen({ name: "error", scenario: "handshake_failed" });
              }
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
      // Invalidate any connection attempt still in flight (mid-await, no
      // client assigned yet) as well as the one currently live, so neither
      // can resurrect clientRef/sessionCryptoRef/screen state afterward.
      connectionGenerationRef.current++;
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

    async function startConnection(generation: number) {
      const own = await generateKeypair();
      // Nothing has touched clientRef/setScreen yet, so a superseded attempt
      // can simply stop here — there's no socket to close.
      if (generation !== connectionGenerationRef.current) return;
      const client = new RelayClient(RELAY_URL);
      try {
        await client.waitForOpen();
      } catch {
        client.close();
        if (generation === connectionGenerationRef.current) {
          setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "start" } });
        }
        return;
      }
      if (generation !== connectionGenerationRef.current) {
        // A newer attempt started while this one was opening its socket.
        // This one did open a real connection — close it, and never assign
        // it to clientRef or register its listener.
        client.close();
        return;
      }
      clientRef.current = client;
      let currentRoomCode = "";
      listenerCleanupsRef.current.push(
        client.onMessage((envelope) => {
          if (generation !== connectionGenerationRef.current) return;
          if (envelope.type === "created") {
            currentRoomCode = envelope.roomCode;
            setScreen({ name: "waiting", roomCode: envelope.roomCode });
          }
          if (envelope.type === "peer-connected") {
            setScreen({ name: "handshake", roomCode: currentRoomCode });
            void exchangeKeys(client, own, "initiator", currentRoomCode, generation);
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

    async function joinConnection(generation: number, roomCode: string) {
      const own = await generateKeypair();
      if (generation !== connectionGenerationRef.current) return;
      const client = new RelayClient(RELAY_URL);
      try {
        await client.waitForOpen();
      } catch {
        client.close();
        if (generation === connectionGenerationRef.current) {
          setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "join", roomCode } });
        }
        return;
      }
      if (generation !== connectionGenerationRef.current) {
        client.close();
        return;
      }
      clientRef.current = client;
      listenerCleanupsRef.current.push(
        client.onMessage((envelope) => {
          if (generation !== connectionGenerationRef.current) return;
          if (envelope.type === "error") {
            setScreen({
              name: "error",
              scenario: scenarioFromServerMessage(envelope.message),
              retry: { kind: "join", roomCode },
            });
          }
          if (envelope.type === "peer-connected") {
            setScreen({ name: "handshake", roomCode });
            void exchangeKeys(client, own, "responder", roomCode, generation);
          }
        })
      );
      client.send({ type: "join", roomCode });
    }

    function connect() {
      const generation = ++connectionGenerationRef.current;
      if (initialAction.kind === "start") void startConnection(generation);
      else void joinConnection(generation, initialAction.roomCode);
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
