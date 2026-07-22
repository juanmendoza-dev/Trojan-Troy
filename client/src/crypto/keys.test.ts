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
    const aliceId = await generateKeypair();
    const bobId = await generateKeypair();
    const aliceEph = await generateKeypair();
    const bobEph = await generateKeypair();

    const aliceKeys = await deriveSessionKeys(
      aliceId,
      bobId.publicKey,
      aliceEph,
      bobEph.publicKey,
      "initiator"
    );
    const bobKeys = await deriveSessionKeys(
      bobId,
      aliceId.publicKey,
      bobEph,
      aliceEph.publicKey,
      "responder"
    );

    await sodium.ready;
    expect(sodium.memcmp(aliceKeys.tx, bobKeys.rx)).toBe(true);
    expect(sodium.memcmp(aliceKeys.rx, bobKeys.tx)).toBe(true);
  });

  it("binds the key to the ephemeral exchange: same identities, different ephemerals => different keys", async () => {
    const aliceId = await generateKeypair();
    const bobId = await generateKeypair();

    const eph1a = await generateKeypair();
    const eph1b = await generateKeypair();
    const eph2a = await generateKeypair();
    const eph2b = await generateKeypair();

    const s1 = await deriveSessionKeys(aliceId, bobId.publicKey, eph1a, eph1b.publicKey, "initiator");
    const s2 = await deriveSessionKeys(aliceId, bobId.publicKey, eph2a, eph2b.publicKey, "initiator");

    await sodium.ready;
    expect(sodium.memcmp(s1.tx, s2.tx)).toBe(false);
  });
});
