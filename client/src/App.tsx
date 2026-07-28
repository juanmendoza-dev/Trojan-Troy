import { useEffect, useRef, useState, type ReactNode } from "react";
import sodium from "libsodium-wrappers-sumo";
import { RelayClient, type Envelope, PROTOCOL_VERSION } from "./net/relayClient";
import { parseInviteCode } from "./net/inviteLink";
import { generateKeypair, deriveSessionKeys, type Keypair, type SessionKeys } from "./crypto/keys";
import { generateKemKeypair, kemEncapsulate, kemDecapsulate } from "./crypto/pqkem";
import { computeHandshakeCommit, computeTranscriptHash } from "./crypto/transcript";
import { computeSafetyNumber } from "./crypto/safetyNumber";
import { toBase64, fromBase64 } from "./crypto/encoding";
import { measureClipDurationMs } from "./audio/clipDuration";
import { frame, type Frame } from "./crypto/framing";
import {
  initSession,
  sealContent,
  sealStatic,
  openMsg,
  type SessionCrypto,
} from "./protocol/ratchetSession";
import { advanceStatus } from "./protocol/messageStatus";
import { shouldSendReadAck } from "./protocol/readAckDecision";
import {
  shouldSendPresence,
  parsePresenceState,
  PRESENCE_EXPIRY_MS,
  type PresenceState,
  jitteredHeartbeatMs,
} from "./protocol/presenceState";
import {
  nextAction,
  jitteredInterval,
  coverBodyLen,
  COVER_INTERVAL_MS,
  COVER_JITTER_FRAC,
} from "./protocol/coverTraffic";
import {
  shouldOffer,
  jitteredRekeyInterval,
  nextOfferId,
  PQ_REKEY_INTERVAL_MS,
  PQ_REKEY_JITTER_FRAC,
} from "./protocol/pqRekey";
import { queuePqSecret, isPqFoldPending } from "./crypto/ratchet";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { type ConnectStatus } from "./screens/ConnectingBar";
import { CONNECT_COMPLETE_HOLD_MS } from "./screens/barPhases";
import { WaitingScreen } from "./screens/WaitingScreen";
import { SafetyNumberScreen } from "./screens/SafetyNumberScreen";
import { ChatScreen, type ChatMessage } from "./screens/ChatScreen";
import { useTheme } from "./theme/ThemeContext";
import { LoadingScreen } from "./screens/loading/LoadingScreen";
import { HandshakeJourney } from "./screens/HandshakeJourney";
import { ErrorScreen } from "./screens/ErrorScreen";
import { scenarioFromServerMessage, type ErrorScenario } from "./screens/errorScenario";
import { ProfileModal } from "./components/ProfileModal";
import {
  ANONYMOUS_ID,
  type StoredProfile,
  type ActiveProfile,
  type Profile,
  type PeerProfile,
} from "./profiles/profileModel";
import {
  listProfiles,
  putProfile,
  deleteProfile,
  getShareProfile,
  setShareProfile as persistShareProfile,
} from "./profiles/profileStore";
import type { ProfileSecrets } from "./profiles/vault";
import { detectDevice } from "./profiles/device";
import { parseScreenOverride } from "./dev/screenOverride";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8080";
const GHOST_MODE_STORAGE_KEY = "trojan-troy-ghost-mode";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const EMPTY_BODY = new Uint8Array(0);

// Seal + send a receipt for a specific message id. Acks now ride the sealed
// "ack" channel (unforgeable, wire-indistinguishable from any other msg)
// instead of the old cleartext delivered/read envelopes.
async function sendAck(
  client: RelayClient,
  sc: SessionCrypto,
  kind: "delivered" | "read",
  id: string
) {
  client.send(await sealStatic(sc, "ack", frame({ channel: "ack", id, kind, body: EMPTY_BODY })));
}

async function maybeSendReadAck(
  client: RelayClient,
  sc: SessionCrypto,
  pendingReadIdsRef: { current: Set<string> },
  ghostModeRef: { current: boolean }
) {
  if (pendingReadIdsRef.current.size === 0) return;
  const send = shouldSendReadAck({
    isFocused: document.hasFocus(),
    isVisible: document.visibilityState === "visible",
    ghostMode: ghostModeRef.current,
    alreadyAcked: false,
  });
  if (!send) return;
  // Flush every message received while blurred, not just the most recent one.
  for (const messageId of pendingReadIdsRef.current) {
    await sendAck(client, sc, "read", messageId);
  }
  pendingReadIdsRef.current.clear();
}

