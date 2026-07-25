import sodium from "libsodium-wrappers";
import { deriveVaultKey, generateSalt, sealVault, openVault } from "./atRest";

// Human-readable identity backup: the identity secret key + display name,
// base64-encoded and grouped into 5-char blocks like the safety number. The
// public key is never stored — it's recomputed from the secret on import. When
// a passphrase is given the payload is Argon2id + secretbox wrapped first, so a
// backup taken from a PIN-locked identity isn't left plaintext.

const FLAG_PLAINTEXT = 0x00;
const FLAG_WRAPPED = 0x01;

function buildPayload(secretKey: Uint8Array, displayName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(displayName);
  const payload = new Uint8Array(2 + nameBytes.length + secretKey.length);
  new DataView(payload.buffer).setUint16(0, nameBytes.length, false);
  payload.set(nameBytes, 2);
  payload.set(secretKey, 2 + nameBytes.length);
  return payload;
}

function parsePayload(payload: Uint8Array): { secretKey: Uint8Array; displayName: string } {
  if (payload.length < 2) throw new Error("Malformed recovery code.");
  const nameLen = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0, false);
  const secretStart = 2 + nameLen;
  const secretKey = payload.slice(secretStart);
  if (secretKey.length !== sodium.crypto_kx_SECRETKEYBYTES) throw new Error("Malformed recovery code.");
  const displayName = new TextDecoder().decode(payload.slice(2, secretStart));
  return { secretKey, displayName };
}

function group(value: string): string {
  const groups: string[] = [];
  for (let i = 0; i < value.length; i += 5) groups.push(value.slice(i, i + 5));
  return groups.join(" ");
}

export async function encodeRecoveryCode(
  secretKey: Uint8Array,
  displayName: string,
  passphrase?: string
): Promise<string> {
  await sodium.ready;
  const payload = buildPayload(secretKey, displayName);
  let container: Uint8Array;
  if (passphrase) {
    const salt = await generateSalt();
    const key = await deriveVaultKey(passphrase, salt);
    const { nonce, ciphertext } = await sealVault(payload, key);
    container = new Uint8Array(1 + salt.length + nonce.length + ciphertext.length);
    container[0] = FLAG_WRAPPED;
    container.set(salt, 1);
    container.set(nonce, 1 + salt.length);
    container.set(ciphertext, 1 + salt.length + nonce.length);
  } else {
    container = new Uint8Array(1 + payload.length);
    container[0] = FLAG_PLAINTEXT;
    container.set(payload, 1);
  }
  return group(sodium.to_base64(container, sodium.base64_variants.ORIGINAL));
}

export async function decodeRecoveryCode(
  code: string,
  passphrase?: string
): Promise<{ secretKey: Uint8Array; displayName: string }> {
  await sodium.ready;
  let container: Uint8Array;
  try {
    container = sodium.from_base64(code.replace(/\s+/g, ""), sodium.base64_variants.ORIGINAL);
  } catch {
    throw new Error("Malformed recovery code.");
  }
  if (container.length < 1) throw new Error("Malformed recovery code.");
  const flag = container[0];
  const rest = container.slice(1);

  if (flag === FLAG_PLAINTEXT) return parsePayload(rest);

  if (flag === FLAG_WRAPPED) {
    if (!passphrase) throw new Error("This recovery code is passphrase-protected.");
    const saltLen = sodium.crypto_pwhash_SALTBYTES;
    const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
    if (rest.length <= saltLen + nonceLen) throw new Error("Malformed recovery code.");
    const salt = rest.slice(0, saltLen);
    const nonce = rest.slice(saltLen, saltLen + nonceLen);
    const ciphertext = rest.slice(saltLen + nonceLen);
    const key = await deriveVaultKey(passphrase, salt);
    let payload: Uint8Array;
    try {
      payload = await openVault({ nonce, ciphertext }, key);
    } catch {
      throw new Error("Wrong passphrase or corrupt recovery code.");
    }
    return parsePayload(payload);
  }

  throw new Error("Malformed recovery code.");
}
