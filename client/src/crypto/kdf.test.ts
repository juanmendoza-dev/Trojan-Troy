import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { deriveRootKey, kdfRoot, kdfChain, deriveChannelSubkey } from "./kdf";

const rand = (n = 32) => sodium.randombytes_buf(n);
const same = (a: Uint8Array, b: Uint8Array) => sodium.to_hex(a) === sodium.to_hex(b);

describe("kdf", () => {
  it("deriveRootKey is order-invariant (initiator and responder agree)", async () => {
    await sodium.ready;
    const k1 = rand();
    const k2 = rand();
    const initiator = await deriveRootKey(k1, k2); // rx=k1, tx=k2
    const responder = await deriveRootKey(k2, k1); // rx=k2, tx=k1
    expect(same(initiator, responder)).toBe(true);
    expect(initiator.length).toBe(32);
  });

  it("deriveRootKey depends on the key material", async () => {
    await sodium.ready;
    const k1 = rand();
    const k2 = rand();
    const k3 = rand();
    expect(same(await deriveRootKey(k1, k2), await deriveRootKey(k1, k3))).toBe(false);
  });

  it("kdfRoot is deterministic and separates rk from ck", async () => {
    await sodium.ready;
    const rk = rand();
    const dh = rand();
    const one = await kdfRoot(rk, dh);
    const two = await kdfRoot(rk, dh);
    expect(same(one.rk, two.rk)).toBe(true);
    expect(same(one.ck, two.ck)).toBe(true);
    expect(same(one.rk, one.ck)).toBe(false);
    expect(one.rk.length).toBe(32);
    expect(one.ck.length).toBe(32);
  });

  it("kdfRoot output changes with the DH input", async () => {
    await sodium.ready;
    const rk = rand();
    const a = await kdfRoot(rk, rand());
    const b = await kdfRoot(rk, rand());
    expect(same(a.rk, b.rk)).toBe(false);
  });

  it("kdfChain advances and derives a distinct message key", async () => {
    await sodium.ready;
    const ck = rand();
    const { ck: next, mk } = await kdfChain(ck);
    expect(same(next, ck)).toBe(false);
    expect(same(mk, ck)).toBe(false);
    expect(same(mk, next)).toBe(false);
    const again = await kdfChain(ck);
    expect(same(again.mk, mk)).toBe(true);
    expect(same(again.ck, next)).toBe(true);
  });

  it("deriveChannelSubkey is domain- and direction-separated", async () => {
    await sodium.ready;
    const tx = rand();
    const rx = rand();
    expect(same(await deriveChannelSubkey(tx, "text"), await deriveChannelSubkey(tx, "voice"))).toBe(
      false
    );
    expect(
      same(await deriveChannelSubkey(tx, "presence"), await deriveChannelSubkey(rx, "presence"))
    ).toBe(false);
    expect((await deriveChannelSubkey(tx, "ack")).length).toBe(32);
  });
});
