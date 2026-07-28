import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair, deriveSessionKeys } from "../crypto/keys";
import { generateKemKeypair, kemEncapsulate, kemDecapsulate } from "../crypto/pqkem";
import { frame } from "../crypto/framing";
import { computeTranscriptHash } from "../crypto/transcript";
import { sealHeader, staticHeader, SEALED_HEADER_LEN } from "../crypto/header";
import { toBase64, fromBase64 } from "../crypto/encoding";
import type { Envelope } from "../net/relayClient";
import { initSession, sealContent, sealStatic, openMsg, type SessionCrypto } from "./ratchetSession";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

type Msg = Extract<Envelope, { type: "msg" }>;
function asMsg(env: Envelope): Msg {
  if (env.type !== "msg") throw new Error("expected a msg envelope");
  return env;
}

// Pair two sessions the way App.tsx does: a real crypto_kx handshake plus a real
// ML-KEM-768 exchange (the responder holds the KEM keypair; the initiator
// encapsulates to it), then the initiator seeds against the responder's handshake
// pubkey while the responder reuses his handshake keypair as his initial ratchet
// key. Both sides feed the same PQ secret into the hybrid root key.
async function pair(): Promise<{ a: SessionCrypto; b: SessionCrypto }> {
  const alice = await generateKeypair();
  const bob = await generateKeypair();
  const aliceKeys = await deriveSessionKeys(alice, bob.publicKey, "initiator");
  const bobKeys = await deriveSessionKeys(bob, alice.publicKey, "responder");
  const bobKem = generateKemKeypair();
  const { cipherText, sharedSecret: pqAlice } = kemEncapsulate(bobKem.publicKey);
  const pqBob = kemDecapsulate(cipherText, bobKem.secretKey);
  const transcript = await computeTranscriptHash(
    alice.publicKey,
    bob.publicKey,
    bobKem.publicKey,
    cipherText,
    5
  );
  const a = await initSession(aliceKeys, "initiator", alice, bob.publicKey, pqAlice, transcript);
  const b = await initSession(bobKeys, "responder", bob, alice.publicKey, pqBob, transcript);
  return { a, b };
}

