# At-Rest Profile Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the sensitive fields of each Local Profile at rest by deriving a real key from the 4-digit PIN via Argon2id and sealing the avatar with `crypto_secretbox`, replacing today's fast-hash access check.

**Architecture:** The PIN stops being a stored hash and becomes the only input to `crypto_pwhash` (Argon2id) → a 32-byte vault key. A new `vault.ts` seals `{ magic, avatar }` under that key with `crypto_secretbox`; PIN verification is "does it decrypt." Stored profiles split into **clear listing metadata** (`id`, `name`, `createdAt`, `pinSalt`, `kdf`) and an opaque `cipher` blob. The decrypted avatar lives in memory only for the session — a reload reverts to Anonymous (Jay's R2 choice).

**Tech Stack:** TypeScript, React 18, Vite 5, Vitest 2, `libsodium-wrappers-sumo` (Argon2id lives in the `-sumo` build only), IndexedDB (via `fake-indexeddb` in tests).

## Global Constraints

- **Audited crypto only.** `crypto_pwhash` (Argon2id) + `crypto_secretbox` from `libsodium-wrappers-sumo`. No hand-rolled crypto. (AGENTS.md hard constraint.)
- **No fast-hash path may survive.** `hashPin`/`verifyPin` (`crypto_generichash`) are removed with no fallback (review S1).
- **KDF cost = `crypto_pwhash_OPSLIMIT_INTERACTIVE` / `MEMLIMIT_INTERACTIVE`, alg `crypto_pwhash_ALG_ARGON2ID13`.** Not MODERATE/SENSITIVE (SENSITIVE can OOM a tab).
- **Profile `name` stays clear** (listing metadata). Only the avatar (+ future history) is encrypted.
- **Anonymous stays zero-storage** — no key, no record, unchanged.
- **Session/handshake crypto is out of scope** — nothing touches `crypto/ratchet.ts`, `crypto/pqkem.ts`, the relay, or the wire.
- **Reload → Anonymous (R2).** The decrypted avatar and active named identity never survive a page reload; nothing named is presented without the PIN re-entered that session.
- **Migration = delete legacy (option a).** Records lacking `cipher`/`kdf` are deleted on load (purges the cleartext avatar). The spec preferred (b) re-seal, but (b) requires verifying the typed PIN against the legacy `pinHash` — i.e. keeping the fast-hash path S1 forbids. Hard constraint outranks soft preference.
- **Branch:** `feat/at-rest-profile-vault` off `main`. Commit via PowerShell so GPG signing works; small human-readable messages, no AI trailer. Do not merge — open a PR.

---

### Task 1: Swap `libsodium-wrappers` → `-sumo` via config alias

**Files:**
- Modify: `client/package.json`
- Modify: `client/vite.config.ts:7-11`
- Modify: `client/vitest.config.ts:5-9`
- Modify: `client/tsconfig.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the ~10 existing `import sodium from "libsodium-wrappers"` sites now resolve to the `-sumo` build, exposing `sodium.crypto_pwhash`, `crypto_pwhash_OPSLIMIT_INTERACTIVE`, `crypto_pwhash_MEMLIMIT_INTERACTIVE`, `crypto_pwhash_ALG_ARGON2ID13`, `crypto_pwhash_SALTBYTES`.

- [ ] **Step 1: Install the sumo package + its types**

```bash
cd client
npm install libsodium-wrappers-sumo
npm install -D @types/libsodium-wrappers-sumo
```

- [ ] **Step 2: Find the real runtime + types paths (do NOT assume they mirror the non-sumo layout)**

```bash
# runtime ESM entry (the alias target) — note the exact filename/folder:
ls node_modules/libsodium-wrappers-sumo/dist/
ls node_modules/libsodium-wrappers-sumo/dist/modules-sumo/ 2>/dev/null || ls node_modules/libsodium-wrappers-sumo/dist/modules/
# types entry (the tsconfig paths target) + confirm it declares crypto_pwhash:
ls node_modules/@types/libsodium-wrappers-sumo/
grep -c "crypto_pwhash" node_modules/@types/libsodium-wrappers-sumo/index.d.ts
```
Record the actual ESM file path (e.g. `dist/modules-sumo/libsodium-wrappers.js`) and the `.d.ts` path. Use those exact paths in Steps 3–4. If `@types/libsodium-wrappers-sumo` does not declare `crypto_pwhash`, stop and flag — the typecheck can't pass without it.

- [ ] **Step 3: Point the Vite + Vitest aliases at the sumo ESM build**

In `client/vite.config.ts` and `client/vitest.config.ts`, change the alias value from the non-sumo path to the sumo ESM path found in Step 2:

```ts
alias: {
  "libsodium-wrappers": path.resolve(
    __dirname,
    "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js" // <- exact path from Step 2
  ),
},
```

- [ ] **Step 4: Add a tsconfig `paths` alias so `tsc` reads the sumo types for `"libsodium-wrappers"`**

In `client/tsconfig.json` `compilerOptions`, add `baseUrl` + `paths` mapping the import specifier to the sumo types entry from Step 2:

```json
"baseUrl": ".",
"paths": {
  "libsodium-wrappers": ["./node_modules/@types/libsodium-wrappers-sumo/index.d.ts"]
}
```

- [ ] **Step 5: Prove `crypto_pwhash` typechecks under the new alias**

Create a throwaway probe `client/src/profiles/_probe.ts`:

```ts
import sodium from "libsodium-wrappers";
export const _ops: number = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE;
export const _alg: number = sodium.crypto_pwhash_ALG_ARGON2ID13;
export type _Fn = typeof sodium.crypto_pwhash;
```

Run: `cd client && npm run typecheck`
Expected: PASS (proves the sumo types resolve). Then delete `_probe.ts`.

**Escape hatch — if the probe will NOT typecheck** (the sumo `.d.ts` is authored as a base-module augmentation that `paths` can't redirect, so `crypto_pwhash` stays invisible): abandon the alias approach entirely. Instead, change the ~10 `import sodium from "libsodium-wrappers"` sites to `import sodium from "libsodium-wrappers-sumo"` directly, drop the `paths` entry, and point the Vite/Vitest aliases at (or just let them resolve) the sumo package normally. This has zero type-resolution gymnastics and is the guaranteed-green path. Skip Step 7 in that case (keep the base package uninstalled/removed only after this variant is green). The spec preferred the alias to avoid churn; this is the documented fallback, not a failure.

- [ ] **Step 6: Verify the whole toolchain is green with the alias**

```bash
cd client && npm run typecheck && npm test && npm run build
```
Expected: all green (existing ~163 tests still pass; wasm loads under Vitest node env; bundle builds). Note the reported bundle size — it will be logged in Task 5.

- [ ] **Step 7 (optional cleanup): drop the now-unused non-sumo deps**

Remove `libsodium-wrappers` and `@types/libsodium-wrappers` from `client/package.json`, then `npm install` and re-run Step 6. If anything breaks (a stray type resolution), revert this step — keeping them is harmless since the alias redirects. Keep whichever state is green.

- [ ] **Step 8: Commit**

```powershell
git add client/package.json client/package-lock.json client/vite.config.ts client/vitest.config.ts client/tsconfig.json
git commit -m "Swap libsodium-wrappers for the -sumo build via config alias"
```

---

### Task 2: `vault.ts` — seal/open profile secrets (TDD)

**Files:**
- Create: `client/src/profiles/vault.ts`
- Test: `client/src/profiles/vault.test.ts`
- Reuses: `client/src/crypto/secretbox.ts` (`encryptBytes`, `decryptBytes`)

**Interfaces:**
- Consumes: `encryptBytes(key: Uint8Array, plaintext: Uint8Array): Promise<string>` and `decryptBytes(key: Uint8Array, payload: string): Promise<Uint8Array>` from `../crypto/secretbox` (existing: nonce‖ciphertext, base64).
- Produces:
  - `interface ProfileSecrets { avatar: string | null }`
  - `sealProfileSecrets(vaultKey: Uint8Array, secrets: ProfileSecrets): Promise<string>` → b64 cipher.
  - `openProfileSecrets(vaultKey: Uint8Array, cipher: string): Promise<ProfileSecrets | null>` → `null` on wrong key / tamper / wrong magic.

- [ ] **Step 1: Write the failing tests**

`client/src/profiles/vault.test.ts`:

```ts
import sodium from "libsodium-wrappers";
import { beforeAll, describe, expect, it } from "vitest";
import { sealProfileSecrets, openProfileSecrets } from "./vault";

beforeAll(async () => {
  await sodium.ready;
});

const key = () => sodium.crypto_secretbox_keygen();

describe("vault seal/open", () => {
  it("round-trips the avatar", async () => {
    const k = key();
    const cipher = await sealProfileSecrets(k, { avatar: "data:image/jpeg;base64,abc" });
    expect(await openProfileSecrets(k, cipher)).toEqual({ avatar: "data:image/jpeg;base64,abc" });
  });

  it("verifies a null-avatar profile via the magic sentinel", async () => {
    const k = key();
    const cipher = await sealProfileSecrets(k, { avatar: null });
    expect(await openProfileSecrets(k, cipher)).toEqual({ avatar: null });
  });

  it("returns null for the wrong key", async () => {
    const cipher = await sealProfileSecrets(key(), { avatar: "x" });
    expect(await openProfileSecrets(key(), cipher)).toBeNull();
  });

  it("returns null for tampered ciphertext", async () => {
    const k = key();
    const cipher = await sealProfileSecrets(k, { avatar: "x" });
    const bytes = sodium.from_base64(cipher, sodium.base64_variants.ORIGINAL);
    bytes[bytes.length - 1] ^= 0xff; // flip a byte → auth-tag failure
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
    expect(await openProfileSecrets(k, tampered)).toBeNull();
  });

  it("returns null for a non-base64 blob", async () => {
    expect(await openProfileSecrets(key(), "not valid base64 !!!")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/profiles/vault.test.ts`
Expected: FAIL — `./vault` has no exports yet.

- [ ] **Step 3: Implement `vault.ts`**

```ts
import { encryptBytes, decryptBytes } from "../crypto/secretbox";

// A fixed sentinel inside the sealed blob: a successful decrypt whose magic
// matches means the PIN was right, so we never store a hash to grind.
const MAGIC = "TTr-vault-v1";

export interface ProfileSecrets {
  avatar: string | null;
}

export async function sealProfileSecrets(
  vaultKey: Uint8Array,
  secrets: ProfileSecrets
): Promise<string> {
  const json = JSON.stringify({ magic: MAGIC, avatar: secrets.avatar });
  return encryptBytes(vaultKey, new TextEncoder().encode(json));
}

export async function openProfileSecrets(
  vaultKey: Uint8Array,
  cipher: string
): Promise<ProfileSecrets | null> {
  try {
    const bytes = await decryptBytes(vaultKey, cipher);
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    if (!obj || obj.magic !== MAGIC) return null;
    return { avatar: typeof obj.avatar === "string" ? obj.avatar : null };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/profiles/vault.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
git add client/src/profiles/vault.ts client/src/profiles/vault.test.ts
git commit -m "Add profile vault seal/open with crypto_secretbox"
```

---

### Task 3: `pin.ts` — Argon2id `deriveVaultKey` + KDF params (TDD)

Adds the real KDF alongside the existing `isValidPin`/`newSalt`. The legacy `hashPin`/`verifyPin` are **left in place for this task only** (ProfileModal still imports them) and removed in Task 4 once nothing consumes them — this keeps every commit's typecheck green while guaranteeing no fast-hash path in the shipped result.

**Files:**
- Modify: `client/src/profiles/pin.ts`
- Modify: `client/src/profiles/pin.test.ts`

**Interfaces:**
- Consumes: `toBase64`/`fromBase64` from `../crypto/encoding`; `sodium` from `libsodium-wrappers` (sumo, aliased).
- Produces:
  - `interface KdfParams { ops: number; mem: number; alg: number }`
  - `defaultKdfParams(): Promise<KdfParams>` → INTERACTIVE / ARGON2ID13.
  - `deriveVaultKey(pin: string, saltB64: string, params: KdfParams): Promise<Uint8Array>` → 32-byte key.
  - `isValidPin`, `newSalt` unchanged in behavior (`newSalt` now sizes to `crypto_pwhash_SALTBYTES`).

- [ ] **Step 1: Write the failing tests** (append to / replace the hash-block in `pin.test.ts`)

Keep the existing `isValidPin` describe block. Replace the `hashPin / verifyPin` describe block with:

```ts
import sodium from "libsodium-wrappers";
import { describe, expect, it, beforeAll } from "vitest";
import { isValidPin, newSalt, deriveVaultKey, defaultKdfParams } from "./pin";
import * as pinModule from "./pin";

beforeAll(async () => {
  await sodium.ready;
});

describe("deriveVaultKey", () => {
  it("is deterministic for the same pin/salt/params", async () => {
    const salt = await newSalt();
    const params = await defaultKdfParams();
    const a = await deriveVaultKey("1234", salt, params);
    const b = await deriveVaultKey("1234", salt, params);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(sodium.crypto_secretbox_KEYBYTES);
  });

  it("gives a different key for a different pin", async () => {
    const salt = await newSalt();
    const params = await defaultKdfParams();
    const a = await deriveVaultKey("1234", salt, params);
    const b = await deriveVaultKey("9999", salt, params);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("gives a different key for a different salt", async () => {
    const params = await defaultKdfParams();
    const a = await deriveVaultKey("1234", await newSalt(), params);
    const b = await deriveVaultKey("1234", await newSalt(), params);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("KDF cost sanity", () => {
  it("is Argon2id at least INTERACTIVE (guards against a fast-hash regression)", async () => {
    const p = await defaultKdfParams();
    expect(p.alg).toBe(sodium.crypto_pwhash_ALG_ARGON2ID13);
    expect(p.ops).toBeGreaterThanOrEqual(sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE);
    expect(p.mem).toBeGreaterThanOrEqual(sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE);
  });

  it("exposes no fast-hash helpers", () => {
    expect("hashPin" in pinModule).toBe(false);
    expect("verifyPin" in pinModule).toBe(false);
  });
});
```

Note: the "exposes no fast-hash helpers" test will FAIL until Task 4 removes `hashPin`/`verifyPin`. Mark that single `it` with `it.skip` in this task and un-skip it in Task 4 Step (pin cleanup). All other tests in this task must pass now.

- [ ] **Step 2: Run to verify the new derive tests fail**

Run: `cd client && npx vitest run src/profiles/pin.test.ts`
Expected: FAIL — `deriveVaultKey`/`defaultKdfParams` not exported.

- [ ] **Step 3: Implement in `pin.ts`** (add the new exports; keep `hashPin`/`verifyPin` for now)

```ts
import sodium from "libsodium-wrappers";
import { toBase64, fromBase64 } from "../crypto/encoding";

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function newSalt(): Promise<string> {
  await sodium.ready;
  return toBase64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES));
}

export interface KdfParams {
  ops: number;
  mem: number;
  alg: number;
}

// Argon2id at INTERACTIVE limits (~64 MiB, ~0.1 s) — memory-hard but snappy in
// a browser tab. SENSITIVE (~1 GiB) can OOM the tab; MODERATE is a one-line bump.
export async function defaultKdfParams(): Promise<KdfParams> {
  await sodium.ready;
  return {
    ops: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    mem: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    alg: sodium.crypto_pwhash_ALG_ARGON2ID13,
  };
}

export async function deriveVaultKey(
  pin: string,
  saltB64: string,
  params: KdfParams
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    pin,
    await fromBase64(saltB64),
    params.ops,
    params.mem,
    params.alg
  );
}

// TODO(Task 4): remove — the fast-hash access check is replaced by decryption.
export async function hashPin(pin: string, salt: string): Promise<string> {
  await sodium.ready;
  const input = sodium.from_string(`${salt}:${pin}`);
  return toBase64(sodium.crypto_generichash(32, input));
}
export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  return (await hashPin(pin, salt)) === hash;
}
```

- [ ] **Step 4: Run to verify the derive/cost tests pass**

Run: `cd client && npm run typecheck && npx vitest run src/profiles/pin.test.ts`
Expected: PASS (derive + cost-sanity green; the "no fast-hash helpers" test is `it.skip` for now).

- [ ] **Step 5: Commit**

```powershell
git add client/src/profiles/pin.ts client/src/profiles/pin.test.ts
git commit -m "Add Argon2id deriveVaultKey and KDF params to pin.ts"
```

---

### Task 4: Storage-format split, legacy migration, and UI wiring (remove fast hash)

Atomic change: splitting the stored shape ripples through `profileModel`, `profileStore`, `App.tsx`, and `ProfileModal.tsx` at once, so they land together to keep `tsc` green. TDD covers the store migration; the React wiring is verified by typecheck/build + the manual eyeball in Task 5.

**Files:**
- Modify: `client/src/profiles/profileModel.ts`
- Delete: `client/src/profiles/profileModel.test.ts` (only tested `resolveActiveProfile`, removed below)
- Modify: `client/src/profiles/profileStore.ts`
- Modify: `client/src/profiles/profileStore.test.ts`
- Modify: `client/src/profiles/pin.ts` (remove `hashPin`/`verifyPin`)
- Modify: `client/src/profiles/pin.test.ts` (un-skip the "no fast-hash helpers" test)
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/ProfileModal.tsx`

**Interfaces:**
- Consumes: `deriveVaultKey`, `defaultKdfParams`, `newSalt`, `isValidPin`, `KdfParams` (Task 3); `sealProfileSecrets`, `openProfileSecrets`, `ProfileSecrets` (Task 2).
- Produces:
  - `interface StoredProfile { id: string; name: string; createdAt: number; pinSalt: string; kdf: KdfParams; cipher: string }` (persisted shape).
  - `interface Profile { id: string; name: string; createdAt: number; avatar: string | null }` (runtime/decrypted shape for the active profile).
  - `type ActiveProfile = { kind: "anonymous" } | { kind: "named"; profile: Profile }`.
  - `listProfiles(): Promise<StoredProfile[]>` (now migrates: deletes legacy on load).
  - `putProfile(p: StoredProfile)`, `deleteProfile(id)` unchanged in signature intent (now `StoredProfile`).
  - `resolveActiveProfile`, `getActiveProfileId`, `setActiveProfileId` **removed**.

- [ ] **Step 1: Rewrite `profileModel.ts`**

```ts
import type { DeviceKind } from "./device";
import type { KdfParams } from "./pin";

// Persisted shape: clear listing metadata + one opaque sealed blob. The avatar
// (and future per-profile history) live only inside `cipher`.
export interface StoredProfile {
  id: string;
  name: string;
  createdAt: number;
  pinSalt: string; // b64, the Argon2id salt
  kdf: KdfParams; // params to reproduce the key (stored so cost can rise later)
  cipher: string; // b64(nonce ‖ secretbox({ magic, avatar }))
}

// Runtime, decrypted view of the active profile — avatar held in memory only.
export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  avatar: string | null;
}

export type ActiveProfile =
  | { kind: "anonymous" }
  | { kind: "named"; profile: Profile };

export interface PeerProfile {
  name: string;
  avatar: string | null;
  device: DeviceKind | null;
}

export const ANONYMOUS_ID = "anonymous";
```

- [ ] **Step 2: Delete the obsolete model test**

```bash
rm client/src/profiles/profileModel.test.ts
```
(`resolveActiveProfile` no longer exists; there is no remaining pure logic in `profileModel.ts` to unit-test.)

- [ ] **Step 3: Write the failing store migration test** (rewrite `profileStore.test.ts`)

```ts
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { listProfiles, putProfile, deleteProfile } from "./profileStore";
import type { StoredProfile } from "./profileModel";

const mk = (id: string, name: string): StoredProfile => ({
  id,
  name,
  createdAt: 0,
  pinSalt: "cw==", // any b64
  kdf: { ops: 2, mem: 67108864, alg: 2 },
  cipher: "cw==",
});

describe("profileStore", () => {
  beforeEach(async () => {
    for (const p of await listProfiles()) await deleteProfile(p.id);
  });

  it("puts and lists profiles", async () => {
    await putProfile(mk("p1", "Jay"));
    await putProfile(mk("p2", "Work"));
    const names = (await listProfiles()).map((p) => p.name).sort();
    expect(names).toEqual(["Jay", "Work"]);
  });

  it("overwrites a profile with the same id", async () => {
    await putProfile(mk("p1", "Jay"));
    await putProfile({ ...mk("p1", "Jay Renamed") });
    const all = await listProfiles();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Jay Renamed");
  });

  it("deletes a profile", async () => {
    await putProfile(mk("p1", "Jay"));
    await deleteProfile("p1");
    expect(await listProfiles()).toEqual([]);
  });

  it("drops legacy records lacking cipher/kdf on load", async () => {
    const legacy = { id: "old", name: "Legacy", avatar: "data:x", pinSalt: "s", pinHash: "h", createdAt: 0 };
    await putProfile(legacy as unknown as StoredProfile);
    await putProfile(mk("new", "Valid"));
    const list = await listProfiles();
    expect(list.map((p) => p.id)).toEqual(["new"]); // legacy purged, valid kept
    // second load confirms it was deleted, not just filtered:
    expect((await listProfiles()).map((p) => p.id)).toEqual(["new"]);
  });
});
```

- [ ] **Step 4: Run to verify the migration test fails**

Run: `cd client && npx vitest run src/profiles/profileStore.test.ts`
Expected: FAIL — no migration yet (legacy record is returned), plus type errors on `StoredProfile`.

- [ ] **Step 5: Update `profileStore.ts`** — retype to `StoredProfile`, add migration, remove active-id persistence

```ts
import type { StoredProfile } from "./profileModel";

const DB_NAME = "trojan-troy-profiles";
const STORE = "profiles";
const SHARE_KEY = "trojan-troy-share-profile";

const hasIndexedDb = typeof indexedDB !== "undefined";
const memory = new Map<string, StoredProfile>();

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = op(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

// A record is a valid vault only if it carries the sealed blob + KDF params.
// Anything else is a pre-encryption legacy record (cleartext avatar) — we
// delete it on load so no cleartext lingers (migration option a; see the plan).
function isVault(p: unknown): p is StoredProfile {
  const r = p as Record<string, unknown> | null;
  return (
    !!r &&
    typeof r.cipher === "string" &&
    typeof (r.kdf as { alg?: unknown } | undefined)?.alg === "number"
  );
}

export async function listProfiles(): Promise<StoredProfile[]> {
  const all = hasIndexedDb
    ? (await run<StoredProfile[]>("readonly", (s) => s.getAll() as IDBRequest<StoredProfile[]>)) ?? []
    : [...memory.values()];
  const valid: StoredProfile[] = [];
  for (const p of all) {
    if (isVault(p)) valid.push(p);
    else await deleteProfile((p as { id: string }).id);
  }
  return valid;
}

export async function putProfile(profile: StoredProfile): Promise<void> {
  if (!hasIndexedDb) {
    memory.set(profile.id, profile);
    return;
  }
  await run("readwrite", (s) => s.put(profile));
}

export async function deleteProfile(id: string): Promise<void> {
  if (!hasIndexedDb) {
    memory.delete(id);
    return;
  }
  await run("readwrite", (s) => s.delete(id));
}

export function getShareProfile(): boolean {
  try {
    return localStorage.getItem(SHARE_KEY) === "true";
  } catch {
    return false;
  }
}
export function setShareProfile(on: boolean): void {
  try {
    localStorage.setItem(SHARE_KEY, String(on));
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 6: Run to verify the store tests pass**

Run: `cd client && npx vitest run src/profiles/profileStore.test.ts`
Expected: PASS (4 tests, including the legacy-drop migration).

- [ ] **Step 7: Remove the fast hash from `pin.ts` and un-skip its guard test**

In `pin.ts` delete `hashPin` and `verifyPin` (and the `TODO(Task 4)` comment). In `pin.test.ts` change the `it.skip("exposes no fast-hash helpers", ...)` back to `it(...)`.

Run: `cd client && npx vitest run src/profiles/pin.test.ts`
Expected: PASS — including "exposes no fast-hash helpers".

- [ ] **Step 8: Wire `ProfileModal.tsx`** — derive/seal on create, derive/open on unlock

Change the import line:
```ts
import { ANONYMOUS_ID, type StoredProfile } from "../profiles/profileModel";
import { isValidPin, newSalt, deriveVaultKey, defaultKdfParams } from "../profiles/pin";
import { sealProfileSecrets, openProfileSecrets, type ProfileSecrets } from "../profiles/vault";
```

Props → `StoredProfile`, and the create/unlock callbacks carry the sealed record plus the decrypted secrets:
```ts
interface ProfileModalProps {
  profiles: StoredProfile[];
  activeId: string;
  onSelectAnonymous: () => void;
  onSelectNamed: (profile: StoredProfile, secrets: ProfileSecrets) => void; // after a correct PIN
  onCreate: (profile: StoredProfile, secrets: ProfileSecrets) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}
```
`View` and the list/confirm markup are unchanged except the types (`{ name: "unlock"; profile: StoredProfile }`, etc.).

**Avatar call sites (must change — a `StoredProfile` has no `avatar` field, so `avatarSrc(profile.avatar)` is a `tsc` error, not a runtime null).** Replace all three with the imported `defaultAvatar`:
- list tile (`ProfileModal.tsx:97`): `src={defaultAvatar}`
- confirm-delete (`ProfileModal.tsx:151`): `src={defaultAvatar}`
- unlock view (`ProfileModal.tsx:313`): `src={defaultAvatar}`

This is intended — the avatar is encrypted, so tiles show the default picture until unlock. `avatarSrc` may become unused afterward (harmless under this tsconfig); drop the import if so.

`CreateView.handleCreate` (replaces the `hashPin` block):
```ts
async function handleCreate() {
  if (!name.trim()) return setError("Give the profile a name.");
  if (!isValidPin(pin)) return setError("PIN must be exactly 4 digits.");
  if (pin !== confirm) return setError("The PINs don't match.");
  setBusy(true);
  const salt = await newSalt();
  const kdf = await defaultKdfParams();
  const vaultKey = await deriveVaultKey(pin, salt, kdf);
  const cipher = await sealProfileSecrets(vaultKey, { avatar });
  onCreate(
    { id: crypto.randomUUID(), name: name.trim(), createdAt: Date.now(), pinSalt: salt, kdf, cipher },
    { avatar }
  );
}
```
`CreateView`/`UnlockView` prop types change `Profile` → `StoredProfile`; `onCreate`/`onUnlocked` gain the `secrets` arg.

`UnlockView.submit` (replaces `verifyPin`):
```ts
async function submit() {
  if (busy) return;
  setBusy(true);
  const vaultKey = await deriveVaultKey(pin, profile.pinSalt, profile.kdf);
  const secrets = await openProfileSecrets(vaultKey, profile.cipher);
  setBusy(false);
  if (secrets) {
    onUnlocked(profile, secrets);
  } else {
    setWrong(true);
    setPin("");
  }
}
```
Add `const [busy, setBusy] = useState(false);` to `UnlockView` and `disabled={pin.length !== 4 || busy}` on its Unlock button (guards the ~0.1 s Argon2id against a double-submit; flow stays visually identical).

Update the honest copy note in `CreateView` (currently "The PIN locks this profile…"):
```tsx
<p className="profile-form__note">
  The PIN encrypts this profile's photo on this device — basic protection for a
  lost device. It doesn't encrypt your messages.
</p>
```

- [ ] **Step 9: Wire `App.tsx`** — explicit `ActiveProfile` state (R2), no persisted active id

Imports:
```ts
import { ANONYMOUS_ID, type StoredProfile, type ActiveProfile, type Profile, type PeerProfile } from "./profiles/profileModel";
import { listProfiles, putProfile, deleteProfile, getShareProfile, setShareProfile as persistShareProfile } from "./profiles/profileStore";
import type { ProfileSecrets } from "./profiles/vault";
```
(Remove `resolveActiveProfile`, `getActiveProfileId`, `setActiveProfileId as persistActiveProfileId`.)

State — replace `activeProfileId` + derived `activeProfile`:
```ts
const [profiles, setProfiles] = useState<StoredProfile[]>([]);
// Reload starts Anonymous (R2): a named identity requires the PIN re-entered.
const [activeProfile, setActiveProfile] = useState<ActiveProfile>({ kind: "anonymous" });
const activeProfileId = activeProfile.kind === "named" ? activeProfile.profile.id : ANONYMOUS_ID;
```
`selfCard`, `activeProfileRef`, and the sharing block (`activeProfileRef.current.profile.{name,avatar}`) are unchanged — the runtime `Profile` still has `name` + `avatar`.

Handlers:
```ts
function toRuntime(p: StoredProfile, secrets: ProfileSecrets): Profile {
  return { id: p.id, name: p.name, createdAt: p.createdAt, avatar: secrets.avatar };
}

async function handleCreateProfile(profile: StoredProfile, secrets: ProfileSecrets) {
  await putProfile(profile);
  setProfiles(await listProfiles());
  setActiveProfile({ kind: "named", profile: toRuntime(profile, secrets) });
}
function handleSelectNamed(profile: StoredProfile, secrets: ProfileSecrets) {
  setActiveProfile({ kind: "named", profile: toRuntime(profile, secrets) });
}
function handleSelectAnonymous() {
  setActiveProfile({ kind: "anonymous" });
}
async function handleDeleteProfile(id: string) {
  await deleteProfile(id);
  setProfiles(await listProfiles());
  if (activeProfile.kind === "named" && activeProfile.profile.id === id) {
    setActiveProfile({ kind: "anonymous" });
  }
}
```
The initial `useEffect` still runs `void listProfiles().then(setProfiles);` (populates the modal list; note this also purges any legacy record on first load).

Update the `ProfileModal` render props:
```tsx
<ProfileModal
  profiles={profiles}
  activeId={activeProfileId}
  onSelectAnonymous={handleSelectAnonymous}
  onSelectNamed={handleSelectNamed}
  onCreate={handleCreateProfile}
  onDelete={handleDeleteProfile}
  onClose={() => setProfilesOpen(false)}
/>
```

Fix the dev/preview harness fixtures (they construct `Profile[]` with `pinHash`/`pinSalt` — will fail typecheck). The preview list at `App.tsx:758-760` becomes `StoredProfile[]`:
```ts
const sample: StoredProfile[] = [
  { id: "s1", name: "Jay", createdAt: 0, pinSalt: "cw==", kdf: { ops: 2, mem: 67108864, alg: 2 }, cipher: "cw==" },
  { id: "s2", name: "Work", createdAt: 0, pinSalt: "cw==", kdf: { ops: 2, mem: 67108864, alg: 2 }, cipher: "cw==" },
];
```
Any preview `ProfileModal` in that harness gets the same prop set as above (its `onSelectNamed` may be a no-op `() => {}`, but must now accept the two-arg signature — use `() => {}` which is assignable). Grep the file for every remaining `pinHash`/`pinSalt`/`resolveActiveProfile`/`getActiveProfileId` and remove/adjust.

- [ ] **Step 10: Full green gate**

Run:
```bash
cd client && npm run typecheck && npm test && npm run build
```
Expected: all green. Grep the repo to confirm no `hashPin`, `verifyPin`, `pinHash`, or `resolveActiveProfile` references remain:
```bash
grep -rn "hashPin\|verifyPin\|pinHash\|resolveActiveProfile\|getActiveProfileId" client/src
```
Expected: no matches.

- [ ] **Step 11: Commit**

```powershell
git add client/src/profiles client/src/App.tsx client/src/components/ProfileModal.tsx
git commit -m "Encrypt profile avatar at rest; revert to Anonymous on reload"
```

---

### Task 5: Manual verification, docs, and PR

**Files:**
- Modify: `decisions.md`
- Modify: `progress.md`

- [ ] **Step 1: Manual eyeball** (`cd client && npm run dev`, open with `?screen=profiles` if needed)

Confirm each, note results:
1. Create a named profile with an uploaded photo → it's active, avatar shows.
2. Reload the tab → active reverts to **Anonymous** (name/avatar gone); the profile still appears in the Profiles list (name shown, default cat thumbnail).
3. Open it with the correct PIN → avatar returns in the header/self-card.
4. Wrong PIN → "Wrong PIN — try again", no unlock.
5. Anonymous selected → nothing new written to IndexedDB (check DevTools → Application → IndexedDB `trojan-troy-profiles`).
6. With sharing on and the profile unlocked, connect a second tab → the profile card (name + avatar) still arrives at the peer.
7. DevTools → IndexedDB: the stored record shows `cipher`/`kdf`/`pinSalt` and **no** cleartext `avatar`.

- [ ] **Step 2: Log decisions** (append to `decisions.md`)

Add dated entries for: the `libsodium-wrappers` → `-sumo` swap (with the bundle-size delta from Task 1 Step 6) and why (`crypto_pwhash` needs the sumo build); Argon2id **INTERACTIVE** as the cost tier (imperceptible unlock, params stored per-profile so cost can rise later); **name-in-clear** for the listing UX; **migration = delete legacy** (deviates from the spec's preferred re-seal because re-seal reintroduces the S1 fast-hash path); **reload → Anonymous (R2)** per Jay.

- [ ] **Step 3: Update `progress.md`** with a dated entry summarizing the at-rest vault, the files touched, and the verification results (typecheck/test/build green, test count, manual pass).

- [ ] **Step 4: Commit docs**

```powershell
git add decisions.md progress.md
git commit -m "Log at-rest vault decisions and progress"
```

- [ ] **Step 5: Push the branch and open a PR against `main` (do not merge)**

```bash
git push -u origin feat/at-rest-profile-vault
gh pr create --base main --title "At-rest encryption for local profiles" --body "Argon2id-derived vault key seals the profile avatar with crypto_secretbox; removes the fast-hash access check (review S1). Reload reverts to Anonymous. Legacy records deleted on load. Spec: docs/superpowers/specs/2026-07-23-at-rest-encryption-design.md"
```

---

## Self-Review

**Spec coverage:**
- Dependency swap to `-sumo` via alias → Task 1. ✅
- `deriveVaultKey` Argon2id, remove fast hash → Task 3 (add) + Task 4 Step 7 (remove). ✅
- `vault.ts` seal/open + magic sentinel → Task 2. ✅
- `StoredProfile` split (clear metadata + `cipher`/`kdf`) → Task 4 Step 1. ✅
- Legacy migration → Task 4 Steps 3–6 (delete-on-load). ✅
- App/ProfileModal wiring, in-memory avatar, unchanged flow → Task 4 Steps 8–9. ✅
- Tests: pin (deterministic/diff/cost-sanity/no-fast-hash), vault (round-trip/wrong-key/tamper/null-avatar), store (CRUD + migration) → Tasks 2–4. ✅
- Reload → Anonymous (R2) → Task 4 Step 9. ✅
- Honest copy → Task 4 Step 8 + Task 5 Step 2. ✅
- Manual pass + logs + PR → Task 5. ✅

**Placeholder scan:** No TBD/TODO left in shipped code (the one `TODO(Task 4)` marker in Task 3 is explicitly deleted in Task 4 Step 7).

**Type consistency:** `StoredProfile` (persisted) vs `Profile` (runtime) used consistently; `KdfParams` defined in `pin.ts` and imported by `profileModel.ts`; `ProfileSecrets` from `vault.ts` threaded through `onCreate`/`onSelectNamed`/`toRuntime`; `deriveVaultKey(pin, saltB64, params)` signature matches all call sites (create uses fresh `defaultKdfParams()`, unlock uses stored `profile.kdf`).
