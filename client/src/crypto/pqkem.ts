import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

// Post-quantum half of the hybrid handshake: a thin wrapper over ML-KEM-768
// (NIST FIPS 203) from @noble/post-quantum — an audited library, the first
// crypto dependency beyond libsodium (see decisions.md 2026-07-23). ML-KEM is a
// KEM, not a DH: the responder publishes a public key, the initiator
// `encapsulate`s to it (producing a ciphertext + shared secret), and the
// responder `decapsulate`s the ciphertext back to the same secret.
//
// Synchronous — unlike libsodium there is no wasm `ready` gate.
//
// ML-KEM-768 byte sizes: public 1184, secret 2400, ciphertext 1088, secret 32.
//
// IMPORTANT — implicit rejection: `decapsulate` NEVER throws on a malformed or
// tampered ciphertext. By FIPS 203 it returns a *pseudo-random* shared secret
// instead. So a corrupted ciphertext surfaces downstream as a **mismatched root
// key** (the first ratchet message fails its AEAD tag → handshake_failed), never
// as an exception here. Callers must not rely on a throw to detect tampering.

export interface KemKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface KemEncapsulation {
  cipherText: Uint8Array;
  sharedSecret: Uint8Array;
}

export function generateKemKeypair(): KemKeypair {
  const { publicKey, secretKey } = ml_kem768.keygen();
  return { publicKey, secretKey };
}

export function kemEncapsulate(publicKey: Uint8Array): KemEncapsulation {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey);
  return { cipherText, sharedSecret };
}

export function kemDecapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(cipherText, secretKey);
}
