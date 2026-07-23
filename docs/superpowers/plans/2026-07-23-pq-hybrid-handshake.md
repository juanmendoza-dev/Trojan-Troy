# Post-Quantum Hybrid Handshake + Safety-Number Binding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Design sources of truth (re-read before each task; crypto rationale lives there, not fully duplicated here):
> - `docs/superpowers/specs/2026-07-23-pq-hybrid-handshake-design.md` (spec ①)
> - `docs/superpowers/specs/2026-07-23-safety-number-binding-design.md` (spec ②)

> **BUILD STATUS — 2026-07-23 (BUILT; manual two-browser eyeball pending).** ① (hybrid
> X25519 + ML-KEM-768 handshake) and ② (safety-number bound to the derived root key) built
> on `feat/pq-hybrid-handshake`. `npm run typecheck` clean, **163** client tests, build
> green; the full handshake choreography (root-key agreement, session-bound safety number,
> joiner-first via primer, corrupt-`kemct` fails) verified with a throwaway real-module
> test. Both invisible to the user — handshake bytes + safety-number digits only.
>
> - [x] **Task 0** — logged the security round + new-dependency reversal (`decisions.md`, `roadmap.md`)
> - [x] **Task 1** — `crypto/pqkem.ts` ML-KEM-768 wrapper (4 tests)
> - [x] **Task 2** — `crypto/kdf.ts` hybrid `deriveRootKey(rx, tx, pqSecret)`, domain tag → v3
> - [x] **Task 3** — `protocol/ratchetSession.ts` threads `pqSecret`; exposes `rootKey`
> - [x] **Task 4** — `crypto/safetyNumber.ts` binds `rootKey` + domain tags (spec ②)
> - [x] **Task 5** — `net/relayClient.ts` `kem?` on pubkey, `kemct` envelope, `PROTOCOL_VERSION = 3`
> - [x] **Task 6** — `App.tsx` handshake wiring: KEM roles, fail-closed downgrade, buffered inbound, extended H2, safety number after seed, zeroize rootKey
> - [x] **Task 7** — honest about/security copy + `progress.md`; **manual two-browser eyeball still pending**
>
> **⚠ Scouted gotchas:**
> - The handshake stops being symmetric. Today both sides send `pubkey` and seed on
>   receipt. Now the **responder holds a KEM keypair** and seeds only *after* the
>   initiator's `kemct` arrives. Task 6 must reorder the responder path and **buffer
>   any inbound `msg` until `RK₀` exists** (the async `onMessage` listener means the
>   initiator's `primer`/profile-card can otherwise race ahead of seeding).
> - `initSession`'s signature changes (adds `pqSecret`). The `pair()` helper in
>   `protocol/ratchetSession.test.ts:19` and the call sites in `App.tsx` must be updated
>   in the same task or typecheck/tests break.
> - `computeSafetyNumber`'s signature changes (adds `rootKey`). `safetyNumber.test.ts`
>   and the `App.tsx` call site update together.
> - Expect `npm run typecheck` to be RED between Task 3 and the end of Task 6 (App.tsx
>   still calls the old signatures until rewired) — normal mid-phase; vitest runs per-file.

**Goal:** Make the session-key agreement **post-quantum** — run X25519 (as today) *and*
ML-KEM-768, and fold both shared secrets into the ratchet's initial root key `RK₀`, so the
session is safe unless *both* break (defeats "harvest now, decrypt later"). Then bind the
safety number to `RK₀` so a relay that strips PQ back to classical (a downgrade) changes the
digits the two humans compare. Zero UX change. Closes the HNDL gap + review L2; sets up B7/TOFU.

**Architecture:** A thin new `crypto/pqkem.ts` wraps ML-KEM-768 from `@noble/post-quantum`.
`crypto/kdf.ts`'s `deriveRootKey` gains a third input (the PQ shared secret) under a bumped
domain tag. `protocol/ratchetSession.ts`'s `initSession` threads that secret through and
exposes `RK₀` as `SessionCrypto.rootKey`. `crypto/safetyNumber.ts` hashes `RK₀` + domain tags
into the number. `net/relayClient.ts` carries an optional KEM public key on `pubkey` and a new
`kemct` envelope; `PROTOCOL_VERSION` → 3. `App.tsx`'s `exchangeKeys` becomes role-asymmetric:
responder = KEM keypair holder / decapsulator, initiator = encapsulator, with fail-closed
downgrade handling and an inbound buffer. **No server change** — `pubkey`/`kemct` ride the
relay's opaque unknown-type pass-through (server validates only `create`/`join`).

**Tech Stack:** TypeScript, React, Vite, Vitest, `libsodium-wrappers` ^0.7.15 (unchanged for
this cluster) **plus one new audited dependency: `@noble/post-quantum`** (ML-KEM-768 = NIST
FIPS 203; Cure53-audited; pure TS). This is the first crypto dep beyond libsodium — a
deliberate, logged reversal (Task 0).

## Global Constraints

- Never hand-roll cryptographic primitives — audited libraries only. ML-KEM comes from
  `@noble/post-quantum`; the hybrid combiner is keyed BLAKE2b (existing `crypto_generichash`).
  (`AGENTS.md`, review §1.)
- The relay only routes opaque envelopes — it never inspects `pubkey`/`kemct`/`msg` beyond the
  `type` needed to route. No server change in this cluster.
- **Fail closed on downgrade.** A v3 client must never silently fall back to classical-only if
  the PQ material is missing/stripped — it errors. There is no classical-fallback code path.
- Preserve review §2 invariants: `crypto_kx` rx/tx separation stays load-bearing; the Double
  Ratchet core (`ratchet.ts`) is untouched (only `RK₀`'s *derivation* changes); the relay stays
  blind.
- Commit messages: short, plain-language, human-sounding — no AI verbosity, no extra trailers,
  never AI-authored/co-authored (`AGENTS.md`).
- **Run `git commit` from PowerShell, not the Bash tool** — Git-Bash's bundled `gpg` reads a
  different keyring and signing silently fails there; native Windows `gpg` (PowerShell) signs
  correctly. `git add`/`git push` are fine from either shell. A `post-commit` hook auto-pushes.
- Commit early and often — one commit per task minimum (`AGENTS.md`).
- Pure-logic modules get Vitest coverage (`pqkem`, `kdf`, `ratchetSession`, `safetyNumber`);
  `App.tsx` is verified by a throwaway protocol script + a manual two-browser pass (standing
  convention, `decisions.md` 2026-07-20).

---

## File Structure

```
client/package.json                         # + "@noble/post-quantum"
client/src/crypto/
  pqkem.ts / pqkem.test.ts                   # NEW: ML-KEM-768 keygen/encapsulate/decapsulate wrapper
  kdf.ts  / kdf.test.ts                      # MOD: deriveRootKey(rx, tx, pqSecret); domain tag v2 -> v3
  safetyNumber.ts / safetyNumber.test.ts     # MOD: computeSafetyNumber(pubA, pubB, rootKey) + domain tags
client/src/protocol/
  ratchetSession.ts / .test.ts               # MOD: initSession(..., pqSecret); expose SessionCrypto.rootKey
client/src/net/relayClient.ts                # MOD: kem? on pubkey; kemct envelope; PROTOCOL_VERSION = 3
client/src/App.tsx                           # MOD: exchangeKeys KEM roles/downgrade/buffer/H2; safety number after seed; zeroize rootKey
docs/.../plans + decisions.md, roadmap.md, progress.md   # Task 0 + Task 7
```

No server files change.

---

### Task 0: Log the security round + dependency reversal (do first, per `AGENTS.md`)

**Files:** Modify `decisions.md`, `roadmap.md`.

- [ ] **Step 1:** `decisions.md` (newest at top) — add an entry: the 2026-07-23 backend-only
  security round (4 specs), building ①+② first; the **new-dependency reversal** (adding
  `@noble/post-quantum` for ML-KEM-768 — the first crypto dep beyond libsodium, still an audited
  library); the `PROTOCOL_VERSION` 2→3 bump; and that H1 *enforcement* (the affirmation/banner UI)
  is deliberately excluded (UX-touching). Reference the two specs + this plan. (Decided by: Jay
  (direction + go-ahead) + Claude (crypto/design/implementation calls).)
- [ ] **Step 2:** `roadmap.md` — add a Phase 5 security-hardening sub-item for the PQ round (note
  it's independent of the feature roadmap; backend/data-handling only).
- [ ] **Step 3: Commit** (PowerShell): `git commit -m "Log post-quantum hardening round and new dependency"`

---

### Task 1: ML-KEM-768 wrapper (`crypto/pqkem.ts`)

**Files:** `client/package.json`; create `client/src/crypto/pqkem.ts`, `client/src/crypto/pqkem.test.ts`.

- [ ] **Step 1:** `cd client && npm install @noble/post-quantum`. Confirm the installed export
  path + API in `node_modules/@noble/post-quantum` (expected: `import { ml_kem768 } from
  "@noble/post-quantum/ml-kem"`; `keygen() -> { publicKey, secretKey }`; `encapsulate(publicKey)
  -> { cipherText, sharedSecret }`; `decapsulate(cipherText, secretKey) -> sharedSecret`).
  **Adjust the wrapper to the real API if names differ.**

**Interface (produced, used by App.tsx):**
- `interface KemKeypair { publicKey: Uint8Array; secretKey: Uint8Array }`
- `generateKemKeypair(): KemKeypair`
- `kemEncapsulate(publicKey): { cipherText: Uint8Array; sharedSecret: Uint8Array }`
- `kemDecapsulate(cipherText, secretKey): Uint8Array`
- Optionally re-export byte-length consts for tests.

- [ ] **Step 2: Write failing tests** — `encapsulate`→`decapsulate` agree on the 32-byte shared
  secret; public/secret/ciphertext byte lengths match ML-KEM-768 (1184 / 2400 / 1088 — confirm
  against the lib); a **flipped-bit ciphertext yields a *different* (not thrown) secret** (ML-KEM
  implicit rejection — the key behavioral contract downstream code relies on).
- [ ] **Step 3: Run tests, verify fail** (`Cannot find module './pqkem'`).
- [ ] **Step 4: Implement** the thin wrapper (synchronous — noble is sync; no `sodium.ready`).
- [ ] **Step 5: Run tests, verify pass.**
- [ ] **Step 6: Commit** (PowerShell): `git commit -m "Add ML-KEM-768 key encapsulation wrapper"`

---

### Task 2: Hybrid root key (`crypto/kdf.ts`)

**Files:** Modify `client/src/crypto/kdf.ts`, `client/src/crypto/kdf.test.ts`.

- [ ] **Step 1:** Change `deriveRootKey(rx, tx)` → `deriveRootKey(rx, tx, pqSecret: Uint8Array)`:
  `RK₀ = crypto_generichash(32, message = "TTr:root:pq:v3", key = concat(sortBytes(rx,tx), pqSecret))`.
  Bump the domain tag `v2 → v3`. Leave `kdfRoot`/`kdfChain`/`deriveChannelSubkey` unchanged.
- [ ] **Step 2:** Update `kdf.test.ts`: `deriveRootKey` now takes a third arg — pass a fixed
  `pqSecret` in the order-invariance + key-dependence tests, and add: **same classical pair +
  same `pqSecret` on both role orders → identical `RK₀`**; **holding the classical pair fixed but
  changing `pqSecret` → different `RK₀`** (the downgrade/PQ-binding property).
- [ ] **Step 3: Run tests → pass** (`cd client && npm test -- kdf`).
- [ ] **Step 4: Commit** (PowerShell): `git commit -m "Fold the post-quantum secret into the root key"`

---

### Task 3: Thread the PQ secret through the session (`protocol/ratchetSession.ts`)

**Files:** Modify `client/src/protocol/ratchetSession.ts`, `client/src/protocol/ratchetSession.test.ts`.

- [ ] **Step 1:** `initSession(sessionKeys, role, ownKeypair, peerPublicKey)` →
  `initSession(sessionKeys, role, ownKeypair, peerPublicKey, pqSecret: Uint8Array)`. Compute
  `rk0 = deriveRootKey(sessionKeys.rx, sessionKeys.tx, pqSecret)` (as today but with `pqSecret`),
  and **add `rootKey: rk0` to the returned `SessionCrypto`** (for spec ②'s safety number; the
  ratchet still consumes `rk0` exactly as before via `initAlice`/`initBob`). Add `rootKey` to the
  `SessionCrypto` interface.
- [ ] **Step 2:** Update `ratchetSession.test.ts`'s `pair()` helper (line ~19): both `initSession`
  calls take a **shared** `pqSecret` (generate one 32-byte value, pass it to both sides — that's
  what the real handshake produces). All existing round-trip/relabel/corrupt tests then pass
  unchanged. Add one assertion: `a.rootKey` equals `b.rootKey` (both derive the same `RK₀`).
- [ ] **Step 3: Run tests → pass** (`cd client && npm test -- ratchetSession`).
- [ ] **Step 4: Commit** (PowerShell): `git commit -m "Seed the session root key with the PQ secret"`

---

### Task 4: Bind the safety number to the root key (`crypto/safetyNumber.ts`) — spec ②

**Files:** Modify `client/src/crypto/safetyNumber.ts`, `client/src/crypto/safetyNumber.test.ts`.

- [ ] **Step 1:** `computeSafetyNumber(pubA, pubB)` → `computeSafetyNumber(pubA, pubB, rootKey)`:
  `confirmTag = crypto_generichash(32, concat(from_string("TTr:sas-confirm:v3"), rootKey))`;
  `digest = crypto_generichash(20, concat(from_string("TTr:sas:v3"), sortBytes(pubA,pubB), confirmTag))`.
  **Keep the decimal-group formatting byte-for-byte** (same screen). `rootKey` never appears in
  the output — only its one-way hash.
- [ ] **Step 2:** Update `safetyNumber.test.ts`: pass a fixed `rootKey` to existing tests; add:
  **fixed pubkeys, changed `rootKey` → different number** (the downgrade/MITM detector); the
  format regex test still passes; determinism regardless of pubkey order still holds.
- [ ] **Step 3: Run tests → pass** (`cd client && npm test -- safetyNumber`).
- [ ] **Step 4: Commit** (PowerShell): `git commit -m "Bind the safety number to the derived root key"`

---

### Task 5: Wire format (`net/relayClient.ts`)

**Files:** Modify `client/src/net/relayClient.ts`.

- [ ] **Step 1:** Add optional `kem?: string` to the `pubkey` envelope; add
  `{ type: "kemct"; payload: string }`; bump `export const PROTOCOL_VERSION = 3`. (Everything else
  unchanged — the `msg` collapse from 5.2 stays.)
- [ ] **Step 2:** `relayClient.test.ts` needs no change (it doesn't assert `pubkey`/version shape),
  but run it to confirm green.
- [ ] **Step 3: Commit** (PowerShell): `git commit -m "Add KEM fields to the handshake wire format"`

---

### Task 6: Handshake wiring (`App.tsx`) — the integration

**Files:** Modify `client/src/App.tsx`. Verified by a throwaway protocol script + manual pass, not
unit tests. Re-locate lines before editing (they drift).

The current `exchangeKeys` (`App.tsx:284`) is symmetric: both send `pubkey`, both seed on receipt.
Restructure into a role-asymmetric flow with a shared finalizer:

- [ ] **Step 1 — imports/state:** import `generateKemKeypair`, `kemEncapsulate`, `kemDecapsulate`
  from `./crypto/pqkem`. Inside `exchangeKeys`, add closure vars: `const kemKeypair = role ===
  "responder" ? generateKemKeypair() : null;`, `let classicalKeys: SessionKeys | null = null;`,
  `let peerPub: Uint8Array | null = null;`, `const inbound: Envelope[] = [];`.
- [ ] **Step 2 — shared finalizer** `finishHandshake(sessionKeys, peerPublicKey, pqSecret)`:
  `const sc = await initSession(sessionKeys, role, own, peerPublicKey, pqSecret); sessionCryptoRef.current = sc;`
  then the existing profile-card send + (initiator-only) primer send, then
  `const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey, sc.rootKey);`
  the existing `HANDSHAKE_MIN_MS` delay + `disconnected` guard + `setScreen("safety-number")`,
  and finally drain `inbound` through the msg handler (Step 5).
- [ ] **Step 3 — `pubkey` branch (extended H2 + version + roles):**
  - Guard: `if (sessionCryptoRef.current || peerPub) → error "handshake_failed"` (extends H2 to the
    pre-seed responder window — a second pubkey is a violation).
  - `if (envelope.v !== PROTOCOL_VERSION) → error`.
  - `peerPub = fromBase64(envelope.payload); classicalKeys = await deriveSessionKeys(own, peerPub, role)`.
  - **initiator:** `if (!envelope.kem) → error "handshake_failed"` (fail-closed downgrade);
    `const { cipherText, sharedSecret } = kemEncapsulate(fromBase64(envelope.kem));`
    `client.send({ type:"kemct", payload: await toBase64(cipherText) });`
    `await finishHandshake(classicalKeys, peerPub, sharedSecret);`
  - **responder:** do nothing else yet — wait for `kemct`.
  - Wrap in try/catch → `handshake_failed`.
- [ ] **Step 4 — `kemct` branch (responder only):**
  `if (role !== "responder" || !classicalKeys || !peerPub || !kemKeypair || sessionCryptoRef.current) → error`
  (rejects a stray/duplicate/misordered kemct — also the H2 analogue for the KEM leg);
  `const sharedSecret = kemDecapsulate(fromBase64(payload), kemKeypair.secretKey);`
  `await finishHandshake(classicalKeys, peerPub, sharedSecret);` (try/catch → error).
- [ ] **Step 5 — buffer inbound `msg` until seeded:** extract the existing `type === "msg"` body
  into a local `async function handleMsg(envelope)`. In the dispatcher: `if (envelope.type ===
  "msg") { if (!sessionCryptoRef.current) { inbound.push(envelope); return; } await handleMsg(envelope); }`.
  `finishHandshake` drains `inbound` (in order) through `handleMsg` after setting the ref. (This
  closes the async-listener race where the initiator's primer/profile-card arrives at the responder
  before its `RK₀` exists.)
- [ ] **Step 6 — outgoing pubkey carries the KEM key (responder):** where `exchangeKeys` sends
  `pubkey`, attach `kem` for the responder:
  `const pub = { type:"pubkey", payload: await toBase64(own.publicKey), v: PROTOCOL_VERSION };
   if (kemKeypair) (pub as any).kem = await toBase64(kemKeypair.publicKey); client.send(pub);`
- [ ] **Step 7 — zeroize `rootKey` on leave:** in `zeroizeSession` (`App.tsx:104`), add
  `sodium.memzero(sc.rootKey)` alongside the ratchet secrets/subkeys.
- [ ] **Step 8: Typecheck** (`cd client && npm run typecheck`) — resolve any signature fallout.
- [ ] **Step 9: Protocol-level verification.** Throwaway, uncommitted Node script (delete after):
  start the real relay, open two `ws` connections, drive the real four-message handshake using the
  real `keys.ts`/`pqkem.ts`/`kdf.ts`/`ratchetSession.ts`; assert both sides reach an identical
  `RK₀` and an identical safety number; assert a **dropped `kem`** (initiator) → fail closed;
  assert a **corrupted `kemct`** → the responder's `RK₀` differs → the initiator's primer fails to
  open (the implicit-rejection path); assert content round-trips both directions after seeding.
- [ ] **Step 10: Build** (`cd client && npm run build`) — succeeds.
- [ ] **Step 11: Commit** (PowerShell): `git commit -m "Run a hybrid post-quantum handshake"`

---

### Task 7: Verify end-to-end + honest copy + progress

**Files:** Modify `progress.md`; the Settings about/security copy (`components/Settings.tsx`).

- [ ] **Step 1 — Manual two-browser pass** (acceptance): `cd server && npm run dev` +
  `cd client && npm run dev`; pair two windows; confirm both land on a **matching** safety number,
  exchange text + voice both directions, and that **joiner-first** send still works (the buffered
  primer path). No console errors; behaves exactly as before.
- [ ] **Step 2 — About/security copy:** state the post-quantum protection **honestly** — hybrid
  X25519 + ML-KEM-768 protects the key agreement against "harvest now, decrypt later"; do **not**
  claim "fully post-quantum" (the ongoing ratchet DH is still classical — the documented residual
  in spec ①). Mention the safety number now binds the derived session.
- [ ] **Step 3 — `progress.md`:** status + log entry (what shipped: hybrid PQ handshake, fail-closed
  downgrade, safety-number binding, `PROTOCOL_VERSION` 3; findings closed: HNDL gap + L2; verified
  via protocol script + two-browser). Reference the specs + this plan.
- [ ] **Step 4: Commit** (PowerShell): `git commit -m "Mark post-quantum handshake complete"`

---

## Sequencing summary

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 (integration; typecheck goes green here) → 7. Each numbered task is
one commit minimum; the `post-commit` hook auto-pushes. After merge, run the optional ultracode
adversarial crypto-review pass (per the session decision) before considering the cluster closed.
