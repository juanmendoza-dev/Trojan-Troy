# Plan — Hardened Handshake (commit-then-reveal + transcript binding)

Spec: `docs/superpowers/specs/2026-07-26-hardened-handshake-design.md`
Branch: `feat/hardened-handshake` (off `main`)

## BUILD STATUS — COMPLETE (built + green on `feat/hardened-handshake`, 2026-07-26)

- [x] Task 1 — `crypto/transcript.ts` + tests (pure commit/transcript hashes)
- [x] Task 2 — `crypto/kdf.ts` `deriveRootKey` transcript arg + domains v4 + tests
- [x] Task 3 — `protocol/ratchetSession.ts` `initSession` threads transcript + tests
- [x] Task 4 — `crypto/safetyNumber.ts` domain bump v3 → v4
- [x] Task 5 — `net/relayClient.ts` `commit` envelope + `PROTOCOL_VERSION = 4`
- [x] Task 6 — `App.tsx` commit-then-reveal choreography + transcript compute
- [x] Task 7 — verify (typecheck / 185 tests / build all green); docs updated

Manual two-browser eyeball still pending (Playwright now available). Also touched
`crypto/ratchet.test.ts` (its `setup()` calls `deriveRootKey`, so it gained a shared
transcript-hash stand-in).

## Tasks

### Task 1 — `crypto/transcript.ts`
Two pure functions (BLAKE2b via libsodium):
- `computeHandshakeCommit(x25519Pub, kemPub?: Uint8Array | null): Promise<Uint8Array>`
  — `H(material, key="TTr:commit:v4")`, material = `pub` or `pub‖kem`.
- `computeTranscriptHash(pubA, pubB, kemPub, kemCt, version): Promise<Uint8Array>`
  — sort the two X25519 pubkeys by hex, `H(version‖first‖second‖kemPub‖kemCt, key="TTr:transcript:v4")`.
- Tests: commit determinism + key-dependence + with/without KEM differ; transcript
  order-invariance over pubkeys, dependence on version/kemPub/kemCt, length 32.

### Task 2 — `crypto/kdf.ts`
- `deriveRootKey(rx, tx, pqSecret, transcriptHash)` — add the 4th arg and a third
  keyed step `H(32, "TTr:root:tr:v4", withPq‖transcriptHash)`; bump the two existing
  domains to v4. Keys stay ≤ 64 bytes.
- Tests: update calls; add "different transcript → different RK₀"; keep order-invariance.

### Task 3 — `protocol/ratchetSession.ts`
- `initSession(sessionKeys, role, ownKeypair, peerPublicKey, pqSecret, transcriptHash)`
  — pass `transcriptHash` to `deriveRootKey`.
- Tests: `pair()` computes one real transcript hash and feeds it to both sides;
  add a "different transcript per side → root keys diverge" case.

### Task 4 — `crypto/safetyNumber.ts`
- Bump `TTr:sas-confirm:v3` / `TTr:sas:v3` → `v4`. Property tests unchanged.

### Task 5 — `net/relayClient.ts`
- Add `| { type: "commit"; v: number; commit: string }`; `PROTOCOL_VERSION = 4`;
  refresh the comment (v4 adds the commit-then-reveal round + transcript binding).

### Task 6 — `App.tsx`
- In `exchangeKeys`: send `commit` (not `pubkey`) as the opening move; add a
  `commit` branch that stores the peer commit then reveals `pubkey`; on `pubkey`
  verify `computeHandshakeCommit(peerReveal) == peerCommit`; compute
  `computeTranscriptHash(...)` and pass it through `finishHandshake` → `initSession`.
- Extend the single-shot guards to `commit`/`pubkey`/`kemct` (dup / out-of-order →
  `handshake_failed`). Keep the fail-closed downgrade check and the `msg`/primer path.

### Task 7 — verify + docs
- `cd client && npm run typecheck && npm test && npm run build` green.
- `progress.md` (new log entry + status row), `decisions.md` (commit-reveal +
  transcript binding + `PROTOCOL_VERSION` 3→4). Commit per `AGENTS.md`.
