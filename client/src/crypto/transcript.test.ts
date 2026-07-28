import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { computeHandshakeCommit, computeTranscriptHash } from "./transcript";

const rand = (n: number) => sodium.randombytes_buf(n);
const same = (a: Uint8Array, b: Uint8Array) => sodium.to_hex(a) === sodium.to_hex(b);

describe("computeHandshakeCommit", () => {
  it("is deterministic and 32 bytes for the same key", async () => {
    await sodium.ready;
    const pub = rand(32);
    expect(same(await computeHandshakeCommit(pub), await computeHandshakeCommit(pub))).toBe(true);
    expect((await computeHandshakeCommit(pub)).length).toBe(32);
  });

  it("changes with the public key", async () => {
    await sodium.ready;
    expect(same(await computeHandshakeCommit(rand(32)), await computeHandshakeCommit(rand(32)))).toBe(
      false
    );
  });

  it("binds the KEM key (present vs absent, and a different KEM, all differ)", async () => {
    await sodium.ready;
    const pub = rand(32);
    const kem1 = rand(1184);
    const kem2 = rand(1184);
    expect(same(await computeHandshakeCommit(pub), await computeHandshakeCommit(pub, kem1))).toBe(
      false
    );
    expect(
      same(await computeHandshakeCommit(pub, kem1), await computeHandshakeCommit(pub, kem2))
    ).toBe(false);
    // null is treated the same as an omitted KEM (the initiator's case).
    expect(same(await computeHandshakeCommit(pub), await computeHandshakeCommit(pub, null))).toBe(
      true
    );
  });
});

describe("computeTranscriptHash", () => {
  it("is order-invariant over the two X25519 keys (both sides agree)", async () => {
    await sodium.ready;
    const a = rand(32);
    const b = rand(32);
    const kemPub = rand(1184);
    const kemCt = rand(1088);
    const one = await computeTranscriptHash(a, b, kemPub, kemCt, 4);
    const two = await computeTranscriptHash(b, a, kemPub, kemCt, 4);
    expect(same(one, two)).toBe(true);
    expect(one.length).toBe(32);
  });

  it("changes with version, KEM public key, and KEM ciphertext", async () => {
    await sodium.ready;
    const a = rand(32);
    const b = rand(32);
    const kemPub = rand(1184);
    const kemCt = rand(1088);
    const base = await computeTranscriptHash(a, b, kemPub, kemCt, 4);
    expect(same(base, await computeTranscriptHash(a, b, kemPub, kemCt, 3))).toBe(false);
    expect(same(base, await computeTranscriptHash(a, b, rand(1184), kemCt, 4))).toBe(false);
    expect(same(base, await computeTranscriptHash(a, b, kemPub, rand(1088), 4))).toBe(false);
  });
});
