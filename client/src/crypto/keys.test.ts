import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { generateKeypair, deriveSessionKeys } from "./keys";

describe("keys", () => {
  it("generates a keypair with 32-byte public and private keys", async () => {
    const kp = await generateKeypair();
    expect(kp.publicKey).toHaveLength(32);
    expect(kp.privateKey).toHaveLength(32);
  });

  it("derives matching session keys for both sides of the exchange", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();

    const aliceKeys = await deriveSessionKeys(alice, bob.publicKey, "initiator");
    const bobKeys = await deriveSessionKeys(bob, alice.publicKey, "responder");

    await sodium.ready;
    expect(sodium.memcmp(aliceKeys.tx, bobKeys.rx)).toBe(true);
    expect(sodium.memcmp(aliceKeys.rx, bobKeys.tx)).toBe(true);
  });
});
