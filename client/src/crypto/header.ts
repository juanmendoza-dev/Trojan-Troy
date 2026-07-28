import sodium from "libsodium-wrappers-sumo";

// Sealed ratchet header (v5, round-2 feature B). Everything that used to sit in
// the clear on the `msg` envelope — the key class, the sender's ratchet public
// key, and the chain counters — now lives here, encrypted under a header key.
//
// The layout is FIXED SIZE for every message, on purpose. A header that varied
// (small for a plain message, large when it carried post-quantum material) would
// hand the relay back most of what sealing it was meant to hide, so the PQ ratchet
// deliberately keeps its ML-KEM blobs out of here and ships them as ordinary
// padded content frames instead (see the design spec). Nothing in this module is
// allowed to grow with the message.
//
//   plaintext  = cls u8 | ver u8 | fold u16LE | pn u32LE | n u32LE | dh 32B  = 44
//   sealed     = nonce 24 | ciphertext 44 | tag 16                          = 84
//
// Pure and synchronous apart from sodium's wasm gate.

export const HEADER_LEN = 44;
export const SEALED_HEADER_LEN = 84;
export const HEADER_VERSION = 5;

// Cleartext-equivalent key classes. 0 is ratcheted content; 1-3 are the static
// per-channel classes (presence/ack/profile), which are not ratcheted and so
// zero-fill the ratchet fields.
export type KeyClass = 0 | 1 | 2 | 3;

export interface Header {
  cls: KeyClass;
  fold: number; // PQ folds already mixed into the root key (content only)
  pn: number; // messages in the sender's previous sending chain
  n: number; // position in the sender's current chain / static send counter
  dh: Uint8Array; // sender's current ratchet public key (32 zero bytes if static)
}

const ZERO_DH = new Uint8Array(32);

export function packHeader(h: Header): Uint8Array {
  const out = new Uint8Array(HEADER_LEN);
  const view = new DataView(out.buffer);
  out[0] = h.cls;
  out[1] = HEADER_VERSION;
  view.setUint16(2, h.fold, true);
  view.setUint32(4, h.pn, true);
  view.setUint32(8, h.n, true);
  if (h.dh.length !== 32) throw new Error("header dh must be 32 bytes");
  out.set(h.dh, 12);
  return out;
}

export function unpackHeader(bytes: Uint8Array): Header {
  if (bytes.length !== HEADER_LEN) throw new Error("bad header length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cls = bytes[0];
  if (cls > 3) throw new Error(`unknown key class ${cls}`);
  // The version lives inside the sealed header as well as on the handshake, so a
  // peer that somehow opens a header from another protocol revision still fails
  // closed instead of misreading the counters.
  if (bytes[1] !== HEADER_VERSION) throw new Error(`unsupported header version ${bytes[1]}`);
  return {
    cls: cls as KeyClass,
    fold: view.getUint16(2, true),
    pn: view.getUint32(4, true),
    n: view.getUint32(8, true),
    dh: bytes.slice(12, 44),
  };
}

export function staticHeader(cls: KeyClass, counter: number): Header {
  return { cls, fold: 0, pn: 0, n: counter, dh: ZERO_DH };
}

export async function sealHeader(hk: Uint8Array, header: Header): Promise<Uint8Array> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    packHeader(header),
    null,
    null,
    nonce,
    hk
  );
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
}

// Returns null rather than throwing on a key that doesn't match: receiving is
// trial decryption across several candidate header keys, so a failed attempt is
// the normal case and has to be cheap. A structurally valid header that opens but
// fails its own version/class check DOES throw — that's a real protocol error,
// not a wrong-key guess.
export async function openHeader(hk: Uint8Array, sealed: Uint8Array): Promise<Header | null> {
  await sodium.ready;
  if (sealed.length !== SEALED_HEADER_LEN) return null;
  const nonce = sealed.subarray(0, sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sealed.subarray(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      null,
      nonce,
      hk
    );
  } catch {
    return null;
  }
  return unpackHeader(plaintext);
}
