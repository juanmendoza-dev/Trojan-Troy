# At-Rest Encryption for Local Profiles (Argon2id vault, review S1): Design Spec

Status: Draft (brainstormed with Jay 2026-07-23; awaiting approval)
Date: 2026-07-23

## Purpose

Local Profiles (Phase 5.1 Layer A, shipped) stores each named profile in IndexedDB
with a 4-digit PIN. Today that PIN is a **salted hash used only as an access
check** (`profiles/pin.ts`) — the stored profile data (name, avatar photo) sits
effectively **in the clear** in the browser's database. Anyone who copies the
IndexedDB files off the disk reads the profile directly; the PIN is a "do not enter"
sign, not a lock.

Worse, the Phase 4.7 review's **highest-value pre-build catch (S1)** is that the
planned key derivation is a **fast hash** (`crypto_generichash(salt‖pin)`), so even
the access check — and any key derived from it — is **instantly brute-forced
offline** over a ~13-bit PIN space.

This spec turns the PIN into a **real encryption key** via **Argon2id** (a
deliberately slow, memory-hard KDF) and encrypts the sensitive profile fields at
rest with `crypto_secretbox`. The PIN stops being a stored hash to attack and
becomes the only way to derive the key that decrypts the data.

**This rides the PIN screen you already have** — no new prompt, no new flow. Per
Jay's steer: backend/data-handling only. (One honest UX caveat about unlock latency
in §Cost.)

## Relationship to the other 2026-07-23 specs

Independent branch, buildable in parallel with the PQ handshake (①/②) — it touches
the profiles subsystem, not the session/handshake path. Shares no code with ③.

## What this closes (from the Phase 4.7 review)

- **S1** — replaces the fast-hash vault with **Argon2id**; forbids the fast-hash
  fallback for any at-rest key. Adds `libsodium-wrappers-sumo` as the prerequisite
  (an audited library — constraint-compliant).
- Partial **B9 / B13** — real slow KDF for at-rest; sensitive data encrypted rather
  than access-gated. (Lockout and passphrase-over-PIN are documented residuals; see
  below.)

## Hard constraints (carried, all satisfied)

- **Audited libraries only.** `crypto_pwhash` (Argon2id) + `crypto_secretbox` from
  **`libsodium-wrappers-sumo`** — the same audited library as today, in its
  full-API (`-sumo`) build. This is a **bundle-size increase, not a new vendor**;
  still no hand-rolled crypto. ✅ (Log the swap per `AGENTS.md`.)
- **Relay never reads plaintext.** This is purely device-local storage; nothing
  touches the wire. ✅
- **No live calling / P2P.** Unchanged. ✅

## Invariants preserved (must not regress)

- **Session crypto is untouched.** At-rest encryption is orthogonal to the
  handshake/ratchet; Local Profiles deliberately left session crypto alone and this
  keeps it that way.
- **Anonymous stays zero-storage.** The always-present Anonymous default shares
  nothing and persists nothing — it never gets a vault.
- **The `profile` sharing envelope is unchanged.** What's sent to the peer (the
  opt-in encrypted name/avatar/device card) is built from the **decrypted,
  in-memory** profile after unlock — the wire format doesn't change.

---

## Design

### Vault key derivation (replaces the fast hash in `profiles/pin.ts`)

```
deriveVaultKey(pin, salt):
  return crypto_pwhash(
    32,                                   // key length
    pin,                                  // the 4-digit PIN (UTF-8)
    salt,                                 // per-profile random 16-byte salt (crypto_pwhash_SALTBYTES)
    OPSLIMIT, MEMLIMIT,                   // see §Cost
    crypto_pwhash_ALG_ARGON2ID13)
```

