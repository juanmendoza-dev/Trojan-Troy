import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encryptVoiceClip, decryptVoiceClip } from "./media";

describe("media", () => {
  it("round-trips a Blob through encrypt and decrypt, preserving mime type", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const original = new Blob([new Uint8Array([1, 2, 3, 4, 5])], {
      type: "audio/webm;codecs=opus",
    });

    const encrypted = await encryptVoiceClip(key, original);
    const decrypted = await decryptVoiceClip(key, encrypted, "audio/webm;codecs=opus");

    expect(decrypted.type).toBe("audio/webm;codecs=opus");
    const decryptedBytes = new Uint8Array(await decrypted.arrayBuffer());
    expect(decryptedBytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("rejects a tampered payload", async () => {
    await sodium.ready;
    const key = sodium.crypto_secretbox_keygen();
    const original = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const encrypted = await encryptVoiceClip(key, original);

    const bytes = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);

    await expect(decryptVoiceClip(key, tampered, "audio/webm")).rejects.toThrow();
  });
});
