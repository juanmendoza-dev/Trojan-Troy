# Post-Quantum Hybrid Handshake (X25519 + ML-KEM-768): Design Spec

Status: Draft (brainstormed with Jay 2026-07-23; awaiting approval)
Date: 2026-07-23

## Purpose

Today the session-key agreement is **X25519 only** (`crypto_kx`). X25519 is a
classical elliptic-curve Diffie-Hellman: unbreakable by today's computers, but a
sufficiently large **quantum computer** could recover the shared secret. The
concrete threat for a chat app is **"harvest now, decrypt later"** — an adversary
(the untrusted relay, or a network MITM) records the encrypted handshake + traffic
today and decrypts it years later once quantum hardware exists.

Trojan Troy's *ephemeral* design already helps here — there is no long-term
identity key to steal, so an attacker can't passively decrypt *everything* forever.
But each session's X25519 key agreement is still recorded on the wire and is
**retroactively breakable**, which would expose that session's entire transcript.

This spec adds a **hybrid post-quantum key exchange**: the two sides run **both**
X25519 (as today) **and** ML-KEM-768 (a NIST-standard, quantum-resistant KEM), and
combine both shared secrets into the root key that seeds the existing Double
Ratchet. "Hybrid" is the load-bearing word: the session is secure **unless both
X25519 and ML-KEM are broken**, so we never lose any security we have today — we
only add a floor.

This is what Signal (PQXDH, 2023) and Apple iMessage (PQ3, 2024) shipped. It is a
genuine, current, headline-grade upgrade.

**This is invisible to the user.** No screen, flow, or interaction changes — only
the handshake bytes on the wire and the (already-opaque-to-the-relay) safety-number
digits. Per Jay's Phase 5 steer (`decisions.md`, `phase-5-security-direction`
memory): keep the UX identical, deepen the backend crypto.

## Relationship to the other 2026-07-23 specs

This is the primary of a four-spec security round (all backend, all UX-invisible):

- **This spec (①)** — hybrid PQ key agreement.
- **② Safety-number session binding** (`2026-07-23-safety-number-binding-design.md`)
  — binds the safety number to the *derived* root key. Ships **on this same
  branch**: it is what gives ① its **downgrade protection** (a relay stripping PQ
  back to classical changes the safety number). ① and ② are one implementation
  cluster; they are specced separately only for clarity.
- **③ Traffic-analysis resistance** and **④ At-rest encryption** are independent
  follow-on branches.

## Hard constraints (carried, all satisfied)

- **Never hand-roll primitives — audited libraries only.** ML-KEM-768 comes from
  `@noble/post-quantum` (paulmillr's noble suite; Cure53-audited; pure TS,
  tree-shakeable). This is the **first crypto dependency beyond libsodium** — a
  deliberate reversal of the prior "libsodium-only, zero new deps" stance (see
  `decisions.md`; log it on build). It is still an audited library, so the
  constraint holds. The hybrid *combiner* itself is a keyed BLAKE2b over both
  secrets — reusing the existing libsodium `crypto_generichash`, not a new
  primitive.
- **Relay never reads plaintext.** ✅ The new handshake fields (a KEM public key, a
  KEM ciphertext) are public key-agreement material, exactly like the existing
  `pubkey`. The relay forwards them opaquely and learns nothing it doesn't already
  learn from the X25519 pubkeys.
- **No live/streaming calling or P2P.** ✅ Unchanged.

## Invariants preserved (must not regress — see review §2)

- **`crypto_kx` rx/tx direction separation stays load-bearing and unchanged.** The
  classical half is exactly today's handshake. PQ material is *added*, never
  substituted.
- **The Double Ratchet is unchanged.** ① only changes how the *initial* root key
  `RK₀` is computed. `initAlice`/`initBob`, `ratchetEncrypt/Decrypt`, and the DH
  steps are untouched (but see the honesty note in §Residuals about the ongoing
  ratchet remaining classical).
- **Roles are locally bound.** Initiator = the local "Start a chat" press,
  responder = "Join" — never relay-chosen (review U2). The KEM
  encapsulator/decapsulator roles map onto these local roles; a relay cannot force
  a role.

---

## Cryptographic design

### Primitives

| Role | Primitive | Source |
|---|---|---|
| Classical key agreement | `crypto_kx_*_session_keys` (X25519) | libsodium (unchanged) |
| PQ KEM | ML-KEM-768 (FIPS 203) — `keygen` / `encapsulate` / `decapsulate` | `@noble/post-quantum` `ml_kem768` |
| Hybrid combiner / root KDF | keyed `crypto_generichash` (BLAKE2b) | libsodium (existing `kdf.ts`) |

