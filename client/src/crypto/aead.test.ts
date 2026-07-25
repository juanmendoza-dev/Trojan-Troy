import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { aeadEncrypt, aeadDecrypt } from "./aead";

const enc = (s: string) => sodium.from_string(s);

describe("aead", () => {
  it("round-trips plaintext with associated data", async () => {
    await sodium.ready;
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const aad = enc("header-v2");

    const payload = await aeadEncrypt(key, enc("hello, world"), aad);
    const opened = await aeadDecrypt(key, payload, aad);

    expect(sodium.to_string(opened)).toBe("hello, world");
  });

  it("rejects a tampered ciphertext", async () => {
    await sodium.ready;
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const aad = enc("header");
    const payload = await aeadEncrypt(key, enc("hello, world"), aad);

    const bytes = sodium.from_base64(payload, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

    await expect(aeadDecrypt(key, tampered, aad)).rejects.toThrow();
  });

  it("rejects the wrong key", async () => {
    await sodium.ready;
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const wrongKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const aad = enc("header");
    const payload = await aeadEncrypt(key, enc("hello"), aad);

    await expect(aeadDecrypt(wrongKey, payload, aad)).rejects.toThrow();
  });

  it("rejects mismatched associated data", async () => {
    await sodium.ready;
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const payload = await aeadEncrypt(key, enc("hello"), enc("aad-A"));

    await expect(aeadDecrypt(key, payload, enc("aad-B"))).rejects.toThrow();
  });

  it("uses a fresh nonce each call, producing different ciphertext for the same input", async () => {
    await sodium.ready;
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const aad = enc("header");

    const first = await aeadEncrypt(key, enc("same message"), aad);
    const second = await aeadEncrypt(key, enc("same message"), aad);

    expect(first).not.toBe(second);
  });
});
