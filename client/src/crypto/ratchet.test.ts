import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { deriveRootKey } from "./kdf";
import {
  initAlice,
  initBob,
  ratchetEncrypt,
  ratchetDecrypt,
  MAX_SKIP,
  type RatchetState,
} from "./ratchet";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

// Build a paired Alice/Bob ratchet the way App.tsx will: a real crypto_kx
// handshake -> shared RK0; Bob's handshake keypair is his initial ratchet key.
async function setup(): Promise<{ alice: RatchetState; bob: RatchetState }> {
  await sodium.ready;
  const a = sodium.crypto_kx_keypair();
  const b = sodium.crypto_kx_keypair();
  const aKeys = sodium.crypto_kx_client_session_keys(a.publicKey, a.privateKey, b.publicKey);
  const bKeys = sodium.crypto_kx_server_session_keys(b.publicKey, b.privateKey, a.publicKey);
  const rk0a = await deriveRootKey(aKeys.sharedRx, aKeys.sharedTx);
  const rk0b = await deriveRootKey(bKeys.sharedRx, bKeys.sharedTx);
  const alice = await initAlice(rk0a, b.publicKey);
  const bob = await initBob(rk0b, { publicKey: b.publicKey, privateKey: b.privateKey });
  return { alice, bob };
}

async function pass(from: RatchetState, to: RatchetState, text: string): Promise<string> {
  const { header, payload } = await ratchetEncrypt(from, enc(text));
  return dec(await ratchetDecrypt(to, header, payload));
}

describe("ratchet", () => {
  it("delivers the first message and replies in order", async () => {
    const { alice, bob } = await setup();
    expect(await pass(alice, bob, "a1")).toBe("a1");
    expect(await pass(bob, alice, "b1")).toBe("b1");
    expect(await pass(alice, bob, "a2")).toBe("a2");
    expect(await pass(bob, alice, "b2")).toBe("b2");
  });

  it("stays in sync over a long alternating conversation (many DH steps)", async () => {
    const { alice, bob } = await setup();
    for (let i = 0; i < 20; i++) {
      expect(await pass(alice, bob, `a${i}`)).toBe(`a${i}`);
      expect(await pass(bob, alice, `b${i}`)).toBe(`b${i}`);
    }
  });

  it("handles out-of-order delivery within a chain via skipped keys", async () => {
    const { alice, bob } = await setup();
    const m0 = await ratchetEncrypt(alice, enc("m0"));
    const m1 = await ratchetEncrypt(alice, enc("m1"));
    const m2 = await ratchetEncrypt(alice, enc("m2"));
    expect(dec(await ratchetDecrypt(bob, m0.header, m0.payload))).toBe("m0");
    expect(dec(await ratchetDecrypt(bob, m2.header, m2.payload))).toBe("m2"); // skips m1
    expect(dec(await ratchetDecrypt(bob, m1.header, m1.payload))).toBe("m1"); // stored key
  });

  it("handles out-of-order delivery across a DH ratchet step (pn skip)", async () => {
    const { alice, bob } = await setup();
    const a0 = await ratchetEncrypt(alice, enc("a0"));
    const a1 = await ratchetEncrypt(alice, enc("a1")); // delayed
    expect(dec(await ratchetDecrypt(bob, a0.header, a0.payload))).toBe("a0");
    const b0 = await ratchetEncrypt(bob, enc("b0"));
    expect(dec(await ratchetDecrypt(alice, b0.header, b0.payload))).toBe("b0"); // Alice ratchets
    const a2 = await ratchetEncrypt(alice, enc("a2")); // new chain, pn=2
    expect(dec(await ratchetDecrypt(bob, a2.header, a2.payload))).toBe("a2"); // Bob ratchets, skips a1
    expect(dec(await ratchetDecrypt(bob, a1.header, a1.payload))).toBe("a1"); // delayed old-chain msg
  });

  it("drops a replayed message and keeps the session usable", async () => {
    const { alice, bob } = await setup();
    const m = await ratchetEncrypt(alice, enc("once"));
    expect(dec(await ratchetDecrypt(bob, m.header, m.payload))).toBe("once");
    await expect(ratchetDecrypt(bob, m.header, m.payload)).rejects.toThrow();
    expect(await pass(alice, bob, "after")).toBe("after"); // state not corrupted
  });

  it("refuses to skip more than MAX_SKIP keys in one chain", async () => {
    const { alice, bob } = await setup();
    let last = await ratchetEncrypt(alice, enc("m0"));
    for (let i = 1; i < MAX_SKIP + 2; i++) last = await ratchetEncrypt(alice, enc(`m${i}`));
    await expect(ratchetDecrypt(bob, last.header, last.payload)).rejects.toThrow(
      /too many skipped/
    );
  });

  it("rejects a header-tampered message without corrupting state", async () => {
    const { alice, bob } = await setup();
    const m = await ratchetEncrypt(alice, enc("hi"));
    const tampered = { ...m.header, n: m.header.n + 5 };
    await expect(ratchetDecrypt(bob, tampered, m.payload)).rejects.toThrow();
    expect(dec(await ratchetDecrypt(bob, m.header, m.payload))).toBe("hi"); // still works
  });

  it("does not open a reflected copy of your own message", async () => {
    const { alice, bob } = await setup();
    const m = await ratchetEncrypt(alice, enc("mine"));
    await expect(ratchetDecrypt(alice, m.header, m.payload)).rejects.toThrow();
    // Alice can still talk to Bob afterwards.
    expect(await pass(alice, bob, "still here")).toBe("still here");
  });

  it("produces a different ciphertext (fresh key) for each message", async () => {
    const { alice } = await setup();
    const one = await ratchetEncrypt(alice, enc("dup"));
    const two = await ratchetEncrypt(alice, enc("dup"));
    expect(one.payload).not.toBe(two.payload);
    expect(one.header.n).not.toBe(two.header.n);
  });
});
