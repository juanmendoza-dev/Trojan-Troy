// Inner-payload framing + size-bucket padding. Pure and synchronous (no
// libsodium needed). Layout before encryption:
//
//   padded = uint32LE(len(inner)) || inner || zero-pad to a bucket
//   inner  = uint16LE(len(metaJSON)) || metaJSON || body
//
// `meta` carries the routing that used to live in the cleartext envelope
// (channel, id, voice mimeType, ack kind) — now sealed. `body` stays raw
// bytes (no base64) so voice clips don't inflate. Padding to a bucket hides
// the exact length from the relay.

// "primer" is a hidden bootstrap message the initiator sends so the responder
// gains a sending chain (see the Double Ratchet init); it renders nothing.
export type Channel = "text" | "voice" | "presence" | "ack" | "profile" | "primer";

export interface Frame {
  channel: Channel;
  id: string;
  mimeType?: string;
  kind?: "delivered" | "read";
  body: Uint8Array;
}

export const PAD_SCHEDULE = [64, 256, 1024, 4096, 16384] as const;
const PAD_STEP = 16384;

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

export function bucketFor(n: number): number {
  for (const b of PAD_SCHEDULE) {
    if (n <= b) return b;
  }
  return Math.ceil(n / PAD_STEP) * PAD_STEP;
}

export function frame(f: Frame): Uint8Array {
  const meta: Record<string, unknown> = { v: 2, ch: f.channel, id: f.id };
  if (f.mimeType) meta.mt = f.mimeType;
  if (f.kind) meta.k = f.kind;
  const metaBytes = utf8.encode(JSON.stringify(meta));
  if (metaBytes.length > 0xffff) throw new Error("frame metadata too large");

  const inner = new Uint8Array(2 + metaBytes.length + f.body.length);
  new DataView(inner.buffer).setUint16(0, metaBytes.length, true);
  inner.set(metaBytes, 2);
  inner.set(f.body, 2 + metaBytes.length);

  const bucket = bucketFor(inner.length + 4);
  const padded = new Uint8Array(bucket);
  new DataView(padded.buffer).setUint32(0, inner.length, true);
  padded.set(inner, 4);
  return padded;
}

export function unframe(bytes: Uint8Array): Frame {
  if (bytes.length < 6) throw new Error("frame too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const innerLen = view.getUint32(0, true);
  if (innerLen < 2 || 4 + innerLen > bytes.length) throw new Error("bad frame length");

  const inner = bytes.subarray(4, 4 + innerLen);
  const metaLen = new DataView(inner.buffer, inner.byteOffset, inner.byteLength).getUint16(0, true);
  if (2 + metaLen > inner.length) throw new Error("bad meta length");

  const meta = JSON.parse(utf8d.decode(inner.subarray(2, 2 + metaLen)));
  const body = inner.subarray(2 + metaLen);
  return {
    channel: meta.ch,
    id: meta.id,
    mimeType: meta.mt,
    kind: meta.k,
    body: body.slice(),
  };
}
