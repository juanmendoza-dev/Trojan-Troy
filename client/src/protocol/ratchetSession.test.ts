import { describe, it, expect } from "vitest";
import { generateKeypair, deriveSessionKeys } from "../crypto/keys";
import { frame } from "../crypto/framing";
import type { Envelope } from "../net/relayClient";
import { initSession, sealContent, sealStatic, openMsg, type SessionCrypto } from "./ratchetSession";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

type Msg = Extract<Envelope, { type: "msg" }>;
function asMsg(env: Envelope): Msg {
  if (env.type !== "msg") throw new Error("expected a msg envelope");
  return env;
}

// Pair two sessions the way App.tsx will: a real crypto_kx handshake, then the
// initiator seeds against the responder's handshake pubkey while the responder
// reuses his handshake keypair as his initial ratchet key.
async function pair(): Promise<{ a: SessionCrypto; b: SessionCrypto }> {
  const alice = await generateKeypair();
  const bob = await generateKeypair();
  const aliceKeys = await deriveSessionKeys(alice, bob.publicKey, "initiator");
  const bobKeys = await deriveSessionKeys(bob, alice.publicKey, "responder");
  const a = await initSession(aliceKeys, "initiator", alice, bob.publicKey);
  const b = await initSession(bobKeys, "responder", bob, alice.publicKey);
  return { a, b };
}

describe("ratchetSession", () => {
  it("round-trips a content message and a reply", async () => {
    const { a, b } = await pair();

    const env = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("hello") })));
    expect(env.c).toBe(0);
    expect(env.header).toBeDefined();

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

  it("round-trips each static channel under its own class", async () => {
    const { a, b } = await pair();

    const presence = asMsg(
      await sealStatic(a, "presence", frame({ channel: "presence", id: "p1", body: enc('{"state":"typing"}') }))
    );
    expect(presence.c).toBe(1);
    expect(presence.header).toBeUndefined();
    expect((await openMsg(b, presence)).channel).toBe("presence");

    const ack = asMsg(
      await sealStatic(a, "ack", frame({ channel: "ack", id: "m1", kind: "read", body: new Uint8Array() }))
    );
    expect(ack.c).toBe(2);
    const ackFrame = await openMsg(b, ack);
    expect(ackFrame.channel).toBe("ack");
    expect(ackFrame.kind).toBe("read");
    expect(ackFrame.id).toBe("m1");

    const profile = asMsg(
      await sealStatic(a, "profile", frame({ channel: "profile", id: "c1", body: enc('{"name":"Jay"}') }))
    );
    expect(profile.c).toBe(3);
    expect((await openMsg(b, profile)).channel).toBe("profile");
  });

  it("drops a content message relabeled as a static class", async () => {
    const { a, b } = await pair();
    const env = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("secret") })));

    const relabeled: Envelope = { type: "msg", c: 1, payload: env.payload };
    await expect(openMsg(b, relabeled)).rejects.toThrow();
  });

  it("drops a presence message relabeled as another static class (wrong subkey)", async () => {
    const { a, b } = await pair();
    const env = asMsg(
      await sealStatic(a, "presence", frame({ channel: "presence", id: "p1", body: enc("x") }))
    );

    const relabeled: Envelope = { type: "msg", c: 2, payload: env.payload };
    await expect(openMsg(b, relabeled)).rejects.toThrow();
  });

  it("throws on a corrupt payload without corrupting the live session", async () => {
    const { a, b } = await pair();
    const env = asMsg(await sealContent(a, frame({ channel: "text", id: "m1", body: enc("hello") })));

    // Flip one base64 char in the middle: same length + charset, broken tag.
    const chars = env.payload.split("");
    const i = Math.floor(chars.length / 2);
    chars[i] = chars[i] === "A" ? "B" : "A";
    const corrupt: Envelope = { type: "msg", c: 0, header: env.header, payload: chars.join("") };
    await expect(openMsg(b, corrupt)).rejects.toThrow();

    // The real message still opens — ratchetDecrypt only commits on success.
    expect(dec((await openMsg(b, env)).body)).toBe("hello");
  });
});
