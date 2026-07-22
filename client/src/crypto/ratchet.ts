import sodium from "libsodium-wrappers";
import { kdfRoot, kdfChain } from "./kdf";
import { aeadEncrypt, aeadDecrypt } from "./aead";

// Double Ratchet (Signal-style), built from libsodium primitives:
//   DH        = crypto_scalarmult (X25519)
//   KDF_RK/CK = keyed BLAKE2b (./kdf)
//   AEAD      = XChaCha20-Poly1305 with the header bound as associated data (./aead)
//
// State is mutated in place by encrypt; decrypt is transactional (operates on a
// clone and commits only on success) so a tampered/replayed message can't
// corrupt the live session.

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface RatchetHeader {
  dh: string; // sender's current ratchet public key (base64)
  pn: number; // messages in the sender's previous sending chain
  n: number; // message number in the sender's current sending chain
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
  MKSKIPPED: Map<string, Uint8Array>;
}

export const MAX_SKIP = 100;
export const MAX_SKIPPED_TOTAL = 1000;

const utf8 = new TextEncoder();

// Canonical, order-independent AAD (avoids depending on JSON key order for a
// MAC input). base64 ORIGINAL never contains '.', so it's an unambiguous sep.
function aadFor(h: RatchetHeader): Uint8Array {
  return utf8.encode(`${h.dh}.${h.pn}.${h.n}`);
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

export async function initAlice(rk0: Uint8Array, bobInitialPub: Uint8Array): Promise<RatchetState> {
  await sodium.ready;
  const DHs = await generateDH();
  const { rk, ck } = await kdfRoot(rk0, dh(DHs.privateKey, bobInitialPub));
  return { DHs, DHr: bobInitialPub, RK: rk, CKs: ck, CKr: null, Ns: 0, Nr: 0, PN: 0, MKSKIPPED: new Map() };
}

export async function initBob(rk0: Uint8Array, bobHandshakeKeypair: KeyPair): Promise<RatchetState> {
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
  };
}

export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array
): Promise<{ header: RatchetHeader; payload: string }> {
  await sodium.ready;
  if (!state.CKs) throw new Error("ratchet has no sending chain yet");
  const { ck, mk } = await kdfChain(state.CKs);
  state.CKs = ck;
  const header: RatchetHeader = { dh: b64(state.DHs.publicKey), pn: state.PN, n: state.Ns };
  state.Ns += 1;
  const payload = await aeadEncrypt(mk, plaintext, aadFor(header));
  sodium.memzero(mk);
  return { header, payload };
}

export async function ratchetDecrypt(
  state: RatchetState,
  header: RatchetHeader,
  payload: string
): Promise<Uint8Array> {
  await sodium.ready;
  const trial = cloneState(state);
  const plaintext = await decryptOnState(trial, header, payload); // throws => no commit
  commitState(state, trial);
  return plaintext;
}

async function decryptOnState(
  state: RatchetState,
  header: RatchetHeader,
  payload: string
): Promise<Uint8Array> {
  const dhrPub = sodium.from_base64(header.dh, sodium.base64_variants.ORIGINAL);

  const sk = `${header.dh}:${header.n}`;
  const stored = state.MKSKIPPED.get(sk);
  if (stored) {
    state.MKSKIPPED.delete(sk);
    const pt = await aeadDecrypt(stored, payload, aadFor(header));
    sodium.memzero(stored);
    return pt;
  }

  const isNewRatchet = state.DHr === null || !equalBytes(dhrPub, state.DHr);
  if (isNewRatchet) {
    await skipMessageKeys(state, header.pn);
    await dhRatchet(state, dhrPub);
  } else if (header.n < state.Nr) {
    throw new Error("stale or replayed message");
  }

  await skipMessageKeys(state, header.n);

  if (!state.CKr) throw new Error("ratchet has no receiving chain");
  const { ck, mk } = await kdfChain(state.CKr);
  state.CKr = ck;
  state.Nr += 1;
  const pt = await aeadDecrypt(mk, payload, aadFor(header));
  sodium.memzero(mk);
  return pt;
}

async function skipMessageKeys(state: RatchetState, until: number): Promise<void> {
  if (state.Nr + MAX_SKIP < until) throw new Error("too many skipped messages");
  if (!state.CKr || state.DHr === null) return;
  const dhrKey = b64(state.DHr);
  while (state.Nr < until) {
    const { ck, mk } = await kdfChain(state.CKr);
    state.CKr = ck;
    while (state.MKSKIPPED.size >= MAX_SKIPPED_TOTAL) {
      const oldest = state.MKSKIPPED.keys().next().value;
      if (oldest === undefined) break;
      state.MKSKIPPED.delete(oldest);
    }
    state.MKSKIPPED.set(`${dhrKey}:${state.Nr}`, mk);
    state.Nr += 1;
  }
}

async function dhRatchet(state: RatchetState, dhrPub: Uint8Array): Promise<void> {
  state.PN = state.Ns;
  state.Ns = 0;
  state.Nr = 0;
  state.DHr = dhrPub;
  const recv = await kdfRoot(state.RK, dh(state.DHs.privateKey, dhrPub));
  state.RK = recv.rk;
  state.CKr = recv.ck;
  state.DHs = await generateDH();
  const send = await kdfRoot(state.RK, dh(state.DHs.privateKey, dhrPub));
  state.RK = send.rk;
  state.CKs = send.ck;
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
}
