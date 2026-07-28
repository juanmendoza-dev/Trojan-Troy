import sodium from "libsodium-wrappers-sumo";

// Domain-separated BLAKE2b hashes for the hardened handshake (round-2 feature D:
// commit-then-reveal + transcript binding). Both pass the domain string as the
// BLAKE2b *key* — a fixed public label, i.e. pure domain separation, not
// secret-keying. The hashed material (an ML-KEM public key is 1184 bytes, a
// ciphertext 1088) exceeds the 64-byte key limit, so it must be the message.

const COMMIT_DOMAIN = "TTr:commit:v4";
const TRANSCRIPT_DOMAIN = "TTr:transcript:v4";

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// A party's hash commitment to its ephemeral handshake public key(s), sent
// before the peer's keys are revealed so neither side (nor a MITM) can choose
// its keys as a function of the other's (ZRTP-style). The responder includes
// its ML-KEM public key; the initiator has none — so the commitment also covers
// the presence/absence of the KEM leg. The keys are high-entropy, so H(key) is
// a hiding + binding commitment without an extra nonce.
export async function computeHandshakeCommit(
  x25519Pub: Uint8Array,
  kemPub?: Uint8Array | null
): Promise<Uint8Array> {
  await sodium.ready;
  const material = kemPub ? concatBytes([x25519Pub, kemPub]) : x25519Pub;
  return sodium.crypto_generichash(32, material, sodium.from_string(COMMIT_DOMAIN));
}

// Canonical hash of the whole handshake transcript, folded into RK0 by
// deriveRootKey so any framing tamper (a version downgrade, a swapped KEM
// ciphertext) changes the root key — the session then fails closed and the
// safety number digits change. The two X25519 public keys are sorted (the same
// canonical ordering the safety number and deriveRootKey use) so the initiator
// and responder compute a byte-identical transcript.
export async function computeTranscriptHash(
  pubA: Uint8Array,
  pubB: Uint8Array,
  kemPub: Uint8Array,
  kemCt: Uint8Array,
  version: number
): Promise<Uint8Array> {
  await sodium.ready;
  const [first, second] = [pubA, pubB].sort((a, b) =>
    sodium.to_hex(a).localeCompare(sodium.to_hex(b))
  );
  const message = concatBytes([Uint8Array.of(version & 0xff), first, second, kemPub, kemCt]);
  return sodium.crypto_generichash(32, message, sodium.from_string(TRANSCRIPT_DOMAIN));
}
