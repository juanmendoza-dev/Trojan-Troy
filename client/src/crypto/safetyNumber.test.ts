import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { computeSafetyNumber } from "./safetyNumber";

describe("computeSafetyNumber", () => {
  it("is deterministic regardless of argument order", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const rk = sodium.randombytes_buf(32);

    const ab = await computeSafetyNumber(a, b, rk);
    const ba = await computeSafetyNumber(b, a, rk);

    expect(ab).toBe(ba);
  });

  it("formats as space-separated groups of 5 digits", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const rk = sodium.randombytes_buf(32);

    const result = await computeSafetyNumber(a, b, rk);

    expect(result).toMatch(/^(\d{5} )*\d{5}$/);
  });

  it("produces a different number for a different key pair", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const c = sodium.randombytes_buf(32);
    const rk = sodium.randombytes_buf(32);

    const ab = await computeSafetyNumber(a, b, rk);
    const ac = await computeSafetyNumber(a, c, rk);

    expect(ab).not.toBe(ac);
  });

  it("changes when the root key changes, even for the same key pair (downgrade/MITM detector)", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const rk1 = sodium.randombytes_buf(32);
    const rk2 = sodium.randombytes_buf(32);

    const withRk1 = await computeSafetyNumber(a, b, rk1);
    const withRk2 = await computeSafetyNumber(a, b, rk2);

    expect(withRk1).not.toBe(withRk2);
  });
});
