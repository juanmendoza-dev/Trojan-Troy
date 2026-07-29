# Phase 5.1 — Persistent Identity Keys: Design Spec

Status: Approved
Date: 2026-07-19

## Purpose

First sub-project of Phase 5 (roadmap redesign — see Rollout below). Today,
every session generates a fresh `crypto_kx` keypair and discards it on
disconnect: the safety number is meaningless across reconnects, and there is
no way to recognize "the same person I talked to yesterday." This sub-project
gives each user a long-term identity keypair that persists in the browser,
lets the safety number attest to identity rather than a throwaway session,
and adds a local contacts list that recognizes returning peers and warns if
their identity key ever changes.

This is also the foundation for Phase 5.2 (forward-secrecy ratchet), which
needs an identity/ephemeral split to bootstrap its initial handshake the way
Signal's X3DH does. Building that split now avoids reworking the handshake
twice.

## Scope

In scope for this spec:
- A per-browser, persistent identity keypair (X25519, same `crypto_kx`
  primitive already in use), generated once and stored in IndexedDB.
- A user-chosen display name, set once on first launch, sent to peers during
  the handshake.
- Combining identity-key and ephemeral-key Diffie-Hellman outputs into the
  session encryption key, so every session is still cryptographically bound
  to the fresh ephemeral exchange, not just the long-term identity.
- Safety number computed from identity keys only, so it stays stable across
  reconnects with the same contact.
- A local contacts store (identity public key → display name, safety
  number, first-verified/last-seen timestamps) that:
  - auto-recognizes a returning contact (matching identity key + matching
    stored safety number) and skips manual re-verification.
  - warns, and blocks auto-trust, when a display name reconnects under a
    *different* identity key than previously stored for that name.
- A visible Contacts screen: list known contacts, show name + short key
  fingerprint + first-verified date, delete a contact.
- Export/import of the identity as a human-readable recovery code.

Out of scope (later Phase 5 sub-projects or explicitly deferred):
- Per-message forward secrecy / key ratcheting — this spec's combined
  identity+ephemeral key still produces one static session key per session,
  same granularity as today. Phase 5.2 replaces this with a real ratchet.
- Multi-device — identity lives in one browser's IndexedDB only. Using the
  same identity from a second device/browser is not supported; each
  browser that generates or imports an identity is independent.
- Encrypted offline delivery, group chats, file sharing, disappearing
  messages, local message history — separate Phase 5 sub-projects.
- Passphrase/PIN protection of the identity at rest, or of the exported
  recovery code — both stay plaintext, matching the project's existing
  low-friction trust model (already true of ephemeral keys today).

## Correction to `decisions.md`

The original Phase 1 decision states pairing is "room/invite-link based —
no user accounts... no usernames, passwords, or user database" and that
"session keys are ephemeral (fresh per session), not a persistent identity,"
explicitly flagging persistent identity as a bigger scope add to revisit
later. This sub-project is that revisit: it adds a persistent local identity
and a user-chosen display name. It is *not* a user-account system — no
server-side account, no login, no password, no central user database. The
relay still only ever sees opaque envelopes; identity keys and the contacts
store live entirely client-side. `decisions.md` gets a new entry recording
this override (see Rollout below).

## Architecture

No server changes — the relay already forwards any envelope type it doesn't
recognize without inspecting it. Additions are entirely within `/client`:

```
client/src/
  identity/
    store.ts              # IndexedDB wrapper: self record + contacts
    store.test.ts
    identity.ts            # generate/load/persist identity keypair + name
    identity.test.ts
    recoveryCode.ts         # encode/decode identity secret key <-> recovery code
    recoveryCode.test.ts
  crypto/
    keys.ts                 # +deriveSessionKeys combines identity + ephemeral DH
    keys.test.ts
    safetyNumber.ts          # unchanged signature, now always called with identity keys
  screens/
    SetupScreen.tsx          # first-launch: choose display name, or restore from code
    ContactsScreen.tsx        # list/delete known contacts
    SafetyNumberScreen.tsx    # +auto-skip / +key-changed warning branches
  net/relayClient.ts          # Envelope: "pubkey" -> "identity" (adds identityPublicKey, displayName)
  App.tsx                     # wires identity load, contacts lookup, new screens into the state machine
```

## Components

### `client/src/identity/identity.ts`
- `loadOrCreateIdentity(): Promise<{ keypair: Keypair; displayName: string }>`
  — reads the `self` record from `store.ts`; if missing or corrupt,
  generates a fresh `crypto_kx_keypair()` and returns it without a display
  name set (caller routes to `SetupScreen` to collect one and persist it).
- `saveDisplayName(name: string): Promise<void>` — persists the name chosen
  on `SetupScreen` into the existing `self` record.

Self-healing on corrupt/missing storage matches Phase 1's "no persistence,
regenerate" precedent — the only new behavior is that regeneration is now
the exception (missing/corrupt data) rather than the rule (every session).

