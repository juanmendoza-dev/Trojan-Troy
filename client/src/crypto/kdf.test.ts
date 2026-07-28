import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import {
  deriveRootKey,
  kdfRoot,
  kdfChain,
  deriveChannelSubkey,
  deriveHeaderKeys,
  deriveHeaderSubkey,
} from "./kdf";

const rand = (n = 32) => sodium.randombytes_buf(n);
const same = (a: Uint8Array, b: Uint8Array) => sodium.to_hex(a) === sodium.to_hex(b);

describe("kdf", () => {
  it("deriveRootKey is order-invariant (initiator and responder agree)", async () => {
    await sodium.ready;
    const k1 = rand();
    const k2 = rand();
    const pq = rand();
    const tr = rand();
    const initiator = await deriveRootKey(k1, k2, pq, tr); // rx=k1, tx=k2
    const responder = await deriveRootKey(k2, k1, pq, tr); // rx=k2, tx=k1
    expect(same(initiator, responder)).toBe(true);
    expect(initiator.length).toBe(32);
  });

  it("deriveRootKey depends on the classical key material", async () => {
    await sodium.ready;
    const k1 = rand();
    const k2 = rand();
    const k3 = rand();
    const pq = rand();
    const tr = rand();
    expect(same(await deriveRootKey(k1, k2, pq, tr), await deriveRootKey(k1, k3, pq, tr))).toBe(false);
  });

  it("deriveRootKey depends on the post-quantum secret (a downgrade changes the root)", async () => {
    await sodium.ready;
    const k1 = rand();
    const k2 = rand();
    const pq1 = rand();
    const pq2 = rand();
    const tr = rand();
    expect(same(await deriveRootKey(k1, k2, pq1, tr), await deriveRootKey(k1, k2, pq2, tr))).toBe(false);
  });

  it("deriveRootKey binds the transcript (a framing tamper changes the root)", async () => {
    await sodium.ready;
    const k1 = rand();
    const k2 = rand();
    const pq = rand();
    const tr1 = rand();
    const tr2 = rand();
    expect(same(await deriveRootKey(k1, k2, pq, tr1), await deriveRootKey(k1, k2, pq, tr2))).toBe(false);
  });

  it("kdfRoot is deterministic and separates rk, ck and nhk", async () => {
    await sodium.ready;
    const rk = rand();
    const dh = rand();
    const one = await kdfRoot(rk, dh);
    const two = await kdfRoot(rk, dh);
    expect(same(one.rk, two.rk)).toBe(true);
    expect(same(one.ck, two.ck)).toBe(true);
    expect(same(one.nhk, two.nhk)).toBe(true);
    expect(same(one.rk, one.ck)).toBe(false);
    expect(same(one.rk, one.nhk)).toBe(false);
    expect(same(one.ck, one.nhk)).toBe(false);
    expect(one.rk.length).toBe(32);
    expect(one.ck.length).toBe(32);
    expect(one.nhk.length).toBe(32);
  });

  it("kdfRoot folds a post-quantum secret into the root chain", async () => {
    await sodium.ready;
    const rk = rand();
    const dh = rand();
    const plain = await kdfRoot(rk, dh);
    const folded = await kdfRoot(rk, dh, rand());
    expect(same(plain.rk, folded.rk)).toBe(false);
    expect(same(plain.ck, folded.ck)).toBe(false);
    expect(same(plain.nhk, folded.nhk)).toBe(false);
  });

  it("kdfRoot with a different post-quantum secret gives a different root", async () => {
    await sodium.ready;
    const rk = rand();
    const dh = rand();
    expect(same((await kdfRoot(rk, dh, rand())).rk, (await kdfRoot(rk, dh, rand())).rk)).toBe(false);
  });

  it("kdfRoot without a pqSecret matches the no-PQ vector exactly (one code path)", async () => {
    await sodium.ready;
    const rk = rand();
    const dh = rand();
    const omitted = await kdfRoot(rk, dh);
    const explicitUndefined = await kdfRoot(rk, dh, undefined);
    expect(same(omitted.rk, explicitUndefined.rk)).toBe(true);
    expect(same(omitted.nhk, explicitUndefined.nhk)).toBe(true);
    // An empty pqSecret must NOT be treated as "no secret" — that would let a
    // peer force a fold-shaped step that the other side computes as unfolded.
    expect(same(omitted.rk, (await kdfRoot(rk, dh, new Uint8Array(0))).rk)).toBe(false);
  });

  it("deriveHeaderKeys gives two distinct 32-byte seeds, deterministically", async () => {
    await sodium.ready;
    const rk0 = rand();
    const a = await deriveHeaderKeys(rk0);
    const b = await deriveHeaderKeys(rk0);
    expect(same(a.i2r, b.i2r)).toBe(true);
    expect(same(a.r2i, b.r2i)).toBe(true);
    expect(same(a.i2r, a.r2i)).toBe(false);
    expect(a.i2r.length).toBe(32);
    expect(a.r2i.length).toBe(32);
    // A different root key gives entirely different header keys.
    expect(same(a.i2r, (await deriveHeaderKeys(rand())).i2r)).toBe(false);
  });

  it("deriveHeaderSubkey is class- and direction-separated", async () => {
    await sodium.ready;
    const tx = rand();
    const rx = rand();
    expect(same(await deriveHeaderSubkey(tx, 1), await deriveHeaderSubkey(tx, 2))).toBe(false);
    expect(same(await deriveHeaderSubkey(tx, 1), await deriveHeaderSubkey(rx, 1))).toBe(false);
    // A header subkey must not collide with the body subkey for the same channel.
    expect(same(await deriveHeaderSubkey(tx, 1), await deriveChannelSubkey(tx, "presence"))).toBe(
      false
    );
    expect((await deriveHeaderSubkey(tx, 3)).length).toBe(32);
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
