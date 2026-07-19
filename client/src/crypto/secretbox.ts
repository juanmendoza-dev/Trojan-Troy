import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "./encoding";

export async function encryptBytes(key: Uint8Array, plaintext: Uint8Array): Promise<string> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return toBase64(combined);
}

export async function decryptBytes(key: Uint8Array, payload: string): Promise<Uint8Array> {
  await sodium.ready;
  const combined = await fromBase64(payload);
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
  return sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
}
