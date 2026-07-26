# Reviving Persistent Identity + Contacts Privacy: Reconciliation Spec

Status: Approved (brainstormed with Jay 2026-07-26)
Date: 2026-07-26

## Purpose

On 2026-07-22, persistent cryptographic identity (Phase 5.1) and its contacts-
privacy extension (5.1a) were built, then retired in favor of "Local Profiles"
— a lighter, non-cryptographic persona picker (`decisions.md`, 2026-07-22,
"Retired persistent identity (5.1) + contacts privacy (5.1a)"). The two
original specs were shelved, not deleted:

- `docs/superpowers/specs/2026-07-19-persistent-identity-design.md` (5.1)
- `docs/superpowers/specs/2026-07-22-contacts-privacy-design.md` (5.1a)

Jay has decided to reverse that retirement: bring persistent identity and
contacts privacy back, deliberately, alongside — not instead of — Local
Profiles. This document does **not** re-derive the two shelved specs; both
remain the source of truth for component shapes, store schemas, and UI flows
that haven't changed. Instead, it records:

1. The decision to un-retire, and how identity now relates to Local Profiles.
2. What changed on `main` since 5.1/5.1a were written (the Double Ratchet +
   hybrid PQ handshake, neither of which existed in 2026-07-19) and exactly
   how identity reconciles with that current architecture.
3. What's already salvageable vs. what needs a fresh build.
4. Build order.

Everything in the two shelved specs that this document doesn't explicitly
override still applies.

## Decision: un-retiring 5.1 + 5.1a

Reverses the 2026-07-22 retirement decision. Rationale (Jay, 2026-07-26): the
"same person as yesterday" gap — stable contact recognition, a real contacts
list, safety numbers that survive a reconnect — is wanted after all, on top
of what Local Profiles already delivered. This is a deliberate reversal, not
a misunderstanding of the earlier decision; `decisions.md` gets a new entry
recording it (see Rollout).

## Relationship to Local Profiles

**Local Profiles and identity coexist as two independent, unrelated layers.**
Local Profiles (shipped, `client/src/profiles/`) stays exactly as it is: a
device-local, PIN-gated persona (name + picture) with its own vault and its
own per-profile conversation history — see `2026-07-22-local-profiles-design.md`,
unchanged.

Identity (this document) is a separate, single-per-browser layer: one
identity keypair regardless of which Local Profile (if any) is active, its
own contacts store, its own PIN-gated at-rest vault. The two systems don't
read each other's storage and don't share a PIN. Concretely:

- Switching Local Profiles does **not** change which identity key you connect
  with, and does not change how peers recognize you.
- A peer recognizing you via your identity key is independent of which Local
  Profile you happen to have open, or whether you're on Anonymous.
- The identity `displayName` (set once via `SetupScreen`, 5.1) and a Local
  Profile's `name` are two separate strings that may say different things.
  This is a known, accepted UX overlap — not solved here, flagged for a later
  pass if it proves confusing in practice.

This was chosen over unifying (one identity keypair per Local Profile)
because it's the smaller change, matches how both specs were actually
written (5.1 predates Local Profiles and was never designed against it), and
keeps "who peers recognize you as" decoupled from "which local persona/history
I'm viewing" — two genuinely different concerns.

## Architecture reconciliation against current `main`

5.1's biggest assumption no longer holds: it was written before the Double
Ratchet (`client/src/crypto/ratchet.ts`) and the hybrid PQ handshake
(`client/src/crypto/pqkem.ts`, `kdf.ts`) existed, and its `deriveSessionKeys`
combined identity-DH + ephemeral-DH X3DH-lite, with no ratchet at all. That
approach cannot be dropped into today's handshake as designed. Three
reconciliation decisions, each made explicitly during brainstorming rather
than inherited from the old spec:

### 1. Identity is an informational layer, not a new key-derivation input

`deriveRootKey(rx, tx, pqSecret)` (`client/src/crypto/kdf.ts:22`) and the rest
of the ratchet/PQ path are **untouched**. No identity-to-identity DH feeds
into session confidentiality. Identity keys are exchanged, verified, and used
for recognition/access-control only — consistent with this app's existing
stated position that safety-number *verification*, not automatic crypto
binding, is the real MITM defense (5.1's own "Known limitation" section makes
this same argument for the weaker name-based case).

This was chosen over a full X3DH-style rebind (identity DH as a third leg
into `deriveRootKey`) because the latter reopens code that just went through
PQ hardening and a whole-branch security review, for a security property
(binding confidentiality itself to identity) beyond what this app has ever
claimed to provide.

