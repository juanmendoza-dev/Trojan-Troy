import sodium from "libsodium-wrappers-sumo";
import { kdfRoot, kdfChain } from "./kdf";
import { aeadEncrypt, aeadDecrypt } from "./aead";
import { sealHeader, openHeader, type Header } from "./header";

// Double Ratchet (Signal-style), built from libsodium primitives:
//   DH        = crypto_scalarmult (X25519)
//   KDF_RK/CK = keyed BLAKE2b (./kdf)
//   AEAD      = XChaCha20-Poly1305 (./aead), with the SEALED header as AAD
//
// v5 adds the two round-2 crypto features, which are entangled enough to belong
// in one implementation:
//
//   B — header encryption (Signal's header-encryption variant). The header no
//   longer travels in the clear: it is sealed under a header key, so the relay
//   can't read the sender's ratchet key, the chain counters, or the key class.
//   Each direction carries a current header key (HKs/HKr) and the next one
//   (NHKs/NHKr), known one chain early because kdfRoot emits it. Receiving is
//   therefore trial decryption: HKr means "same chain", NHKr means "the peer
//   flipped", and a header key stored with a skipped message key means "an old
//   straggler".
//
//   A — post-quantum ratchet. Fresh ML-KEM secrets, agreed in-band on the
//   pqoffer/pqaccept channels, are folded into the root chain so post-compromise
//   healing re-secures with post-quantum material rather than X25519 alone. The
//   fold lands on a DH ratchet step, because that is the only place RK is consumed
//   and therefore the one point both sides are already synchronised. The SENDER
//   decides when to fold and announces it in the header's `fold` counter; the
//   receiver mirrors it. Timing can't desync the two sides, because neither side
//   folds on "when the secret happened to arrive".
//
// State is mutated in place by encrypt; decrypt is transactional (operates on a
// clone and commits only on success) so a tampered/replayed message can't corrupt
// the live session.

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface PendingPqSecret {
  offerId: number;
  secret: Uint8Array;
}

// A message key held back for an out-of-order message, plus the header key of the
// chain it belongs to — without the latter, a straggler's header couldn't be
// opened at all once the chain has moved on.
interface SkippedKey {
  hk: Uint8Array;
  mk: Uint8Array;
}

export interface RatchetState {
  DHs: KeyPair;
  DHr: Uint8Array | null;
  RK: Uint8Array;
  CKs: Uint8Array | null;
  CKr: Uint8Array | null;
  Ns: number;
  Nr: number;
  PN: number;
  MKSKIPPED: Map<string, SkippedKey>;
  // Header keys: current and next, per direction (B).
  HKs: Uint8Array | null;
  HKr: Uint8Array | null;
  NHKs: Uint8Array | null;
  NHKr: Uint8Array | null;
  // PQ ratchet (A): how many secrets are already folded into RK, and the queue of
  // agreed-but-unfolded ones in offer order. Both sides see the same offers in the
  // same order (one offerer, FIFO relay), so folding from the front of the queue is
  // deterministic on both sides.
  pqFold: number;
  pqPending: PendingPqSecret[];
}

export const MAX_SKIP = 100;
export const MAX_SKIPPED_TOTAL = 1000;
// How many past chains' header keys stay eligible for trial decryption. Bounds the
// per-message trial cost; a straggler older than this is dropped, not crashed.
export const MAX_TRIAL_CHAINS = 8;

// Thrown when a header says the root key should already have a PQ secret folded in
// and we haven't received that secret yet. Distinguishable on purpose: the caller
// buffers and retries on this, rather than dropping the message as corrupt.
export class PqFoldPendingError extends Error {
  constructor() {
    super("pq fold not yet available");
    this.name = "PqFoldPendingError";
  }
}

export function isPqFoldPending(err: unknown): boolean {
  return err instanceof PqFoldPendingError;
}

function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  return sodium.crypto_scalarmult(priv, pub);
}

