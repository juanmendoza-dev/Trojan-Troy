# PQ Double Ratchet + Header Encryption (round-2 A+B): Design Spec

Status: Draft (designed 2026-07-28; awaiting Jay's approval to build)
Round-2 features **A** (post-quantum Double Ratchet) and **B** (ratchet header
encryption), co-designed as **one wire revision** — `PROTOCOL_VERSION` 4 → 5.
Sits on top of `feat/crypto-round-integration` (PR #15), not `main`.

## Purpose

Two gaps left by everything shipped so far:

**A — the ongoing ratchet is still classical.** The hybrid handshake (①) made the
*initial* key agreement post-quantum: `RK₀` folds an ML-KEM-768 secret, so a
recorded session can't be opened later by a quantum adversary. But every
subsequent ratchet step is `crypto_scalarmult` (X25519) only. So post-compromise
healing — the ratchet's promise that a stolen key stops working — is **classical**:
an adversary who breaks X25519 later can follow the DH ratchet forward from a
compromise. The about/security copy is honest about this today ("protects the key
agreement", never "fully post-quantum"). A closes it: fold fresh ML-KEM secrets
into the root chain *continuously*, so healing is quantum-safe too.

**B — the ratchet header is cleartext.** Every `msg` currently carries
`header: { dh, pn, n }` and a cleartext class selector `c` in the clear. The relay
therefore reads: each sender's current ratchet public key, how many messages were
in each chain (`pn`), the position within the current chain (`n`), and which of the
four key classes a frame belongs to. That is a precise map of the conversation's
structure — who spoke in what bursts, how many messages each burst held, and which
frames are presence vs receipts vs content — even though it can't read a word.
③'s cover traffic hides the *rhythm* of sending; it does nothing about this,
because the counters are printed on the envelope. B seals the header so the relay
sees one uniform opaque blob per message and nothing else.

## The tension between A and B, and how it's resolved

These two features fight each other, and that fight determines the whole design:

- **B wants the header to be a fixed size.** Any size variation is a signal, and a
  header that is sometimes-small/sometimes-large hands back much of what B set out
  to hide.
- **A wants to ship ML-KEM material on ratchet steps.** ML-KEM-768 is a public key
  of 1184 bytes and a ciphertext of 1088. The obvious design — put the KEM material
  in the ratchet header on every chain flip — makes the header vary by ~2.3 KB.

Worse, "every chain flip" is far more often than it sounds. A DH ratchet step
happens whenever a side sends after receiving, and with ③'s cover traffic both
sides send roughly once a second, *forever*. So chain flips are ~1/sec per side,
and per-flip KEM material would mean ~3 KB of extra payload per message per side —
while also making flip-vs-non-flip trivially visible by size.

**Resolution: take the PQ material out of the header entirely.**

ML-KEM public keys and ciphertexts ride *inside* ordinary padded, ratcheted content
frames, on two new sealed channels — exactly where ③'s size buckets already hide
them. The header carries only a 2-byte fold counter saying *which* PQ secret is
already mixed into the root key. The header therefore stays **fixed at 84 bytes,
always** — no variation, ever — and the KEM blobs are just more content, padded
into the same buckets as text and cover.

This is what makes A+B one spec rather than two: designed separately, they'd
undercut each other. Designed together, B gets perfect header uniformity *because*
A's bulk was moved into the content path, and A gets its bandwidth hidden *because*
③ is already padding that path.

### Why riding inside the ratchet doesn't weaken the PQ guarantee

The KEM offer/accept frames are protected by the current, classically-chained
ratchet. So a quantum adversary who records everything and later breaks X25519 can
read those frames. That's fine, and it's worth being precise about why: the frames
contain an ML-KEM **public key** (public by construction) and a **ciphertext**.
Recovering the shared secret from those requires breaking ML-KEM itself — the
ML-KEM secret key never leaves the device and is zeroized after decapsulation.
So the folded secret stays safe, and the root chain past that fold is
post-quantum even though the frame that carried the ciphertext was not.

## Relationship to the other round-2 specs

- **D (hardened handshake, built)** — already binds the transcript and the epoch-0
  KEM secret into `RK₀`. A extends exactly that idea forward in time; this spec
  reuses `crypto/pqkem.ts` and the `deriveRootKey` domain style unchanged.
- **③ (cover traffic, built)** — a hard dependency of this design, not just a
  neighbour: it is what hides the KEM frames' size and cadence. One change is owed
  back to it (see *Cover-traffic interaction*).
- **E (periodic rekey, not yet specced)** — **A substantially overlaps E.** Once the
  root chain is being re-seeded with fresh ML-KEM secrets every 30 s, "periodic
  rekey" reduces to re-running the *classical* handshake for a fresh ephemeral
  X25519 identity and a fresh transcript/safety number. Recommend re-scoping E
  after A+B lands rather than building it as originally sketched.

## Hard constraints (carried)

- **No custom primitives.** ML-KEM-768 via `@noble/post-quantum` (already a
  dependency), XChaCha20-Poly1305 + BLAKE2b via libsodium-sumo. The only new
  construction is *composition* — keyed BLAKE2b combiners and an extra AEAD layer,
  both of which the codebase already does.
- **Relay stays architecturally blind.** No server change. `msg` remains an opaque
  pass-through; this spec makes it *more* opaque (it loses two cleartext fields).
- **UX identical.** No new screens, no new latency on a real send, no user-visible
  state. The PQ rekey is invisible; header encryption is invisible.
- **Backend-only.** Nothing in `screens/` or `components/` changes except honest
  about/security copy.

## Invariants preserved (must not regress)

1. **Zero added latency on a real send** (③'s filter) — PQ offers are scheduled on
   their own timer and never block a user message.
2. **Byte-indistinguishability of cover vs real content** (③'s hard constraint) —
   including the new KEM frames, which is why `coverBodyLen` must be extended.
3. **Joiner can send first** — the primer path is untouched.
4. **Transactional decrypt** — a tampered/replayed/undecryptable frame never
   corrupts the live session. This gets *more* important: header trial-decryption
   must not mutate state before a body decrypt succeeds.
5. **Fail closed** — a v5 client refuses a v4 peer (existing version check), and a
   frame whose header opens under no candidate key is dropped, never guessed at.
6. **Zeroize on leave** — extended to header keys, next-header keys, per-epoch KEM
   secret keys, and pending PQ secrets.

## Design

### Wire format (v5)

The `msg` envelope loses both cleartext fields:

```ts
// v4 (today)
| { type: "msg"; c: 0 | 1 | 2 | 3; header?: RatchetHeader; payload: string }
// v5
| { type: "msg"; payload: string }
```

`payload` = base64( `encHeader` ‖ `bodyCiphertext` ), where `encHeader` is exactly
84 bytes. Everything the receiver needs to route and decrypt is inside it.

### Header plaintext (44 bytes, fixed)

| offset | size | field | meaning |
|---|---|---|---|
| 0 | 1 | `cls` | 0 content, 1 presence, 2 ack, 3 profile |
| 1 | 1 | `ver` | 5 — belt-and-braces inside the sealed header |
| 2 | 2 | `fold` | u16LE — PQ folds already mixed into the root key |
| 4 | 4 | `pn` | u32LE — messages in the sender's previous chain |
| 8 | 4 | `n` | u32LE — position in the sender's current chain |
| 12 | 32 | `dh` | sender's current ratchet public key |

Static classes (1–3) are not ratcheted: they set `pn = 0`, `dh = 32 zero bytes`,
`fold = 0`, and use `n` as a **monotonic send counter** (see *Static-channel
replay*). The struct is fixed-size regardless, so nothing leaks from the shape.

Encrypted with XChaCha20-Poly1305 under a header key: 24 (nonce) + 44 + 16 (tag)
= **84 bytes**, constant for every message on the wire, forever.

The body is encrypted with the message key as today, but with `encHeader` (all 84
bytes) as the **AAD** — replacing v4's `aadFor(header)` string. This binds header
to body: swapping a header between two messages breaks the body tag.

### Header keys (B)

`kdfRoot` currently emits 64 bytes → `(rk, ck)`. It becomes 96 bytes →
`(rk, ck, nhk)`, where `nhk` is the *next header key* for the chain that call
created. State gains Signal's four:

- `HKs` / `HKr` — header keys for the current sending / receiving chain
- `NHKs` / `NHKr` — the next ones, known one chain early

Seeding: `deriveHeaderKeys(rk0)` → four domain-separated keys
(`TTr:hdr:i2r:v5`, `TTr:hdr:r2i:v5`, `TTr:nhdr:i2r:v5`, `TTr:nhdr:r2i:v5`).
The initiator takes `HKs = i2r`, `HKr = r2i`, `NHKs = nhdr:i2r`,
`NHKr = nhdr:r2i`; the responder mirrors.

On a DH ratchet: the recv step sets `HKr = NHKr` then `NHKr = nhk` from that
`kdfRoot`; the send step sets `HKs = NHKs` then `NHKs = nhk` from its `kdfRoot`.

**Receiving is trial decryption.** The receiver doesn't know a frame's class or
chain until it opens the header, so it tries candidates in this order and stops at
the first that authenticates:

1. `HKr` — current receiving chain (the common case)
2. `NHKr` — a new chain → the sender flipped → do a DH ratchet
3. the header keys stored with skipped message keys (bounded, see below)
4. the three static header keys, `deriveHeaderSubkey(rxDir, cls)`

~13 XChaCha attempts on 60 bytes in the worst case; microseconds, and the common
case hits on the first. A frame that opens under none is dropped.

**Skipped keys.** `MKSKIPPED` today maps `${dh}:${n} → mk`. With sealed headers, a
straggler from an older chain can no longer have its header opened by `HKr`/`NHKr`,
so each entry stores the header key that chain used: `${dh}:${n} → { hk, mk }`.
Candidate list 3 above is the distinct `hk`s among stored entries, **capped at the
8 most recent chains** so trial cost stays bounded. Out-of-order tolerance is
therefore preserved for the realistic window and explicitly bounded beyond it —
today's `MAX_SKIP` (100) / `MAX_SKIPPED_TOTAL` (1000) limits are unchanged.

### PQ re-seeding (A)

**Only the initiator offers.** A single offerer means one monotonic counter, no
id-collision case, and no ambiguity about the order two pending secrets fold in.
Both directions still get the benefit — the secret is folded into the *shared* root
chain, which drives both sending and receiving chains. The responder is the
accepter, mirroring the role split the handshake already uses.

Two new sealed channels in `crypto/framing.ts`, both riding the normal ratcheted
`cls = 0` content path (so they are padded, bucketed, and cover-indistinguishable),
both decrypted-then-dropped by the UI like `primer` and `cover`:

- **`pqoffer`** — body = `offerId` (u16LE) ‖ ML-KEM public key (1184 B)
- **`pqaccept`** — body = `offerId` (u16LE) ‖ ML-KEM ciphertext (1088 B)

Flow:

1. Every `PQ_REKEY_INTERVAL_MS` (**30 000**, ±30 % jitter) *or* after
   `PQ_REKEY_MESSAGES` (**200**) content sends — whichever comes first — the
   initiator generates a fresh ML-KEM keypair, stores it under the next `offerId`,
   and sends `pqoffer`.
2. The responder encapsulates to that public key, records the shared secret as
   pending under `offerId`, and sends `pqaccept`.
3. The initiator decapsulates with the stored secret key, records the same secret
   as pending, and **zeroizes the KEM secret key immediately** — the keypair is
   single-use.
4. **The fold happens at the next DH ratchet step**, not on receipt. `RK` is only
   consumed at chain flips, which makes the flip a natural, already-synchronised
   fold point:
   - **Sender side**, at the *send step* of `dhRatchet`: if a pending secret exists,
     fold it — `kdfRoot(RK, dh, pqSecret)` — and increment `fold`. Every outgoing
     header from then on carries the new `fold`.
   - **Receiver side**, at the *recv step* of `dhRatchet`: if the incoming header's
     `fold` exceeds the local count, fold pending secrets in `offerId` order until
     the counts match, inside that same `kdfRoot` call.

   This works because the two sides walk an **identical root-key chain** — each
   `RK` is computed exactly once per side, from the same predecessor and the same
   DH output (the sender's send step and the receiver's recv step are the same link
   in that chain). Letting the sender decide and having the receiver mirror via
   `fold` makes the fold point deterministic instead of timing-dependent.
5. If the header demands a fold the receiver can't perform (the `pqaccept` hasn't
   arrived), decryption throws and the frame is **buffered and retried**, reusing
   the existing pre-seed inbound buffer. In practice this can't happen — the relay
   is FIFO per sender, so the `pqaccept` precedes any frame that folds it — but the
   buffer means a reordering bug degrades to a delay, not a dead session.

`kdfRoot` becomes `kdfRoot(rk, dh, pqSecret?)`:

```
okm = BLAKE2b-96( key = rk,  msg = "TTr:rk:v5" ‖ dh ‖ (pqSecret ?? "") )
→ (rk', ck, nhk)
```

Absent `pqSecret` the message is byte-identical to a v5 no-PQ step, so non-fold
steps and fold steps share one code path.

### Cover-traffic interaction (owed back to ③)

A `pqoffer` frame is a 1186-byte body → the **4096** bucket. Cover traffic today
tops out at 1024 (`coverBodyLen`: ~80 % → 256, ~20 % → 1024). So a 4096-bucket
frame every ~30 s would be unambiguously "PQ rekey" to a size-aware relay.

The rekey *schedule* isn't secret — it's a fixed jittered interval, not a function
of user behaviour — so this leaks no content. But it hands the relay a clean
periodic beat to fingerprint a session by, which is precisely what ③ set out to
remove. Fix: extend `coverBodyLen` with a small 4096-bucket tail (**~3 %**), so
4096-bucket frames are not exclusively PQ. Costs ~4 KB per ~30 s of cover, and
keeps ③'s hard constraint intact by construction.

### Static-channel replay (a residual this design can close cheaply)

Presence/ack/profile frames are sealed under static subkeys with no counter, so a
relay can replay a captured one and it decrypts successfully. Today the impact is
cosmetic (`advanceStatus` is monotonic, presence self-heals on the next
heartbeat), which is why it was left as a documented residual. The v5 header
already carries an `n` field for these classes, so closing it is nearly free:
`n` becomes a monotonic per-channel send counter, and the receiver keeps a small
sliding window per channel, dropping anything at or below the high-water mark
outside the window. Included here deliberately rather than deferred — it is ~15
lines on top of a struct this spec is already introducing.

## Module plan (`/client`)

| File | Change |
|---|---|
| `crypto/kdf.ts` | `kdfRoot` → 96-byte output `(rk, ck, nhk)`, optional `pqSecret`, domain v5; new `deriveHeaderKeys(rk0)` and `deriveHeaderSubkey(dirKey, cls)` |
| `crypto/header.ts` | **new** — pure fixed-size header pack/unpack (44 B) + `sealHeader`/`openHeader` (XChaCha) + the trial-decrypt candidate walk |
| `crypto/ratchet.ts` | `RatchetState` gains `HKs/HKr/NHKs/NHKr`, `pqFold`, `pqPending`; `ratchetEncrypt` seals the header and uses it as body AAD; `ratchetDecrypt` trial-decrypts; `dhRatchet` rotates header keys and applies PQ folds; `MKSKIPPED` values become `{ hk, mk }` |
| `crypto/framing.ts` | `Channel` gains `"pqoffer" \| "pqaccept"` |
| `crypto/pqkem.ts` | unchanged (reused as-is) |
| `protocol/pqRekey.ts` | **new** — pure schedule/state decisions (when to offer, offer-id bookkeeping, pending-secret ordering), mirroring `coverTraffic.ts`'s shape |
| `protocol/coverTraffic.ts` | `coverBodyLen` gains the ~3 % 4096 tail |
| `protocol/ratchetSession.ts` | `sealContent`/`sealStatic`/`openMsg` move to the single-blob `payload`; static classes get send counters + a replay window; header keys seeded from `RK₀` |
| `net/relayClient.ts` | `Envelope` `msg` → `{ type: "msg"; payload: string }`; `PROTOCOL_VERSION = 5`; drop the exported `RatchetHeader` re-export |
| `App.tsx` | PQ rekey timer (initiator) + offer/accept handling + drop cases for the two new channels; zeroize the new key material on leave |
| `components/Settings.tsx` | honest copy: healing is now post-quantum too; the relay no longer sees ratchet counters |

Server: **no change** — verified that `server.ts` inspects only `create`/`join`.

## Data flow (unchanged for the user)

Type a message → sealed exactly as today from the user's point of view. The
differences are all below the waterline: the header is sealed, the class selector
is gone from the envelope, and every ~30 s two extra invisible frames (offer,
accept) ride the content channel and then get dropped.

## Error handling / edge cases

- **Header opens under no candidate** → drop the frame silently (static) or as a
  decryption-error bubble (content), matching today's `isSilentContentDrop` split.
- **Header opens, body fails** → drop; state untouched (transactional decrypt).
- **Fold demanded but secret missing** → throw → buffer and retry (see above).
- **`pqaccept` for an unknown/stale `offerId`** → ignore; the offer is single-use
  and its secret key already zeroized.
- **Duplicate `pqoffer`** (retransmit or a misbehaving peer) → the responder
  accepts the newest `offerId` only; older pending offers are dropped and zeroized.
- **Responder receives a `pqoffer`** while it is itself the initiator of nothing —
  impossible by construction (single offerer), but a `pqoffer` arriving *at* the
  initiator is a protocol violation → drop, do not reflect.
- **Static replay outside the window** → drop silently.
- **Version mismatch** → existing `handshake_failed` path.

## Testing

Unit (vitest, real modules — no mocks of crypto):

- `header.ts`: pack/unpack round-trip for every class; fixed 44/84-byte sizes;
  seal/open under the right key; open fails under a wrong key; tamper in any byte
  fails the tag.
- `kdf.ts`: 96-byte split is stable; `nhk` differs from `rk`/`ck`; a `pqSecret`
  changes the output; absent-`pqSecret` matches the no-PQ vector.
- `ratchet.ts`: existing suite ported to sealed headers; **new** — a full PQ fold
  round-trip keeps both sides in sync; a fold on one side only diverges the chains
  (proving the fold is actually load-bearing); out-of-order delivery across a flip
  still decrypts via stored `hk`; a straggler older than the 8-chain cap is
  dropped, not crashed.
- `pqRekey.ts`: schedule fires on interval *or* message count; jitter bounds;
  offer-id monotonicity; pending secrets order by `offerId`.
- `ratchetSession.ts`: single-blob `payload` round-trips for content and all three
  static classes; a content frame relabelled as static (and vice versa) fails;
  a replayed static frame is dropped; the session survives every bad frame.
- `coverTraffic.ts`: `coverBodyLen` never returns a 64-bucket length and now
  reaches 4096 with roughly the intended frequency.

End-to-end (throwaway two-browser Playwright, run then deleted — the pattern PR
#15 used, driven from a scratch dir so no harness lands in the repo):

- both sides still reach a matching safety number and can chat both ways;
- **no `header` or `c` field appears on any `msg` frame** on the wire, and every
  frame's payload begins with exactly 84 bytes of sealed header;
- a PQ rekey completes live (offer + accept observed, then messages continue) and
  the chat keeps working *across* the fold — the real proof A works;
- ≥ 2 folds in a run with a shortened test interval;
- cover traffic still flows with no stray bubbles; sizes still bucket-uniform;
- no console errors.

## Residuals (documented, honest — do not oversell)

- **The DH half of each ratchet step is still X25519.** A folds ML-KEM in
  *periodically*, not per-step; between folds, healing rests on X25519. So the
  honest claim is "post-compromise healing re-secures with post-quantum key
  material every ~30 s", not "every message is post-quantum". Per-step ML-KEM is
  what Signal's SPQR does with chunked key transmission; that is a bigger build
  and explicitly out of scope here.
- **A fold's window.** A compromise is healed at the *next fold*, so the exposure
  window is up to one rekey interval (~30 s) plus a chain flip, not instant.
- **Message counts are hidden, not eliminated.** The relay still sees *how many*
  `msg` frames cross it and when — ③ masks the rhythm, B masks the structure, but
  frame count remains. Inherent to a forwarding relay.
- **Class is hidden; direction is not.** The relay still knows which peer sent a
  frame (it has two sockets).
- **The 8-chain trial cap** bounds out-of-order tolerance for very old stragglers.
  A deliberate trade against unbounded trial-decrypt work.
- **H1 verification enforcement** remains out of scope (UX-touching), as in every
  round-2 spec.

## Build order

1. `crypto/kdf.ts` — 96-byte `kdfRoot` + optional `pqSecret` + header-key derivation
2. `crypto/header.ts` — pack/unpack/seal/open (pure, fully unit-tested first)
3. `crypto/framing.ts` — two new channels
4. `crypto/ratchet.ts` — header keys, trial decrypt, PQ folds, `{hk, mk}` skipped store
5. `protocol/pqRekey.ts` — pure schedule/state
6. `protocol/ratchetSession.ts` — single-blob payload, static counters + window
7. `protocol/coverTraffic.ts` — 4096 tail
8. `net/relayClient.ts` — envelope + `PROTOCOL_VERSION = 5`
9. `App.tsx` — rekey timer, offer/accept, drop cases, zeroize
10. Copy + docs + verification (unit, then two-browser)

Steps 1–4 are the dependency spine and must land in order; 5–7 are independent of
each other.

## Rollout

Both peers must run v5 — the existing version check makes a mismatch fail closed
at the handshake, which is correct for a hackathon deploy where both clients come
from the same build. No migration concern: sessions are ephemeral, nothing sealed
under v4 keys is ever stored.