### 2. The `pubkey` envelope carries identity, not a new envelope type

Verified directly (`client/src/App.tsx`, `exchangeKeys`): both roles already
send a single, symmetric `pubkey` message once
(`client/src/net/relayClient.ts:24`), unconditionally, with only the
responder's carrying a `kem` field. This — not a parallel `"identity"`
envelope as 5.1 originally specced — is the natural, minimal place to carry
identity, since it's already exchanged exactly once per handshake with an
existing single-shot protocol-violation guard (`App.tsx`, the "H2" duplicate-
pubkey check).

```ts
// client/src/net/relayClient.ts — Envelope's "pubkey" variant, extended:
| { type: "pubkey"; payload: string; v: number; kem?: string;
    identityPublicKey: string; displayName?: string }
```

`PROTOCOL_VERSION` (`relayClient.ts:7`) bumps 3→4: `identityPublicKey`
becomes a required field, matching the existing fail-closed pattern for a
missing PQ `kem` field (a stale client without an identity key hits
`handshake_failed`, never a silent downgrade). `displayName` is optional from
the start — 5.1a's later "anonymous presentation" change doesn't need a
second wire-format bump. Plan A (below) always sends the single global
display name set on `SetupScreen`; the per-room "join as" alias/anonymous
picker is Plan B UI on top of the same already-optional field.

### 3. Two-tier verification, replacing the single rootKey-bound safety number

Today, `computeSafetyNumber(publicKeyA, publicKeyB, rootKey)`
(`client/src/crypto/safetyNumber.ts`) sorts the two **ephemeral** public keys
and folds in a one-way commitment to the session's `rootKey`
(`crypto_generichash(32, "TTr:sas-confirm:v3", rootKey)`) before the final
digest. That rootKey binding exists specifically because ML-KEM's FIPS 203
"implicit rejection" means `kemDecapsulate` never throws on a corrupted
ciphertext (`client/src/crypto/pqkem.ts`) — a tampered handshake silently
produces mismatched root keys on the two sides, and the rootKey-bound number
is how a human comparing digits catches that.

A number that's stable across reconnects (identity's whole purpose) cannot
also commit to `rootKey`, which is fresh every session by design. Rather than
choose one property over the other, this splits into two independent checks:

- **`computeIdentitySafetyNumber(identityPublicKeyA, identityPublicKeyB)`** —
  new function, same shape as today's (sort, domain-separated
  `crypto_generichash`, grouped decimal digits) but over identity keys only,
  no rootKey. This is what's shown for manual once-per-contact verification
  (new contact) and what's stored/matched for recognized-contact auto-skip.
  New domain tag (e.g. `"TTr:sas-identity:v4"`) so it can never collide with
  the existing per-session number.
- **An automatic bidirectional handshake confirmation**, replacing the
  rootKey-binding's job without needing a human to eyeball it every
  reconnect (including the recognized-contact path, which skips the manual
  screen entirely). Required end-state property: **neither side leaves the
  handshake screen until it has cryptographic proof the other side derived
  the identical `rootKey`**, and a proof failure routes to today's
  `handshake_failed` scenario explicitly — never a silent entry into chat
  followed by in-chat decryption-error bubbles.
  Building block: the ratchet's AEAD already guarantees a message only
  decrypts if both sides derived the same `rootKey`, so decrypt success of
  a frame sealed under the new session *is* a proof, with no new derived
  value needed. A new `"confirm"` frame channel (added to `Channel` in
  `client/src/crypto/framing.ts:14`, dropped like `"primer"`) is the
  responder's reply.
  **Left to Plan A's implementation plan, not settled here:** the exact
  sequencing. It is not simply symmetric with today's `"primer"` frame —
  the responder has no sending chain until *after* it decrypts the
  initiator's primer (`initBob` seeds no `CKs` until that first receive;
  this is why the primer bootstrap exists at all), so the responder's
  `"confirm"` reply can only be sent from within the primer-received
  handler, not in parallel with it. And today, `setScreen({name:
  "safety-number", ...})` fires synchronously inside `finishHandshake` for
  *both* roles, before either side has necessarily seen the other's
  primer/confirm — the plan must decide precisely how each role's screen
  transition defers until its half of the proof has arrived, without
  breaking the existing `HANDSHAKE_MIN_MS` UX-hold timing or the buffered-
  `inbound` message replay that already exists for the responder's
  pre-seed window.
