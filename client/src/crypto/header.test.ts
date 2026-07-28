import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import {
  packHeader,
  unpackHeader,
  sealHeader,
  openHeader,
  staticHeader,
  HEADER_LEN,
  SEALED_HEADER_LEN,
  type Header,
  type KeyClass,
} from "./header";

const rand = (n = 32) => sodium.randombytes_buf(n);
const hex = (b: Uint8Array) => sodium.to_hex(b);

function content(overrides: Partial<Header> = {}): Header {
  return { cls: 0, fold: 0, pn: 0, n: 0, dh: rand(32), ...overrides };
}

describe("header", () => {
  it("round-trips a content header through pack/unpack", async () => {
    await sodium.ready;
    const h = content({ fold: 7, pn: 12, n: 345 });
    const back = unpackHeader(packHeader(h));
    expect(back.cls).toBe(0);
    expect(back.fold).toBe(7);
    expect(back.pn).toBe(12);
    expect(back.n).toBe(345);
    expect(hex(back.dh)).toBe(hex(h.dh));
  });

  it("round-trips every static class with a send counter", async () => {
    await sodium.ready;
    for (const cls of [1, 2, 3] as KeyClass[]) {
      const back = unpackHeader(packHeader(staticHeader(cls, 41)));
      expect(back.cls).toBe(cls);
      expect(back.n).toBe(41);
      expect(back.pn).toBe(0);
      expect(back.fold).toBe(0);
      expect(hex(back.dh)).toBe(hex(new Uint8Array(32)));
    }
  });

  it("is exactly 44 bytes packed and 84 sealed, for every class", async () => {
    await sodium.ready;
    const hk = rand();
    expect(packHeader(content()).length).toBe(HEADER_LEN);
    expect((await sealHeader(hk, content({ fold: 65535, pn: 4000, n: 999999 }))).length).toBe(
      SEALED_HEADER_LEN
    );
    for (const cls of [1, 2, 3] as KeyClass[]) {
      expect((await sealHeader(hk, staticHeader(cls, 12345))).length).toBe(SEALED_HEADER_LEN);
    }
  });

  it("holds the full counter ranges it claims", async () => {
    await sodium.ready;
    // fold is u16, pn/n are u32 — a long-lived session must not silently wrap.
    const h = content({ fold: 65535, pn: 4294967295, n: 4294967295 });
    const back = unpackHeader(packHeader(h));
    expect(back.fold).toBe(65535);
    expect(back.pn).toBe(4294967295);
    expect(back.n).toBe(4294967295);
  });

  it("seals and opens under the right header key", async () => {
    await sodium.ready;
    const hk = rand();
    const h = content({ fold: 3, n: 9 });
    const opened = await openHeader(hk, await sealHeader(hk, h));
    expect(opened).not.toBeNull();
    expect(opened!.fold).toBe(3);
    expect(opened!.n).toBe(9);
    expect(hex(opened!.dh)).toBe(hex(h.dh));
  });

  it("returns null (never throws) under a wrong header key", async () => {
    await sodium.ready;
    const sealed = await sealHeader(rand(), content());
    expect(await openHeader(rand(), sealed)).toBeNull();
  });

  it("returns null for a wrong-length blob", async () => {
    await sodium.ready;
    const hk = rand();
    expect(await openHeader(hk, new Uint8Array(SEALED_HEADER_LEN - 1))).toBeNull();
    expect(await openHeader(hk, new Uint8Array(SEALED_HEADER_LEN + 1))).toBeNull();
  });

  it("fails the tag when any byte is flipped", async () => {
    await sodium.ready;
    const hk = rand();
    const sealed = await sealHeader(hk, content({ n: 5 }));
    for (const i of [0, 12, 30, 43, SEALED_HEADER_LEN - 1]) {
      const tampered = sealed.slice();
      tampered[i] ^= 0x01;
      expect(await openHeader(hk, tampered)).toBeNull();
    }
  });

  it("hides the class — two classes seal to indistinguishable sizes", async () => {
    await sodium.ready;
    const hk = rand();
    const a = await sealHeader(hk, content());
    const b = await sealHeader(hk, staticHeader(2, 1));
    expect(a.length).toBe(b.length);
    expect(hex(a)).not.toBe(hex(b));
  });

  it("re-sealing the same header gives a different blob (fresh nonce)", async () => {
    await sodium.ready;
    const hk = rand();
    const h = content({ n: 4 });
    expect(hex(await sealHeader(hk, h))).not.toBe(hex(await sealHeader(hk, h)));
  });

  it("rejects a bad length, an unknown class, and a wrong version on unpack", async () => {
    await sodium.ready;
    expect(() => unpackHeader(new Uint8Array(HEADER_LEN - 1))).toThrow();
    const badClass = packHeader(content());
    badClass[0] = 9;
    expect(() => unpackHeader(badClass)).toThrow(/key class/);
    const badVersion = packHeader(content());
    badVersion[1] = 4;
    expect(() => unpackHeader(badVersion)).toThrow(/version/);
  });

  it("rejects a dh that is not 32 bytes", async () => {
    await sodium.ready;
    expect(() => packHeader({ cls: 0, fold: 0, pn: 0, n: 0, dh: rand(31) })).toThrow(/32 bytes/);
  });
});
