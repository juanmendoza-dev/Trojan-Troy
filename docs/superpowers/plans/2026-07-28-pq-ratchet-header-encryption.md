# Plan — PQ Double Ratchet + Header Encryption (round-2 A+B)

Spec: `docs/superpowers/specs/2026-07-28-pq-ratchet-header-encryption-design.md`
Branch: `feat/pq-ratchet-header-encryption` (off `feat/crypto-round-integration`,
**not** `main` — this revises the same `msg` wire format PR #15 just integrated)

`PROTOCOL_VERSION` 4 → 5. No server change. Tasks 1–4 are a dependency spine and
must land in order; 5–7 are independent. Each task ends green (typecheck + tests)
before the next starts.

## Task 1 — `crypto/kdf.ts`: 96-byte root KDF + header-key derivation

- `kdfRoot(rk, dh, pqSecret?)` → `{ rk, ck, nhk }`, from a single 96-byte
  keyed BLAKE2b: `key = rk`, `msg = "TTr:rk:v5" ‖ dh ‖ (pqSecret ?? empty)`.
  Absent `pqSecret` must be byte-identical to the no-PQ vector (one code path).
- `deriveHeaderKeys(rk0)` → `{ i2r, r2i, nhI2r, nhR2i }`, domains
  `TTr:hdr:i2r:v5` / `TTr:hdr:r2i:v5` / `TTr:nhdr:i2r:v5` / `TTr:nhdr:r2i:v5`.
- `deriveHeaderSubkey(dirKey, cls)` — static-class header keys, domain
  `TTr:hdrsub:<cls>:v5`.
- Keep `deriveRootKey` (RK₀) and `deriveChannelSubkey` as they are, but bump their
  domains v4 → v5 for consistency with the version bump.
- Tests: 96-byte split stable and distinct; `nhk` ≠ `rk` ≠ `ck`; `pqSecret` changes
  output; no-`pqSecret` vector unchanged; header keys mutually distinct and
  deterministic; `deriveHeaderSubkey` differs per class.

## Task 2 — `crypto/header.ts` (new, pure)

- `packHeader({ cls, fold, pn, n, dh })` → 44 bytes, exact layout from the spec
  (`cls` u8, `ver` u8 = 5, `fold` u16LE, `pn` u32LE, `n` u32LE, `dh` 32 B).
- `unpackHeader(bytes)` → the struct; throws on wrong length or `ver ≠ 5`.
- `sealHeader(hk, headerBytes)` → 84 bytes (XChaCha20-Poly1305, no AAD).
- `openHeader(hk, encHeader)` → 44 bytes or `null` (must **not** throw — the
  trial-decrypt walk depends on a cheap negative).
- `SEALED_HEADER_LEN = 84` exported for the split in `ratchetSession`.
- Tests: round-trip every class; sizes are exactly 44 / 84; `openHeader` returns
  `null` under a wrong key; a flipped bit anywhere in the 84 fails; `ver` guard.

## Task 3 — `crypto/framing.ts`

- `Channel` gains `"pqoffer" | "pqaccept"`.
- Test: both round-trip through `frame`/`unframe` with a 1184-byte body and land in
  the 4096 bucket (documents the size the cover tail in Task 7 has to match).

## Task 4 — `crypto/ratchet.ts`

The big one. Split into commits.

**4a — state + header keys.** `RatchetState` gains `HKs`, `HKr`, `NHKs`, `NHKr`,
`pqFold: number`, `pqPending: Array<{ offerId: number; secret: Uint8Array }>`.
`initAlice`/`initBob` take the four seed header keys. `MKSKIPPED` values become
`{ hk, mk }`. `dhRatchet` rotates `HKr = NHKr` / `NHKs = NHKs'` and stores the
`nhk` from each `kdfRoot`.

**4b — sealed headers on encrypt.** `ratchetEncrypt` packs + seals the header under
`HKs`, uses the 84-byte `encHeader` as the body AAD, and returns
`{ encHeader, payload }` instead of `{ header, payload }`. Drop `aadFor`.

**4c — trial decrypt.** `ratchetDecrypt(state, encHeader, payload)`: walk candidates
`HKr` → `NHKr` → distinct `hk`s among skipped entries (**cap 8 most recent chains**)
and return the opened header + which candidate matched; `NHKr` matching means a new
chain → `dhRatchet`. Stays transactional: clone → decrypt → commit only on success.

**4d — PQ folds.** In `dhRatchet`: on the **send** step, if `pqPending` is non-empty,
fold the lowest `offerId` into `kdfRoot` and `pqFold += 1`. On the **recv** step, if
the incoming header's `fold > state.pqFold`, fold pending secrets in `offerId` order
until they match — throwing a distinguishable `PqFoldPending` error if a needed
secret is absent (the caller buffers on that specific error, not on generic
failure). Zeroize each secret as it's folded.

- Tests: existing suite ported to sealed headers; PQ fold round-trip keeps both
  sides in sync across several flips; folding on one side only makes the chains
  diverge (proves the fold is load-bearing); out-of-order across a flip still
  decrypts via a stored `hk`; a straggler older than the 8-chain cap drops without
  crashing; replay still rejected; a tampered `encHeader` fails and leaves the
  session usable.

## Task 5 — `protocol/pqRekey.ts` (new, pure)

Shaped like `coverTraffic.ts` — decisions only, no timers, no crypto:

- `PQ_REKEY_INTERVAL_MS = 30_000`, `PQ_REKEY_JITTER_FRAC = 0.3`,
  `PQ_REKEY_MESSAGES = 200`.
- `shouldOffer({ now, lastOfferAt, contentSentSinceOffer, interval })` → boolean
  (interval **or** message count, whichever first).
- `nextOfferId(current)` → u16 monotonic with wraparound guard.
- `sortPending(pending)` → deterministic `offerId` order (both sides must agree).
- Tests: fires on interval; fires on count before interval; jitter bounds; id
  monotonicity + wrap; `sortPending` is a total order.

## Task 6 — `protocol/ratchetSession.ts`

- `sealContent` → `{ type: "msg", payload: base64(encHeader ‖ body) }`.
- `sealStatic` → same single-blob shape; header carries `cls` + a monotonic
  per-channel send counter; sealed under `deriveHeaderSubkey(txDir, cls)`.
- `openMsg(sc, env)`: decode base64, split at `SEALED_HEADER_LEN`, trial-decrypt
  (content candidates first, then the three static header keys), then route on
  `cls`. Static classes check a **replay window** (sliding, high-water + 64-slot
  bitmap) and drop anything already seen or too old.
- `SessionCrypto` gains the header keys, static counters/windows, `pqOwnOffer`
  (initiator's live keypair + id), and keeps `rootKey`.
- `initSession` seeds header keys from `RK₀` via `deriveHeaderKeys`.
- Tests: content + all three static classes round-trip; cross-class relabel fails;
  static replay dropped; a corrupt payload leaves the session usable; two static
  sends in a row both accepted (counter advances, window doesn't false-positive).

## Task 7 — `protocol/coverTraffic.ts`

- `coverBodyLen`: keep ~80 % → 256 and ~17 % → 1024, add **~3 %** → 4096 so PQ
  frames aren't the only 4096-bucket traffic. Never 64 (existing constraint).
- Update its test: 4096 is reachable, 64 never, distribution roughly as intended
  over a seeded sample.

## Task 8 — `net/relayClient.ts`

- `Envelope`'s `msg` → `{ type: "msg"; payload: string }`; remove the
  `RatchetHeader` re-export and its import.
- `PROTOCOL_VERSION = 5`; refresh the comment (v5 = sealed headers + PQ ratchet).
- Update the existing `relayClient` tests that construct `msg` envelopes.

## Task 9 — `App.tsx`

- **Rekey timer (initiator only):** an effect gated on `screen.name === "chat"` +
  a seeded session, using `shouldOffer`; generates a keypair, stores it as
  `pqOwnOffer`, sends `pqoffer` through the existing `sendContentFrame` choke point
  (so it counts as real traffic and cover backs off).
- **`pqoffer` receive (responder):** encapsulate, push the secret to
  `ratchet.pqPending`, send `pqaccept`. **`pqaccept` receive (initiator):**
  decapsulate, push to `pqPending`, zeroize the offer's secret key.
- Both new channels are decrypted-then-dropped in the `switch` (like `primer` /
  `cover`) — no UI.
- Buffer-and-retry on the `PqFoldPending` error, reusing the existing inbound
  buffer.
- Extend `zeroizeSession` to `HKs/HKr/NHKs/NHKr`, `pqPending` secrets, and
  `pqOwnOffer.secretKey`.
- Content-send counter for `shouldOffer` lives next to `lastContentSentRef`.

## Task 10 — copy, docs, verification

- `Settings.tsx` about/security copy — healing now re-secures with post-quantum key
  material periodically (**not** "every message is post-quantum"); the relay no
  longer sees ratchet counters or message class. Keep the residuals honest.
- `progress.md` + `decisions.md` entries; `roadmap.md` round-2 line.
- `npm run typecheck && npm test && npm run build` green.
- Throwaway two-browser Playwright run from a scratch dir (delete after): matching
  safety numbers, chat both ways, **no `c`/`header` field on any `msg`**, every
  payload's first 84 bytes are a sealed header, ≥ 2 PQ folds with a shortened test
  interval and chat still working across them, cover traffic unaffected, no console
  errors.
- Commit per `AGENTS.md` (short human messages, signed, human identity).
