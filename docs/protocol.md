# The wire protocol, on one page

`PROTOCOL_VERSION 6`. Everything below rides JSON over a WebSocket relay that
understands exactly two requests — `create` and `join` — and forwards every
other frame verbatim to the peer. This page is the map; each linked spec in
[specs/](specs/) has the full detail.

## What a frame looks like

After the handshake, **every** frame — text, voice, typing indicator, read
receipt, profile share, rekey negotiation, decoy — is:

```json
{ "type": "msg", "payload": "<base64>" }
```

where the payload decodes to:

```
sealed header (84 bytes, fixed) ‖ body ciphertext (padded)
```

- The **sealed header** (XChaCha20-Poly1305) carries the protocol version, the
  key class, the sender's current ratchet public key and the chain counters —
  so the relay can't even see the conversation's *structure*.
- The **body** is AEAD-encrypted under a per-message key and padded to a fixed
  bucket: 64 / 256 / 1024 / 4096 / 16384 bytes, then multiples of 16384.
- Inside the body, a self-describing frame (`channel`, `id`, raw bytes) names
  what the message actually is. The receiver checks the channel against an
  allowlist rather than trusting the decrypted JSON.

A hostile relay learns that two peers are connected, roughly for how long, and
how many buckets crossed. Nothing else.

## Handshake → root key

Commit-then-reveal (ZRTP-style), hybrid classical + post-quantum
([spec](specs/2026-07-26-hardened-handshake-design.md),
[PQ spec](specs/2026-07-23-pq-hybrid-handshake-design.md)):

1. Each side publishes a **hash commitment** to its ephemeral keys, and reveals
   only after holding the peer's commitment — neither side (nor a MITM relay)
   can choose keys as a function of the other's.
2. The initiator reveals an X25519 key; the responder reveals X25519 **and**
   an ML-KEM-768 public key; the initiator encapsulates and returns the KEM
   ciphertext.
3. Both sides derive the root key from the X25519 secrets, the ML-KEM secret,
   **and a canonical transcript hash** (version, both public keys, KEM key and
   ciphertext). Tamper with any framing byte and the session fails closed.
4. The 60-digit **safety number** is derived from the resulting session, not
   just the relayed public keys — a key swap or downgrade changes the digits.

There is no classical fallback: strip the post-quantum material and the
handshake aborts.

## Messaging — Double Ratchet with post-quantum healing

([ratchet spec](specs/2026-07-22-phase5.2-forward-secrecy-ratchet-design.md),
[PQ ratchet + sealed headers](specs/2026-07-28-pq-ratchet-header-encryption-design.md))

- Standard Double Ratchet: a fresh key per message, discarded after use;
  DH ratchet steps on every reply direction change.
- **In-band PQ rekeying:** the initiator periodically offers a fresh single-use
  ML-KEM key (`pqoffer`); the responder encapsulates and answers (`pqaccept`);
  both sides queue the shared secret and **fold it into the root chain** at the
  next ratchet step. The offers ride as ordinary ratcheted content, padded like
  everything else — a rekey is not visible on the wire.
- Decryption is **transactional**: it runs on a clone of the ratchet state and
  commits only on success, so a forged, replayed or corrupted frame can never
  desync the live session. Skipped-message keys are bounded and single-use.

## Static channels

Presence heartbeats, delivery/read receipts and profile shares are frequent
and tiny, so they use per-direction static keys instead of the ratchet — but
as of v6 those keys are **bound to the hybrid root key**
([spec](specs/2026-07-28-v6-static-channel-pq-binding-design.md)), so they
inherit the same post-quantum and transcript guarantees. Each direction keeps
a replay window, and a frame's body must authenticate before its replay
counter is consumed.

## Cover traffic

A jittered ~1/second stream of decoy frames, byte-indistinguishable from real
content (same header shape, same buckets), flows whenever the session is
quiet, and the presence heartbeat is jittered too
([spec](specs/2026-07-23-traffic-analysis-resistance-design.md)). Real
messages always send immediately — the decoys add zero latency.

## What the relay runs

A ~400-line Node + `ws` server: room codes, two sockets per room, payload
cap, rate limiting, connection caps, heartbeat reaping. It has no database,
stores nothing, and never sees a key. Its entire content-handling logic is
"forward the blob."