- The 3-branch `SafetyNumberScreen` (new / recognized / key-changed) from
  5.1 ships as originally specced in Plan A, since at that point display
  names are still 1:1 with identity keys. Plan B collapses it to the 2-branch
  model (drop the name-based key-changed branch) exactly as 5.1a specifies,
  once per-room presented names make that branch unreliable.

### 4. Access control gates before the handshake completes

`decideAccess` (see Salvage inventory below) runs immediately after parsing
the peer's `pubkey` envelope — once `identityPublicKey` is known, before
`kemct`/`finishHandshake`. A `refuse-*` result tears the connection down
without ever completing key derivation into a usable session; no chat, no
session keys reach the UI. Same placement 5.1a originally specified, just
pinned to the concrete point in today's `exchangeKeys` (`App.tsx`) where the
peer's identity first becomes known.

## Salvage inventory: what's reusable vs. what needs a fresh build

Two branches were checked for reusable code (neither merged, neither to be
merged as-is):

**`origin/feat/identity-vault-modules`** (PR #11, open) — 4 self-contained,
primitive-only modules, verified to have zero dependency on any specific
handshake shape, so they slot into the architecture above unchanged:
- `client/src/identity/atRest.ts` — Argon2id (`crypto_pwhash`) key derivation
  + `crypto_secretbox` seal/open for the identity vault. Matches 5.1a's
  `atRest.ts` spec exactly.
- `client/src/identity/lockState.ts` — pure `shouldRelock(lastActivity, now,
  timeoutMs)` predicate. Matches 5.1a's `lockState.ts` spec; timer wiring
  still needs to be built (this branch has only the predicate).
- `client/src/identity/recoveryCode.ts` — encode/decode, optional passphrase
  wrap via `atRest.ts`. Already assumes a `crypto_kx`-shaped secret key
  (`sodium.crypto_kx_SECRETKEYBYTES`), which matches this document's decision
  to keep identity keys on the same primitive as the ephemeral handshake key
  — no changes needed for the informational-layer approach above.
- `client/src/net/accessControl.ts` — pure `decideAccess`, exact shape 5.1a
  specifies. Ready to wire in as-is (§4 above).

Requires the `libsodium-wrappers` → `libsodium-wrappers-sumo` swap (already
done in this branch, and already precedented on `main` by PR #13's at-rest
Local Profile work — same direct-import-site-swap approach, not the config
alias, since the sumo `.d.ts` is self-referential and won't typecheck through
an alias).

**`origin/feat/persistent-identity-contacts`** (older, stale, predates the
ratchet/PQ handshake and Local Profiles — **not mergeable**, reference only)
— has a fuller `identity.ts` (keypair generate/load/persist, display name,
recovery-code integration, contact CRUD) and a generic IndexedDB `store.ts`
that the salvage branch above doesn't have. Since it targets the *same*
`crypto_kx` primitive for the identity keypair, the keypair-generation and
IndexedDB-shape portions are usable as a **reference implementation** for
Plan A's `identity.ts`/`store.ts` — but must be rewritten fresh against
current `main`'s file layout, and its `deriveSessionKeys`/`keys.ts` (the
X3DH-lite combine) must **not** be carried over, since §1 above rejects that
approach.

**Not present anywhere yet, needs building fresh in Plan A:** identity
keypair generation/persistence module, contacts store + CRUD, the extended
`pubkey` envelope + `App.tsx` wiring, `SetupScreen`, `ContactsScreen`, the
3-branch `SafetyNumberScreen` update, `computeIdentitySafetyNumber`, the
confirm-frame mechanism.

## Data flow (delta from 5.1/5.1a's original, reconciled with current `main`)

1. App loads. Identity is loaded or created (`loadOrCreateIdentity`, 5.1). If
   no display name is stored, `SetupScreen` collects one before continuing to
   `StartJoinScreen` — Local Profile selection is unaffected and happens
   independently, as today.
2. User starts/joins a room exactly as today (Local Profiles' flow
   unchanged). Ephemeral ratchet handshake proceeds exactly as today
   (`generateKeypair`, `pubkey`/`kemct` exchange, `deriveRootKey`) — §1.
3. The extended `pubkey` envelope carries `identityPublicKey` + optional
   `displayName` alongside the existing ephemeral/KEM fields — §2. On
   receipt, before `kemct`/`finishHandshake`: `decideAccess` gate (§4) — a
   refusal tears down the connection here.