- **No fast-hash path exists** after this. `pin.ts`'s current `generichash`-based
  hashing is removed, not left as a fallback (S1's explicit requirement).

### What gets encrypted (and what stays clear)

The profile splits into **clear listing metadata** and an **encrypted secret blob**:

```ts
interface StoredProfile {
  id: string;               // clear — stable key
  name: string;             // clear — see the UX decision below
  createdAt: number;        // clear
  pinSalt: string;          // clear (b64) — needed to derive the key
  kdf: { ops: number; mem: number; alg: number };  // clear — params to reproduce the key
  cipher: string;           // b64(nonce ‖ secretbox(secretJSON, vaultKey))
}
// secretJSON = { magic: "TTr-vault-v1", avatar: string | null }
```

- **Encrypted:** the **avatar photo** (a potentially large data-URL — the genuinely
  private, heavy field) and any future sensitive fields (Layer-B history reuses this
  vault key). A fixed `magic` sentinel inside the blob lets us verify the PIN by
  decryption success even when `avatar` is null.
- **Clear:** `id`, `name`, `createdAt`, `pinSalt`, `kdf`. See the UX decision for
  why `name` stays clear.

### The one UX-preserving decision: name stays clear

`ProfileModal` today lists profiles **by name**, then prompts for the PIN on select.
If the name were encrypted, the list couldn't render names until after unlock — a
visible flow change (names → "locked profile" placeholders). Under Jay's "no UX
change" rule:

- **Keep `name` as clear listing metadata; encrypt the avatar (+ future history).**
  The PIN still gates *activating* a profile (as today) and now also *decrypts* its
  avatar/history. The modal flow — list names, enter PIN, open — is **byte-for-byte
  the same**.
- **Documented residual:** a thief who copies IndexedDB sees profile *names* (e.g.
  "Jay", "Work") but not avatars or history. The name is a self-chosen display label,
  the least sensitive field. Encrypting it too is a one-field move (drop it into
  `secretJSON`, show placeholders pre-unlock) if Jay ever accepts the listing change.

### PIN verification without a stored hash

No more `pinHash`. To check a PIN: derive the vault key, attempt
`secretbox_open` of `cipher`, and confirm the decrypted `magic === "TTr-vault-v1"`.
Auth-tag failure (or wrong magic) ⇒ wrong PIN. This removes the separate hash an
attacker could grind and ties "is the PIN right" to "can we actually decrypt."

### Create / select / delete flows

- **Create:** validate the 4-digit PIN (existing rule), generate `pinSalt`, derive
  the vault key, seal `{ magic, avatar }`, store `StoredProfile`. Hold the derived
  key + decrypted avatar in memory for the active session.
- **Select (named):** enter PIN → derive key → open `cipher` → on success, the
  profile is active with its avatar in memory; on failure, the existing
  wrong-PIN error. (Unchanged UI.)
- **Delete:** unchanged (soft-red cube confirm); just removes the `StoredProfile`.
- **Anonymous:** unchanged — no key, no storage.

### Migration

Local Profiles shipped recently; there may be a few dev/test profiles in the old
`{ pinSalt, pinHash, avatar-in-clear }` shape. Since there are no real production
users to preserve, the safe path: on load, a profile lacking `cipher`/`kdf` is
treated as **legacy** and either (a) ignored/removed, or (b) opportunistically
re-encrypted on the next successful PIN entry (derive the new key, seal, rewrite).
Prefer (b) if trivial; (a) is acceptable. Log the choice.

---

## Cost parameters (§Cost — the honest UX caveat)

`crypto_pwhash` cost is `OPSLIMIT` × `MEMLIMIT`:

| Preset | mem | ~latency (browser) | Notes |
|---|---|---|---|
| `INTERACTIVE` | ~64 MiB | ~0.1 s | **Recommended default** — imperceptible unlock |
| `MODERATE` | ~256 MiB | ~0.7 s | Stronger; a sub-second "unlocking…" beat |
| `SENSITIVE` | ~1 GiB | ~2–3 s | **Do not use in-browser** — likely OOMs a tab |

- **Recommended: `INTERACTIVE`** as the default so profile-open stays imperceptible
  (respecting "no UX change") while still being **memory-hard Argon2id** — a
  categorical improvement over the current fast hash. Expose the params as a tunable
  constant; `MODERATE` is a one-line bump for a stronger stance if a brief unlock
  spinner is acceptable.
- **Store the chosen params** (`kdf` field) with each profile so raising the cost
  later doesn't lock out existing profiles (verify at the stored cost, re-seal at the
  new cost on next unlock if desired).
- **Honest framing for the about/security copy:** a 4-digit PIN has ~13 bits of
  entropy. Argon2id raises an offline guess from *instant* to *meaningful*
  (INTERACTIVE ≈ 10⁴ guesses × 0.1 s ≈ minutes; MODERATE ≈ hours), but it is **not a
  wall** against a determined attacker who has the stolen device and grinds all
  10 000 PINs. True strength needs an **alphanumeric passphrase** — which is a UX
  change (longer input) and therefore **out of scope** here. Claim "protects against
  casual/opportunistic access to a lost device," not "unbreakable."

---

## Module plan (`/client`)

```
client/package.json                         # libsodium-wrappers -> libsodium-wrappers-sumo (+ @types)
client/vite.config.ts, vitest.config.ts     # resolve.alias "libsodium-wrappers" -> "libsodium-wrappers-sumo"
client/tsconfig.json                        # matching paths alias (so existing imports don't churn)
client/src/profiles/
  pin.ts / pin.test.ts                       # deriveVaultKey (Argon2id); keep 4-digit validation; drop fast hash
  vault.ts / vault.test.ts                   # NEW: sealProfileSecrets(vk, {avatar}) / openProfileSecrets(vk, cipher)
                                             #      (secretbox + magic sentinel); returns null on wrong key
  profileModel.ts                            # Profile/StoredProfile split (name/id/createdAt/salt/kdf clear; avatar in cipher)
  profileStore.ts / .test.ts                 # store the new shape; legacy detection/migration
client/src/App.tsx / components/ProfileModal.tsx  # derive vk on create/select; hold decrypted avatar in memory;
                                             # unchanged modal flow; wrong-PIN via open-failure
```

