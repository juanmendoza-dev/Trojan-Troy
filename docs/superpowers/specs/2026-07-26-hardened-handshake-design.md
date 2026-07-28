# Hardened Handshake (commit-then-reveal + transcript binding): Design Spec

Status: Draft (brainstormed with Jay 2026-07-26; approved to build)
Date: 2026-07-26

## Purpose

The whole product rests on one thing: two humans comparing a **safety number**
that a MITM can't reproduce. Today's handshake is already strong — hybrid
X25519 + ML-KEM-768, the safety number binds the derived root key `RK₀` (so a
key swap or PQ downgrade changes the digits), and a second `pubkey` is rejected
(H2). Two gaps remain, and this is the first feature of the 2026-07-26 crypto
round (**D**), sequenced first because it's handshake-time only (no per-message
wire change) and because **E — periodic rekey** will re-run this hardened
handshake:

1. **Adaptive key choice.** Both sides publish their ephemeral public keys
   through the untrusted relay at effectively the same time. Nothing forces a
   party (or a MITM impersonating one) to fix its keys *before* seeing the
   other's. A computationally-motivated relay could therefore choose its MITM
   keys *as a function of* the honest key — e.g. to grind a safety number that
   shares a prefix a human might not fully compare. The safety number defends
   against MITM, but adaptivity lowers the bar.

2. **Only the keys are bound, not the whole transcript.** `RK₀` folds in the
   two `crypto_kx` secrets and the ML-KEM secret, but not the protocol version,
   the KEM public key, or the KEM ciphertext explicitly. A relay tampering with
   the *framing* (a version downgrade attempt, a swapped ciphertext) is caught
   only indirectly (via a derived-secret mismatch), not by an explicit transcript
   commitment.

This spec closes both, invisibly:

- **Commit-then-reveal (ZRTP-style hash commitment).** Each side sends
  `commit = H(its ephemeral public key(s))` and reveals its actual public key(s)
  **only after receiving the peer's commit**. Because a party must commit before
  it sees the peer's key, it cannot choose its key adaptively — the classic
  hash-commitment defense that ZRTP uses to protect its SAS.

- **Transcript binding.** Both sides compute a canonical hash of the full
  handshake transcript (protocol version, both X25519 public keys, the ML-KEM
  public key, the ML-KEM ciphertext) and fold it into `RK₀`. Any tampering with
  the framing changes `RK₀` → the session fails closed *and* the safety number
  digits change (the safety number already binds `RK₀`).

**This is invisible to the user.** It adds one relay round-trip to a handshake
that already shows an artificial ≥2600 ms progress screen (`HANDSHAKE_MIN_MS`),
so the extra hop is absorbed with zero perceptible change. Per Jay's steer:
backend only, UX identical.

## Relationship to the other round-2 specs

First of four (**D**). Independent of A/B (the ratchet wire revision) and E; but
it lands first because E re-runs this handshake and because it's the lowest-risk
piece (handshake-time only). Bumps `PROTOCOL_VERSION` 3 → 4.

## Hard constraints (carried, all satisfied)

- **Audited libraries only.** Commit + transcript hashes are `crypto_generichash`
  (BLAKE2b, libsodium) — the same primitive the safety number and KDF already
  use. No new dependency, no hand-rolled crypto. ✅
- **Relay never reads plaintext.** The `commit` envelope is an opaque hash; the
  relay forwards it verbatim like `pubkey`/`kemct`/`msg` (server `create`/`join`
  are the only validated types — `server.ts` forwards everything else untouched),
  so **no server change**. ✅
- **No live calling / P2P.** Unchanged. ✅

## Invariants preserved (must not regress)

- **Both sides must derive an identical `RK₀`.** The transcript hash is computed
  from **canonically sorted** X25519 public keys (same sort the safety number and
  `deriveRootKey` already use) plus the single shared KEM public key and
  ciphertext, so initiator and responder compute byte-identical transcripts. A
  divergence would be a false handshake failure — this is the highest-risk part
  and gets direct tests.
- **Fail-closed on missing KEM material** (the existing v3 downgrade guard) stays.
- **Single-shot handshake (H2).** Extended: a duplicate or out-of-order handshake
  envelope (`commit`/`pubkey`/`kemct`) → `handshake_failed`, never a silent
  re-key.