### `client/src/identity/store.ts`
Thin IndexedDB wrapper, one database (`trojan-troy-identity`), two object
stores:
- `self` — single record: `{ identityPublicKey, identitySecretKey,
  displayName }`.
- `contacts` — keyed by `identityPublicKey` (base64): `{ identityPublicKey,
  displayName, safetyNumber, firstVerifiedAt, lastSeenAt }`.

Exposes `getSelf`, `putSelf`, `getContact(identityPublicKey)`,
`putContact(entry)`, `listContacts()`, `deleteContact(identityPublicKey)` —
no query logic beyond key lookup, matching the project's existing "thin
wrapper, no framework" style (`rooms.ts` on the server is the same shape).

### `client/src/identity/recoveryCode.ts`
- `encodeRecoveryCode(secretKey: Uint8Array, displayName: string): string` —
  concatenates the secret key bytes and UTF-8 display name length-prefixed,
  base64-encodes the result, and groups it into 5-character blocks separated
  by spaces (same grouping style as `safetyNumber.ts`'s output, so it reads
  consistently with the rest of the app).
- `decodeRecoveryCode(code: string): { secretKey: Uint8Array; displayName:
  string }` — reverses the above; throws on malformed input (wrong length,
  bad base64) so the caller can show an error without touching existing
  storage.
- The public key is never stored in the code — it's recomputed from the
  secret key via `crypto_scalarmult_base` on import, same as how `crypto_kx`
  keypairs are structured.

### `client/src/crypto/keys.ts` (modified)
`deriveSessionKeys` changes signature to take both key pairs:
```ts
deriveSessionKeys(
  ownIdentity: Keypair, peerIdentityPublicKey: Uint8Array,
  ownEphemeral: Keypair, peerEphemeralPublicKey: Uint8Array,
  role: "initiator" | "responder"
): Promise<SessionKeys>
```
Internally runs `crypto_kx_{client,server}_session_keys` twice — once on the
identity pair, once on the ephemeral pair — then combines each side
(`rx`, `tx`) via `crypto_generichash(identityResult || ephemeralResult)`.
This is the X3DH-lite step: the resulting session key is bound to both the
verified long-term identity and this session's fresh ephemeral exchange, so
neither alone determines it.

`computeSafetyNumber` keeps its existing signature and implementation
unchanged, but callers now always pass identity public keys, never
ephemeral ones — this is what makes the number stable across reconnects.

### `client/src/screens/SetupScreen.tsx` (new)
Shown once, before `StartJoinScreen`, when no display name is stored yet:
- Text input for a display name, "Continue" button — saves via
  `saveDisplayName` and proceeds.
- A secondary "Restore from backup code" link/textarea that calls
  `decodeRecoveryCode` and, on success, overwrites the `self` record via
  `putSelf` instead of generating a new identity. On decode failure, shows
  an inline error and leaves existing storage untouched.
- Also reachable later from `ContactsScreen` (or a settings-style entry
  point) for exporting the current identity via `encodeRecoveryCode` — shown
  as read-only text with a "copy" affordance and a one-line warning to treat
  it like a password.

### `client/src/screens/ContactsScreen.tsx` (new)
- Lists `listContacts()` results: display name, a short fingerprint (first
  N groups of the stored safety number), first-verified date.
- Delete button per contact (calls `deleteContact`) — removing a contact
  only forgets local recognition of them; it does not affect their ability
  to reconnect, they'd just go through first-time verification again.
- Reachable from `ChatScreen` (a "Contacts" link/button) and does not gate
  anything — purely informational/management.

### `client/src/screens/SafetyNumberScreen.tsx` (modified)
Three branches instead of one, decided in `App.tsx` before this screen
renders:
1. **New contact** (no stored entry for this identity key): today's
   existing manual-compare-and-click-Verified flow, unchanged. On verify,
   calls `putContact` to save the entry.
