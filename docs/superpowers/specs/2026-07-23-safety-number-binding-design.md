# Safety-Number Session Binding (review L2): Design Spec

Status: Draft (brainstormed with Jay 2026-07-23; awaiting approval)
Date: 2026-07-23

## Purpose

The safety number is the whole MITM defense: two people compare the number
out-of-band, and if it matches, no relay is sitting in the middle. Today
`computeSafetyNumber(pubA, pubB)` hashes only the **two relayed X25519 public
keys**. That already detects a classical MITM (a key-swapping relay makes the two
sides' numbers differ) — but it has two gaps the Phase 4.7 review flagged as **L2**:

1. **No domain separation.** The hash isn't personalized with an app/version
   context, so the same public keys in any other context would produce the same
   number. Standard hygiene, cheap to fix.
2. **It isn't bound to the *derived* session — only to the relayed pubkeys.** This
   is the one that matters now: once the **post-quantum hybrid handshake (spec ①)**
   lands, the real shared secret (`RK₀`) includes ML-KEM material that a
   pubkey-only safety number **does not cover**. A relay could strip PQ back to
   classical (a downgrade) and the classical-only safety number would still match.

This spec re-computes the safety number over a **one-way commitment to the derived
root key `RK₀`** plus domain separation. Effect: the number now depends on both
sides having actually derived the *same* secret (including the PQ half), so any
key swap **or** PQ downgrade changes it. This is what makes spec ①'s downgrade
protection real — the two ship together.

**This is invisible to the user.** Same screen, same "compare the digits" gesture,
same decimal-group format — only the digits themselves differ from before (and
they were already opaque to the relay). Per Jay's steer: backend only.

## Relationship to the other 2026-07-23 specs

Ships **on the same branch as spec ①** (`feat/pq-hybrid-handshake`); it is the
downgrade backstop for the PQ handshake. It is written up separately only for
clarity — an implementer builds ① and ② as one cluster. Independent of specs ③/④.

> **Scope boundary (important):** This is the *cryptographic binding* half of the
> review's H1/B1 cluster. It does **not** add the *enforcement* UI (an explicit
> "these match" affirmation + a persistent "Unverified" banner) — that half changes
> the user flow and is out of scope under Jay's "backend only" filter (see
> `decisions.md`). Binding hardens the number; enforcement is a separate, deferred,
> UX-touching decision.

## Hard constraints (carried, all satisfied)

- **Audited libraries only.** Reuses the existing libsodium `crypto_generichash`
  (BLAKE2b) — no new primitive, no new dependency. ✅
- **Relay never reads plaintext.** The safety number is computed and shown
  client-side; nothing new goes on the wire. ✅
- **No live calling / P2P.** Unchanged. ✅

## Invariants preserved (must not regress — see review §2)

- **The safety number keeps sound entropy.** Still a BLAKE2b digest over
  high-entropy inputs; we *add* inputs, never remove the pubkeys.
- **`RK₀` is never exposed.** Only a one-way hash of it (`confirmTag`) enters the
  safety-number input. `RK₀` has 256-bit entropy, so its hash reveals nothing about
  it, and the safety number is shown to the user anyway (it must leak nothing about
  the key). This is the critical correctness point for the review.