- **The `msg` buffering + host-primer path** (responder buffers inbound `msg`
  until `RK₀` exists; initiator sends a hidden primer) is unchanged — the extra
  commit round only lengthens the pre-seed window the buffer already covers.

---

## Design

### New choreography (v4)

```
peer-connected
  │
  ├─ A ── commit_A = H("TTr:commit:v4", pubA)               ──▶ relay ──▶ B
  └─ B ── commit_B = H("TTr:commit:v4", pubB ‖ kemPubB)     ──▶ relay ──▶ A
  │
  │  (each side waits for the peer's commit before revealing)
  │
  ├─ A ── pubkey { payload: pubA, v:4 }                     ──▶ B   (reveal)
  └─ B ── pubkey { payload: pubB, v:4, kem: kemPubB }       ──▶ A   (reveal)
  │
  │  on receiving the peer's reveal, verify H(reveal) == stored peer commit
  │
  ├─ A (initiator): derive kx; encapsulate to kemPubB → kemct; finish
  └─ B (responder): derive kx; wait for kemct
  │
  └─ A ── kemct { payload: cipherText }                     ──▶ B → decapsulate → finish
```

The only new envelope is `commit`. The `pubkey` (reveal) and `kemct` shapes are
**unchanged** — the responder's reveal still carries `kem`, the initiator's
doesn't, so the commitment naturally covers the presence/absence of the KEM key.

### Commit hash

```
computeHandshakeCommit(x25519Pub, kemPub | null):
  material = kemPub ? (x25519Pub ‖ kemPub) : x25519Pub
  return crypto_generichash(32, material, key = "TTr:commit:v4")
```

The ephemeral public keys are high-entropy, so `H(pubkey)` is a hiding + binding
commitment with no extra nonce (as in ZRTP). Domain string is passed as the
BLAKE2b **key** (the material can exceed 64 bytes — ML-KEM pub is 1184 — so it
must be the message, not the key; the domain is a fixed public string, i.e. pure
domain separation, not secret-keying).

### Transcript hash

```
computeTranscriptHash(pubA, pubB, kemPub, kemCt, version):
  [first, second] = sort([pubA, pubB]) by lowercase hex   // canonical
  message = uint8(version) ‖ first ‖ second ‖ kemPub ‖ kemCt
  return crypto_generichash(32, message, key = "TTr:transcript:v4")
```

Both sides hold all five inputs identically (sorted pubkeys; the single shared
KEM pub/ct; the agreed version), so the hash is byte-identical on both ends.

### Root-key binding

`deriveRootKey` gains a required `transcriptHash` argument and a third keyed
step (domains bumped v3 → v4):

```
classical = H(32, "TTr:root:kx:v4",  key = first ‖ second)          // sorted kx pair
withPq    = H(32, "TTr:root:pq:v4",  key = classical ‖ pqSecret)
RK₀       = H(32, "TTr:root:tr:v4",  key = withPq ‖ transcriptHash)  // NEW
```

Each keyed-BLAKE2b key stays ≤ 64 bytes (the existing constraint). The safety
number already hashes `RK₀`, so transcript tampering propagates to the digits
for free; its domain strings bump v3 → v4 for coherence (its output already
changes via `RK₀`).

### Guards (extends H2)

The `exchangeKeys` listener enforces a strict order; any violation →
`handshake_failed`:

- `commit`: reject a second commit, a commit after we've revealed/seeded, or a
  version mismatch. Store the peer commit, then reveal our `pubkey`.
- `pubkey`: reject if no peer commit yet (reveal-before-commit / a v3-style
  handshake), if already revealed/seeded, on version mismatch, or if
  `H(reveal) ≠ storedCommit`. Then derive kx; initiator encapsulates + finishes,
  responder waits.
- `kemct`: unchanged guards (responder only, after its reveal, once).

---

## Module plan (`/client`)

