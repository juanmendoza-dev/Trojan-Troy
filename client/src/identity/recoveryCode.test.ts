import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encodeRecoveryCode, decodeRecoveryCode } from "./recoveryCode";
import { generateKeypair } from "../crypto/keys";

describe("recoveryCode", () => {
  it("round-trips secret key + display name (plaintext)", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay");
    const decoded = await decodeRecoveryCode(code);
    await sodium.ready;
    expect(sodium.memcmp(decoded.secretKey, kp.privateKey)).toBe(true);
    expect(decoded.displayName).toBe("Jay");
  });

  it("groups into blocks of at most 5 characters", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay");
    for (const block of code.split(" ")) expect(block.length).toBeLessThanOrEqual(5);
  });

  it("round-trips with a passphrase", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Río", "hunter2");
    const decoded = await decodeRecoveryCode(code, "hunter2");
    await sodium.ready;
    expect(sodium.memcmp(decoded.secretKey, kp.privateKey)).toBe(true);
    expect(decoded.displayName).toBe("Río");
  });

  it("rejects a passphrase-protected code opened without the passphrase", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay", "pw");
    await expect(decodeRecoveryCode(code)).rejects.toThrow();
  });

  it("rejects the wrong passphrase", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay", "pw");
    await expect(decodeRecoveryCode(code, "nope")).rejects.toThrow();
  });

  it("rejects malformed input", async () => {
    await expect(decodeRecoveryCode("!!!! not base64 @@@@")).rejects.toThrow();
  });
});