2. **Recognized contact** (identity key found, stored safety number matches
   the freshly computed one — which it always will, since the number is a
   pure function of identity keys that haven't changed): skips the manual
   compare, shows a lightweight "Reconnected with `<name>` — already
   verified" banner with a single "Continue" button, updates `lastSeenAt`.
3. **Key-changed warning** (this exact identity key isn't stored, but its
   asserted display name matches a *different* stored identity key): shows
   an explicit warning — "Someone named `<name>` connected with a different
   key than the one you verified before. This could mean they reinstalled,
   or it could mean something is wrong." — and requires the same manual
   compare-and-confirm flow as a new contact before proceeding. Confirming
   does not overwrite the old contact entry silently; it saves this as an
   additional/updated entry only after explicit confirmation.

### `client/src/net/relayClient.ts` (modified)
`Envelope`'s `"pubkey"` variant is replaced with:
```ts
| { type: "identity"; ephemeralPublicKey: string; identityPublicKey: string; displayName: string }
```
No other envelope types change.

### `client/src/App.tsx` (modified)
- On mount, calls `loadOrCreateIdentity()`. If no display name is set yet,
  renders `SetupScreen` first; otherwise proceeds straight to
  `StartJoinScreen` as today.
- `exchangeKeys` now also generates a fresh ephemeral `crypto_kx` keypair
  per session (as today's `generateKeypair` call already does, just
  renamed/scoped to "ephemeral") and sends the new `identity` envelope
  carrying both public keys and the display name.
- On receiving a peer's `identity` envelope: looks up
  `getContact(peerIdentityPublicKey)` and computes which of the three
  `SafetyNumberScreen` branches applies (see above) before calling
  `deriveSessionKeys` with both key pairs.

## Data flow

1. App loads. Identity is loaded or created from IndexedDB. If no display
   name is stored, `SetupScreen` collects one (or the user restores an
   existing identity from a backup code) before continuing.
2. User starts or joins a room exactly as today (Phase 1 behavior
   unchanged).
3. On `peer-connected`, each side generates a fresh ephemeral keypair and
   sends `{ type: "identity", ephemeralPublicKey, identityPublicKey,
   displayName }`.
4. On receiving the peer's `identity` envelope, the client:
   - looks up the peer's `identityPublicKey` in the contacts store,
   - computes the safety number from the two identity public keys,
   - derives session keys from both the identity and ephemeral key pairs
     combined,
   - routes to the appropriate `SafetyNumberScreen` branch (new / recognized
     / key-changed) based on the contacts lookup.
5. Confirming on any branch saves/updates the contacts entry and unlocks
   chat, same gating rule as Phase 2 (no path to chat skips this screen).

## Error handling

- Missing/corrupt `self` IndexedDB record: treated as first launch —
  generate a fresh identity, route to `SetupScreen`. Never throws up to the
  UI as a hard error.
- Invalid recovery code on import: inline error on `SetupScreen`, existing
  `self` record (if any) is left untouched until a decode succeeds.
- Key-changed warning cannot be silently bypassed or auto-dismissed — it
  always requires the same explicit manual-verify action as a brand-new
  contact.
- IndexedDB unavailable/blocked (e.g. private browsing modes that restrict
  it): falls back to an in-memory-only identity for that session (behaves
  like today's ephemeral-per-session model) rather than crashing the app —
  logged as a console warning, no user-facing error, since the app still
  fully functions, just without persistence.

## Known limitation: key-change detection is a heuristic, not a guarantee

Because pairing has no stable external identifier (no phone number, no
username/account, no server-side identity registry — by design, per the
original no-accounts decision), the contacts store can only correlate a new
identity key back to an old one via a matching *display name*, which is
self-asserted and not cryptographically bound to anything. An impersonator
can trivially claim the same display name as someone the user already knows.
The key-changed warning is therefore a genuine "something worth
double-checking" signal, not a MITM-proof guarantee — the underlying
protection is still the safety-number verification itself, which the
warning routes into rather than replaces. This is inherent to the app's
anonymous, no-accounts pairing model; solving it more rigorously would
require introducing some form of stable external identifier, which is
explicitly out of scope.

## Testing

- **`identity/identity.ts`**: loads existing identity when present; generates
  and persists a new one when storage is empty or corrupt; display name
  save round-trips.
- **`identity/store.ts`**: `self` get/put round-trip; `contacts` put/get/
  list/delete round-trip; a missing contact lookup returns undefined rather
  than throwing.
- **`identity/recoveryCode.ts`**: encode → decode round-trips secret key and
  display name exactly; decode rejects malformed/truncated input.
- **`crypto/keys.ts`**: combined session-key derivation — same identity keys
  with two *different* ephemeral key pairs produce two different session
  keys (proves the ephemeral contribution isn't a no-op); same identity
  keys with the same ephemeral pair on both sides produce matching `tx`/`rx`
  across initiator/responder roles (existing Phase 1 test shape, extended).
- **`safetyNumber.ts`**: unchanged tests still pass; new test confirms the
  number is identical across two derivations that share identity keys but
  differ in ephemeral keys — proves stability across "sessions."
- **`ContactsScreen` / `SetupScreen` / `SafetyNumberScreen` branches**: no
  automated tests — presentational, same "manual UI verification" precedent
  as every other screen in this project.
- **`App.tsx` wiring**: protocol-level integration script extended from
  Phase 2's — two simulated clients each with persisted identities complete
  a session, disconnect, reconnect, and assert the second round skips
  manual verification and produces the same safety number as the first.
- **Server**: no changes, no new server tests.

## Rollout

Before implementation starts:
- Add a `decisions.md` entry recording the override of the original
  no-accounts/ephemeral-identity decision (see "Correction to
  `decisions.md`" above), and the Phase 4/5/6 roadmap restructure this
  sub-project is part of.
- Update `roadmap.md`: Phase 4 becomes UI design (handled externally, not by
  this agent); Phase 5 becomes a set of new-feature sub-projects, of which
  this is the first, in this build order: persistent identity keys →
  forward-secrecy ratchet → encrypted offline delivery → local encrypted
  history/search → group chats → encrypted file/image sharing →
  disappearing messages; Phase 6 becomes polishing/hardening whatever Phase
  5 builds.