- **Both sides compute the identical number.** Guaranteed because both sides hold
  the identical `RK₀` (verified by spec ①'s tests) and the pubkey pair is sorted.

---

## Cryptographic design

Replaces `crypto/safetyNumber.ts`. Today:

```
computeSafetyNumber(pubA, pubB):
  combined = sortBytes(pubA, pubB)
  digest   = crypto_generichash(20, combined)         // unkeyed, no domain sep
  -> format as space-separated groups of 5 decimal digits
```

New:

```
computeSafetyNumber(pubA, pubB, rootKey):             // rootKey = RK0 from the ratchet seed
  confirmTag = crypto_generichash(32,
                 concat(from_string("TTr:sas-confirm:v3"), rootKey))   // one-way commitment to RK0
  digest     = crypto_generichash(20,
                 concat(from_string("TTr:sas:v3"),                     // domain separation
                        sortBytes(pubA, pubB),                         // still binds the pubkeys
                        confirmTag))                                   // binds the derived secret
  -> SAME decimal-group formatting as today (unchanged)
```

- **`confirmTag`** is a domain-separated one-way hash of `RK₀`. Because `RK₀` (via
  spec ①) mixes the ML-KEM secret, the safety number now covers PQ material — a
  downgrade changes `confirmTag` → changes the number.
- **Domain tags (`TTr:sas:v3` / `TTr:sas-confirm:v3`)** personalize both hashes so
  this construction can't collide with any other use of `crypto_generichash` in the
  app (e.g., the root KDF or channel subkeys).
- **Formatting is byte-for-byte unchanged**, so the screen and comparison gesture
  are identical.

### Interaction with the handshake ordering

Today the safety number is computed right after `deriveSessionKeys`. Now it needs
`RK₀`, which exists only after `initSession` seeds the ratchet. So in
`App.tsx:exchangeKeys`, **move the `computeSafetyNumber` call to after `initSession`**
(both are already in the same success path; this is a small reorder, not new
control flow). `RK₀` must be reachable at that point — either return it from
`initSession` or expose it on the `SessionCrypto` object.

- **Minor API surface:** `initSession` (in `protocol/ratchetSession.ts`) currently
  returns `SessionCrypto`. Add `RK₀` to what the caller can read — simplest is to
  return `{ sc, rootKey }` or attach `rootKey` to `SessionCrypto`. Prefer attaching
  it (or a dedicated `sasKey`) so `handleLeave`'s `zeroizeSession` can wipe it too.
  Do **not** keep `RK₀` around longer than needed; the ratchet mutates its own copy.

---

## Module plan (`/client`)

```
client/src/crypto/
  safetyNumber.ts / safetyNumber.test.ts   # computeSafetyNumber(pubA, pubB, rootKey); domain tags
client/src/protocol/
  ratchetSession.ts                        # expose RK0 to the caller (return or on SessionCrypto);
                                           # ensure zeroize covers it
client/src/App.tsx                         # exchangeKeys: compute the safety number AFTER initSession,
                                           # passing RK0; both initiator and responder paths
```

`safetyNumber.ts` stays a pure module with Vitest coverage (as today).

---

## Data flow (unchanged for the user)

1. Handshake completes; the ratchet is seeded (spec ①) → both sides hold `RK₀`.
2. Each side computes the safety number over `sortBytes(pubkeys) + hash(RK₀)` with
   domain separation.
3. The safety-number screen shows it — same UI. If a relay swapped keys or stripped
   PQ, the two humans see **different** numbers and stop. Exactly the current
   gesture, now harder to fool.

## Error handling / edge cases

- **`RK₀` unavailable** (handshake failed before seeding) → we never reach the
  safety-number screen; the error path already handles this.
- **Version skew** → spec ①'s `PROTOCOL_VERSION` guard fires before we get here.
- **Both sides must be v3.** A v2↔v3 mix can't complete the handshake (spec ①), so
  there's no "one side binds, one doesn't" mismatch to handle.

## Testing

- **`safetyNumber.test.ts`:**
  - Deterministic: same `(pubA, pubB, rootKey)` in either argument order → identical
    number (pubkey sort + shared `RK₀`).
  - Binding: holding the pubkeys fixed but changing `rootKey` changes the number
    (this is the downgrade/MITM detector — the key new test).
  - Still binds pubkeys: changing a pubkey changes the number.
  - Domain separation: the v3 output differs from the old pubkey-only digest for the
    same pubkeys (proves the reformat took effect).
  - Format unchanged: output matches the existing group-of-5 decimal shape.
- **Integration (with spec ①):** both simulated handshake sides produce the *same*
  number; a simulated PQ downgrade produces a *different* number on the downgraded
  side.
- **Manual:** two-browser pass — both sides land on a matching number and proceed
  to chat (same eyeball as every prior phase).

Acceptance: `cd client && npm run typecheck && npm test && npm run build` green;
the "change `rootKey` ⇒ number changes" test passes; two-browser numbers match.

## Residuals (documented, honest)

- **Still relies on humans actually comparing the number.** Binding makes the
  number *trustworthy*; it does not *force* anyone to check it. The enforcement UI
  (affirmation + unverified banner, review H1/B1) is deliberately out of scope here
  (UX-touching). This is the single biggest real-world residual and should be noted
  for a future UX-relaxed pass.
- **The safety number verifies *this session*, not "this person forever."** Keys are
  ephemeral (no persistent identity) — unchanged from today's model.

## Build order

Ships with spec ① on `feat/pq-hybrid-handshake`, as its final step:

1. (spec ①) hybrid `RK₀` derivation lands and exposes `RK₀` from `initSession`.
2. Reformat `computeSafetyNumber` with the `rootKey` + domain tags (+ tests).
3. Reorder the `App.tsx` call to after `initSession`.
4. Two-browser eyeball confirming matching numbers + normal chat.

## Rollout

- Same branch/plan as spec ① (`feat/pq-hybrid-handshake`).
- **Log on build** (`AGENTS.md`): note L2 closed, and that H1 *enforcement* was
  deliberately left out (backend-only steer) in `decisions.md`; update
  `progress.md`.
- Commit/push per `AGENTS.md`.
