import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";
import { sealProfileSecrets, openProfileSecrets } from "./vault";

beforeAll(async () => {
  await sodium.ready;
});

const key = () => sodium.crypto_secretbox_keygen();

describe("vault seal/open", () => {
  it("round-trips the avatar", async () => {
    const k = key();
    const cipher = await sealProfileSecrets(k, { avatar: "data:image/jpeg;base64,abc" });
    expect(await openProfileSecrets(k, cipher)).toEqual({ avatar: "data:image/jpeg;base64,abc" });
  });

  it("verifies a null-avatar profile via the magic sentinel", async () => {
    const k = key();
    const cipher = await sealProfileSecrets(k, { avatar: null });
    expect(await openProfileSecrets(k, cipher)).toEqual({ avatar: null });
  });

  it("returns null for the wrong key", async () => {
    const cipher = await sealProfileSecrets(key(), { avatar: "x" });
    expect(await openProfileSecrets(key(), cipher)).toBeNull();
  });

  it("returns null for tampered ciphertext", async () => {
    const k = key();
    const cipher = await sealProfileSecrets(k, { avatar: "x" });
    const bytes = sodium.from_base64(cipher, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff; // flip a byte → auth-tag failure
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
    expect(await openProfileSecrets(k, tampered)).toBeNull();
  });

  it("returns null for a non-base64 blob", async () => {
    expect(await openProfileSecrets(key(), "not valid base64 !!!")).toBeNull();
  });
});