async function generateDH(): Promise<KeyPair> {
  await sodium.ready;
  const kp = sodium.crypto_kx_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// `hka`/`nhkb` are the seed header keys from deriveHeaderKeys: the initiator's
// first sending header key and the responder's first sending header key.
export async function initAlice(
  rk0: Uint8Array,
  bobInitialPub: Uint8Array,
  hka: Uint8Array,
  nhkb: Uint8Array
): Promise<RatchetState> {
  await sodium.ready;
  const DHs = await generateDH();
  const { rk, ck, nhk } = await kdfRoot(rk0, dh(DHs.privateKey, bobInitialPub));
  return {
    DHs,
    DHr: bobInitialPub,
    RK: rk,
    CKs: ck,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map(),
    HKs: hka,
    HKr: null,
    NHKs: nhk,
    NHKr: nhkb,
    pqFold: 0,
    pqPending: [],
  };
}

export async function initBob(
  rk0: Uint8Array,
  bobHandshakeKeypair: KeyPair,
  hka: Uint8Array,
  nhkb: Uint8Array
): Promise<RatchetState> {
  await sodium.ready;
  return {
    DHs: bobHandshakeKeypair,
    DHr: null,
    RK: rk0,
    CKs: null,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map(),
    HKs: null,
    HKr: null,
    NHKs: nhkb,
    NHKr: hka,
    pqFold: 0,
    pqPending: [],
  };
}

export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array
): Promise<{ encHeader: Uint8Array; payload: string }> {
  await sodium.ready;
  if (!state.CKs) throw new Error("ratchet has no sending chain yet");
  if (!state.HKs) throw new Error("ratchet has no sending header key yet");
  const { ck, mk } = await kdfChain(state.CKs);
  state.CKs = ck;
  const header: Header = {
    cls: 0,
    fold: state.pqFold,
    pn: state.PN,
    n: state.Ns,
    dh: state.DHs.publicKey,
  };
  state.Ns += 1;
  // The sealed header is the AAD, so a relay can't swap headers between two
  // messages: the body tag covers the exact header bytes on the wire.
  const encHeader = await sealHeader(state.HKs, header);
  const payload = await aeadEncrypt(mk, plaintext, encHeader);
  sodium.memzero(mk);
  return { encHeader, payload };
}

// Trial-decrypt the sealed header against every candidate this session could
// legitimately have used. Reports which candidate matched, because "it opened
// under NHKr" is precisely how a new sending chain is detected.
async function trialOpenHeader(
  state: RatchetState,
  encHeader: Uint8Array
): Promise<{ header: Header; viaNext: boolean } | null> {
  if (state.HKr) {
    const header = await openHeader(state.HKr, encHeader);
    if (header) return { header, viaNext: false };
  }
  if (state.NHKr) {
    const header = await openHeader(state.NHKr, encHeader);
    if (header) return { header, viaNext: true };
  }
  // Stragglers from chains we've already moved past. Newest first, capped.
  const seen = new Set<string>();
  const candidates: Uint8Array[] = [];
  for (const { hk } of Array.from(state.MKSKIPPED.values()).reverse()) {
    const key = b64(hk);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(hk);
    if (candidates.length >= MAX_TRIAL_CHAINS) break;
  }
  for (const hk of candidates) {
    const header = await openHeader(hk, encHeader);
    if (header) return { header, viaNext: false };
  }
  return null;
}

// Returns null when no candidate header key opens the blob — the caller then tries
// the static classes before giving up. Throws when the header opens but the message
// is bad (tampered body, replay, unavailable PQ fold).
export async function ratchetDecrypt(
  state: RatchetState,
  encHeader: Uint8Array,
  payload: string
): Promise<Uint8Array | null> {
  await sodium.ready;
  const trial = cloneState(state);
  const opened = await trialOpenHeader(trial, encHeader);
  if (!opened) return null;
  const plaintext = await decryptOnState(trial, opened, encHeader, payload); // throws => no commit
  commitState(state, trial);
  return plaintext;
}

async function decryptOnState(
  state: RatchetState,
  opened: { header: Header; viaNext: boolean },
  encHeader: Uint8Array,
  payload: string
): Promise<Uint8Array> {
  const { header, viaNext } = opened;
  if (header.cls !== 0) throw new Error("static class on the ratchet path");
  const dhrPub = header.dh;

  const sk = `${b64(dhrPub)}:${header.n}`;
  const stored = state.MKSKIPPED.get(sk);
  if (stored) {
    state.MKSKIPPED.delete(sk);
    const pt = await aeadDecrypt(stored.mk, payload, encHeader);
    sodium.memzero(stored.mk);
    return pt;
  }

  // A header that opened under NHKr is a new sending chain by definition; the byte
  // comparison stays as a belt-and-braces check for the HKr path.
  const isNewRatchet = viaNext || state.DHr === null || !equalBytes(dhrPub, state.DHr);
  if (isNewRatchet) {
    await skipMessageKeys(state, header.pn);
    await dhRatchet(state, dhrPub, header.fold);
  } else if (header.n < state.Nr) {
    throw new Error("stale or replayed message");
  }

  await skipMessageKeys(state, header.n);

  if (!state.CKr) throw new Error("ratchet has no receiving chain");
  const { ck, mk } = await kdfChain(state.CKr);
  state.CKr = ck;
  state.Nr += 1;
  const pt = await aeadDecrypt(mk, payload, encHeader);
  sodium.memzero(mk);
  return pt;
}

