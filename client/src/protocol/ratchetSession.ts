import {
  initAlice,
  initBob,
  ratchetEncrypt,
  ratchetDecrypt,
  type KeyPair,
  type RatchetState,
} from "../crypto/ratchet";
import { deriveRootKey, deriveChannelSubkey } from "../crypto/kdf";
import { aeadEncrypt, aeadDecrypt } from "../crypto/aead";
import { unframe, type Frame } from "../crypto/framing";
import type { SessionKeys } from "../crypto/keys";
import type { Envelope } from "../net/relayClient";

// Binds a Double Ratchet plus the static per-channel subkeys to one paired
// session, and encodes/decodes the single opaque `msg` wire envelope.
//
//   content (text/voice) -> the ratchet, c:0, fresh key per message
//   presence/ack/profile -> a static directional subkey, c:1/2/3
//
// The static channels don't get per-message forward secrecy (ratcheting a
// 2.5s presence heartbeat would just churn the chain), but they're still
// unforgeable and channel-separated: each is sealed under its own subkey with
// the channel name bound as AAD, so the relay can't relabel one class as
// another and have it open.

export type StaticChannel = "presence" | "ack" | "profile";

export interface SessionCrypto {
  ratchet: RatchetState;
  txSub: Record<StaticChannel, Uint8Array>;
  rxSub: Record<StaticChannel, Uint8Array>;
}

const STATIC_CHANNELS: StaticChannel[] = ["presence", "ack", "profile"];

// Cleartext key-class selector <-> logical channel. 0 is ratcheted content.
const CLASS_BY_CHANNEL: Record<StaticChannel, 1 | 2 | 3> = {
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

// Seed the ratchet + static subkeys from the completed crypto_kx handshake.
// The initiator ("Alice") seeds against the peer's handshake public key; the
// responder ("Bob") reuses his own handshake keypair as his initial ratchet
// key, so no extra wire round-trip is needed.
export async function initSession(
  sessionKeys: SessionKeys,
  role: "initiator" | "responder",
  ownKeypair: KeyPair,
  peerPublicKey: Uint8Array
): Promise<SessionCrypto> {
  const rk0 = await deriveRootKey(sessionKeys.rx, sessionKeys.tx);
  const ratchet =
    role === "initiator"
      ? await initAlice(rk0, peerPublicKey)
      : await initBob(rk0, ownKeypair);
  return {
    ratchet,
    txSub: await deriveSubkeys(sessionKeys.tx),
    rxSub: await deriveSubkeys(sessionKeys.rx),
  };
}

// Ratcheted content: advances the sending chain, so each message gets a fresh
// key and a header the peer needs to stay in sync.
export async function sealContent(sc: SessionCrypto, frameBytes: Uint8Array): Promise<Envelope> {
  const { header, payload } = await ratchetEncrypt(sc.ratchet, frameBytes);
  return { type: "msg", c: 0, header, payload };
}

// Static channel: sealed under the outgoing subkey with the channel name as
// AAD (binds the class), no ratchet advance.
export async function sealStatic(
  sc: SessionCrypto,
  channel: StaticChannel,
  frameBytes: Uint8Array
): Promise<Envelope> {
  const payload = await aeadEncrypt(sc.txSub[channel], frameBytes, utf8.encode(channel));
  return { type: "msg", c: CLASS_BY_CHANNEL[channel], payload };
}

// Decrypt and unframe an incoming `msg`. Throws on any failure (tamper,
// replay, relabel, corruption, wrong class) so the caller drops it — the
// ratchet's own decrypt is transactional, so a bad packet never corrupts the
// live session.
export async function openMsg(sc: SessionCrypto, env: Envelope): Promise<Frame> {
  if (env.type !== "msg") throw new Error("not a msg envelope");
  if (env.c === 0) {
    if (!env.header) throw new Error("content msg missing ratchet header");
    const inner = await ratchetDecrypt(sc.ratchet, env.header, env.payload);
    return unframe(inner);
  }
  const channel = CHANNEL_BY_CLASS[env.c];
  if (!channel) throw new Error(`unknown msg class ${env.c}`);
  const inner = await aeadDecrypt(sc.rxSub[channel], env.payload, utf8.encode(channel));
  return unframe(inner);
}