**Why ML-KEM-768** (not 512 / 1024): 768 is NIST's "category 3" recommended level
and the level Signal uses in PQXDH — the defensible standard-choice. 1024 is a
one-line bump (`ml_kem1024`) if Jay wants to flex the highest level; it only
enlarges keys/ciphertexts (~1.5×) at no protocol-design cost. Recommend **768**.

**ML-KEM implicit rejection (important for implementers):** ML-KEM
`decapsulate` does **not** throw on a malformed/tampered ciphertext — by design it
returns a *pseudo-random* shared secret. So a corrupted KEM ciphertext does not
fail loudly at decapsulation; instead the two sides derive **different** `RK₀`,
which is caught downstream when the first ratchet message (the existing `primer`)
fails its AEAD tag → `handshake_failed`. Tests must assert this end-to-end, not
expect a `decapsulate` throw.

### The hybrid combiner (root key)

Replaces `deriveRootKey(rx, tx)` in `crypto/kdf.ts`:

```
deriveRootKey(rx, tx, pqSecret):                 // pqSecret = 32-byte ML-KEM shared secret
  classical = sortBytes(rx, tx)                  // unordered pair, identical on both sides (unchanged)
  RK0 = crypto_generichash(32,
          message = "TTr:root:pq:v3",            // domain tag bumped v2 -> v3
          key     = concat(classical, pqSecret)) // BOTH secrets keyed in
  return RK0
```

- Both secrets feed the KDF; breaking one leaves `RK₀` unrecoverable. This is the
  standard "concatenate then KDF" hybrid combiner (same family as Signal/X-Wing).
- Domain tag bumped to `v3` so a v2 (classical-only) and a v3 (hybrid) derivation
  can never collide.

### Handshake protocol (extends `App.tsx:exchangeKeys`)

Today: on `peer-connected`, **both** sides register a message handler and send
`{ type:"pubkey", payload: b64(x25519Pub), v }`. On receiving the peer's `pubkey`,
each side derives `crypto_kx` session keys, seeds the ratchet, computes the safety
number; the initiator additionally sends the hidden `primer`.

Hybrid flow (KEM roles: **responder = KEM keypair holder / decapsulator**,
**initiator = encapsulator**):

```
Responder (Bob), at handshake start:
  (kemPub, kemSec) = ml_kem768.keygen()
  send { type:"pubkey", payload: b64(x25519Pub), kem: b64(kemPub), v:3 }

Initiator (Alice), at handshake start:
  send { type:"pubkey", payload: b64(x25519Pub), v:3 }          // no kem field

Initiator, on receiving Bob's pubkey (which MUST carry kem):
  if !envelope.kem: -> DOWNGRADE -> error screen (fail closed; see below)
  classicalKeys      = deriveSessionKeys(...)                    // as today
  { cipherText, sharedSecret } = ml_kem768.encapsulate(fromB64(envelope.kem))
  send { type:"kemct", payload: b64(cipherText) }
  RK0 = deriveRootKey(rx, tx, sharedSecret)
  seed ratchet as Alice; send primer; compute safety number (spec ②)

Responder, on receiving Alice's pubkey:
  classicalKeys = deriveSessionKeys(...)                          // as today; wait for kemct
Responder, on receiving kemct:
  sharedSecret = ml_kem768.decapsulate(fromB64(payload), kemSec)  // implicit-reject, never throws
  RK0 = deriveRootKey(rx, tx, sharedSecret)
  seed ratchet as Bob; compute safety number (spec ②)
```

### Ordering & buffering (the one real subtlety)

The responder cannot seed its ratchet — and therefore cannot decrypt the
initiator's `primer` — until the `kemct` arrives. On a single connection the relay
forwards in order, so `kemct` precedes `primer`; but to be robust the responder
**buffers any inbound `msg` until `RK₀` exists**, then processes it. This mirrors
the existing `outboxRef`/primer buffering already in `App.tsx` for the
send-before-chain case. The extra half-round-trip is fully hidden behind the
existing `HANDSHAKE_MIN_MS` (2.6s) animation.

### Downgrade protection (fail closed)

A malicious relay's cheapest attack is to **strip PQ**: drop the `kem` field or the
`kemct` so the sides fall back to classical-only, which a future quantum computer
can break. Defenses, in order:

