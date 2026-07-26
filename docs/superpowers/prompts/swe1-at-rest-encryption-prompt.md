# Prompt for SWE 1 (Claude): Ship At-Rest Encryption for Local Profiles

Copy everything below the line into the SWE 1 session.

---

Implement at-rest encryption for Local Profiles per
`docs/superpowers/specs/2026-07-23-at-rest-encryption-design.md`. Read that
spec in full before writing any code — it has the exact module plan, data
shapes, KDF cost parameters, migration approach, and test list. This prompt
adds context the spec doesn't have.

## Why this exists

Local Profiles (shipped on `main`) stores each named profile in IndexedDB
gated by a 4-digit PIN, but the PIN is currently just a fast-hash access
check (`client/src/profiles/pin.ts`) — the stored name/avatar sit in the
clear. The Phase 4.7 review's top pre-build catch (S1) is that this fast hash
is instantly brute-forced offline. The spec fixes this by deriving a real
encryption key from the PIN via Argon2id (`crypto_pwhash`) and sealing the
avatar (and future per-profile history) with `crypto_secretbox`. No UX
change — same PIN screen, same flow, ~0.1s added latency on unlock.

## Important: don't pull from `feat/identity-vault-modules`

There's a branch, `feat/identity-vault-modules` (tip commit `723f036`), with
modules named `atRest.ts`, `lockState.ts`, `recoveryCode.ts`, and
`accessControl.ts`. **Do not merge or wire these in directly.** They were
salvaged from an earlier persistent-identity + contacts architecture
(long-term `crypto_kx` identity keypairs, a contacts store, recovery-code
export of a secret key) that was built and then **rolled back**
(`main @ 1ee0e35`, "Redeploy the pre-identity client") in favor of the
current, lighter Local Profiles model. Their file layout, data model, and
assumptions target an `App.tsx` that no longer exists.

That said, two things on that branch are worth a look purely as reference
for the crypto primitives, since they're the same libsodium calls this spec
needs:
- `atRest.ts`'s `deriveVaultKey` (Argon2id via `crypto_pwhash`) and
  `sealVault`/`openVault` (`crypto_secretbox`) — same primitives, different
  names/shapes than what this spec wants (`deriveVaultKey`/
  `sealProfileSecrets`/`openProfileSecrets` in `pin.ts`/`vault.ts`). Fine to
  crib the sodium call signatures; don't copy the module wholesale.
- `lockState.ts`'s `shouldRelock(lastActivity, now, timeoutMs)` — a pure
  idle-timeout check. Not in this spec's scope (no idle re-lock requirement
  here), so leave it out unless you see a clean, small place it's already
  needed; don't add new scope.

Ignore `recoveryCode.ts` and `accessControl.ts` entirely — both are specific
to the rolled-back identity-keypair model (backing up a `crypto_kx` secret
key, contacts-only connection gating) and have no equivalent concept in
Local Profiles.

## What to build

Follow the spec's module plan and build order exactly:

1. Swap `libsodium-wrappers` → `libsodium-wrappers-sumo` via a
   `resolve.alias` in `vite.config.ts` / `vitest.config.ts` (+ matching
   `tsconfig.json` path) so the ~10 existing
   `import sodium from "libsodium-wrappers"` call sites don't change.
   `-sumo` is required because `crypto_pwhash` isn't in the regular build.
   Confirm dev server + `npm run build` are green with the alias before
   moving on.
2. `client/src/profiles/pin.ts` — add `deriveVaultKey(pin, salt)` using
   `crypto_pwhash` at `OPSLIMIT_INTERACTIVE` / `MEMLIMIT_INTERACTIVE`,
   `ALG_ARGON2ID13`. Remove the existing fast-hash path entirely — no
   fallback.
3. `client/src/profiles/vault.ts` (new) — `sealProfileSecrets(vaultKey, {avatar})`
   / `openProfileSecrets(vaultKey, cipher)` using `crypto_secretbox`, with
   the `{ magic: "TTr-vault-v1", avatar }` sentinel so PIN verification is
   "does it decrypt," not a stored hash.
4. `client/src/profiles/profileModel.ts` + `profileStore.ts` — split
   `StoredProfile` into clear listing fields (`id`, `name`, `createdAt`,
   `pinSalt`, `kdf`) and the encrypted `cipher` blob. Handle legacy records
   (no `cipher`/`kdf`) per the spec's migration section — re-seal on next
   successful PIN entry if it's a clean addition, otherwise drop/ignore them
   and say which you picked.
5. `App.tsx` / `ProfileModal.tsx` — derive the vault key on create/select,
   hold the decrypted avatar in memory for the session, keep the modal flow
   byte-for-byte the same (list names → PIN → open; wrong PIN via
   open-failure, not a separate hash check). Anonymous profile stays
   untouched — no key, no storage, unchanged.

## Constraints to respect

- Audited-library-only: no hand-rolled crypto, `crypto_pwhash` +
  `crypto_secretbox` from `libsodium-wrappers-sumo` only (per `AGENTS.md`'s
  hard constraint on crypto primitives).
- Session/handshake crypto (`crypto/ratchet.ts`, `crypto/pqkem.ts`, etc.) is
  completely out of scope — this is local storage only, nothing touches the
  wire or the relay.
- Profile **name** stays clear (listing metadata) — do not encrypt it. The
  spec explains why (avoids a UX change to the profile list); don't relitigate
  that call.
- Use `crypto_pwhash_OPSLIMIT_INTERACTIVE` (not `MODERATE` or `SENSITIVE`) as
  the default cost — `SENSITIVE` can OOM a browser tab.

## Testing (spec has the full list — hit all of it)

- `pin.test.ts`: deterministic key derivation, different pin/salt → different
  key, no fast-hash export remains.
- `vault.test.ts`: seal→open round-trip, wrong key → null, tampered
  ciphertext → null, null-avatar profile still verifies via magic.
- `profileStore.test.ts`: store/list/get/delete on the new shape via
  `fake-indexeddb`, legacy record migration path exercised.
- A cost-sanity test asserting the configured KDF is Argon2id at least
  `INTERACTIVE` (regression guard against silently downgrading to a fast
  hash again).
- Manual pass: create a profile, reload the tab, unlock with the correct PIN
  (avatar comes back), wrong PIN rejected, Anonymous still stores nothing,
  opt-in profile sharing to a peer still sends the card.

Acceptance bar (from the spec): `cd client && npm run typecheck && npm test
&& npm run build` all green with the `-sumo` alias resolving.

## Workflow / process

- Branch off current `main` (not `feat/identity-vault-modules`) —
  `feat/at-rest-profile-vault` per the spec's Rollout section.
- This touches a dependency and a storage format, so go through the normal
  loop: brainstorm anything genuinely open (there shouldn't be much, the
  spec is detailed), write/confirm the plan, then implement.
- Log per `AGENTS.md`/the project's `decisions.md` convention: the
  `libsodium-wrappers` → `-sumo` swap and bundle-size note, the chosen
  Argon2id cost tier, the legacy-migration choice you made. Update
  `progress.md` when done.
- Commit early and often per `AGENTS.md` (small, human-readable commit
  messages, no AI co-author trailer, signed commits) — don't batch this into
  one giant commit.
- Open a PR against `main` when green; don't merge it yourself.

If anything in the spec looks stale or conflicts with what's actually on
`main` right now (check — it predates a couple of merges), flag it and ask
rather than guessing.
