import sodium from "libsodium-wrappers-sumo";

// Key-derivation for the Double Ratchet, built from keyed BLAKE2b
// (`crypto_generichash`) — the same primitive the safety number uses. Each
// function keys the hash with the secret and hashes a domain string, so
// outputs are domain-separated and one-way.

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// RK0: the ratchet's initial root key, derived from the crypto_kx session keys,
// the ML-KEM-768 shared secret (hybrid post-quantum), AND a hash of the full
// handshake transcript (hardened handshake, v4). The classical pair is sorted so
// the initiator (rx=Ri,tx=Ti) and responder (rx=Ti,tx=Ri) compute the identical
// value; the same pqSecret reaches both sides from the KEM; the transcript hash
// is canonical (see crypto/transcript.ts) so both sides also match on it. Keying
// with all three means the root key is safe unless BOTH X25519 and ML-KEM break,
// and any framing tamper (version downgrade, swapped KEM ciphertext) changes it.
// Domain tags bumped v3 -> v4 for the transcript-binding round.
export async function deriveRootKey(
  rx: Uint8Array,
  tx: Uint8Array,
  pqSecret: Uint8Array,
  transcriptHash: Uint8Array
): Promise<Uint8Array> {
  await sodium.ready;
  const [first, second] = [rx, tx].sort((a, b) =>
    sodium.to_hex(a).localeCompare(sodium.to_hex(b))
  );
  // Three-step so each keyed-BLAKE2b key stays within the 64-byte max. Step 1
  // folds the classical crypto_kx pair (already 64 bytes) into a 32-byte root;
  // step 2 keys that with the ML-KEM secret; step 3 binds the transcript hash.
  const classical = sodium.crypto_generichash(
    32,
    sodium.from_string("TTr:root:kx:v4"),
    concat(first, second)
  );
  const withPq = sodium.crypto_generichash(
    32,
    sodium.from_string("TTr:root:pq:v4"),
    concat(classical, pqSecret)
  );
  return sodium.crypto_generichash(
    32,
    sodium.from_string("TTr:root:tr:v4"),
    concat(withPq, transcriptHash)
  );
}

// Root KDF: mix a fresh DH output into the root key, yielding a new root key
// and a new chain key. Used on every DH ratchet step.
export async function kdfRoot(
  rk: Uint8Array,
  dh: Uint8Array
): Promise<{ rk: Uint8Array; ck: Uint8Array }> {
  await sodium.ready;
  const okm = sodium.crypto_generichash(64, concat(sodium.from_string("TTr:rk:v2"), dh), rk);
  return { rk: okm.slice(0, 32), ck: okm.slice(32, 64) };
}

// Chain KDF: advance a chain key one step, deriving the message key for this
// step and the next chain key (Signal's 0x01/0x02 constants).
export async function kdfChain(ck: Uint8Array): Promise<{ ck: Uint8Array; mk: Uint8Array }> {
  await sodium.ready;
  const mk = sodium.crypto_generichash(32, Uint8Array.of(0x01), ck);
  const next = sodium.crypto_generichash(32, Uint8Array.of(0x02), ck);
  return { ck: next, mk };
}

// Static per-channel subkey for the non-ratcheted channels (presence/ack/
// profile). Derive from a directional key (tx for sending, rx for receiving)
// so a reflected ciphertext won't open under our receive subkey.
export async function deriveChannelSubkey(
  dirKey: Uint8Array,
  channel: string
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_generichash(32, sodium.from_string("TTr:sub:" + channel), dirKey);
}
