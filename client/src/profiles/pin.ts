import sodium from "libsodium-wrappers";
import { toBase64 } from "../crypto/encoding";

// A profile PIN is a local access gate, not real encryption — a 4-digit PIN is
// trivially brute-forced (see the spec's "Honest scope of the PIN"). We only
// hash it (salted) so it never sits in storage as plaintext.

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function newSalt(): Promise<string> {
  await sodium.ready;
  return toBase64(sodium.randombytes_buf(16));
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  await sodium.ready;
  const input = sodium.from_string(`${salt}:${pin}`);
  return toBase64(sodium.crypto_generichash(32, input));
}

export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  const computed = await hashPin(pin, salt);
  return computed === hash;
}
