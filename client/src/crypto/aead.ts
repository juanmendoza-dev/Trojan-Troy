import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "./encoding";

// Authenticated encryption with associated data (XChaCha20-Poly1305 IETF).
// Layout mirrors secretbox.ts: base64 of `nonce || ciphertext`. The `aad` is
// authenticated but not encrypted — used to bind the ratchet header / channel
// so the relay can't tamper with or relabel a message without failing the tag.

export async function aeadEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array
): Promise<string> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key
  );
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return toBase64(combined);
}

export async function aeadDecrypt(
  key: Uint8Array,
  payload: string,
  aad: Uint8Array
): Promise<Uint8Array> {
  await sodium.ready;
  const combined = await fromBase64(payload);
  const nonce = combined.slice(0, sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = combined.slice(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key);
}