describe("ratchetSession", () => {
  it("derives an identical hybrid root key on both sides", async () => {
    const { a, b } = await pair();
    expect(a.rootKey.length).toBe(32);
    expect(Array.from(a.rootKey)).toEqual(Array.from(b.rootKey));
  });

  it("binds the transcript: a per-side transcript mismatch makes the root keys diverge", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();
    const aliceKeys = await deriveSessionKeys(alice, bob.publicKey, "initiator");
    const bobKeys = await deriveSessionKeys(bob, alice.publicKey, "responder");
    const bobKem = generateKemKeypair();
    const { cipherText, sharedSecret: pqAlice } = kemEncapsulate(bobKem.publicKey);
    const pqBob = kemDecapsulate(cipherText, bobKem.secretKey);
    // Alice binds the true transcript; Bob's was tampered (version downgraded to
    // 4), as a relay stripping the v5 framing would produce. They must not agree.
    const trA = await computeTranscriptHash(alice.publicKey, bob.publicKey, bobKem.publicKey, cipherText, 5);
    const trB = await computeTranscriptHash(alice.publicKey, bob.publicKey, bobKem.publicKey, cipherText, 4);
    const a = await initSession(aliceKeys, "initiator", alice, bob.publicKey, pqAlice, trA);
    const b = await initSession(bobKeys, "responder", bob, alice.publicKey, pqBob, trB);
    expect(Array.from(a.rootKey)).not.toEqual(Array.from(b.rootKey));
  });

  it("round-trips a content message and a reply", async () => {
    const { a, b } = await pair();

    const env = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("hello") })));
    const f1 = await openMsg(b, env);
    expect(f1.channel).toBe("text");
    expect(f1.id).toBe("m1");
    expect(dec(f1.body)).toBe("hello");

    // Bob has a sending chain now that he's received, so the reply round-trips.
    const reply = await sealContent(b, frame({ channel: "text", id: "m2", body: enc("hi back") }));
    const f2 = await openMsg(a, reply);
    expect(dec(f2.body)).toBe("hi back");
  });

  it("round-trips a voice frame with a raw binary body and mimeType", async () => {
    const { a, b } = await pair();
    const body = new Uint8Array([0, 1, 2, 128, 250, 255]);

    const env = await sealContent(a, frame({ channel: "voice", id: "v1", mimeType: "audio/webm", body }));
    const f = await openMsg(b, env);

    expect(f.channel).toBe("voice");
    expect(f.mimeType).toBe("audio/webm");
    expect(Array.from(f.body)).toEqual(Array.from(body));
  });

  it("round-trips each static channel", async () => {
    const { a, b } = await pair();

    const presence = await sealStatic(
      a,
      "presence",
      frame({ channel: "presence", id: "p1", body: enc('{"state":"typing"}') })
    );
    expect((await openMsg(b, presence)).channel).toBe("presence");

    const ack = await sealStatic(
      a,
      "ack",
      frame({ channel: "ack", id: "m1", kind: "read", body: new Uint8Array() })
    );
    const ackFrame = await openMsg(b, ack);
    expect(ackFrame.channel).toBe("ack");
    expect(ackFrame.kind).toBe("read");
    expect(ackFrame.id).toBe("m1");

    const profile = await sealStatic(
      a,
      "profile",
      frame({ channel: "profile", id: "c1", body: enc('{"name":"Jay"}') })
    );
    expect((await openMsg(b, profile)).channel).toBe("profile");
  });

  it("round-trips the post-quantum rekey channels as ordinary content", async () => {
    const { a, b } = await pair();
    const kem = generateKemKeypair();
    const body = new Uint8Array(2 + kem.publicKey.length);
    new DataView(body.buffer).setUint16(0, 7, true);
    body.set(kem.publicKey, 2);

    const env = await sealContent(a, frame({ channel: "pqoffer", id: "", body }));
    const f = await openMsg(b, env);
    expect(f.channel).toBe("pqoffer");
    expect(new DataView(f.body.buffer, f.body.byteOffset).getUint16(0, true)).toBe(7);
    expect(Array.from(f.body.subarray(2))).toEqual(Array.from(kem.publicKey));
  });

  describe("wire opacity (v5)", () => {
    it("puts nothing but type and payload on the envelope", async () => {
      const { a } = await pair();
      const content = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("hi") })));
      const presence = asMsg(
        await sealStatic(a, "presence", frame({ channel: "presence", id: "p1", body: enc("x") }))
      );
      // No cleartext class selector, no cleartext ratchet header — the relay sees
      // one opaque field and nothing else.
      expect(Object.keys(content).sort()).toEqual(["payload", "type"]);
      expect(Object.keys(presence).sort()).toEqual(["payload", "type"]);
      expect("c" in content).toBe(false);
      expect("header" in content).toBe(false);
    });

    it("makes content and static frames structurally identical", async () => {
      const { a } = await pair();
      const content = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("hi") })));
      const presence = asMsg(
        await sealStatic(a, "presence", frame({ channel: "presence", id: "m1", body: enc("hi") }))
      );
      const cBlob = await fromBase64(content.payload);
      const pBlob = await fromBase64(presence.payload);
      // Same fixed-size sealed header on both, and both bodies pad to the same
      // bucket — so class isn't inferable from shape.
      expect(cBlob.length).toBe(pBlob.length);
      expect(sodium.to_hex(cBlob.subarray(0, SEALED_HEADER_LEN))).not.toBe(
        sodium.to_hex(pBlob.subarray(0, SEALED_HEADER_LEN))
      );
    });
  });

  describe("class binding and replay", () => {
    it("drops a static frame whose header class does not match its body key", async () => {
      const { a, b } = await pair();
      const env = asMsg(
        await sealStatic(a, "presence", frame({ channel: "presence", id: "p1", body: enc("x") }))
      );
      // Re-seal the header as the ack class under the ack header key, keeping the
      // presence-sealed body: the header now opens on the ack key, so only the
      // body's own subkey stops it.
      const blob = await fromBase64(env.payload);
      const forgedHeader = await sealHeader(a.txHdr.ack, staticHeader(2, 0));
      const forged = new Uint8Array(blob.length);
      forged.set(forgedHeader, 0);
      forged.set(blob.subarray(SEALED_HEADER_LEN), SEALED_HEADER_LEN);
      await expect(openMsg(b, { type: "msg", payload: await toBase64(forged) })).rejects.toThrow();
    });

    it("drops a content blob that no key can open", async () => {
      const { a, b } = await pair();
      const env = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("secret") })));
      // Reflect it back at the sender: none of Alice's own receive candidates —
      // ratchet or static — can open her own outgoing frame.
      await expect(openMsg(a, env)).rejects.toThrow(/no key opened/);
      // Bob, the real recipient, still opens it.
      expect(dec((await openMsg(b, env)).body)).toBe("secret");
    });

    it("drops a replayed static frame", async () => {
      const { a, b } = await pair();
      const env = await sealStatic(
        a,
        "presence",
        frame({ channel: "presence", id: "p1", body: enc('{"state":"typing"}') })
      );
      expect((await openMsg(b, env)).channel).toBe("presence");
      // The same captured frame a second time is a replay, not a new heartbeat.
      await expect(openMsg(b, env)).rejects.toThrow(/replayed|stale/);
      // A genuine follow-up still works.
      const next = await sealStatic(
        a,
        "presence",
        frame({ channel: "presence", id: "p2", body: enc('{"state":"idle"}') })
      );
      expect((await openMsg(b, next)).channel).toBe("presence");
    });

    it("accepts static frames arriving out of order, but only once each", async () => {
      const { a, b } = await pair();
      const one = await sealStatic(a, "ack", frame({ channel: "ack", id: "m1", kind: "delivered", body: new Uint8Array() }));
      const two = await sealStatic(a, "ack", frame({ channel: "ack", id: "m2", kind: "delivered", body: new Uint8Array() }));
      const three = await sealStatic(a, "ack", frame({ channel: "ack", id: "m3", kind: "read", body: new Uint8Array() }));
      expect((await openMsg(b, three)).id).toBe("m3"); // newest first
      expect((await openMsg(b, one)).id).toBe("m1"); // older, still inside the window
      expect((await openMsg(b, two)).id).toBe("m2");
      await expect(openMsg(b, one)).rejects.toThrow(); // but not twice
    });

    it("keeps each static channel's counter independent", async () => {
      const { a, b } = await pair();
      // Both channels start at counter 0; a shared window would reject the second.
      const presence = await sealStatic(a, "presence", frame({ channel: "presence", id: "p", body: enc("x") }));
      const ack = await sealStatic(a, "ack", frame({ channel: "ack", id: "m", kind: "read", body: new Uint8Array() }));
      expect((await openMsg(b, presence)).channel).toBe("presence");
      expect((await openMsg(b, ack)).channel).toBe("ack");
    });
  });

  it("throws on a corrupt payload without corrupting the live session", async () => {
    const { a, b } = await pair();
    const env = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("hello") })));

    // Flip a byte in the body (past the sealed header) so the header still opens
    // and only the body tag fails.
    const blob = await fromBase64(env.payload);
    const corruptBlob = blob.slice();
    corruptBlob[corruptBlob.length - 1] ^= 0x01;
    const corrupt: Envelope = { type: "msg", payload: await toBase64(corruptBlob) };
    await expect(openMsg(b, corrupt)).rejects.toThrow();

    // The real message still opens — ratchetDecrypt only commits on success.
    expect(dec((await openMsg(b, env)).body)).toBe("hello");
  });

  it("rejects a msg with no room for a sealed header", async () => {
    const { b } = await pair();
    const tooShort = await toBase64(new Uint8Array(SEALED_HEADER_LEN));
    await expect(openMsg(b, { type: "msg", payload: tooShort })).rejects.toThrow(/too short/);
  });
});
