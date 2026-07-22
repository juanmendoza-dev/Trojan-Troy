import sodium from "libsodium-wrappers";

// At-rest encryption for the identity/contacts vault. Uses only audited
// libsodium primitives: Argon2id (crypto_pwhash) to stretch the user's
// PIN/passphrase into a key, and crypto_secretbox to seal the vault under it.
// No new primitive — crypto_secretbox is the same one used for messages/voice.

export interface SealedVault {
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export async function generateSalt(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
}

// Argon2id at INTERACTIVE limits — the right tier for an interactive unlock in
// a browser (snappy, ~64MiB), rather than MODERATE's 256MiB which is heavy for
// wasm. Protects a locked/stolen device, not an unlocked one (see spec).
export async function deriveVaultKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT
  );
}

export async function sealVault(
  plaintext: Uint8Array,
  key: Uint8Array
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  return { nonce, ciphertext };
}

// Throws on a wrong key or tampered ciphertext (crypto_secretbox is
// authenticated), which the caller surfaces as a wrong-PIN error.
export async function openVault(
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  key: Uint8Array
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_secretbox_open_easy(sealed.ciphertext, sealed.nonce, key);
}
