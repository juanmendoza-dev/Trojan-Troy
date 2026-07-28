import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { deriveRootKey, deriveHeaderKeys } from "./kdf";
import { sealHeader, staticHeader, SEALED_HEADER_LEN } from "./header";
import {
  initAlice,
  initBob,
  ratchetEncrypt,
  ratchetDecrypt,
  queuePqSecret,
  isPqFoldPending,
  MAX_SKIP,
  MAX_TRIAL_CHAINS,
  type RatchetState,
} from "./ratchet";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

// Build a paired Alice/Bob ratchet the way App.tsx does: a real crypto_kx
// handshake -> shared RK0; Bob's handshake keypair is his initial ratchet key;
// both header-key seeds come from RK0.
async function setup(): Promise<{ alice: RatchetState; bob: RatchetState }> {
  await sodium.ready;
  const a = sodium.crypto_kx_keypair();
  const b = sodium.crypto_kx_keypair();
  const aKeys = sodium.crypto_kx_client_session_keys(a.publicKey, a.privateKey, b.publicKey);
  const bKeys = sodium.crypto_kx_server_session_keys(b.publicKey, b.privateKey, a.publicKey);
  // Shared ML-KEM secret stand-in — both sides derive the same value from the KEM.
  const pq = sodium.randombytes_buf(32);
  // Shared transcript-hash stand-in — canonical, so both sides match.
  const tr = sodium.randombytes_buf(32);
  const rk0a = await deriveRootKey(aKeys.sharedRx, aKeys.sharedTx, pq, tr);
  const rk0b = await deriveRootKey(bKeys.sharedRx, bKeys.sharedTx, pq, tr);
  const hA = await deriveHeaderKeys(rk0a);
  const hB = await deriveHeaderKeys(rk0b);
  const alice = await initAlice(rk0a, b.publicKey, hA.i2r, hA.r2i);
  const bob = await initBob(
    rk0b,
    { publicKey: b.publicKey, privateKey: b.privateKey },
    hB.i2r,
    hB.r2i
  );
  return { alice, bob };
}

async function pass(from: RatchetState, to: RatchetState, text: string): Promise<string> {
  const { encHeader, payload } = await ratchetEncrypt(from, enc(text));
  const out = await ratchetDecrypt(to, encHeader, payload);
  if (!out) throw new Error("no candidate header key opened the message");
  return dec(out);
}

