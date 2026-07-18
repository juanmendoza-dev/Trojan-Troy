import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encryptMessage, decryptMessage } from "./messages";

describe("messages", () => {
  it("round-trips plaintext through encrypt and decrypt", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();

    const encrypted = await encryptMessage(key, "hello, world");
    const decrypted = await decryptMessage(key, encrypted);

    expect(decrypted).toBe("hello, world");
  });

  it("rejects a tampered ciphertext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptMessage(key, "hello, world");

    const bytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

    await expect(decryptMessage(key, tampered)).rejects.toThrow();
  });

  it("rejects when decrypted with the wrong key", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const wrongKey = sodium.crypto_secretbox_keygen();
    const encrypted = await encryptMessage(key, "hello, world");

    await expect(decryptMessage(wrongKey, encrypted)).rejects.toThrow();
  });

  it("uses a different nonce each call, producing different ciphertext for the same plaintext", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();

    const first = await encryptMessage(key, "hello, world");
    const second = await encryptMessage(key, "hello, world");

    expect(first).not.toBe(second);
  });
});
