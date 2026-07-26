import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it, beforeAll } from "vitest";
import { isValidPin, newSalt, deriveVaultKey, defaultKdfParams } from "./pin";
import * as pinModule from "./pin";

beforeAll(async () => {
  await sodium.ready;
});

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

describe("deriveVaultKey", () => {
  it("is deterministic for the same pin/salt/params", async () => {
    const salt = await newSalt();
    const params = await defaultKdfParams();
    const a = await deriveVaultKey("1234", salt, params);
    const b = await deriveVaultKey("1234", salt, params);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(sodium.crypto_secretbox_KEYBYTES);
  });

  it("gives a different key for a different pin", async () => {
    const salt = await newSalt();
    const params = await defaultKdfParams();
    const a = await deriveVaultKey("1234", salt, params);
    const b = await deriveVaultKey("9999", salt, params);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("gives a different key for a different salt", async () => {
    const params = await defaultKdfParams();
    const a = await deriveVaultKey("1234", await newSalt(), params);
    const b = await deriveVaultKey("1234", await newSalt(), params);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("KDF cost sanity", () => {
  it("is Argon2id at least INTERACTIVE (guards against a fast-hash regression)", async () => {
    const p = await defaultKdfParams();
    expect(p.alg).toBe(sodium.crypto_pwhash_ALG_ARGON2ID13);
    expect(p.ops).toBeGreaterThanOrEqual(sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE);
    expect(p.mem).toBeGreaterThanOrEqual(sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE);
  });

  it("exposes no fast-hash helpers (no fast-hash export remains)", () => {
    expect("hashPin" in pinModule).toBe(false);
    expect("verifyPin" in pinModule).toBe(false);
  });
});