// Both sides of a completed pqoffer/pqaccept exchange end up holding the same
// secret under the same offer id.
function agreePqSecret(alice: RatchetState, bob: RatchetState, offerId: number): void {
  const secret = sodium.randombytes_buf(32);
  queuePqSecret(alice, offerId, secret.slice());
  queuePqSecret(bob, offerId, secret.slice());
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
    expect(dec((await ratchetDecrypt(bob, m0.encHeader, m0.payload))!)).toBe("m0");
    expect(dec((await ratchetDecrypt(bob, m2.encHeader, m2.payload))!)).toBe("m2"); // skips m1
    expect(dec((await ratchetDecrypt(bob, m1.encHeader, m1.payload))!)).toBe("m1"); // stored key
  });

  it("handles out-of-order delivery across a DH ratchet step (pn skip)", async () => {
    const { alice, bob } = await setup();
    const a0 = await ratchetEncrypt(alice, enc("a0"));
    const a1 = await ratchetEncrypt(alice, enc("a1")); // delayed
    expect(dec((await ratchetDecrypt(bob, a0.encHeader, a0.payload))!)).toBe("a0");
    const b0 = await ratchetEncrypt(bob, enc("b0"));
    expect(dec((await ratchetDecrypt(alice, b0.encHeader, b0.payload))!)).toBe("b0"); // Alice ratchets
    const a2 = await ratchetEncrypt(alice, enc("a2")); // new chain, pn=2
    expect(dec((await ratchetDecrypt(bob, a2.encHeader, a2.payload))!)).toBe("a2"); // Bob ratchets
    // The straggler's header can only be opened via the header key stored
    // alongside its skipped message key — its chain has already been retired.
    expect(dec((await ratchetDecrypt(bob, a1.encHeader, a1.payload))!)).toBe("a1");
  });

  it("drops a replayed message and keeps the session usable", async () => {
    const { alice, bob } = await setup();
    const m = await ratchetEncrypt(alice, enc("once"));
    expect(dec((await ratchetDecrypt(bob, m.encHeader, m.payload))!)).toBe("once");
    await expect(ratchetDecrypt(bob, m.encHeader, m.payload)).rejects.toThrow();
    expect(await pass(alice, bob, "after")).toBe("after"); // state not corrupted
  });

  it("refuses to skip more than MAX_SKIP keys in one chain", async () => {
    const { alice, bob } = await setup();
    let last = await ratchetEncrypt(alice, enc("m0"));
    for (let i = 1; i < MAX_SKIP + 2; i++) last = await ratchetEncrypt(alice, enc(`m${i}`));
    await expect(ratchetDecrypt(bob, last.encHeader, last.payload)).rejects.toThrow(
      /too many skipped/
    );
  });

  it("produces a different ciphertext (fresh key) for each message", async () => {
    const { alice } = await setup();
    const one = await ratchetEncrypt(alice, enc("dup"));
    const two = await ratchetEncrypt(alice, enc("dup"));
    expect(one.payload).not.toBe(two.payload);
    expect(sodium.to_hex(one.encHeader)).not.toBe(sodium.to_hex(two.encHeader));
  });

  describe("header encryption (B)", () => {
    it("seals a fixed-size header on every message", async () => {
      const { alice, bob } = await setup();
      const a = await ratchetEncrypt(alice, enc("short"));
      const b = await ratchetEncrypt(alice, enc("a considerably longer message body"));
      expect(a.encHeader.length).toBe(SEALED_HEADER_LEN);
      expect(b.encHeader.length).toBe(SEALED_HEADER_LEN);
      expect(dec((await ratchetDecrypt(bob, a.encHeader, a.payload))!)).toBe("short");
    });

    it("returns null when no candidate header key opens the blob", async () => {
      const { alice, bob } = await setup();
      const m = await ratchetEncrypt(alice, enc("hi"));
      const tampered = m.encHeader.slice();
      tampered[30] ^= 0x01;
      expect(await ratchetDecrypt(bob, tampered, m.payload)).toBeNull();
      // The real message still opens afterwards — no state was touched.
      expect(dec((await ratchetDecrypt(bob, m.encHeader, m.payload))!)).toBe("hi");
    });

    it("rejects a tampered body without corrupting state", async () => {
      const { alice, bob } = await setup();
      const m = await ratchetEncrypt(alice, enc("hi"));
      const flipped = sodium.from_base64(m.payload, sodium.base64_variants.ORIGINAL);
      flipped[flipped.length - 1] ^= 0x01;
      const badPayload = sodium.to_base64(flipped, sodium.base64_variants.ORIGINAL);
      await expect(ratchetDecrypt(bob, m.encHeader, badPayload)).rejects.toThrow();
      expect(dec((await ratchetDecrypt(bob, m.encHeader, m.payload))!)).toBe("hi");
    });

    it("does not open a reflected copy of your own message", async () => {
      const { alice, bob } = await setup();
      const m = await ratchetEncrypt(alice, enc("mine"));
      // Sealed under Alice's own sending header key, which is not among her
      // receive candidates — so it doesn't even open, let alone decrypt.
      expect(await ratchetDecrypt(alice, m.encHeader, m.payload)).toBeNull();
      expect(await pass(alice, bob, "still here")).toBe("still here");
    });

    it("rejects a static-class header smuggled onto the ratchet path", async () => {
      const { alice, bob } = await setup();
      const m = await ratchetEncrypt(alice, enc("hi"));
      // Seal a presence-class header under Alice's real sending header key: it
      // opens on Bob's side, so only the class check stops it.
      const smuggled = await sealHeader(alice.HKs!, staticHeader(1, 0));
      await expect(ratchetDecrypt(bob, smuggled, m.payload)).rejects.toThrow(/static class/);
    });

    it("bounds trial decryption to the most recent chains", async () => {
      const { alice, bob } = await setup();
      const stragglers: Array<{ encHeader: Uint8Array; payload: string }> = [];
      // Leave one undelivered message behind in each of many successive chains,
      // so each chain contributes a stored header key. Receiving the next chain's
      // first message (pn=2) is what commits the previous chain's skipped key.
      for (let i = 0; i < MAX_TRIAL_CHAINS + 4; i++) {
        const arrives = await ratchetEncrypt(alice, enc(`a${i}`));
        stragglers.push(await ratchetEncrypt(alice, enc(`d${i}`)));
        expect(dec((await ratchetDecrypt(bob, arrives.encHeader, arrives.payload))!)).toBe(`a${i}`);
        expect(await pass(bob, alice, `b${i}`)).toBe(`b${i}`); // both sides flip
      }
      // A recent chain's straggler still opens...
      const recent = stragglers[stragglers.length - 2];
      expect(dec((await ratchetDecrypt(bob, recent.encHeader, recent.payload))!)).toBe(
        `d${stragglers.length - 2}`
      );
      // ...while the oldest is past the cap: dropped, not crashed.
      expect(await ratchetDecrypt(bob, stragglers[0].encHeader, stragglers[0].payload)).toBeNull();
      expect(await pass(alice, bob, "session alive")).toBe("session alive");
    });
  });

  describe("post-quantum ratchet (A)", () => {
    it("folds an agreed secret and stays in sync across many flips", async () => {
      const { alice, bob } = await setup();
      expect(await pass(alice, bob, "before")).toBe("before");
      agreePqSecret(alice, bob, 1);
      // Whoever flips first folds it; the other mirrors it from the header.
      for (let i = 0; i < 6; i++) {
        expect(await pass(bob, alice, `b${i}`)).toBe(`b${i}`);
        expect(await pass(alice, bob, `a${i}`)).toBe(`a${i}`);
      }
      expect(alice.pqFold).toBe(1);
      expect(bob.pqFold).toBe(1);
      expect(alice.pqPending).toHaveLength(0);
      expect(bob.pqPending).toHaveLength(0);
    });

    it("keeps folding across several successive offers", async () => {
      const { alice, bob } = await setup();
      for (let offer = 1; offer <= 3; offer++) {
        agreePqSecret(alice, bob, offer);
        for (let i = 0; i < 4; i++) {
          expect(await pass(alice, bob, `a${offer}-${i}`)).toBe(`a${offer}-${i}`);
          expect(await pass(bob, alice, `b${offer}-${i}`)).toBe(`b${offer}-${i}`);
        }
      }
      expect(alice.pqFold).toBe(3);
      expect(bob.pqFold).toBe(3);
    });

    it("actually changes the root chain — a one-sided fold diverges the session", async () => {
      const { alice, bob } = await setup();
      expect(await pass(alice, bob, "before")).toBe("before");
      // Only Alice has the secret: she folds it on her next send step, and Bob
      // cannot reproduce the resulting root key. If the fold were cosmetic, this
      // conversation would carry on working.
      queuePqSecret(alice, 1, sodium.randombytes_buf(32));
      expect(await pass(bob, alice, "b0")).toBe("b0"); // Alice flips, folds
      const a1 = await ratchetEncrypt(alice, enc("a1"));
      await expect(ratchetDecrypt(bob, a1.encHeader, a1.payload)).rejects.toSatisfy(isPqFoldPending);
    });

    it("buffers rather than fails when the accept has not arrived yet", async () => {
      const { alice, bob } = await setup();
      expect(await pass(alice, bob, "before")).toBe("before");
      const secret = sodium.randombytes_buf(32);
      queuePqSecret(alice, 1, secret.slice());
      expect(await pass(bob, alice, "b0")).toBe("b0"); // Alice folds on her send step
      const a1 = await ratchetEncrypt(alice, enc("a1"));
      // Bob's accept is in flight: the message is retryable, not corrupt.
      await expect(ratchetDecrypt(bob, a1.encHeader, a1.payload)).rejects.toSatisfy(isPqFoldPending);
      // The secret lands, and the same message now opens — Bob's state survived
      // the failed attempt intact.
      queuePqSecret(bob, 1, secret.slice());
      expect(dec((await ratchetDecrypt(bob, a1.encHeader, a1.payload))!)).toBe("a1");
      expect(bob.pqFold).toBe(1);
      expect(await pass(bob, alice, "back")).toBe("back");
    });

    it("does not consume a pending secret on a failed decrypt", async () => {
      const { alice, bob } = await setup();
      expect(await pass(alice, bob, "before")).toBe("before");
      agreePqSecret(alice, bob, 1);
      expect(await pass(bob, alice, "b0")).toBe("b0"); // Alice folds
      const a1 = await ratchetEncrypt(alice, enc("a1"));
      const flipped = sodium.from_base64(a1.payload, sodium.base64_variants.ORIGINAL);
      flipped[flipped.length - 1] ^= 0x01;
      await expect(
        ratchetDecrypt(bob, a1.encHeader, sodium.to_base64(flipped, sodium.base64_variants.ORIGINAL))
      ).rejects.toThrow();
      expect(bob.pqPending).toHaveLength(1); // still queued, not eaten by the trial
      expect(dec((await ratchetDecrypt(bob, a1.encHeader, a1.payload))!)).toBe("a1");
      expect(bob.pqPending).toHaveLength(0);
    });
  });
});