// Which channels ride the ratchet (as opposed to a static subkey). v5 takes the
// key class off the envelope, so "was that a content frame?" is answered from the
// sealed frame instead — it gates the outbox flush, since only a content receive
// can establish the responder's sending chain.
const CONTENT_CHANNELS = new Set<Frame["channel"]>([
  "text",
  "voice",
  "primer",
  "cover",
  "pqoffer",
  "pqaccept",
]);

function isContentChannel(channel: Frame["channel"]): boolean {
  return CONTENT_CHANNELS.has(channel);
}

// Content that fails to open is shown as a "couldn't decrypt" bubble — but a
// replayed / stale / over-skipped packet (which a malicious relay could spam)
// is dropped silently, matching the ratchet's own drop semantics. A frame no key
// opens is silent too: under v5's sealed headers that is what a foreign or
// reflected frame looks like, and it must not paint an error bubble.
function isSilentContentDrop(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : "";
  return (
    msg.includes("replayed") ||
    msg.includes("stale") ||
    msg.includes("too many skipped") ||
    msg.includes("no receiving chain") ||
    msg.includes("no key opened") ||
    msg.includes("static header class")
  );
}

// Best-effort wipe of the ratchet secrets + channel subkeys on leave (review
// L3/B13). JS can't guarantee no copies linger, but this clears the live
// buffers we hold.
function zeroizeSession(sc: SessionCrypto | null) {
  if (!sc) return;
  const r = sc.ratchet;
  sodium.memzero(r.RK);
  if (r.CKs) sodium.memzero(r.CKs);
  if (r.CKr) sodium.memzero(r.CKr);
  sodium.memzero(r.DHs.privateKey);
  for (const { mk } of r.MKSKIPPED.values()) sodium.memzero(mk);
  r.MKSKIPPED.clear();
  // v5: header keys and unfolded post-quantum secrets are live key material too.
  for (const hk of [r.HKs, r.HKr, r.NHKs, r.NHKr]) if (hk) sodium.memzero(hk);
  for (const pending of r.pqPending) sodium.memzero(pending.secret);
  r.pqPending.length = 0;
  for (const key of Object.values(sc.txSub)) sodium.memzero(key);
  for (const key of Object.values(sc.rxSub)) sodium.memzero(key);
  for (const key of Object.values(sc.txHdr)) sodium.memzero(key);
  for (const key of Object.values(sc.rxHdr)) sodium.memzero(key);
  sodium.memzero(sc.rootKey);
}

type Screen =
  | { name: "start" }
  | { name: "waiting"; roomCode: string }
  | { name: "handshake"; roomCode: string }
  | { name: "safety-number"; roomCode: string; safetyNumber: string }
  | { name: "chat"; roomCode: string; safetyNumber: string }
  | {
      name: "error";
      scenario: ErrorScenario;
      /** How to replay the failed action, if it can be retried in place. */
      retry?: { kind: "start" } | { kind: "join"; roomCode: string };
    };