**Dependency-swap approach (recommended):** install `libsodium-wrappers-sumo` and
**alias** `libsodium-wrappers` → `-sumo` in the Vite/Vitest/TS configs, so the ~10
existing `import sodium from "libsodium-wrappers"` sites don't change. `-sumo` is a
superset (same API + `crypto_pwhash`), so nothing else is affected. Verify the wasm
loads in dev and the bundle builds.

`pin.ts`, `vault.ts` are pure modules (async for `sodium.ready`) with Vitest
coverage. `profileStore.ts` already has tests (uses `fake-indexeddb`).

---

## Data flow (unchanged for the user)

1. Create a named profile → PIN → Argon2id vault key → avatar sealed → stored. (Same
   create UI.)
2. Select a named profile → PIN → vault key → avatar decrypted into memory (or
   wrong-PIN error). (Same select UI, plus ~0.1 s Argon2id at `INTERACTIVE`.)
3. In chat, opt-in sharing sends the in-memory decrypted card as today (unchanged
   wire).
4. On disk, the avatar (+ future history) is ciphertext; names remain as listing
   labels.

## Error handling / edge cases

- **Wrong PIN:** `openProfileSecrets` returns null → existing wrong-PIN UI. No
  distinct timing/oracle beyond the KDF cost.
- **Legacy profile (no `cipher`):** handled by migration (§Migration).
- **Corrupt `cipher`/wrong magic:** treated as wrong PIN / unreadable; never crash.
- **Large avatar:** the downscale util already bounds avatar size before storage;
  the sealed blob stays modest. Confirm the encrypted size is still fine for
  IndexedDB.
- **`sodium.ready`:** `crypto_pwhash` needs the wasm ready like every other sodium
  call; the existing `await sodium.ready` guards cover it.

## Testing

- **`pin.test.ts`:** `deriveVaultKey` deterministic for a given (pin, salt, params);
  different PIN ⇒ different key; different salt ⇒ different key; 4-digit validation
  unchanged; **no fast-hash export remains**.
- **`vault.test.ts`:** seal→open round-trip recovers the avatar; wrong key ⇒ null;
  tampered `cipher` ⇒ null; null-avatar profile still verifies via `magic`.
- **`profileStore.test.ts`:** store/list/get/delete the new shape (via
  `fake-indexeddb`); legacy record detected and migrated/ignored per the chosen
  path.
- **Cost sanity:** a test that the configured params are Argon2id (`ALG_ARGON2ID13`)
  and at least `INTERACTIVE` (guards against a regression to a weaker/fast KDF).
- **Manual:** create a profile, reload the tab, open it with the correct PIN (avatar
  returns), confirm a wrong PIN is rejected, confirm Anonymous stores nothing, and
  confirm opt-in sharing still sends the card. (`?screen=profiles` dev override +
  a real reload.)

Acceptance: `cd client && npm run typecheck && npm test && npm run build` green
(with the `-sumo` alias resolving); reload-then-unlock recovers the avatar; no
fast-hash path exists; wrong PIN rejected.

## Residuals (documented, honest)

- **4-digit PIN entropy.** Even with Argon2id, ~10 000 candidates are exhaustible on
  a stolen device given time; the honest claim is "casual/opportunistic protection,"
  not "unbreakable." A passphrase (UX change) is the real fix — deferred.
- **Profile name in clear** for the listing UX (deliberate; see the UX decision).
- **No brute-force lockout this pass** — Argon2id cost is the only speed bump. A
  simple attempt-delay/backoff is a cheap future add (S1's suggestion) but adds
  state; noted, not built.
- **Protects a lost/stolen or copied device, not a live one.** Malware or an
  attacker with the unlocked app in memory (or the known PIN) is out of the threat
  model — same line as the rest of the app. The decrypted avatar/history live in
  memory while active.
- **Layer-B history** (per-profile encrypted transcript) is **not built here** — this
  spec establishes the vault key it will reuse. That remains a separate follow-up.

## Build order

1. Swap to `libsodium-wrappers-sumo` via config alias; confirm dev + build green
   (nothing else changes).
2. `pin.ts` Argon2id `deriveVaultKey` (+ tests); remove the fast hash.
3. `vault.ts` seal/open (+ tests).
4. `profileModel.ts` / `profileStore.ts` shape split + migration (+ tests).
5. `App.tsx` / `ProfileModal.tsx` wiring (derive on create/select, in-memory avatar,
   unchanged flow).
6. Manual reload/unlock eyeball.

## Rollout

- Independent branch off `main`: suggested `feat/at-rest-profile-vault`.
- Full workflow (dependency swap + storage-format change): brainstorming → **this
  spec** → plan → `subagent-driven-development`.
- **Log on build** (`AGENTS.md`): the `libsodium-wrappers` → `-sumo` swap and
  bundle-size note, the chosen Argon2id params, the name-in-clear decision, and the
  migration choice in `decisions.md`; update `progress.md`. Keep the Settings
  about/security copy honest per §Cost.
- Commit/push per `AGENTS.md`.