1. **Fail closed, never fall back.** A v3 initiator that receives a `pubkey`
   **without** a `kem` field routes to the error screen — it must not silently
   derive a classical-only `RK₀`. Likewise a responder that never receives a
   `kemct` before the handshake timeout errors out. There is no
   "classical fallback" code path in a v3 client.
2. **Version pinning.** `PROTOCOL_VERSION = 3`; a `pubkey` with a different `v`
   already routes to `handshake_failed` (existing H2/version guard). A v2 client
   simply can't complete a v3 handshake.
3. **Safety-number binding (spec ②).** `RK₀` includes the PQ secret, and ② hashes
   `RK₀` into the safety number — so any successful downgrade *also* changes the
   number the two humans compare out-of-band. This is the belt-and-suspenders
   backstop and the reason ② ships with ①.

### H2 re-key guard (extended)

The existing single-shot guard (a second `pubkey` after keys are established →
error screen, never re-seed) is extended to the KEM: a second `kemct`, or a `kemct`
after `RK₀` is already set, is a protocol violation → error screen.

---

## Wire format (`net/relayClient.ts`)

```ts
export type Envelope =
  | { type: "create" }
  | { type: "created"; roomCode: string }
  | { type: "join"; roomCode: string }
  | { type: "peer-connected" }
  | { type: "peer-disconnected" }
  | { type: "pubkey"; payload: string; kem?: string; v: number }  // + optional KEM public key
  | { type: "kemct"; payload: string }                            // NEW: KEM ciphertext (b64)
  | { type: "msg"; c: 0 | 1 | 2 | 3; header?: RatchetHeader; payload: string }
  | { type: "error"; message: string };
export const PROTOCOL_VERSION = 3;                                // was 2
```

- `pubkey` gains an **optional** `kem` (present only from the responder). `kemct` is
  a new envelope carrying the encapsulation ciphertext.
- **No server change.** `pubkey` and `kemct` travel the relay's opaque
  unknown-type pass-through (the server validates only `create`/`join`). Confirm
  `kemct` isn't accidentally caught by any structural check in `server.ts`
  (it isn't today — only `create`/`join` are gated).
- `kem` (~1.2 KB) and `kemct` (~1.1 KB) are well under the Track B `maxPayload`
  (2 MiB).

---

## Module plan (`/client`)

```
client/package.json                         # + "@noble/post-quantum"
client/src/crypto/
  pqkem.ts / pqkem.test.ts                   # NEW: thin ML-KEM-768 wrapper (keygen/encapsulate/decapsulate)
                                             #      + base64 helpers; { publicKey, secretKey } / { cipherText, sharedSecret }
  kdf.ts  / kdf.test.ts                      # deriveRootKey(rx, tx, pqSecret); domain tag -> v3
client/src/protocol/
  ratchetSession.ts / .test.ts               # initSession(..., pqSecret): thread the PQ secret into deriveRootKey
client/src/net/relayClient.ts                # kem? on pubkey; kemct envelope; PROTOCOL_VERSION = 3
client/src/App.tsx                           # exchangeKeys: KEM keygen (responder) / encapsulate (initiator) /
                                             # decapsulate (responder); fail-closed downgrade guard; buffer msg
                                             # until RK0; extend H2 guard to kemct
```

`pqkem.ts` and `kdf.ts` are pure state-in/state-out (async only for readiness), so
the hybrid derivation is deterministically unit-testable — consistent with the
"pure-logic modules get Vitest coverage" convention. `App.tsx` stays manually
verified (`decisions.md` 2026-07-20).

### `pqkem.ts` shape (confirm exact API against the installed version)

```ts
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
export interface KemKeypair { publicKey: Uint8Array; secretKey: Uint8Array; }
export function generateKemKeypair(): KemKeypair { return ml_kem768.keygen(); }
export function kemEncapsulate(pub: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  return ml_kem768.encapsulate(pub);
}
export function kemDecapsulate(ct: Uint8Array, sec: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(ct, sec);   // implicit rejection: never throws
}
```

---

## Data flow (unchanged for the user)

1. Pair via room code — exactly as today.
2. `pubkey` exchange, now carrying the responder's KEM public key; the initiator
   encapsulates and returns a `kemct`. Classical `crypto_kx` runs as today.
3. Both derive the hybrid `RK₀` and seed the same Double Ratchet. The handshake
   animation covers the extra half-round-trip.
4. Safety number (now bound to `RK₀`, spec ②) is shown — same screen, digits differ.
5. Messaging, presence, receipts, leave — all unchanged.

## Error handling / edge cases

- **Missing `kem` on the responder's `pubkey`** → downgrade → error screen (fail
  closed). Never derive a classical-only root.
