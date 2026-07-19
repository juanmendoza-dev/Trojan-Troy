import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "./encoding";

describe("encoding", () => {
  it("round-trips bytes through base64", async () => {
    await sodium.ready;
    const original = sodium.randombytes_buf(32);

    const encoded = await toBase64(original);
    const decoded = await fromBase64(encoded);

    expect(decoded).toEqual(original);
  });
});