4. `finishHandshake` proceeds as today (`initSession`, optional profile
   card, initiator's `primer`) plus the new responder `"confirm"` frame —
   §3. Both sides gate on successfully decrypting the peer's confirm/primer
   frame before proceeding; a decrypt failure here → `handshake_failed`.
5. Contacts lookup on the peer's `identityPublicKey` decides the
   `SafetyNumberScreen` branch (new / recognized / key-changed, per 5.1).
   Recognized skips straight to a "Reconnected with `<name>`" banner —
   `computeIdentitySafetyNumber` is stable across this reconnect precisely
   because it never included the ephemeral/PQ material that changes every
   session.
6. Confirming (new or key-changed branch) saves/updates the contacts entry;
   chat unlocks — same gating rule as today (no path to chat skips
   verification).

Plan B layers contacts-only mode, block list, per-contact labels, at-rest
vault + idle re-lock, and passphrase-wrapped recovery codes on top of this,
exactly as `2026-07-22-contacts-privacy-design.md` describes, using the
salvaged `atRest.ts`/`lockState.ts`/`accessControl.ts`/`recoveryCode.ts`
modules as the utility layer.

## Error handling (delta)

- A missing `identityPublicKey` on `pubkey` (stale v3 client) →
  `handshake_failed`, same fail-closed pattern as a missing `kem`.
- `decideAccess` refusal → connection torn down before any session key
  exists; `refuse-unknown` shows a neutral message, `refuse-blocked` is
  silent/indistinguishable from a generic failure (5.1a's original design,
  unchanged).
- Confirm/primer decrypt failure during the handshake-confirmation window →
  `handshake_failed`, distinct from the existing generic in-chat
  decryption-error bubble path (which remains for post-handshake message
  decrypt failures).
- All other error handling (missing/corrupt identity storage, invalid
  recovery codes, IndexedDB unavailable) is unchanged from 5.1/5.1a.

## Known limitations (unchanged from 5.1/5.1a, restated)

- Key-change detection via display name is a heuristic, not a guarantee (5.1
  §"Known limitation") — still true, still resolved the same way (routes
  into mandatory safety-number verification, doesn't replace it).
- At-rest vault protects a locked/stolen device only, not malware while
  unlocked or a known PIN (5.1a's threat model section) — unchanged.
- The identity `displayName`/Local Profile `name` overlap (see "Relationship
  to Local Profiles" above) is accepted, not solved, in this pass.

## Testing (delta)

- `computeIdentitySafetyNumber`: new test — stable across two derivations
  sharing identity keys but differing in ephemeral/rootKey material (proves
  the property this whole feature exists to deliver).
- `decideAccess` / `atRest.ts` / `lockState.ts` / `recoveryCode.ts`: reuse
  the salvage branch's existing test suites (already passing against
  current `main`'s libsodium-sumo build).
- New integration coverage: extended `pubkey` envelope round-trips with
  `identityPublicKey`; a tampered/mismatched confirm exchange routes to
  `handshake_failed`; contacts-only refusal happens before any session key
  is derivable.
- Everything else per 5.1/5.1a's original testing sections, unchanged.

## Build order

**Plan A — Core identity + contacts.** Identity keypair + `SetupScreen`,
extended `pubkey` envelope + `PROTOCOL_VERSION` bump, `computeIdentitySafetyNumber`
+ confirm-frame mechanism, contacts store, 3-branch `SafetyNumberScreen`,
`ContactsScreen`, plaintext recovery code export/import. Independently
shippable — closes the "same person as yesterday" gap on its own.

**Plan B — Privacy layer**, built on Plan A. Per-contact pseudonyms/labels,
contacts-only mode + block list (`accessControl.ts`), at-rest vault + idle
re-lock (`atRest.ts`/`lockState.ts`), passphrase-wrapped recovery codes,
Settings → Privacy additions, `SafetyNumberScreen` collapses to 2 branches.

Each gets its own implementation plan (`docs/superpowers/plans/`) and its
own branch/PR, per this project's standing SDD workflow — not built as one
combined change.

## Rollout

- `decisions.md` gets a new entry recording the reversal of the 2026-07-22
  retirement decision, the coexistence-with-Local-Profiles call, and the
  three reconciliation decisions in this document (informational-layer
  identity, envelope reuse, two-tier verification) — logged before Plan A's
  implementation starts, per this project's standing process rule.
- `roadmap.md` updates: 5.1 currently reads "Local Profiles (REPLACES the
  retired persistent-identity...)" — needs rewording now that both coexist,
  plus a note pointing to this document.
- PR #11 (`feat/identity-vault-modules`) stays open; Plan B's implementation
  plan targets rebasing/merging its 4 modules rather than re-salvaging them.
