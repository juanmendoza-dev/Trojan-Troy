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
// handshake transcript (hardened handshake). The classical pair is sorted so
// the initiator (rx=Ri,tx=Ti) and responder (rx=Ti,tx=Ri) compute the identical
// value; the same pqSecret reaches both sides from the KEM; the transcript hash
// is canonical (see crypto/transcript.ts) so both sides also match on it. Keying
// with all three means the root key is safe unless BOTH X25519 and ML-KEM break,
// and any framing tamper (version downgrade, swapped KEM ciphertext) changes it.
// Domain tags bumped v4 -> v5 alongside the sealed-header / PQ-ratchet revision.
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
    sodium.from_string("TTr:root:kx:v5"),
    concat(first, second)
  );
  const withPq = sodium.crypto_generichash(
    32,
    sodium.from_string("TTr:root:pq:v5"),
    concat(classical, pqSecret)
  );
  return sodium.crypto_generichash(
    32,
    sodium.from_string("TTr:root:tr:v5"),
    concat(withPq, transcriptHash)
  );
}

// Root KDF: mix a fresh DH output into the root key, yielding a new root key, a
// new chain key, and the NEXT header key for the chain this call creates (v5's
// header encryption needs a header key one chain ahead — see crypto/header.ts).
//
// `pqSecret` is the post-quantum ratchet step (round-2 feature A): when a fresh
// ML-KEM secret has been agreed in-band, it is folded into the root chain here,
// so post-compromise healing re-secures with post-quantum material and not just
// X25519. Omitting it must stay byte-identical to a no-PQ step — both sides walk
// the same root chain, and only one of them decides when a fold happens (the
// sender, announced via the header's fold counter), so this has to be one code
// path with no "did we pass undefined" divergence.
//
// Two keyed calls rather than one: BLAKE2b's output caps at 64 bytes, so 96 bytes
// of key material needs a second domain-separated call under the same key.
//
// A folded step uses a DIFFERENT domain than an unfolded one, so the two can
// never collide — not even if a caller bug passes a zero-length secret. Folding
// is the one place where the two sides could silently disagree, so it fails loudly
// (chains diverge, messages don't open) rather than quietly agreeing by accident.
export async function kdfRoot(
  rk: Uint8Array,
  dh: Uint8Array,
  pqSecret?: Uint8Array
): Promise<{ rk: Uint8Array; ck: Uint8Array; nhk: Uint8Array }> {
  await sodium.ready;
  const input = pqSecret ? concat(dh, pqSecret) : dh;
  const rkDomain = pqSecret ? "TTr:rk:pq:v5" : "TTr:rk:v5";
  const nhkDomain = pqSecret ? "TTr:nhk:pq:v5" : "TTr:nhk:v5";
  const okm = sodium.crypto_generichash(64, concat(sodium.from_string(rkDomain), input), rk);
  const nhk = sodium.crypto_generichash(32, concat(sodium.from_string(nhkDomain), input), rk);
  return { rk: okm.slice(0, 32), ck: okm.slice(32, 64), nhk };
}

// The two seed header keys, from RK0 (v5) — Signal's `shared_hka` / `shared_nhkb`
// for the header-encryption variant. Each side's FIRST sending chain needs a
// header key agreed out of band (there's no kdfRoot output to take one from yet);
// every later chain gets its header key from kdfRoot's `nhk`, one chain early.
// Derived from RK0 rather than the directional crypto_kx keys so they inherit the
// hybrid-PQ + transcript binding the root key already carries.
export async function deriveHeaderKeys(rk0: Uint8Array): Promise<{
  i2r: Uint8Array;
  r2i: Uint8Array;
}> {
  await sodium.ready;
  return {
    i2r: sodium.crypto_generichash(32, sodium.from_string("TTr:hdr:i2r:v5"), rk0),
    r2i: sodium.crypto_generichash(32, sodium.from_string("TTr:hdr:r2i:v5"), rk0),
  };
}

// Header key for a static (non-ratcheted) class. Direction-separated like
// deriveChannelSubkey — derive from tx to send, rx to receive — so a reflected
// frame won't open under our own receive header key.
export async function deriveHeaderSubkey(
  dirKey: Uint8Array,
  cls: number
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_generichash(32, sodium.from_string("TTr:hdrsub:" + cls + ":v5"), dirKey);
}

// Chain KDF: advance a chain key one step, deriving the message key for this
// step and the next chain key (Signal's 0x01/0x02 constants).
export async function kdfChain(ck: Uint8Array): Promise<{ ck: Uint8Array; mk: Uint8Array }> {
  await sodium.ready;
  const mk = sodium.crypto_generichash(32, Uint8Array.of(0x01), ck);
  const next = sodium.crypto_generichash(32, Uint8Array.of(0x02), ck);
  return { ck: next, mk };
}

// Bind a directional crypto_kx key to the hybrid root key before it is used to
// derive the static channels' subkeys (v6).
//
// Why this exists: the static channels (presence/ack/profile) used to derive
// straight from the raw crypto_kx output, which made them X25519-ONLY — no
// ML-KEM, no transcript binding — while the ratchet and its header keys took
// both from RK0. A harvest-now-decrypt-later adversary who broke X25519 would
// therefore have recovered the profile card (display name + avatar), the
// presence rhythm, and every read receipt, even though message content stayed
// safe. Folding RK0 in closes that gap.
//
// The directional key stays the *message* and RK0 the *key*, so tx/rx remain
// distinct: direction separation (a reflected frame must not open under our own
// receive subkey) survives the binding. Deliberately NOT sorted the way
// deriveRootKey sorts its pair — that sorting exists to produce one shared value,
// and here it would collapse both directions into one key.
export async function bindDirKey(dirKey: Uint8Array, rk0: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_generichash(
    32,
    concat(sodium.from_string("TTr:dir:v6"), dirKey),
    rk0
  );
}

// Static per-channel subkey for the non-ratcheted channels (presence/ack/
// profile). Derive from a directional key (tx for sending, rx for receiving)
// so a reflected ciphertext won't open under our receive subkey. As of v6 the
// caller passes a root-key-bound directional key (see bindDirKey), so these
// inherit the hybrid-PQ and transcript binding too.
export async function deriveChannelSubkey(
  dirKey: Uint8Array,
  channel: string
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_generichash(32, sodium.from_string("TTr:sub:" + channel), dirKey);
}
