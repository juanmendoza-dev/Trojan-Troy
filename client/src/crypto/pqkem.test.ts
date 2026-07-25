import { describe, it, expect } from "vitest";
import { generateKemKeypair, kemEncapsulate, kemDecapsulate } from "./pqkem";

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("pqkem (ML-KEM-768)", () => {
  it("encapsulation and decapsulation agree on the shared secret", () => {
    const { publicKey, secretKey } = generateKemKeypair();
    const { cipherText, sharedSecret } = kemEncapsulate(publicKey);
    const recovered = kemDecapsulate(cipherText, secretKey);
    expect(same(recovered, sharedSecret)).toBe(true);
    expect(sharedSecret.length).toBe(32);
  });

  it("uses the ML-KEM-768 byte sizes", () => {
    const { publicKey, secretKey } = generateKemKeypair();
    const { cipherText } = kemEncapsulate(publicKey);
    expect(publicKey.length).toBe(1184);
    expect(secretKey.length).toBe(2400);
    expect(cipherText.length).toBe(1088);
  });

  it("produces a fresh ciphertext and secret each encapsulation", () => {
    const { publicKey } = generateKemKeypair();
    const one = kemEncapsulate(publicKey);
    const two = kemEncapsulate(publicKey);
    expect(same(one.cipherText, two.cipherText)).toBe(false);
    expect(same(one.sharedSecret, two.sharedSecret)).toBe(false);
  });

  it("implicit rejection: a tampered ciphertext yields a different secret, not a throw", () => {
    const { publicKey, secretKey } = generateKemKeypair();
    const { cipherText, sharedSecret } = kemEncapsulate(publicKey);
    const tampered = cipherText.slice();
    tampered[0] ^= 0xff;

    let recovered: Uint8Array | undefined;
    expect(() => {
      recovered = kemDecapsulate(tampered, secretKey);
    }).not.toThrow();
    expect(recovered).toBeDefined();
    expect(same(recovered as Uint8Array, sharedSecret)).toBe(false);
  });
});