- **Tampered/malformed `kemct`** → ML-KEM implicit rejection → mismatched `RK₀` →
  the `primer` fails its AEAD tag → `handshake_failed`. No crash.
- **Version mismatch** (`v ≠ 3`) → `handshake_failed` (existing guard).
- **Second `pubkey`/`kemct` after `RK₀` set** → protocol violation → error screen
  (H2 extended). Never re-seed a live session.
- **`msg` arriving before `RK₀`** (responder) → buffered, processed once seeded.
- **Peer disconnects mid-handshake** → existing `friend_left` path.

## Testing

- **`pqkem.test.ts`:** `encapsulate`→`decapsulate` agree on the shared secret;
  key/ciphertext byte lengths match ML-KEM-768; a flipped-bit ciphertext yields a
  *different* (not thrown) secret (implicit rejection).
- **`kdf.test.ts`:** hybrid `RK₀` identical for both roles given the same
  classical pair + PQ secret; differs if the PQ secret differs (downgrade/tamper);
  differs from the v2 classical-only derivation (domain separation).
- **`ratchetSession.test.ts`:** a full A↔B session seeded with the hybrid `RK₀`
  round-trips content both directions (i.e., `initSession` threading is correct).
- **Handshake integration (deterministic, module-level, no relay):** simulate the
  four-message exchange; assert both sides reach an identical `RK₀`; assert a
  dropped `kem` field fails closed; assert a corrupted `kemct` fails at the primer.
- **Regression:** the existing ratchet/framing/aead suites stay green.
- **Manual:** two-browser paired session — confirm both sides pair, land on a
  *matching* safety number, and exchange text + voice both directions (initiator-
  first and joiner-first, exercising the buffered-primer path). Same eyeball pass
  as every prior phase (no browser automation here).

Acceptance: `cd client && npm run typecheck && npm test && npm run build` green; a
two-browser pass pairs and chats normally; a simulated downgrade (dropped `kem`)
fails closed.

## Residuals (documented, honest — matches the app's posture)

- **The ongoing ratchet DH steps remain X25519.** ① makes the *initial key
  agreement* post-quantum. The Double Ratchet's per-step DH is still classical, so
  **initial confidentiality is PQ-safe, but post-compromise "self-healing" is
  not** — a quantum attacker who both records everything *and* compromises live
  ratchet state could follow the healing via the X25519 steps. Closing this needs
  a **post-quantum ratchet** (ML-KEM in the DH steps — Signal's SPQR direction),
  which is a deliberate, heavier stretch (its own spec). Call this out in the
  about/security copy honestly; do not claim "fully post-quantum."
- **Bundle size grows** by the ML-KEM implementation (~tens of KB). Acceptable.
- **First-contact MITM is still gated by the safety number** (spec ②), unchanged.
  ① does not make the relay trusted.

## Build order

1. `pqkem.ts` (+ tests) — isolate the new dependency behind a thin wrapper first.
2. `kdf.ts` hybrid combiner (+ tests) and `ratchetSession.initSession` threading.
3. Wire format (`kem?`, `kemct`, `PROTOCOL_VERSION = 3`).
4. `App.tsx` handshake wiring: keygen/encapsulate/decapsulate, fail-closed
   downgrade guard, buffered primer, extended H2 guard.
5. Fold in **spec ②** (safety-number binding) on the same branch, then the
   two-browser eyeball.

## Rollout

- Full workflow (wire-format change, new dependency — not a drive-by):
  brainstorming → **this spec (+ ②)** → plan (`docs/superpowers/plans/`) →
  `subagent-driven-development`. One cluster/branch off `main`.
  Suggested branch: `feat/pq-hybrid-handshake` (ships ① + ②).
- **Log on build** (`AGENTS.md`): the new-dependency reversal (`@noble/post-quantum`
  beyond libsodium), `PROTOCOL_VERSION` bump to 3, and the roadmap addition
  (a new Phase 5 security sub-item) in `decisions.md` / `roadmap.md`; update
  `progress.md` as it lands.
- Commit/push per `AGENTS.md` (human-authored, signed, short messages, frequent).
