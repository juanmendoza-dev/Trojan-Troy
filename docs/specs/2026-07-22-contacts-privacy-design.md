# Contacts Privacy Settings — Design Spec

Status: Approved (design agreed with Jay, 2026-07-22)
Date: 2026-07-22

Extends Phase 5.1 (Persistent Identity Keys). 5.1 gives each user a long-term
identity keypair, a display name, and a local contacts list keyed by identity
public key. This sub-project layers three privacy controls on top: (1)
per-contact pseudonyms + local labels, (2) a contacts-only connection mode +
block list, and (3) at-rest encryption of the identity/contacts store behind a
PIN with idle re-lock. Everything is client-side — **no server change**, and
**no new crypto primitive**: it reuses the Phase 2 `crypto_secretbox` path and
adds `crypto_pwhash` (Argon2id) from the same audited libsodium already in use.
Brainstormed with Jay 2026-07-22 — headline directions chosen by Jay, finer
implementation calls delegated to Claude (see `decisions.md`).

The framing Jay asked for was a contact feature "similar to crypto": a
public-key / address-book model — your identity keypair is your wallet, your
identity public key is your address, a contact is a saved address with a local
nickname, verified out-of-band via the safety number. That is exactly what
5.1's identity-key contacts list already is, so this spec builds on it rather
than replacing it.

## Relationship to Phase 5.1

This depends on 5.1's `identity/` module, `ContactsScreen`, `SetupScreen`, and
`identity` envelope existing, and it modifies two of 5.1's decisions:

- **Recognition becomes key-based only.** 5.1's three `SafetyNumberScreen`
  branches (new / recognized / key-changed) collapse to **two** (new /
  recognized). The name-based "key-changed" warning is dropped: once presented
  names are per-contact/cosmetic and you label contacts yourself, correlating a
  new identity key to an old contact by *self-asserted name* is unreliable and
  noisy. The safety number remains the real protection — 5.1 itself framed the
  warning as routing *into* safety-number verification, not replacing it.
- **The `identity` envelope's display name becomes optional** (anonymous
  presentation).

Build order: implement alongside or immediately after 5.1.

## Scope

In scope:
- Per-contact **local labels** (never transmitted) and **presented-name
  control** (default name / saved alias / anonymous) via a "join as" picker.
- **Contacts-only mode** (opt-in): refuse handshakes from identity keys not in
  your verified contacts.
- **Block list**: silently refuse handshakes from specific identity keys.
- **At-rest encryption** of the identity secret key + contacts store behind a
  PIN/passphrase (`crypto_pwhash` + `crypto_secretbox`), with **idle re-lock**
  (session timeout) and an **unlock screen**.
- **Optional passphrase protection of the recovery-code export**, so the backup
  isn't the weak link once a PIN is set.
- Surfacing all of the above in Settings → Privacy and the Contacts screen.

Out of scope (deferred or other sub-projects):
- **True per-contact unlinkability** (a separate identity key per relationship /
  multiple identities). Cosmetic pseudonyms share one identity key, so colluding
  contacts can still correlate you by key. Multi-identity is a much larger change
  (breaks the single recovery code / one safety number) — deferred.
- Per-contact Ghost Mode granularity — Ghost Mode stays global.
- Disappearing / auto-forget contacts and panic-wipe (brainstormed, not selected
  this pass).
- PIN brute-force lockout / rate-limiting beyond Argon2id's inherent cost.
- Server-side anything — unchanged.

## Architecture

All additions within `/client`, layered on 5.1's `identity/` module:

```
client/src/
  identity/
    store.ts               # 5.1 + contact.label, blocked set, encrypted-blob storage
    atRest.ts              # NEW pure: pwhash-derive + secretbox wrap/unwrap of the vault
    atRest.test.ts         # NEW
    lockState.ts           # NEW pure: idle-timeout / re-lock decision (like presenceState.ts)
    lockState.test.ts      # NEW
    recoveryCode.ts        # 5.1 + optional passphrase wrap of the export
    recoveryCode.test.ts   # 5.1 + passphrase round-trip cases
  net/
    accessControl.ts       # NEW pure: allow/refuse decision (contacts-only + block)
    accessControl.test.ts  # NEW
    relayClient.ts         # identity envelope: displayName optional
  screens/
    StartJoinScreen.tsx    # + "join as" presentation picker
    ContactsScreen.tsx     # 5.1 + edit label, block/unblock, per-contact presentation
    SafetyNumberScreen.tsx # collapse to key-based new/recognized (drop key-changed branch)
    UnlockScreen.tsx       # NEW: PIN entry on launch / after re-lock
    SetupScreen.tsx        # 5.1 + optional "set app lock (PIN)" + alias management entry
  components/
    Settings.tsx           # Privacy section: contacts-only toggle, block mgmt, app-lock, aliases
  App.tsx                  # unlock flow, idle re-lock timer, access-control gate, join-as wiring
```

