import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { deriveVaultKey, generateSalt, sealVault, openVault } from "./atRest";

describe("atRest", () => {
  it("derives the same key for the same passphrase + salt", async () => {
    await sodium.ready;
    const salt = await generateSalt();
    const a = await deriveVaultKey("correct horse", salt);
    const b = await deriveVaultKey("correct horse", salt);
    expect(sodium.memcmp(a, b)).toBe(true);
  });

  it("derives a different key for a different salt", async () => {
    await sodium.ready;
    const a = await deriveVaultKey("correct horse", await generateSalt());
    const b = await deriveVaultKey("correct horse", await generateSalt());
    expect(sodium.memcmp(a, b)).toBe(false);
  });

  it("round-trips seal -> open", async () => {
    const key = await deriveVaultKey("pw", await generateSalt());
    const plaintext = new TextEncoder().encode("secret contacts blob");
    const sealed = await sealVault(plaintext, key);
    const opened = await openVault(sealed, key);
    expect(new TextDecoder().decode(opened)).toBe("secret contacts blob");
  });

  it("throws when opened with the wrong key", async () => {
    const key = await deriveVaultKey("pw", await generateSalt());
    const wrong = await deriveVaultKey("nope", await generateSalt());
    const sealed = await sealVault(new TextEncoder().encode("x"), key);
    await expect(openVault(sealed, wrong)).rejects.toThrow();
  });

  it("rejects a tampered ciphertext", async () => {
    const key = await deriveVaultKey("pw", await generateSalt());
    const sealed = await sealVault(new TextEncoder().encode("hello"), key);
    sealed.ciphertext[0] ^= 0xff;
    await expect(openVault(sealed, key)).rejects.toThrow();
  });
});