export default function App() {
  const devOverride = import.meta.env.DEV ? parseScreenOverride(window.location.search) : null;
  const [screen, setScreen] = useState<Screen>({ name: "start" });
  const [initialJoinCode] = useState<string | null>(() => parseInviteCode(window.location.hash));
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sessionCryptoRef = useRef<SessionCrypto | null>(null);
  // Outgoing content the responder tried to send before it had a sending chain
  // (i.e. before receiving the initiator's primer/first message) — flushed the
  // moment a content receive establishes the chain.
  const outboxRef = useRef<Uint8Array[]>([]);
  // Last time a real-or-cover content frame went to the wire — the cover
  // scheduler backs off whenever this is recent (see protocol/coverTraffic.ts).
  const lastContentSentRef = useRef(0);
  const coverTimerRef = useRef<number | null>(null);
  // Post-quantum rekey (round-2 feature A). Only the initiator offers, so there is
  // one offer-id sequence and no ambiguity about the order two secrets fold in.
  // The live offer's ML-KEM secret key is held until the peer's accept arrives,
  // then zeroized — each keypair is single-use.
  const pqOfferRef = useRef<{ offerId: number; secretKey: Uint8Array } | null>(null);
  const pqLastOfferAtRef = useRef(0);
  const pqSentSinceOfferRef = useRef(0);
  const pqTimerRef = useRef<number | null>(null);
  const pqLastOfferIdRef = useRef(0);
  // Which side of the handshake we are — the rekey offerer is always the initiator.
  const roleRef = useRef<"initiator" | "responder" | null>(null);
  const clientRef = useRef<RelayClient | null>(null);
  const listenerCleanupsRef = useRef<Array<() => void>>([]);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const { setTheme } = useTheme();

  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  // Reload starts Anonymous (R2): a named identity requires the PIN re-entered.
  const [activeProfile, setActiveProfile] = useState<ActiveProfile>({ kind: "anonymous" });
  const activeProfileId = activeProfile.kind === "named" ? activeProfile.profile.id : ANONYMOUS_ID;
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [ownDevice] = useState(detectDevice);
  const selfCard: PeerProfile = {
    name: activeProfile.kind === "named" ? activeProfile.profile.name : "Anonymous",
    avatar: activeProfile.kind === "named" ? activeProfile.profile.avatar : null,
    device: ownDevice,
  };
  const activeProfileRef = useRef(activeProfile);
  activeProfileRef.current = activeProfile;
  const [shareProfile, setShareProfile] = useState<boolean>(() => getShareProfile());
  const shareProfileRef = useRef(shareProfile);
  shareProfileRef.current = shareProfile;
  function updateShareProfile(next: boolean) {
    persistShareProfile(next);
    setShareProfile(next);
  }
  const [peerProfile, setPeerProfile] = useState<PeerProfile | null>(null);

  useEffect(() => {
    void listProfiles().then(setProfiles);
  }, []);

  function toRuntime(p: StoredProfile, secrets: ProfileSecrets): Profile {
    return { id: p.id, name: p.name, createdAt: p.createdAt, avatar: secrets.avatar };
  }

  async function handleCreateProfile(profile: StoredProfile, secrets: ProfileSecrets) {
    await putProfile(profile);
    setProfiles(await listProfiles());
    setActiveProfile({ kind: "named", profile: toRuntime(profile, secrets) });
  }
  function handleSelectNamed(profile: StoredProfile, secrets: ProfileSecrets) {
    setActiveProfile({ kind: "named", profile: toRuntime(profile, secrets) });
  }
  function handleSelectAnonymous() {
    setActiveProfile({ kind: "anonymous" });
  }
  async function handleDeleteProfile(id: string) {
    await deleteProfile(id);
    setProfiles(await listProfiles());
    if (activeProfile.kind === "named" && activeProfile.profile.id === id) {
      setActiveProfile({ kind: "anonymous" });
    }
  }

  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const [ghostMode, setGhostMode] = useState<boolean>(
    () => localStorage.getItem(GHOST_MODE_STORAGE_KEY) === "true"
  );
  const ghostModeRef = useRef(ghostMode);
  ghostModeRef.current = ghostMode;

  const [peerPresence, setPeerPresence] = useState<PresenceState>("idle");
  const presenceExpiryRef = useRef<number | null>(null);
  const presenceSentRef = useRef<{ state: PresenceState; at: number }>({ state: "idle", at: 0 });

  function updateGhostMode(next: boolean) {
    localStorage.setItem(GHOST_MODE_STORAGE_KEY, String(next));
    setGhostMode(next);
  }

  // Show the peer's live presence, auto-clearing after PRESENCE_EXPIRY_MS as a
  // safety net for a dropped "idle"/stop event.
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

  // Broadcast our own composition activity — encrypted, throttled to a heartbeat,
  // and suppressed by Ghost Mode (see protocol/presenceState.ts).
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

  useEffect(() => {
    function handleFocusChange() {
      const client = clientRef.current;
      const sc = sessionCryptoRef.current;
      if (client && sc) void maybeSendReadAck(client, sc, pendingReadIdsRef, ghostModeRef);
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

  // Cover traffic: while in chat with an established sending chain, keep the
  // outbound c:0 frame rate at/above a jittered baseline so the relay can't see
  // idle gaps or typing pauses. Real sends reset lastContentSentRef, so cover
  // only fills genuine silence — real messages incur zero added latency.
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

  // Post-quantum rekey (A): the initiator periodically offers a fresh ML-KEM
  // public key; the responder encapsulates to it, and both sides fold the
  // resulting secret into the ratchet's root chain at the next DH step. So
  // post-compromise healing re-secures with post-quantum material, not just
  // X25519. The offer rides the ordinary content path, which means it is padded
  // and bucketed exactly like text — the reason the ML-KEM blobs are NOT carried
  // in the (now sealed, fixed-size) ratchet header.
  useEffect(() => {
    if (screen.name !== "chat" || roleRef.current !== "initiator") return;
    let cancelled = false;
    // Treat entering chat as the last rekey: RK0 already contains the handshake's
    // ML-KEM secret, so the clock starts from a post-quantum root.
    pqLastOfferAtRef.current = performance.now();
    pqSentSinceOfferRef.current = 0;
    function scheduleRekey() {
      if (cancelled) return;
      const interval = jitteredRekeyInterval(
        PQ_REKEY_INTERVAL_MS,
        PQ_REKEY_JITTER_FRAC,
        Math.random
      );
      pqTimerRef.current = window.setTimeout(async () => {
        const sc = sessionCryptoRef.current;
        const client = clientRef.current;
        if (
          sc &&
          client &&
          sc.ratchet.CKs &&
          shouldOffer({
            now: performance.now(),
            lastOfferAt: pqLastOfferAtRef.current,
            contentSentSinceOffer: pqSentSinceOfferRef.current,
            interval,
          })
        ) {
          await sendPqOffer(sc, client);
        }
        scheduleRekey();
      }, interval);
    }
    scheduleRekey();
    return () => {
      cancelled = true;
      if (pqTimerRef.current !== null) {
        clearTimeout(pqTimerRef.current);
        pqTimerRef.current = null;
      }
    };
  }, [screen.name]);

  useEffect(() => {
    if (devOverride?.theme) setTheme(devOverride.theme);
  }, []);

  // An invite link (…/#CODE) prefills the join form on load; drop the hash
  // afterward so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (initialJoinCode && window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const HANDSHAKE_MIN_MS = 2600;

  async function exchangeKeys(
    client: RelayClient,
    own: Keypair,
    role: "initiator" | "responder",
    roomCode: string
  ) {
    const handshakeStart = performance.now();
    let disconnected = false;
    roleRef.current = role;
    // Hybrid post-quantum handshake state. The responder holds the ML-KEM
    // keypair (published on its `pubkey`); the initiator encapsulates to it and
    // returns the ciphertext (`kemct`). Each side stashes its classical
    // crypto_kx result until the PQ secret is known and the root key derivable.
    const kemKeypair = role === "responder" ? generateKemKeypair() : null;
    let classicalKeys: SessionKeys | null = null;
    let peerPub: Uint8Array | null = null;
    // The peer's hash commitment, received before its `pubkey` reveal; the
    // reveal is verified against it (commit-then-reveal, v4).
    let peerCommit: Uint8Array | null = null;
    // The initiator's primer/profile card can reach the responder before it has
    // derived RK₀ (the async listener runs handlers concurrently). Buffer any
    // `msg` until seeded, then drain in order.
    const inbound: Extract<Envelope, { type: "msg" }>[] = [];

    // Everything once BOTH the classical and PQ secrets are in hand: seed the
    // ratchet, optionally share the profile, prime the responder's chain, show
    // the session-bound safety number, and replay any buffered msgs.
    async function finishHandshake(
      sessionKeys: SessionKeys,
      peerPublicKey: Uint8Array,
      pqSecret: Uint8Array,
      transcriptHash: Uint8Array
    ) {
      const sc = await initSession(sessionKeys, role, own, peerPublicKey, pqSecret, transcriptHash);
      sessionCryptoRef.current = sc;
      if (shareProfileRef.current && activeProfileRef.current.kind === "named") {
        const self = activeProfileRef.current.profile;
        const card = JSON.stringify({ name: self.name, avatar: self.avatar, device: ownDevice });
        client.send(
          await sealStatic(sc, "profile", frame({ channel: "profile", id: "", body: textEncoder.encode(card) }))
        );
      }
      // Host-primer: the responder has no sending chain until it receives the
      // initiator's first content message, so the initiator sends a hidden one
      // now. The responder decrypts it (gaining a sending chain) and drops it —
      // invisible, but it lets either side type first.
      if (role === "initiator") {
        await sendContentFrame(sc, client, frame({ channel: "primer", id: "", body: EMPTY_BODY }));
      }
      // The safety number now binds the derived hybrid root key (not just the
      // relayed pubkeys), so a key swap or a PQ downgrade changes the digits.
      const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey, sc.rootKey);
      const elapsed = performance.now() - handshakeStart;
      if (elapsed < HANDSHAKE_MIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_MIN_MS - elapsed));
      }
      if (disconnected) return;
      setScreen({ name: "safety-number", roomCode, safetyNumber });
      await drainInbound();
    }

    // Replay whatever arrived before we could open it — either before RK₀ existed
    // (responder, pre-kemct) or while a post-quantum fold was still in flight.
    // Anything that still can't be opened is re-buffered by handleMsg, so this is
    // safe to call repeatedly.
    async function drainInbound() {
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
        // The peer folded a post-quantum secret we haven't received yet (its
        // accept is still in flight). Retryable, not corrupt — buffer and drain
        // once the accept lands. The relay is FIFO per sender so this shouldn't
        // happen; the buffer means a reordering bug degrades to a delay.
        if (isPqFoldPending(err)) {
          inbound.push(envelope);
          return;
        }
        // A content packet that genuinely won't decrypt gets a bubble; a bad
        // static signal, a replay, or a frame no key opens is dropped silently.
        if (!isSilentContentDrop(err)) {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
          ]);
        }
        return;
      }
      // A content receive advances the receiving ratchet and may have just
      // established our sending chain (responder) — flush anything queued. The
      // class is no longer on the envelope, so it comes from the sealed frame.
      if (isContentChannel(received.channel)) void flushOutbox();

      switch (received.channel) {
        case "primer":
          // Hidden bootstrap message: its only job was to advance the ratchet.
          break;
        case "cover":
          // Decoy traffic: its only job was to advance the ratchet. Drop it.
          break;
        case "pqoffer": {
          // The initiator offered a fresh ML-KEM public key: encapsulate to it,
          // queue the secret for the next ratchet step, and return the ciphertext.
          if (roleRef.current !== "responder") break; // only the initiator offers
          if (received.body.length < 2) break;
          const view = new DataView(received.body.buffer, received.body.byteOffset);
          const offerId = view.getUint16(0, true);
          const kemPub = received.body.slice(2);
          try {
            const { cipherText, sharedSecret } = kemEncapsulate(kemPub);
            queuePqSecret(sc.ratchet, offerId, sharedSecret);
            const body = new Uint8Array(2 + cipherText.length);
            new DataView(body.buffer).setUint16(0, offerId, true);
            body.set(cipherText, 2);
            await sendContentFrame(sc, client, frame({ channel: "pqaccept", id: "", body }));
          } catch {
            // A malformed public key just means no fold this round — the session
            // carries on under the existing root key.
          }
          break;
        }
        case "pqaccept": {
          // Our offer was accepted: decapsulate, queue the secret, and retire the
          // single-use ML-KEM secret key.
          const offer = pqOfferRef.current;
          if (roleRef.current !== "initiator" || !offer) break;
          if (received.body.length < 2) break;
          const view = new DataView(received.body.buffer, received.body.byteOffset);
          const offerId = view.getUint16(0, true);
          if (offerId !== offer.offerId) break; // stale or unknown offer
          const cipherText = received.body.slice(2);
          try {
            const secret = kemDecapsulate(cipherText, offer.secretKey);
            queuePqSecret(sc.ratchet, offerId, secret);
          } catch {
            // Nothing to fold; the next offer will try again.
          }
          sodium.memzero(offer.secretKey);
          pqOfferRef.current = null;
          // A buffered message may have been waiting on exactly this secret.
          void drainInbound();
          break;
        }
        case "text": {
          const text = textDecoder.decode(received.body);
          showPeerPresence("idle");
          setMessages((prev) => [
            ...prev,
            { id: received.id, timestamp: Date.now(), from: "peer", kind: "text", text },
          ]);
          void sendAck(client, sc, "delivered", received.id);
          pendingReadIdsRef.current.add(received.id);
          void maybeSendReadAck(client, sc, pendingReadIdsRef, ghostModeRef);
          break;
        }
        case "voice": {
          const blob = new Blob([new Uint8Array(received.body)], { type: received.mimeType ?? "audio/webm" });
          const audioUrl = URL.createObjectURL(blob);
          const durationMs = await measureClipDurationMs(blob).catch(() => 0);
          showPeerPresence("idle");
          setMessages((prev) => [
            ...prev,
            { id: received.id, timestamp: Date.now(), from: "peer", kind: "voice", audioUrl, durationMs },
          ]);
          void sendAck(client, sc, "delivered", received.id);
          pendingReadIdsRef.current.add(received.id);
          void maybeSendReadAck(client, sc, pendingReadIdsRef, ghostModeRef);
          break;
        }
        case "presence": {
          try {
            const state = parsePresenceState(JSON.parse(textDecoder.decode(received.body))?.state);
            if (state) showPeerPresence(state);
          } catch {
            // Ignore a malformed presence body — the next heartbeat recovers.
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

    listenerCleanupsRef.current.push(client.onMessage(async (envelope: Envelope) => {
      if (envelope.type === "peer-disconnected") {
        disconnected = true;
        setScreen({ name: "error", scenario: "friend_left" });
        return;
      }
      if (envelope.type === "commit") {
        // Commit-then-reveal (v4): the peer commits to its ephemeral key(s)
        // before either side reveals, so keys can't be chosen adaptively. A
        // second commit, a commit after we've revealed/seeded, or a version
        // mismatch is a protocol violation — single-shot (extends H2).
        if (sessionCryptoRef.current || peerPub || peerCommit) {
          setScreen({ name: "error", scenario: "handshake_failed" });
          return;
        }
        if (envelope.v !== PROTOCOL_VERSION) {
          setScreen({ name: "error", scenario: "handshake_failed" });
          return;
        }
        try {
          peerCommit = await fromBase64(envelope.commit);
        } catch {
          setScreen({ name: "error", scenario: "handshake_failed" });
          return;
        }
        // Holding the peer's commitment, reveal our own public key(s) now.
        const revealPayload = await toBase64(own.publicKey);
        if (kemKeypair) {
          client.send({
            type: "pubkey",
            payload: revealPayload,
            v: PROTOCOL_VERSION,
            kem: await toBase64(kemKeypair.publicKey),
          });
        } else {
          client.send({ type: "pubkey", payload: revealPayload, v: PROTOCOL_VERSION });
        }
        return;
      }
      if (envelope.type === "pubkey") {
        // Single-shot: a second reveal — before or after seeding — is a protocol
        // violation, never a silent re-key (H2, extended to the pre-seed window).
        if (sessionCryptoRef.current || peerPub) {
          setScreen({ name: "error", scenario: "handshake_failed" });
          return;
        }
        // A reveal must follow the peer's commit; its absence means a stripped
        // commit round (a forced downgrade / an injected reveal).
        if (!peerCommit) {
          setScreen({ name: "error", scenario: "handshake_failed" });
          return;
        }
        // Refuse to derive keys against a wire format we don't speak.
        if (envelope.v !== PROTOCOL_VERSION) {
          setScreen({ name: "error", scenario: "handshake_failed" });
          return;
        }
        try {
          const revealedPub = await fromBase64(envelope.payload);
          const revealedKem = envelope.kem ? await fromBase64(envelope.kem) : null;
          // Verify the reveal against the earlier commitment: a relay that swaps
          // a key (or strips the responder's KEM) after the commit is caught here.
          const expected = await computeHandshakeCommit(revealedPub, revealedKem);
          if (sodium.to_hex(expected) !== sodium.to_hex(peerCommit)) {
            setScreen({ name: "error", scenario: "handshake_failed" });
            return;
          }
          peerPub = revealedPub;
          classicalKeys = await deriveSessionKeys(own, peerPub, role);
          if (role === "initiator") {
            // Fail closed: a v4 responder MUST supply a KEM key. A missing one
            // is a downgrade attempt — never fall back to classical-only.
            if (!revealedKem) {
              setScreen({ name: "error", scenario: "handshake_failed" });
              return;
            }
            const { cipherText, sharedSecret } = kemEncapsulate(revealedKem);
            client.send({ type: "kemct", payload: await toBase64(cipherText) });
            const transcriptHash = await computeTranscriptHash(
              own.publicKey,
              peerPub,
              revealedKem,
              cipherText,
              PROTOCOL_VERSION
            );
            await finishHandshake(classicalKeys, peerPub, sharedSecret, transcriptHash);
          }
          // Responder: wait for the kemct before seeding.
        } catch {
          setScreen({ name: "error", scenario: "handshake_failed" });
        }
        return;
      }
      if (envelope.type === "kemct") {
        // Only the responder decapsulates, only after its reveal step, only once.
        if (
          role !== "responder" ||
          !classicalKeys ||
          !peerPub ||
          !kemKeypair ||
          sessionCryptoRef.current
        ) {
          setScreen({ name: "error", scenario: "handshake_failed" });
          return;
        }
        try {
          const cipherText = await fromBase64(envelope.payload);
          const sharedSecret = kemDecapsulate(cipherText, kemKeypair.secretKey);
          const transcriptHash = await computeTranscriptHash(
            own.publicKey,
            peerPub,
            kemKeypair.publicKey,
            cipherText,
            PROTOCOL_VERSION
          );
          await finishHandshake(classicalKeys, peerPub, sharedSecret, transcriptHash);
        } catch {
          setScreen({ name: "error", scenario: "handshake_failed" });
        }
        return;
      }
      if (envelope.type === "msg") {
        // Buffer until RK₀ exists (responder, pre-kemct), then handle in order.
        if (!sessionCryptoRef.current) {
          inbound.push(envelope);
          return;
        }
        await handleMsg(envelope);
        return;
      }
    }));

    // Opening move: send our commitment. We reveal our public key only after we
    // receive the peer's commit (handled in the listener above) — commit-then-
    // reveal, so neither side can pick its keys as a function of the other's.
    const ownCommit = await computeHandshakeCommit(
      own.publicKey,
      kemKeypair ? kemKeypair.publicKey : null
    );
    client.send({ type: "commit", v: PROTOCOL_VERSION, commit: await toBase64(ownCommit) });
  }

  async function handleStart() {
    setConnectStatus("connecting");
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    clientRef.current = client;
    try {
      await client.waitForOpen();
    } catch {
      client.close();
      clientRef.current = null;
      setConnectStatus("idle");
      setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "start" } });
      return;
    }
    let currentRoomCode = "";
    listenerCleanupsRef.current.push(client.onMessage((envelope) => {
      if (envelope.type === "created") {
        currentRoomCode = envelope.roomCode;
        const code = envelope.roomCode;
        // Snap the connecting bar to 100%, then hold a beat before advancing.
        setConnectStatus("connected");
        window.setTimeout(() => {
          setConnectStatus("idle");
          setScreen((prev) => (prev.name === "start" ? { name: "waiting", roomCode: code } : prev));
        }, CONNECT_COMPLETE_HOLD_MS);
      }
      if (envelope.type === "peer-connected") {
        setScreen({ name: "handshake", roomCode: currentRoomCode });
        void exchangeKeys(client, own, "initiator", currentRoomCode);
      }
      if (envelope.type === "error") {
        setConnectStatus("idle");
        setScreen({
          name: "error",
          scenario: scenarioFromServerMessage(envelope.message),
          retry: { kind: "start" },
        });
      }
    }));
    client.send({ type: "create" });
  }

  async function handleJoin(roomCode: string) {
    setConnectStatus("connecting");
    const own = await generateKeypair();
    const client = new RelayClient(RELAY_URL);
    clientRef.current = client;
    try {
      await client.waitForOpen();
    } catch {
      client.close();
      clientRef.current = null;
      setConnectStatus("idle");
      setScreen({ name: "error", scenario: "server_unreachable", retry: { kind: "join", roomCode } });
      return;
    }
    listenerCleanupsRef.current.push(client.onMessage((envelope) => {
      if (envelope.type === "error") {
        setConnectStatus("idle");
        setScreen({
          name: "error",
          scenario: scenarioFromServerMessage(envelope.message),
          retry: { kind: "join", roomCode },
        });
      }
      if (envelope.type === "peer-connected") {
        // Start the key exchange right away (listeners stack — delaying it would
        // drop the peer's pubkey), but hold the finished bar a beat on the home
        // screen before swapping in the handshake/loading screen.
        setConnectStatus("connected");
        void exchangeKeys(client, own, "responder", roomCode);
        window.setTimeout(() => {
          setConnectStatus("idle");
          setScreen((prev) => (prev.name === "start" ? { name: "handshake", roomCode } : prev));
        }, CONNECT_COMPLETE_HOLD_MS);
      }
    }));
    client.send({ type: "join", roomCode });
  }

  // One choke point for every ratcheted content send, so the cover timer sees real
  // traffic and backs off. Static signals (presence/ack/profile) do NOT go through
  // here — only ratcheted content counts toward the cover baseline.
  async function sendContentFrame(sc: SessionCrypto, client: RelayClient, frameBytes: Uint8Array) {
    lastContentSentRef.current = performance.now();
    pqSentSinceOfferRef.current += 1;
    client.send(await sealContent(sc, frameBytes));
  }

  // Offer a fresh ML-KEM public key for the next root-chain fold (A). The keypair
  // is single-use: the secret key is held only until the peer's accept arrives.
  // Sent as ordinary ratcheted content, so it is padded into the same buckets as
  // text — cover traffic reaches the 4096 bucket too, so a rekey isn't visible as
  // a periodic large frame.
  async function sendPqOffer(sc: SessionCrypto, client: RelayClient) {
    const offerId = nextOfferId(pqLastOfferIdRef.current);
    pqLastOfferIdRef.current = offerId;
    const kem = generateKemKeypair();
    // Retire any offer the peer never answered — one live offer at a time.
    if (pqOfferRef.current) sodium.memzero(pqOfferRef.current.secretKey);
    pqOfferRef.current = { offerId, secretKey: kem.secretKey };
    pqLastOfferAtRef.current = performance.now();
    pqSentSinceOfferRef.current = 0;
    const body = new Uint8Array(2 + kem.publicKey.length);
    new DataView(body.buffer).setUint16(0, offerId, true);
    body.set(kem.publicKey, 2);
    await sendContentFrame(sc, client, frame({ channel: "pqoffer", id: "", body }));
  }

  // Send ratcheted content, or — if we're the responder and haven't received
  // the initiator's primer yet — queue it until our sending chain exists.
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
    setMessages((prev) => [
      ...prev,
      { id, timestamp: Date.now(), from: "me", kind: "text", text, status: "sent" },
    ]);
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

  function handleLeave() {
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
    if (pqTimerRef.current !== null) {
      clearTimeout(pqTimerRef.current);
      pqTimerRef.current = null;
    }
    // The live offer's ML-KEM secret key outlives the session object, so wipe it
    // here rather than in zeroizeSession.
    if (pqOfferRef.current) {
      sodium.memzero(pqOfferRef.current.secretKey);
      pqOfferRef.current = null;
    }
    pqLastOfferIdRef.current = 0;
    pqSentSinceOfferRef.current = 0;
    roleRef.current = null;
    presenceSentRef.current = { state: "idle", at: 0 };
    setPeerPresence("idle");
    setPeerProfile(null);
    setConnectStatus("idle");
    for (const message of messagesRef.current) {
      if (message.kind === "voice") URL.revokeObjectURL(message.audioUrl);
    }
    setMessages([]);
    setScreen({ name: "start" });
  }

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
          ghostMode={ghostMode}
          onGhostModeChange={updateGhostMode}
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
    // Holds the connecting bar in its "alive" cold-start state so the sheen +
    // breathing glow can be eyeballed without a live relay.
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
    const sample: StoredProfile[] = [
      { id: "s1", name: "Jay", createdAt: 0, pinSalt: "cw==", kdf: { ops: 2, mem: 67108864, alg: 2 }, cipher: "cw==" },
      { id: "s2", name: "Work", createdAt: 0, pinSalt: "cw==", kdf: { ops: 2, mem: 67108864, alg: 2 }, cipher: "cw==" },
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
    // Show "Try again" for the connection-time scenarios (mirrors the real
    // wiring, where only those carry a retry); peer-left / handshake show one.
    const retryable =
      scenario === "server_unreachable" || scenario === "bad_code" || scenario === "room_full";
    return (
      <ErrorScreen scenario={scenario} onNewChat={() => {}} onRetry={retryable ? () => {} : undefined} />
    );
  }
  if (screen.name === "start") {
    return (
      <>
        <StartJoinScreen
          onStart={handleStart}
          onJoin={handleJoin}
          connectStatus={connectStatus}
          initialCode={initialJoinCode ?? undefined}
          activeProfile={activeProfile}
          onOpenProfiles={() => setProfilesOpen(true)}
        />
        {profilesOpen && (
          <ProfileModal
            profiles={profiles}
            activeId={activeProfileId}
            onSelectAnonymous={handleSelectAnonymous}
            onSelectNamed={handleSelectNamed}
            onCreate={handleCreateProfile}
            onDelete={handleDeleteProfile}
            onClose={() => setProfilesOpen(false)}
          />
        )}
      </>
    );
  }
  if (screen.name === "waiting") {
    return <WaitingScreen roomCode={screen.roomCode} onCancel={handleLeave} />;
  }
  if (screen.name === "handshake" || screen.name === "safety-number" || screen.name === "chat") {
    let content: ReactNode;
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
            for (const dispose of listenerCleanupsRef.current) dispose();
            listenerCleanupsRef.current = [];
            clientRef.current?.close();
            clientRef.current = null;
            zeroizeSession(sessionCryptoRef.current);
            sessionCryptoRef.current = null;
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
          onGhostModeChange={updateGhostMode}
          shareProfile={shareProfile}
          onShareProfileChange={updateShareProfile}
          peerPresence={peerPresence}
          onPresence={sendPresence}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
          onLeave={handleLeave}
        />
      );
    }
    return <HandshakeJourney activeKey={screen.name}>{content}</HandshakeJourney>;
  }
  // Only the "error" variant remains.
  const retry = screen.retry;
  return (
    <ErrorScreen
      scenario={screen.scenario}
      onNewChat={handleLeave}
      onRetry={
        retry
          ? () => {
              // Tear down the failed attempt's client/state, then replay it.
              handleLeave();
              if (retry.kind === "start") void handleStart();
              else void handleJoin(retry.roomCode);
            }
          : undefined
      }
    />
  );
}
