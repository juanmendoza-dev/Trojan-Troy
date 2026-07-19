import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encryptBytes, decryptBytes } from "./secretbox";

describe("secretbox", () => {
  it("round-trips bytes through encrypt and decrypt", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const plaintext = sodium.from_string("hello, world");

    const encrypted = await encryptBytes(key, plaintext);
    const decrypted = await decryptBytes(key, encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it("rejects a tampered ciphertext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptBytes(key, sodium.from_string("hello, world"));

    const bytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

    await expect(decryptBytes(key, tampered)).rejects.toThrow();
  });

  it("rejects when decrypted with the wrong key", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const wrongKey = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptBytes(key, sodium.from_string("hello, world"));

    await expect(decryptBytes(wrongKey, encrypted)).rejects.toThrow();
  });

  it("uses a different nonce each call, producing different ciphertext for the same plaintext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const plaintext = sodium.from_string("hello, world");

    const first = await encryptBytes(key, plaintext);
    const second = await encryptBytes(key, plaintext);

    expect(first).not.toBe(second);
  });
});
