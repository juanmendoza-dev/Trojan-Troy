import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "./encoding";

export async function encryptMessage(key: Uint8Array, plaintext: string): Promise<string> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return toBase64(combined);
}

export async function decryptMessage(key: Uint8Array, payload: string): Promise<string> {
  await sodium.ready;
  const combined = await fromBase64(payload);
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(plaintext);
}
