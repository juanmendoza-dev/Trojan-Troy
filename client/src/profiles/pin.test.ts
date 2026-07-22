import { describe, expect, it } from "vitest";
import { isValidPin, newSalt, hashPin, verifyPin } from "./pin";

describe("isValidPin", () => {
  it("accepts exactly 4 digits", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("0000")).toBe(true);
  });
  it("rejects wrong length or non-digits", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
    expect(isValidPin("12 4")).toBe(false);
  });
});

describe("hashPin / verifyPin", () => {
  it("verifies a matching pin against its salted hash", async () => {
    const salt = await newSalt();
    const hash = await hashPin("1234", salt);
    expect(await verifyPin("1234", salt, hash)).toBe(true);
  });
  it("rejects a wrong pin", async () => {
    const salt = await newSalt();
    const hash = await hashPin("1234", salt);
    expect(await verifyPin("9999", salt, hash)).toBe(false);
  });
  it("produces different hashes for the same pin under different salts", async () => {
    const s1 = await newSalt();
    const s2 = await newSalt();
    expect(await hashPin("1234", s1)).not.toBe(await hashPin("1234", s2));
  });
});
