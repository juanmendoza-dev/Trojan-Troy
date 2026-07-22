# Implementation Plan — Persistent Identity (5.1) + Contacts Privacy (5.1a)

Branch: `feat/persistent-identity-contacts`
Specs: `docs/superpowers/specs/2026-07-19-persistent-identity-design.md`,
`docs/superpowers/specs/2026-07-22-contacts-privacy-design.md`
Date: 2026-07-22

Builds 5.1 and its privacy extension together in one branch (see `decisions.md`,
2026-07-22). No server changes. No new crypto primitive — reuses
`crypto_secretbox` (`secretbox.ts`) and `crypto_kx`, adds only `crypto_pwhash`
(Argon2id) from the libsodium already in `package.json`.

## Testing approach (deviation from the specs' Testing sections)

The specs ask for `store.test.ts`. This repo has no `fake-indexeddb` dev
dependency and its standing convention is "only pure-logic modules get Vitest;
I/O boundaries, screens, and `App.tsx` are manually verified" (see `rooms.ts`,
`ChatScreen`, `App.tsx` — none have tests). To honor that convention without
adding a dependency: the **security-critical pure logic is unit-tested**
(`atRest`, `keys`, `recoveryCode`, `accessControl`, `lockState`,
`safetyNumber`), while the **IndexedDB wrapper (`store.ts`), screens, and
`App.tsx` wiring are manually verified**. This keeps the crypto covered and the
plumbing verified the same way every prior phase did. Logged in `decisions.md`.

## Build order (each task = one commit, typecheck + vitest green before moving on)

### Foundation (5.1 crypto + identity)
1. **`crypto/keys.ts`** — `deriveSessionKeys` gains identity+ephemeral form:
   `deriveSessionKeys(ownIdentity, peerIdentityPub, ownEphemeral, peerEphemeralPub, role)`,
   combining each of `rx`/`tx` via `crypto_generichash(identityResult || ephemeralResult)`.
   Extend `keys.test.ts`: different ephemerals ⇒ different session keys; same
   inputs ⇒ matching tx/rx across roles.
2. **`identity/atRest.ts`** (new, pure) — `deriveVaultKey(passphrase, salt)`
   (`crypto_pwhash`, Argon2id MODERATE), `sealVault(bytes, key)` /
   `openVault(sealed, key)` (`crypto_secretbox`). `atRest.test.ts`: KDF
   deterministic per salt, differs across salts; seal→open round-trip; wrong
   key throws; tamper rejected.
3. **`identity/lockState.ts`** (new, pure) — `shouldRelock(lastActivity, now, timeoutMs)`.
   `lockState.test.ts`: true past timeout, false within, activity resets.
4. **`net/accessControl.ts`** (new, pure) — `decideAccess(peerIdentityKey,
   {contactsOnly, blocked:Set, knownContact}) => "allow"|"refuse-unknown"|"refuse-blocked"`.
   `accessControl.test.ts`: block precedence; contacts-only unknown refusal;
   name-independence; allow when off or known.
5. **`identity/recoveryCode.ts`** (new, pure) — `encodeRecoveryCode(secretKey,
   displayName, passphrase?)` / `decodeRecoveryCode(code, passphrase?)`, 5-char
   grouping like `safetyNumber`; optional `pwhash`+`secretbox` wrap. Public key
   recomputed via `crypto_scalarmult_base` on import. `recoveryCode.test.ts`:
   plaintext + passphrase round-trips; wrong passphrase / malformed rejected.
6. **`identity/store.ts`** (new, thin IndexedDB wrapper, manually verified) —
   db `trojan-troy-identity`; stores `self`, `contacts` (by id pubkey b64),
   `blocked` (by id pubkey b64); when a PIN is set, `self`+`contacts`+`blocked`
   persist as one sealed vault record (`{salt, nonce, ciphertext}`) instead of
   plaintext. Exposes get/put/list/delete + vault seal/open helpers.
7. **`identity/identity.ts`** (new) — `loadOrCreateIdentity()`,
   `saveDisplayName()`, alias CRUD, PIN set/change/remove, `unlock(passphrase)`,
   in-memory-fallback when IndexedDB is blocked.

### Protocol
8. **`net/relayClient.ts`** — replace `{type:"pubkey"}` with
   `{type:"identity"; ephemeralPublicKey; identityPublicKey; displayName?}`.

### Screens / UI
9. **`screens/SetupScreen.tsx`** (new) — first launch: display name, restore
   from recovery code, optional "set app lock (PIN)".
10. **`screens/UnlockScreen.tsx`** (new) — PIN entry on launch / after re-lock.
11. **`screens/ContactsScreen.tsx`** (new) — list, edit label, block/unblock,
    delete, per-contact presentation.
12. **`screens/SafetyNumberScreen.tsx`** — recognized vs new branches (key-based
    only); keep the existing seal-slider/spark UI for the "new" path.
13. **`screens/StartJoinScreen.tsx`** — "join as" presentation picker
    (default / alias / anonymous).
14. **`components/Settings.tsx`** — Privacy section: contacts-only toggle,
    blocked-keys management, app-lock (PIN) set/change/remove, alias management,
    Contacts entry point. (Ghost Mode already here.)

### Wiring
15. **`App.tsx`** — identity load on mount → Setup/Unlock as needed; idle
    re-lock timer; `identity` envelope send (with join-as presentation) +
    receive; `deriveSessionKeys` with both key pairs; identity-based safety
    number; `decideAccess` gate before key derivation; contacts lookup → safety
    branch; save/update contact on verify; new screens in the state machine.

## Verification
- `npm run typecheck`, `npm run test` (all pure-logic suites green),
  `npm run build`.
- Manual (no browser-automation tool here, as in every prior phase): first-launch
  setup, pair two browsers, safety recognized on reconnect, contacts-only
  refusal, block, PIN lock/unlock + idle re-lock, recovery-code restore.
- Update `progress.md`; final whole-branch review; merge to `main`.
