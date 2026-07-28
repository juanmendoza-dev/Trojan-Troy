import {
  initAlice,
  initBob,
  ratchetEncrypt,
  ratchetDecrypt,
  type KeyPair,
  type RatchetState,
} from "../crypto/ratchet";
import {
  deriveRootKey,
  deriveChannelSubkey,
  deriveHeaderKeys,
  deriveHeaderSubkey,
} from "../crypto/kdf";
import { aeadEncrypt, aeadDecrypt } from "../crypto/aead";
import {
  sealHeader,
  openHeader,
  staticHeader,
  SEALED_HEADER_LEN,
  type KeyClass,
} from "../crypto/header";
import { toBase64, fromBase64 } from "../crypto/encoding";
import { unframe, type Frame } from "../crypto/framing";
import type { SessionKeys } from "../crypto/keys";
import type { Envelope } from "../net/relayClient";

// Binds a Double Ratchet plus the static per-channel subkeys to one paired
// session, and encodes/decodes the single opaque `msg` wire envelope.
//
//   content (text/voice/primer/cover/pq) -> the ratchet, fresh key per message
//   presence/ack/profile                 -> a static directional subkey
//
// v5: the key class no longer travels in the clear. Every `msg` is one opaque
// blob — `sealedHeader (84 bytes) ‖ body ciphertext` — and which class a frame
// belongs to is only discoverable by opening its header, which needs a key the
// relay doesn't have. Receiving is therefore trial decryption across the ratchet's
// header keys and then the three static ones.
//
// The static channels still don't get per-message forward secrecy (ratcheting a
// 2.5s presence heartbeat would just churn the chain), but they are unforgeable,
// channel-separated, and — new in v5 — replay-protected by a per-channel counter.

export type StaticChannel = "presence" | "ack" | "profile";

// How far out of order a static frame may arrive and still be accepted. Presence
// heartbeats and receipts are small and frequent; a 64-wide window is generous
// while still bounding what a replaying relay can resurrect.
const STATIC_REPLAY_WINDOW = 64;

interface StaticGuard {
  // Highest counter seen, plus a bitmap of the window below it, so out-of-order
  // arrivals are accepted once and only once.
  highest: number;
  seen: Set<number>;
}

export interface SessionCrypto {
  ratchet: RatchetState;
  txSub: Record<StaticChannel, Uint8Array>;
  rxSub: Record<StaticChannel, Uint8Array>;
  txHdr: Record<StaticChannel, Uint8Array>;
  rxHdr: Record<StaticChannel, Uint8Array>;
  txCounter: Record<StaticChannel, number>;
  rxGuard: Record<StaticChannel, StaticGuard>;
  // The initial hybrid root key. Kept so the safety number can bind to the
  // derived session (see crypto/safetyNumber.ts); zeroized on leave.
  rootKey: Uint8Array;
}

const STATIC_CHANNELS: StaticChannel[] = ["presence", "ack", "profile"];

// Key class <-> logical channel. 0 is ratcheted content; the numbers now live
// only inside the sealed header, never on the envelope.
const CLASS_BY_CHANNEL: Record<StaticChannel, KeyClass> = {
  presence: 1,
  ack: 2,
  profile: 3,
};
const CHANNEL_BY_CLASS: Record<number, StaticChannel | undefined> = {
  1: "presence",
  2: "ack",
  3: "profile",
};

const utf8 = new TextEncoder();

async function deriveSubkeys(dirKey: Uint8Array): Promise<Record<StaticChannel, Uint8Array>> {
  const out = {} as Record<StaticChannel, Uint8Array>;
  for (const channel of STATIC_CHANNELS) {
    out[channel] = await deriveChannelSubkey(dirKey, channel);
  }
  return out;
}

async function deriveHdrSubkeys(dirKey: Uint8Array): Promise<Record<StaticChannel, Uint8Array>> {
  const out = {} as Record<StaticChannel, Uint8Array>;
  for (const channel of STATIC_CHANNELS) {
    out[channel] = await deriveHeaderSubkey(dirKey, CLASS_BY_CHANNEL[channel]);
  }
  return out;
}

function freshGuards(): Record<StaticChannel, StaticGuard> {
  const out = {} as Record<StaticChannel, StaticGuard>;
  for (const channel of STATIC_CHANNELS) out[channel] = { highest: -1, seen: new Set() };
  return out;
}

function freshCounters(): Record<StaticChannel, number> {
  return { presence: 0, ack: 0, profile: 0 };
}

