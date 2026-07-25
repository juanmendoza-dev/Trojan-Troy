import sodium from "libsodium-wrappers-sumo";
import { toBase64, fromBase64 } from "../crypto/encoding";

// A profile PIN is a local access gate, not real encryption — a 4-digit PIN is
// trivially brute-forced (see the spec's "Honest scope of the PIN"). We only
// hash it (salted) so it never sits in storage as plaintext.

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function newSalt(): Promise<string> {
  await sodium.ready;
  return toBase64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES));
}

export interface KdfParams {
  ops: number;
  mem: number;
  alg: number;
}

// Argon2id at INTERACTIVE limits (~64 MiB, ~0.1 s) — memory-hard but snappy in
// a browser tab. SENSITIVE (~1 GiB) can OOM the tab; MODERATE is a one-line bump.
export async function defaultKdfParams(): Promise<KdfParams> {
  await sodium.ready;
  return {
    ops: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    mem: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    alg: sodium.crypto_pwhash_ALG_ARGON2ID13,
  };
}

export async function deriveVaultKey(
  pin: string,
  saltB64: string,
  params: KdfParams
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    pin,
    await fromBase64(saltB64),
    params.ops,
    params.mem,
    params.alg
  );
}

// TODO(Task 4): remove — the fast-hash access check is replaced by decryption.
export async function hashPin(pin: string, salt: string): Promise<string> {
  await sodium.ready;
  const input = sodium.from_string(`${salt}:${pin}`);
  return toBase64(sodium.crypto_generichash(32, input, null));
}

export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  const computed = await hashPin(pin, salt);
  return computed === hash;
}