```
client/src/crypto/
  transcript.ts / transcript.test.ts   # NEW: computeHandshakeCommit + computeTranscriptHash (pure)
  kdf.ts / kdf.test.ts                  # deriveRootKey gains transcriptHash (4th arg); domains v3->v4
  safetyNumber.ts                       # domain strings v3 -> v4 (coherence; output already shifts)
client/src/protocol/
  ratchetSession.ts / .test.ts          # initSession threads transcriptHash into deriveRootKey
client/src/net/relayClient.ts           # + { type:"commit"; v; commit }; PROTOCOL_VERSION 3 -> 4
client/src/App.tsx                       # commit-then-reveal choreography; compute + pass transcriptHash
```

No server change. No new dependency.

## Data flow (unchanged for the user)

1. Peers connect → each sends a commit → each reveals its key after seeing the
   peer's commit → verify the commitment → KEM leg → seed → safety-number screen.
2. The user sees the same handshake screen for the same ≥2600 ms; one extra relay
   hop is absorbed.

## Error handling / edge cases

- **Broken commitment** (`H(reveal) ≠ commit`): `handshake_failed`. Covers a relay
  swapping a revealed key after the commit, or stripping the responder's `kem`.
- **Reveal before commit / missing commit**: `handshake_failed` (also blocks a
  forced v3-style handshake).
- **Transcript divergence**: cannot happen for an honest pair (canonical inputs);
  if it did (a tampered ct/version), `RK₀` differs → the first ratchet/primer
  message fails its AEAD tag → `handshake_failed`. Fail-closed.
- **Duplicate/out-of-order handshake envelope**: `handshake_failed` (H2 extended).
- **Dropped commit** (relay drops one side's): the handshake stalls, exactly as a
  dropped `pubkey` does today — no new failure mode. A handshake watchdog timeout
  is a documented residual, not built here.

## Testing

- **`transcript.test.ts`:** commit is deterministic and differs with the key /
  with/without KEM; transcript hash is order-invariant over the two pubkeys,
  differs when version / KEM pub / KEM ct changes, and is 32 bytes.
- **`kdf.test.ts`:** existing assertions updated for the new arg; add "a different
  transcript hash changes `RK₀`" and keep order-invariance (initiator/responder
  with the same transcript agree).
- **`ratchetSession.test.ts`:** `pair()` computes a real transcript hash from the
  handshake values and feeds the **same** one to both `initSession` calls; the
  existing "identical root key" + round-trip tests must still pass. Add: feeding a
  **different** transcript to each side yields non-matching root keys (they can't
  talk) — proves the binding is load-bearing.
- **`safetyNumber.test.ts`:** property tests unchanged (still pass under v4 domains).
- **Manual:** a real two-browser handshake reaches a matching safety number and
  chats both ways (Playwright is now available — see the mobile-web-support round;
  the old "no browser automation" caveat is obsolete).

Acceptance: `cd client && npm run typecheck && npm test && npm run build` green;
an honest pair agrees on `RK₀`/safety number and chats; a mismatched commitment or
transcript fails closed.

## Residuals (documented, honest)

- **MITM is still defeated by the safety number, not eliminated.** Commit-reveal
  removes the *adaptive* advantage; it does not make the relay trusted. Two humans
  comparing the number remains the root defense (review H1).
- **No handshake watchdog timeout.** A relay that drops a handshake envelope
  stalls the handshake (same as today). A timeout → error screen is a cheap future
  add; not in scope.
- **The ongoing ratchet is still classical** — that's feature **A** (PQ ratchet),
  next in the round.

## Build order

1. `transcript.ts` (+ tests) — pure, no dependency on the rest.
2. `kdf.ts` deriveRootKey transcript arg (+ test updates).
3. `ratchetSession.ts` initSession threading (+ test updates).
4. `safetyNumber.ts` domain bump.
5. `relayClient.ts` commit type + `PROTOCOL_VERSION = 4`.
6. `App.tsx` commit-then-reveal choreography + transcript computation.
7. Verify (typecheck / test / build); manual two-browser eyeball.

## Rollout

- Branch off `main`: `feat/hardened-handshake`.
- Log on build (`AGENTS.md`): the commit-reveal + transcript-binding decision and
  the `PROTOCOL_VERSION` 3 → 4 bump in `decisions.md`; update `progress.md`.
- Commit/push per `AGENTS.md` (plain, human-authored, signed).