// Seed the ratchet + static subkeys from the completed crypto_kx handshake. The
// initiator ("Alice") seeds against the peer's handshake public key; the responder
// ("Bob") reuses his own handshake keypair as his initial ratchet key, so no extra
// wire round-trip is needed. Header keys come from RK0, so they inherit its
// hybrid-PQ and transcript binding.
export async function initSession(
  sessionKeys: SessionKeys,
  role: "initiator" | "responder",
  ownKeypair: KeyPair,
  peerPublicKey: Uint8Array,
  pqSecret: Uint8Array,
  transcriptHash: Uint8Array
): Promise<SessionCrypto> {
  const rk0 = await deriveRootKey(sessionKeys.rx, sessionKeys.tx, pqSecret, transcriptHash);
  const { i2r, r2i } = await deriveHeaderKeys(rk0);
  const ratchet =
    role === "initiator"
      ? await initAlice(rk0, peerPublicKey, i2r, r2i)
      : await initBob(rk0, ownKeypair, i2r, r2i);
  return {
    ratchet,
    txSub: await deriveSubkeys(sessionKeys.tx),
    rxSub: await deriveSubkeys(sessionKeys.rx),
    txHdr: await deriveHdrSubkeys(sessionKeys.tx),
    rxHdr: await deriveHdrSubkeys(sessionKeys.rx),
    txCounter: freshCounters(),
    rxGuard: freshGuards(),
    rootKey: rk0,
  };
}

function joinBlob(encHeader: Uint8Array, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(encHeader.length + body.length);
  out.set(encHeader, 0);
  out.set(body, encHeader.length);
  return out;
}

// Ratcheted content: advances the sending chain, so each message gets a fresh key
// and a sealed header the peer needs to stay in sync.
export async function sealContent(sc: SessionCrypto, frameBytes: Uint8Array): Promise<Envelope> {
  const { encHeader, payload } = await ratchetEncrypt(sc.ratchet, frameBytes);
  const body = await fromBase64(payload);
  return { type: "msg", payload: await toBase64(joinBlob(encHeader, body)) };
}

// Static channel: sealed under the outgoing subkey, with the sealed header as AAD
// (which binds the class and the counter), no ratchet advance.
export async function sealStatic(
  sc: SessionCrypto,
  channel: StaticChannel,
  frameBytes: Uint8Array
): Promise<Envelope> {
  const counter = sc.txCounter[channel];
  sc.txCounter[channel] = counter + 1;
  const encHeader = await sealHeader(
    sc.txHdr[channel],
    staticHeader(CLASS_BY_CHANNEL[channel], counter)
  );
  const payload = await aeadEncrypt(sc.txSub[channel], frameBytes, encHeader);
  const body = await fromBase64(payload);
  return { type: "msg", payload: await toBase64(joinBlob(encHeader, body)) };
}

// Accept a static counter exactly once, within a bounded window. A relay that
// replays a captured presence beat or receipt now gets nothing.
function acceptStaticCounter(guard: StaticGuard, n: number): boolean {
  if (n > guard.highest) {
    guard.highest = n;
    guard.seen.add(n);
    for (const old of guard.seen) {
      if (old <= n - STATIC_REPLAY_WINDOW) guard.seen.delete(old);
    }
    return true;
  }
  if (n <= guard.highest - STATIC_REPLAY_WINDOW) return false; // too old to judge
  if (guard.seen.has(n)) return false; // already accepted
  guard.seen.add(n);
  return true;
}

// Decrypt and unframe an incoming `msg`. Throws on any failure (tamper, replay,
// relabel, corruption, unknown class) so the caller drops it — the ratchet's own
// decrypt is transactional, so a bad packet never corrupts the live session. A
// PqFoldPendingError propagates unchanged so the caller can buffer and retry.
export async function openMsg(sc: SessionCrypto, env: Envelope): Promise<Frame> {
  if (env.type !== "msg") throw new Error("not a msg envelope");
  const blob = await fromBase64(env.payload);
  if (blob.length <= SEALED_HEADER_LEN) throw new Error("msg too short");
  const encHeader = blob.subarray(0, SEALED_HEADER_LEN);
  const body = blob.subarray(SEALED_HEADER_LEN);
  const bodyB64 = await toBase64(body);

  // Content first: it's the overwhelmingly common case, and the ratchet reports a
  // clean "not mine" (null) rather than throwing when no header key matches.
  const inner = await ratchetDecrypt(sc.ratchet, encHeader, bodyB64);
  if (inner) return unframe(inner);

  for (const channel of STATIC_CHANNELS) {
    const header = await openHeader(sc.rxHdr[channel], encHeader);
    if (!header) continue;
    if (header.cls !== CLASS_BY_CHANNEL[channel]) {
      throw new Error("static header class does not match its key");
    }
    if (!acceptStaticCounter(sc.rxGuard[channel], header.n)) {
      throw new Error("replayed or stale static frame");
    }
    const plain = await aeadDecrypt(sc.rxSub[channel], bodyB64, encHeader);
    return unframe(plain);
  }
  throw new Error("no key opened this msg");
}