Pure-logic modules get Vitest coverage; screens/components are manually
verified — matching the project's standing convention (`presenceState.ts` /
`barPhases.ts` tested; `ChatScreen` / `Settings` not).

## Components

### 1. Per-contact pseudonyms (cosmetic — one identity key)

**Local label (`store.ts`).** The contacts entry gains `label?: string`. Your
UI shows `label` if set, else the last-seen self-asserted name, else a short key
fingerprint. `label` is never sent anywhere.

**Presented name — the "join as" picker (`StartJoinScreen.tsx`).** Because both
peers send their `identity` envelope on `peer-connected`, you can't know the
peer before you've presented yourself — so presentation is chosen *before* the
handshake, scoped to the room:
- **Default** — your global display name (5.1 behavior).
- **Alias** — one of a small list of saved presentation names in the `self`
  record.
- **Anonymous** — send no name; the peer renders a key fingerprint.

The choice is passed into `exchangeKeys` and placed in the `identity` envelope's
now-optional `displayName`.

**`relayClient.ts`.** `identity` envelope's `displayName` becomes
`displayName?: string` (empty/absent = anonymous).

**`SafetyNumberScreen.tsx`.** Two branches (down from 5.1's three):
- **Recognized** — the peer's identity key is a saved contact: skip the manual
  compare, show "Reconnected with `<label>` — already verified", update
  `lastSeenAt`.
- **New** — unknown identity key: 5.1's manual compare-and-confirm; on verify,
  `putContact` (prompting for an optional label). The name-based key-changed
  branch is removed.

### 2. Contacts-only mode + block list (opt-in, off by default)

**`accessControl.ts` (pure).**
```ts
decideAccess(peerIdentityKey: string, opts: {
  contactsOnly: boolean; blocked: Set<string>; knownContact: boolean;
}): "allow" | "refuse-unknown" | "refuse-blocked"
```
Keyed purely on the **identity key** — never the presented name — so
anonymous-but-known peers are allowed and unknown-but-named peers are refused.
`refuse-blocked` takes precedence over everything. Trivially unit-testable.

**`App.tsx` gate.** On the peer's `identity` envelope, *before*
`deriveSessionKeys`: run `decideAccess`. `refuse-*` → tear down the room
(dispose the relay client, return to start). `refuse-unknown` shows a neutral
"connection from an unknown contact was refused"; `refuse-blocked` is
**silent/neutral** (no "you're blocked" signal). No session keys, no chat, no
message content ever flow.

**Escape hatch.** Contacts-only is off by default (Settings → Privacy toggle,
`localStorage`, same pattern as Ghost Mode). Meeting someone new = toggle off,
or an "allow unknown this once" affordance on the refusal screen that whitelists
only the current handshake.

**Block storage (`store.ts`).** A `blocked` object store keyed by identity key,
independent of `contacts` (you can block a key you never saved). Block/unblock
actions live on `ContactsScreen` and the New-contact `SafetyNumberScreen`
branch.

**Value over room codes.** The room code is already admission control, but codes
leak and get forwarded — contacts-only is defense-in-depth ("even with my code,
only my verified keys get in").

### 3. At-rest encryption (unlock + idle session timeout)

**`atRest.ts` (pure, new).** libsodium only — no hand-rolled crypto:
```ts
deriveVaultKey(passphrase: string, salt: Uint8Array): Uint8Array           // crypto_pwhash (Argon2id, moderate limits)
sealVault(plaintext: Uint8Array, key: Uint8Array): { nonce; ciphertext }   // crypto_secretbox_easy
openVault(sealed: { nonce; ciphertext }, key: Uint8Array): Uint8Array      // crypto_secretbox_open_easy (throws on bad key/tamper)
```
The "vault" is the serialized `self` record (identity secret key + saved
aliases) plus the `contacts` / `blocked` stores. Persisted as
`{ salt, nonce, ciphertext }`.

**`store.ts`.** When a PIN is set, IndexedDB holds only the sealed vault (+ salt
/ nonce), never plaintext. No PIN set → plaintext exactly as 5.1 — fully
opt-in.

**Unlock flow (`UnlockScreen.tsx` + `App.tsx`).** On launch, if a sealed vault
exists, render `UnlockScreen` before anything else; the entered passphrase
derives the key and `openVault` decrypts into memory. Wrong PIN → inline error
(Argon2id makes guessing expensive; no lockout this pass). No PIN set →
auto-load as today.

**Idle re-lock (`lockState.ts`, pure — mirrors `presenceState.ts`).** Tracks
last activity; after a configurable idle window (default ~a few minutes) the
in-memory vault is dropped and `UnlockScreen` returns. Re-lock gates the
**contacts store + identity management**; it does **not** kill an active
in-memory chat — that chat's session keys are already derived and independent of
the identity secret. The pure decision `shouldRelock(lastActivity, now,
timeoutMs)` is unit-tested; the timer wiring lives in `App.tsx`.

**Forgot-PIN.** Restore via 5.1's recovery code → generate a fresh sealed vault.
No server recovery.

**Recovery-code passphrase (`recoveryCode.ts`).** `encodeRecoveryCode` gains an
optional passphrase parameter; when set (nudged whenever a PIN exists), the
encoded secret is itself `pwhash` + `secretbox`-wrapped before the
base64/grouping step, so the exported backup isn't plaintext.
`decodeRecoveryCode` detects and unwraps.

**Settings → Privacy.** Adds "App lock (PIN)" set/change/remove, the
contacts-only toggle, blocked-keys management, and saved-alias management —
alongside the existing Ghost Mode toggle.

**Threat model (stated so it isn't oversold).** At-rest encryption protects a
**stolen or shared device while the app is locked** (forensic IndexedDB
access). It does *not* protect against malware running while unlocked, or an
adversary who knows the PIN.

## Data flow

1. App loads. If a sealed vault exists → `UnlockScreen` → decrypt into memory.
   Else load plaintext (5.1), or first-launch `SetupScreen`.
2. User starts/joins a room and picks a **presentation** (default / alias /
   anonymous) in the "join as" picker.
3. On `peer-connected`, each side sends `{ type: "identity",
   ephemeralPublicKey, identityPublicKey, displayName? }` with the chosen
   presentation.
4. On the peer's `identity` envelope, *before* key derivation: run
   `decideAccess` (contacts-only + block). Refuse → tear down. Allow →
   continue.
5. Compute the safety number from the two identity keys, derive session keys
   (5.1's combined identity + ephemeral), route to `SafetyNumberScreen`
   **recognized** or **new**.
6. Confirm → save/update the contact (optional label) → chat unlocks (5.1
   gating unchanged).
7. The idle timer runs throughout; on timeout the vault re-locks (active chat
   continues; contacts/identity management requires re-unlock).

## Error handling

- **Wrong PIN:** inline error on `UnlockScreen`; storage untouched; Argon2id
  cost is the brute-force deterrent (no lockout this pass — noted as a
  hardening follow-up).
- **Corrupt sealed vault:** treated like 5.1's corrupt-`self` case — offer
  restore-from-recovery-code or a fresh identity; never a hard crash.
- **IndexedDB unavailable** (private-browsing modes): falls back to an
  in-memory ephemeral identity (5.1 behavior); no PIN applies; no persistence.
- **Access refused:** neutral messaging; `refuse-blocked` is indistinguishable
  from a failed connection (no block signal to the peer).
- **Invalid / re-encrypted recovery code:** inline error; existing storage
  untouched until a decode (+ unwrap) succeeds.

## Known limitations

- **Pseudonyms hide names, not keys.** One shared identity key means colluding
  contacts can still correlate you. True unlinkability (multi-identity) is
  deferred.
- **Blocking is per-key, not per-person.** A blocked party can mint a fresh
  identity — inherent to the no-accounts pairing model.
- **At-rest protects a locked/stolen device only** — not malware while
  unlocked, not a known PIN (see threat model above).
- **No PIN brute-force lockout this pass** — relies on Argon2id cost; a
  rate-limit / attempt-delay is a hardening follow-up.

## Testing

- **`atRest.ts`:** `deriveVaultKey` deterministic for the same passphrase+salt
  and different for a different salt; seal→open round-trips; open with the
  wrong key throws; a tampered ciphertext is rejected.
- **`lockState.ts`:** `shouldRelock` is true past the timeout, false within it;
  activity resets the window.
- **`accessControl.ts`:** allow when known or contacts-only off;
  `refuse-unknown` when contacts-only on + unknown; `refuse-blocked` takes
  precedence over everything; the decision ignores the presented name.
- **`recoveryCode.ts`:** passphrase encode→decode round-trips; the plaintext
  (no-passphrase) path still round-trips (5.1 tests unchanged); wrong
  passphrase / malformed input rejected.
- **`store.ts`:** `label` put/get; `blocked` add/has/remove; sealed-vault
  put/get round-trip.
- **Screens (`Unlock` / `Contacts` / `StartJoin` / `SafetyNumber`):** manual
  verification, per project convention.
- **`App.tsx` wiring:** extend 5.1's integration script — a session refused
  under contacts-only with an unknown key; allowed after adding the contact;
  re-lock drops the vault while an active chat keeps sending.
- **Server:** no changes, no new server tests.

## Rollout

- Add a `decisions.md` entry (2026-07-22) recording the three settings, Jay's
  headline choices, the delegated implementation calls, and the 5.1 deviation
  (key-based recognition only; optional `displayName`).
- Add a `roadmap.md` note under 5.1 pointing to this spec as the
  privacy-settings extension.
- Build gated behind Phase 5.1 (and Phase 5's 4.6 / 4.7 prerequisites) — this
  is design-ahead, same as the presence indicator was.
