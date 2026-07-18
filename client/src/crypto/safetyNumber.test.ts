import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { computeSafetyNumber } from "./safetyNumber";

describe("computeSafetyNumber", () => {
  it("is deterministic regardless of argument order", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);

    const ab = await computeSafetyNumber(a, b);
    const ba = await computeSafetyNumber(b, a);

    expect(ab).toBe(ba);
  });

  it("formats as space-separated groups of 5 digits", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);

    const result = await computeSafetyNumber(a, b);

    expect(result).toMatch(/^(\d{5} )*\d{5}$/);
  });

  it("produces a different number for a different key pair", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const c = sodium.randombytes_buf(32);

    const ab = await computeSafetyNumber(a, b);
    const ac = await computeSafetyNumber(a, c);

    expect(ab).not.toBe(ac);
  });
});