async function skipMessageKeys(state: RatchetState, until: number): Promise<void> {
  if (state.Nr + MAX_SKIP < until) throw new Error("too many skipped messages");
  if (!state.CKr || state.DHr === null || !state.HKr) return;
  const dhrKey = b64(state.DHr);
  const hk = state.HKr;
  while (state.Nr < until) {
    const { ck, mk } = await kdfChain(state.CKr);
    state.CKr = ck;
    while (state.MKSKIPPED.size >= MAX_SKIPPED_TOTAL) {
      const oldest = state.MKSKIPPED.keys().next().value;
      if (oldest === undefined) break;
      state.MKSKIPPED.delete(oldest);
    }
    state.MKSKIPPED.set(`${dhrKey}:${state.Nr}`, { hk, mk });
    state.Nr += 1;
  }
}

// Take the next PQ secret to fold, or undefined. Deliberately does NOT zeroize the
// secret: every fold happens inside a transactional trial decrypt that may be
// discarded, and wiping shared bytes there would destroy the live session's copy.
// Pending secrets are zeroized at session teardown instead.
function takePendingPq(state: RatchetState): Uint8Array | undefined {
  const next = state.pqPending.shift();
  return next?.secret;
}

async function dhRatchet(
  state: RatchetState,
  dhrPub: Uint8Array,
  headerFold: number
): Promise<void> {
  state.PN = state.Ns;
  state.Ns = 0;
  state.Nr = 0;
  state.HKs = state.NHKs;
  state.HKr = state.NHKr;
  state.DHr = dhrPub;

  // Recv step — mirror whatever the sender folded on ITS send step. A jump of more
  // than one is impossible in a two-party ratchet (each of their folds is separated
  // by one of our own flips), so treat it as a protocol violation rather than
  // guessing how to combine secrets.
  let recvPq: Uint8Array | undefined;
  if (headerFold > state.pqFold) {
    if (headerFold - state.pqFold > 1) throw new Error("pq fold counter jumped");
    recvPq = takePendingPq(state);
    if (!recvPq) throw new PqFoldPendingError();
    state.pqFold += 1;
  }
  const recv = await kdfRoot(state.RK, dh(state.DHs.privateKey, dhrPub), recvPq);
  state.RK = recv.rk;
  state.CKr = recv.ck;
  state.NHKr = recv.nhk;

  // Send step — fold our own next pending secret, if we have one. This is the
  // decision the peer mirrors, via the `fold` counter in our headers.
  state.DHs = await generateDH();
  const sendPq = takePendingPq(state);
  if (sendPq) state.pqFold += 1;
  const send = await kdfRoot(state.RK, dh(state.DHs.privateKey, dhrPub), sendPq);
  state.RK = send.rk;
  state.CKs = send.ck;
  state.NHKs = send.nhk;
}

function cloneState(s: RatchetState): RatchetState {
  return {
    DHs: { publicKey: s.DHs.publicKey, privateKey: s.DHs.privateKey },
    DHr: s.DHr,
    RK: s.RK,
    CKs: s.CKs,
    CKr: s.CKr,
    Ns: s.Ns,
    Nr: s.Nr,
    PN: s.PN,
    MKSKIPPED: new Map(s.MKSKIPPED),
    HKs: s.HKs,
    HKr: s.HKr,
    NHKs: s.NHKs,
    NHKr: s.NHKr,
    pqFold: s.pqFold,
    // A fresh array so a discarded trial can't consume the live queue.
    pqPending: s.pqPending.slice(),
  };
}

function commitState(dst: RatchetState, src: RatchetState): void {
  dst.DHs = src.DHs;
  dst.DHr = src.DHr;
  dst.RK = src.RK;
  dst.CKs = src.CKs;
  dst.CKr = src.CKr;
  dst.Ns = src.Ns;
  dst.Nr = src.Nr;
  dst.PN = src.PN;
  dst.MKSKIPPED = src.MKSKIPPED;
  dst.HKs = src.HKs;
  dst.HKr = src.HKr;
  dst.NHKs = src.NHKs;
  dst.NHKr = src.NHKr;
  dst.pqFold = src.pqFold;
  dst.pqPending = src.pqPending;
}

// Queue an agreed PQ secret for folding at the next DH ratchet step. Kept sorted by
// offerId so both sides fold in the same order regardless of arrival timing.
export function queuePqSecret(state: RatchetState, offerId: number, secret: Uint8Array): void {
  state.pqPending.push({ offerId, secret });
  state.pqPending.sort((a, b) => a.offerId - b.offerId);
}
