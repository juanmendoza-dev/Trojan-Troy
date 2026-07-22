import { describe, it, expect } from "vitest";
import { frame, unframe, bucketFor, PAD_SCHEDULE, type Frame } from "./framing";

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();
const ID = "11111111-1111-1111-1111-111111111111";
const isBucket = (n: number) => (PAD_SCHEDULE as readonly number[]).includes(n) || n % 16384 === 0;

describe("framing", () => {
  it("round-trips a text frame", () => {
    const f: Frame = { channel: "text", id: ID, body: utf8.encode("hello, world") };
    const out = unframe(frame(f));
    expect(out.channel).toBe("text");
    expect(out.id).toBe(ID);
    expect(utf8d.decode(out.body)).toBe("hello, world");
    expect(out.mimeType).toBeUndefined();
    expect(out.kind).toBeUndefined();
  });

  it("round-trips a voice frame with mimeType and exact binary body", () => {
    const body = new Uint8Array(2048);
    for (let i = 0; i < body.length; i++) body[i] = (i * 7 + 3) & 0xff;
    const out = unframe(frame({ channel: "voice", id: ID, mimeType: "audio/webm", body }));
    expect(out.channel).toBe("voice");
    expect(out.mimeType).toBe("audio/webm");
    expect(out.body.length).toBe(2048);
    expect([...out.body]).toEqual([...body]);
  });

  it("round-trips an ack frame with a kind and empty body", () => {
    const out = unframe(frame({ channel: "ack", id: ID, kind: "read", body: new Uint8Array(0) }));
    expect(out.channel).toBe("ack");
    expect(out.kind).toBe("read");
    expect(out.body.length).toBe(0);
  });

  it("pads to a fixed bucket, hiding exact length", () => {
    const short = frame({ channel: "text", id: ID, body: utf8.encode("x") });
    const longer = frame({ channel: "text", id: ID, body: utf8.encode("x".repeat(80)) });
    expect(short.length).toBe(longer.length); // same bucket => indistinguishable size
    expect(isBucket(short.length)).toBe(true);
  });

  it("lands every size on a valid bucket and round-trips it", () => {
    for (const n of [0, 5, 200, 1000, 5000, 20000]) {
      const body = new Uint8Array(n);
      for (let i = 0; i < n; i++) body[i] = i & 0xff;
      const padded = frame({ channel: "voice", id: ID, mimeType: "audio/webm", body });
      expect(isBucket(padded.length)).toBe(true);
      expect(padded.length).toBeGreaterThanOrEqual(n + 4);
      expect([...unframe(padded).body]).toEqual([...body]);
    }
  });

  it("bucketFor picks the smallest bucket that fits", () => {
    expect(bucketFor(1)).toBe(64);
    expect(bucketFor(64)).toBe(64);
    expect(bucketFor(65)).toBe(256);
    expect(bucketFor(16384)).toBe(16384);
    expect(bucketFor(16385)).toBe(32768);
  });

  it("rejects a malformed frame", () => {
    expect(() => unframe(new Uint8Array([1, 2, 3]))).toThrow();
    const bad = frame({ channel: "text", id: ID, body: utf8.encode("hi") }).slice();
    new DataView(bad.buffer).setUint32(0, 0xffffff, true); // claim a huge inner length
    expect(() => unframe(bad)).toThrow();
  });
});
