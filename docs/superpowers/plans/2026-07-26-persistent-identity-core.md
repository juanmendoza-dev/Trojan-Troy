# Persistent Identity + Contacts (Plan A — Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each browser a persistent X25519 identity keypair + display name, so peers are recognized across reconnects (stable safety number, a contacts list, and an automatic handshake-tamper check) — without touching session confidentiality or the already-shipped Local Profiles feature.

**Architecture:** The identity keypair rides the existing single-shot `pubkey` handshake envelope (two new optional fields) rather than a new envelope type. Session-key derivation (`deriveRootKey`, the Double Ratchet) is untouched — identity is purely informational: a new `computeIdentitySafetyNumber` (identity-keys-only, stable across reconnects) replaces the old ephemeral+rootKey-bound `computeSafetyNumber` for the human-facing digits, and a new automatic bidirectional "confirm" frame exchange (reusing the ratchet's own AEAD as the proof) replaces the rootKey-binding's tamper-detection job without a human needing to eyeball it every reconnect.

**Tech Stack:** TypeScript, React 18, Vite 5, Vitest 2, libsodium-wrappers (`crypto_kx` — the same primitive the ephemeral handshake key already uses; no new primitive, no `-sumo` build needed in this plan).

## Global Constraints

- **Reference spec:** `docs/superpowers/specs/2026-07-26-persistent-identity-revival-design.md` (reconciliation) + `docs/superpowers/specs/2026-07-19-persistent-identity-design.md` (5.1, original component shapes) — this plan implements 5.1's scope only. `docs/superpowers/specs/2026-07-22-contacts-privacy-design.md` (5.1a — pseudonyms, contacts-only/block list, at-rest vault) is **out of scope**; do not build any of it here.
- **No PIN, no at-rest encryption in this plan.** The identity vault is plaintext IndexedDB, exactly as 5.1 originally specified (5.1a's PIN/vault work is a separate, later plan). Do not add sealing/locking scaffolding for it.
- **Session confidentiality is untouched.** `deriveRootKey` (`client/src/crypto/kdf.ts`), the Double Ratchet (`client/src/crypto/ratchet.ts`), and `initSession` (`client/src/protocol/ratchetSession.ts`) get zero changes. No identity-to-identity DH.
- **Audited crypto only; no new dependency.** Identity keys use `crypto_kx_keypair()` — the exact function `client/src/crypto/keys.ts`'s `generateKeypair` already calls.
- **Local Profiles (`client/src/profiles/`) is untouched.** Separate PIN, separate vault, separate `App.tsx` state. Identity's `displayName` and a Local Profile's `name` are independent strings — this is accepted, not solved, in this plan.
- **Every task must leave `cd client && npm run typecheck && npm test && npm run build` green.** Where a change would otherwise leave the app mid-refactor (e.g. a type needing a field nothing populates yet), add the field as optional so existing call sites keep compiling, and tighten it in the task that actually wires it up.
- **Branch:** `feat/persistent-identity-revival` (already created off `main`, current HEAD is the approved reconciliation spec commit). Commit via PowerShell so GPG signing works; short, human-sounding messages, no AI trailer, no `git push` (a post-commit hook auto-pushes). Do not merge — open a PR at the end.
- **Screens/components are manually verified, not unit-tested** (this project's standing convention — see `SafetyNumberScreen`, `ProfileModal`, `Settings`, none of which have test files). Pure modules (`identity.ts`, `recoveryCode.ts`, `safetyNumber.ts`) get Vitest coverage.

---

### Task 1: Identity module — self-record + contacts store

Owns the in-memory identity + contacts and their plaintext IndexedDB persistence. Mirrors the existing "thin wrapper, no framework" style of `client/src/profiles/profileStore.ts` and the server's `rooms.ts`.

**Files:**
- Create: `client/src/identity/store.ts`
- Create: `client/src/identity/store.test.ts`
- Create: `client/src/identity/identity.ts`
- Create: `client/src/identity/identity.test.ts`

**Interfaces:**
- Consumes: `generateKeypair`, `type Keypair` (`client/src/crypto/keys.ts`, existing); `toBase64`/`fromBase64` (`client/src/crypto/encoding.ts`, existing).
- Produces: `initIdentity(): Promise<"setup" | "ready">`, `saveDisplayName(name: string): Promise<void>`, `getIdentityKeypair(): Promise<Keypair>`, `getSelfPublicKey(): string`, `getDisplayName(): string`, `getContact(identityPublicKey: string): ContactRecord | undefined`, `listContacts(): ContactRecord[]`, `upsertContact(entry): Promise<void>`, `touchContact(identityPublicKey: string): Promise<void>`, `deleteContact(identityPublicKey: string): Promise<void>`, `shortFingerprint(identityPublicKey: string): string`, `type ContactRecord`, `VAULT_KEY` (exported for test cleanup).

- [ ] **Step 1: Write the failing `store.ts` tests**

Create `client/src/identity/store.test.ts`:

```ts
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { idbGet, idbPut, idbDel } from "./store";

describe("identity/store", () => {
  beforeEach(async () => {
    await idbDel("k1");
  });

  it("returns undefined for a missing key", async () => {
    expect(await idbGet("k1")).toBeUndefined();
  });

  it("round-trips a value", async () => {
    await idbPut("k1", { a: 1, b: "two" });
    expect(await idbGet("k1")).toEqual({ a: 1, b: "two" });
  });

  it("overwrites an existing value", async () => {
    await idbPut("k1", { a: 1 });
    await idbPut("k1", { a: 2 });
    expect(await idbGet("k1")).toEqual({ a: 2 });
  });

  it("deletes a value", async () => {
    await idbPut("k1", { a: 1 });
    await idbDel("k1");
    expect(await idbGet("k1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/identity/store.test.ts`
Expected: FAIL — `./store` has no exports yet.

- [ ] **Step 3: Implement `store.ts`**

Create `client/src/identity/store.ts`:

```ts
// Thin IndexedDB key/value wrapper for the identity module -- one database,
// one object store, string keys, structured-clone values. No query logic
// beyond key lookup (matches client/src/profiles/profileStore.ts and the
// server's rooms.ts).

const DB_NAME = "trojan-troy-identity";
const STORE = "kv";
const DB_VERSION = 1;

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run to verify `store.ts` tests pass**

Run: `cd client && npx vitest run src/identity/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `identity.ts` tests**

Create `client/src/identity/identity.test.ts`:

```ts
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  initIdentity,
  saveDisplayName,
  getIdentityKeypair,
  getSelfPublicKey,
  getDisplayName,
  getContact,
  listContacts,
  upsertContact,
  touchContact,
  deleteContact,
  shortFingerprint,
  VAULT_KEY,
} from "./identity";
import { idbDel, idbPut } from "./store";

describe("identity: self record", () => {
  beforeEach(async () => {
    await idbDel(VAULT_KEY);
  });

  it("generates and persists a fresh identity when storage is empty", async () => {
    const status = await initIdentity();
    expect(status).toBe("setup");
    expect(getSelfPublicKey().length).toBeGreaterThan(0);
  });

  it("returns 'ready' once a display name has been saved and reloaded", async () => {
    await initIdentity();
    const publicKey = getSelfPublicKey();
    await saveDisplayName("Jay");

    const status = await initIdentity(); // reload, simulating a fresh app launch
    expect(status).toBe("ready");
    expect(getDisplayName()).toBe("Jay");
    expect(getSelfPublicKey()).toBe(publicKey); // same identity, not regenerated
  });

  it("keypair round-trips through storage", async () => {
    await initIdentity();
    const kp = await getIdentityKeypair();
    expect(kp.publicKey.length).toBe(32); // crypto_kx public key size
    expect(kp.privateKey.length).toBe(32);
  });

  it("self-heals from corrupt storage instead of throwing", async () => {
    await idbPut(VAULT_KEY, { self: { identityPublicKey: "" } });
    const status = await initIdentity();
    expect(status).toBe("setup");
    expect(getSelfPublicKey().length).toBeGreaterThan(0);
  });
});

describe("identity: contacts", () => {
  beforeEach(async () => {
    await idbDel(VAULT_KEY);
    await initIdentity();
  });

  it("returns undefined for an unknown contact", () => {
    expect(getContact("nope")).toBeUndefined();
  });

  it("upserts and retrieves a contact", async () => {
    await upsertContact({ identityPublicKey: "abc", displayName: "Rio", safetyNumber: "11111 22222" });
    const c = getContact("abc");
    expect(c?.displayName).toBe("Rio");
    expect(c?.safetyNumber).toBe("11111 22222");
    expect(c?.firstVerifiedAt).toBe(c?.lastSeenAt);
  });

  it("preserves firstVerifiedAt across an update, bumps lastSeenAt", async () => {
    await upsertContact({ identityPublicKey: "abc", safetyNumber: "111" });
    const first = getContact("abc")!.firstVerifiedAt;
    await new Promise((r) => setTimeout(r, 2));
    await upsertContact({ identityPublicKey: "abc", safetyNumber: "111" });
    const second = getContact("abc")!;
    expect(second.firstVerifiedAt).toBe(first);
    expect(second.lastSeenAt).toBeGreaterThanOrEqual(first);
  });

  it("lists contacts sorted by most-recently-seen first", async () => {
    await upsertContact({ identityPublicKey: "old", safetyNumber: "1" });
    await new Promise((r) => setTimeout(r, 2));
    await upsertContact({ identityPublicKey: "new", safetyNumber: "2" });
    expect(listContacts().map((c) => c.identityPublicKey)).toEqual(["new", "old"]);
  });

  it("touchContact bumps lastSeenAt without changing other fields", async () => {
    await upsertContact({ identityPublicKey: "abc", displayName: "Rio", safetyNumber: "111" });
    await new Promise((r) => setTimeout(r, 2));
    await touchContact("abc");
    const c = getContact("abc")!;
    expect(c.displayName).toBe("Rio");
    expect(c.lastSeenAt).toBeGreaterThan(c.firstVerifiedAt);
  });

  it("deletes a contact", async () => {
    await upsertContact({ identityPublicKey: "abc", safetyNumber: "111" });
    await deleteContact("abc");
    expect(getContact("abc")).toBeUndefined();
  });

  it("persists contacts across a reload", async () => {
    await upsertContact({ identityPublicKey: "abc", safetyNumber: "111" });
    await initIdentity(); // reload
    expect(getContact("abc")?.safetyNumber).toBe("111");
  });
});

describe("shortFingerprint", () => {
  it("keeps only alphanumerics, capped at 8 chars", () => {
    expect(shortFingerprint("ab+c/d==ef12gh")).toBe("abcdef12");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd client && npx vitest run src/identity/identity.test.ts`
Expected: FAIL — `./identity` has no exports yet.

- [ ] **Step 7: Implement `identity.ts`**

Create `client/src/identity/identity.ts`:

```ts
import { generateKeypair, type Keypair } from "../crypto/keys";
import { toBase64, fromBase64 } from "../crypto/encoding";
import { idbGet, idbPut, isIndexedDbAvailable } from "./store";

// Owns the in-memory persistent identity + contacts for this browser, and its
// plaintext IndexedDB persistence. No PIN / at-rest encryption in this build
// -- that's a separate, later privacy-layer plan. Everything here is
// client-side; the relay never sees any of it.

export const VAULT_KEY = "vault";

export interface SelfRecord {
  identityPublicKey: string; // base64
  identitySecretKey: string; // base64
  displayName: string;
}

export interface ContactRecord {
  identityPublicKey: string; // base64
  displayName?: string; // last self-asserted name they presented (cosmetic)
  safetyNumber: string; // computeIdentitySafetyNumber output, for the "recognized" match
  firstVerifiedAt: number;
  lastSeenAt: number;
}

interface VaultData {
  self: SelfRecord;
  contacts: Record<string, ContactRecord>;
}

let vault: VaultData | null = null;
let persistent = true;

function requireVault(): VaultData {
  if (!vault) throw new Error("Identity not loaded.");
  return vault;
}

async function freshVault(): Promise<VaultData> {
  const kp = await generateKeypair();
  return {
    self: {
      identityPublicKey: await toBase64(kp.publicKey),
      identitySecretKey: await toBase64(kp.privateKey),
      displayName: "",
    },
    contacts: {},
  };
}

async function persist(): Promise<void> {
  if (!persistent || !vault) return;
  await idbPut(VAULT_KEY, vault);
}

export type IdentityStatus = "setup" | "ready";

// Load or create the identity. "setup" -> no display name yet (SetupScreen
// collects one). "ready" -> loaded into memory. Never throws to the UI --
// corrupt/missing storage self-heals to a fresh in-memory identity.
export async function initIdentity(): Promise<IdentityStatus> {
  if (!isIndexedDbAvailable()) {
    persistent = false;
    vault = await freshVault();
    return "setup";
  }
  let record: VaultData | undefined;
  try {
    record = await idbGet<VaultData>(VAULT_KEY);
  } catch {
    persistent = false;
    vault = await freshVault();
    return "setup";
  }
  if (!record || !record.self || !record.self.identityPublicKey) {
    vault = await freshVault();
    await persist();
    return "setup";
  }
  vault = { self: record.self, contacts: record.contacts ?? {} };
  return vault.self.displayName ? "ready" : "setup";
}

export async function saveDisplayName(name: string): Promise<void> {
  requireVault().self.displayName = name;
  await persist();
}

export async function getIdentityKeypair(): Promise<Keypair> {
  const self = requireVault().self;
  return {
    publicKey: await fromBase64(self.identityPublicKey),
    privateKey: await fromBase64(self.identitySecretKey),
  };
}

export function getSelfPublicKey(): string {
  return requireVault().self.identityPublicKey;
}
export function getDisplayName(): string {
  return requireVault().self.displayName;
}
export function isPersistent(): boolean {
  return persistent;
}

export function getContact(identityPublicKey: string): ContactRecord | undefined {
  return requireVault().contacts[identityPublicKey];
}
export function listContacts(): ContactRecord[] {
  return Object.values(requireVault().contacts).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
export async function upsertContact(entry: {
  identityPublicKey: string;
  displayName?: string;
  safetyNumber: string;
}): Promise<void> {
  const v = requireVault();
  const existing = v.contacts[entry.identityPublicKey];
  const now = Date.now();
  v.contacts[entry.identityPublicKey] = {
    identityPublicKey: entry.identityPublicKey,
    displayName: entry.displayName ?? existing?.displayName,
    safetyNumber: entry.safetyNumber,
    firstVerifiedAt: existing?.firstVerifiedAt ?? now,
    lastSeenAt: now,
  };
  await persist();
}
export async function touchContact(identityPublicKey: string): Promise<void> {
  const c = requireVault().contacts[identityPublicKey];
  if (c) {
    c.lastSeenAt = Date.now();
    await persist();
  }
}
export async function deleteContact(identityPublicKey: string): Promise<void> {
  delete requireVault().contacts[identityPublicKey];
  await persist();
}

// A short, stable visual id for a peer who presents no name.
export function shortFingerprint(identityPublicKey: string): string {
  return identityPublicKey.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
}
```

- [ ] **Step 8: Run typecheck + tests to verify green**

Run: `cd client && npm run typecheck && npx vitest run src/identity`
Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add client/src/identity/store.ts client/src/identity/store.test.ts client/src/identity/identity.ts client/src/identity/identity.test.ts
git commit -m "Add the identity + contacts store"
```

---

### Task 2: Recovery codes — plaintext export/import

Human-readable identity backup, plaintext only in this plan (a passphrase-wrapped variant is 5.1a's job, later). Same wire shape as the safety number: base64, grouped into 5-char blocks.

**Files:**
- Create: `client/src/identity/recoveryCode.ts`
- Create: `client/src/identity/recoveryCode.test.ts`
- Modify: `client/src/crypto/keys.ts` (add `publicKeyFromSecret`)
- Modify: `client/src/crypto/keys.test.ts` (add a case for it)
- Modify: `client/src/identity/identity.ts` (add `restoreFromRecoveryCode` / `exportRecoveryCode`)
- Modify: `client/src/identity/identity.test.ts` (add cases for them)

**Interfaces:**
- Consumes: `sodium.crypto_kx_SECRETKEYBYTES` (libsodium, existing dependency).
- Produces: `encodeRecoveryCode(secretKey: Uint8Array, displayName: string): Promise<string>`, `decodeRecoveryCode(code: string): Promise<{ secretKey: Uint8Array; displayName: string }>`, `publicKeyFromSecret(privateKey: Uint8Array): Promise<Uint8Array>`, `restoreFromRecoveryCode(code: string): Promise<void>`, `exportRecoveryCode(): Promise<string>`.

- [ ] **Step 1: Write the failing `recoveryCode.ts` tests**

Create `client/src/identity/recoveryCode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sodium from "libsodium-wrappers";
import { encodeRecoveryCode, decodeRecoveryCode } from "./recoveryCode";
import { generateKeypair } from "../crypto/keys";

describe("recoveryCode", () => {
  it("round-trips secret key + display name", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay");
    const decoded = await decodeRecoveryCode(code);
    await sodium.ready;
    expect(sodium.memcmp(decoded.secretKey, kp.privateKey)).toBe(true);
    expect(decoded.displayName).toBe("Jay");
  });

  it("round-trips a non-ASCII display name", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Río");
    const decoded = await decodeRecoveryCode(code);
    expect(decoded.displayName).toBe("Río");
  });

  it("groups into blocks of at most 5 characters", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay");
    for (const block of code.split(" ")) expect(block.length).toBeLessThanOrEqual(5);
  });

  it("tolerates surrounding whitespace on decode", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay");
    const decoded = await decodeRecoveryCode(`  ${code}  `);
    expect(decoded.displayName).toBe("Jay");
  });

  it("rejects malformed input", async () => {
    await expect(decodeRecoveryCode("!!!! not base64 @@@@")).rejects.toThrow();
  });

  it("rejects truncated input", async () => {
    const kp = await generateKeypair();
    const code = await encodeRecoveryCode(kp.privateKey, "Jay");
    await expect(decodeRecoveryCode(code.slice(0, 10))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/identity/recoveryCode.test.ts`
Expected: FAIL — `./recoveryCode` has no exports yet.

- [ ] **Step 3: Implement `recoveryCode.ts`**

Create `client/src/identity/recoveryCode.ts`:

```ts
import sodium from "libsodium-wrappers";

// Human-readable identity backup: the identity secret key + display name,
// base64-encoded and grouped into 5-char blocks like the safety number. The
// public key is never stored -- it's recomputed from the secret on import.
// Plaintext only in this build; a passphrase-protected export is a later
// privacy-layer addition (would need a leading format flag byte to stay
// backward-compatible with codes issued by this version).

function buildPayload(secretKey: Uint8Array, displayName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(displayName);
  const payload = new Uint8Array(2 + nameBytes.length + secretKey.length);
  new DataView(payload.buffer).setUint16(0, nameBytes.length, false);
  payload.set(nameBytes, 2);
  payload.set(secretKey, 2 + nameBytes.length);
  return payload;
}

function parsePayload(payload: Uint8Array): { secretKey: Uint8Array; displayName: string } {
  if (payload.length < 2) throw new Error("Malformed recovery code.");
  const nameLen = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0, false);
  const secretStart = 2 + nameLen;
  const secretKey = payload.slice(secretStart);
  if (secretKey.length !== sodium.crypto_kx_SECRETKEYBYTES) throw new Error("Malformed recovery code.");
  const displayName = new TextDecoder().decode(payload.slice(2, secretStart));
  return { secretKey, displayName };
}

function group(value: string): string {
  const groups: string[] = [];
  for (let i = 0; i < value.length; i += 5) groups.push(value.slice(i, i + 5));
  return groups.join(" ");
}

export async function encodeRecoveryCode(secretKey: Uint8Array, displayName: string): Promise<string> {
  await sodium.ready;
  const payload = buildPayload(secretKey, displayName);
  return group(sodium.to_base64(payload, sodium.base64_variants.ORIGINAL));
}

export async function decodeRecoveryCode(code: string): Promise<{ secretKey: Uint8Array; displayName: string }> {
  await sodium.ready;
  let payload: Uint8Array;
  try {
    payload = sodium.from_base64(code.replace(/\s+/g, ""), sodium.base64_variants.ORIGINAL);
  } catch {
    throw new Error("Malformed recovery code.");
  }
  return parsePayload(payload);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/identity/recoveryCode.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `publicKeyFromSecret` test**

Append to `client/src/crypto/keys.test.ts` (add `publicKeyFromSecret` to the existing import from `./keys`):

```ts
it("publicKeyFromSecret recomputes the same public key generateKeypair produced", async () => {
  const kp = await generateKeypair();
  const recomputed = await publicKeyFromSecret(kp.privateKey);
  await sodium.ready;
  expect(sodium.memcmp(recomputed, kp.publicKey)).toBe(true);
});
```

(If `sodium`/`libsodium-wrappers` isn't already imported in that test file, add `import sodium from "libsodium-wrappers";`.)

- [ ] **Step 6: Run to verify it fails**

Run: `cd client && npx vitest run src/crypto/keys.test.ts`
Expected: FAIL — `publicKeyFromSecret` is not exported.

- [ ] **Step 7: Implement `publicKeyFromSecret` in `keys.ts`**

Append to `client/src/crypto/keys.ts`:

```ts
// Recomputes an X25519 public key from its secret key -- used to restore an
// identity from a recovery code, which stores only the secret key.
export async function publicKeyFromSecret(privateKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_scalarmult_base(privateKey);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd client && npx vitest run src/crypto/keys.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing `identity.ts` restore/export tests**

Append to `client/src/identity/identity.test.ts` (add `restoreFromRecoveryCode`, `exportRecoveryCode` to the existing import from `./identity`):

```ts
describe("identity: recovery code", () => {
  beforeEach(async () => {
    await idbDel(VAULT_KEY);
  });

  it("exports and restores the same identity", async () => {
    await initIdentity();
    await saveDisplayName("Jay");
    const originalPublicKey = getSelfPublicKey();
    const code = await exportRecoveryCode();

    await idbDel(VAULT_KEY);
    await initIdentity(); // now a different, fresh identity
    expect(getSelfPublicKey()).not.toBe(originalPublicKey);

    await restoreFromRecoveryCode(code);
    expect(getSelfPublicKey()).toBe(originalPublicKey);
    expect(getDisplayName()).toBe("Jay");
  });

  it("restoring preserves the existing contacts list", async () => {
    await initIdentity();
    await saveDisplayName("Jay");
    await upsertContact({ identityPublicKey: "abc", safetyNumber: "111" });
    const code = await exportRecoveryCode();

    await restoreFromRecoveryCode(code);
    expect(getContact("abc")?.safetyNumber).toBe("111");
  });

  it("rejects a malformed code without touching existing storage", async () => {
    await initIdentity();
    await saveDisplayName("Jay");
    const publicKey = getSelfPublicKey();
    await expect(restoreFromRecoveryCode("not a real code")).rejects.toThrow();
    expect(getSelfPublicKey()).toBe(publicKey);
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `cd client && npx vitest run src/identity/identity.test.ts`
Expected: FAIL — `restoreFromRecoveryCode`/`exportRecoveryCode` not exported.

- [ ] **Step 11: Implement in `identity.ts`**

Add the import and two functions to `client/src/identity/identity.ts`:

```ts
import { encodeRecoveryCode, decodeRecoveryCode } from "./recoveryCode";
import { publicKeyFromSecret } from "../crypto/keys";
```

```ts
export async function restoreFromRecoveryCode(code: string): Promise<void> {
  const { secretKey, displayName } = await decodeRecoveryCode(code);
  const publicKey = await publicKeyFromSecret(secretKey);
  vault = {
    self: {
      identityPublicKey: await toBase64(publicKey),
      identitySecretKey: await toBase64(secretKey),
      displayName,
    },
    contacts: vault?.contacts ?? {},
  };
  await persist();
}

export async function exportRecoveryCode(): Promise<string> {
  const self = requireVault().self;
  return encodeRecoveryCode(await fromBase64(self.identitySecretKey), self.displayName);
}
```

(Note: `decodeRecoveryCode` throwing on malformed input happens *before* `vault` is reassigned, so the "rejects without touching existing storage" test passes without extra guard code.)

- [ ] **Step 12: Run typecheck + tests to verify green**

Run: `cd client && npm run typecheck && npx vitest run src/identity src/crypto/keys.test.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```powershell
git add client/src/identity/recoveryCode.ts client/src/identity/recoveryCode.test.ts client/src/crypto/keys.ts client/src/crypto/keys.test.ts client/src/identity/identity.ts client/src/identity/identity.test.ts
git commit -m "Add plaintext identity recovery codes"
```

---

### Task 3: `SetupScreen` + App mount-time identity gating

Shown once, before `StartJoinScreen`, whenever no display name is stored yet. Loads/creates the identity on mount; nothing else in the app depends on it existing until Task 8.

**Files:**
- Create: `client/src/screens/SetupScreen.tsx`
- Create: `client/src/screens/SetupScreen.css`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `initIdentity`, `saveDisplayName`, `restoreFromRecoveryCode`, `getIdentityKeypair` (Task 1/2).
- Produces: nothing new consumed by later tasks (Task 8 reads identity via the same Task 1/2 functions directly, not through this screen).

- [ ] **Step 1: Create `SetupScreen.tsx`**

Create `client/src/screens/SetupScreen.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import "./SetupScreen.css";

interface SetupScreenProps {
  onSubmitName: (name: string) => void;
  onRestoreCode: (code: string) => Promise<boolean>;
}

export function SetupScreen({ onSubmitName, onRestoreCode }: SetupScreenProps) {
  const [name, setName] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const [code, setCode] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmitName(trimmed);
  }

  async function handleRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim() || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    const ok = await onRestoreCode(code.trim());
    setRestoring(false);
    if (!ok) setRestoreError("That recovery code doesn't look right.");
  }

  return (
    <div className="setup-screen">
      <div className="setup-screen__card">
        <h1 className="setup-screen__title">Choose a name</h1>
        <p className="setup-screen__subtitle">
          Shown to people you connect with. You can change it later.
        </p>
        <form className="setup-screen__form" onSubmit={handleSubmit}>
          <input
            className="setup-screen__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            maxLength={40}
            autoFocus
          />
          <button type="submit" className="setup-screen__continue" disabled={!name.trim()}>
            Continue
          </button>
        </form>

        {!showRestore && (
          <button
            type="button"
            className="setup-screen__restore-link"
            onClick={() => setShowRestore(true)}
          >
            Restore from a recovery code
          </button>
        )}
        {showRestore && (
          <form className="setup-screen__restore-form" onSubmit={handleRestore}>
            <textarea
              className="setup-screen__restore-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Paste your recovery code"
              rows={2}
            />
            {restoreError && <p className="setup-screen__restore-error">{restoreError}</p>}
            <button type="submit" className="setup-screen__restore-submit" disabled={restoring}>
              {restoring ? "Restoring…" : "Restore"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `SetupScreen.css`**

Create `client/src/screens/SetupScreen.css`:

```css
.setup-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.setup-screen__card {
  width: 360px;
  max-width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 28px 24px;
  color: var(--text-primary);
  font-family: var(--font-ui);
  text-align: center;
}
.setup-screen__title {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 8px;
}
.setup-screen__subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 20px;
}
.setup-screen__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.setup-screen__input,
.setup-screen__restore-input {
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 14px;
}
.setup-screen__continue {
  border: none;
  border-radius: 10px;
  padding: 10px 12px;
  font-weight: 600;
  cursor: pointer;
}
.setup-screen__continue:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.setup-screen__restore-link {
  margin-top: 16px;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
}
.setup-screen__restore-form {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.setup-screen__restore-error {
  color: #ff6b6b;
  font-size: 12px;
  margin: 0;
}
.setup-screen__restore-submit {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
}
```

- [ ] **Step 3: Wire identity load + `SetupScreen` into `App.tsx`**

Add the import (alongside the other screen imports):

```ts
import { SetupScreen } from "./screens/SetupScreen";
import {
  initIdentity,
  saveDisplayName,
  restoreFromRecoveryCode,
  getIdentityKeypair,
  type IdentityStatus,
} from "./identity/identity";
```

Add state near the other `useState`/`useRef` declarations at the top of the component:

```ts
const [identityStatus, setIdentityStatus] = useState<IdentityStatus | "loading">("loading");
const [identityKeypair, setIdentityKeypair] = useState<Keypair | null>(null);
const identityKeypairRef = useRef<Keypair | null>(null);
identityKeypairRef.current = identityKeypair;

useEffect(() => {
  void (async () => {
    const status = await initIdentity();
    setIdentityKeypair(await getIdentityKeypair());
    setIdentityStatus(status);
  })();
}, []);

async function handleSubmitName(name: string) {
  await saveDisplayName(name);
  setIdentityStatus("ready");
}
async function handleRestoreCode(code: string): Promise<boolean> {
  try {
    await restoreFromRecoveryCode(code);
  } catch {
    return false;
  }
  setIdentityKeypair(await getIdentityKeypair());
  setIdentityStatus("ready");
  return true;
}
```

In the render section, right before `if (screen.name === "start") {`, add the gate (after the `devOverride` blocks, so `?screen=` dev previews keep working without a real identity):

```tsx
if (!devOverride && identityStatus !== "ready") {
  if (identityStatus === "loading") return null;
  return <SetupScreen onSubmitName={handleSubmitName} onRestoreCode={handleRestoreCode} />;
}
```

- [ ] **Step 4: Verify green**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green (existing suite unchanged; no new unit tests in this task — screens are manually verified per project convention).

- [ ] **Step 5: Commit**

```powershell
git add client/src/screens/SetupScreen.tsx client/src/screens/SetupScreen.css client/src/App.tsx
git commit -m "Add first-launch identity setup screen"
```

---

### Task 4: Extend the `pubkey` envelope + add the `confirm` channel

Purely additive: new optional envelope fields and a new frame channel value. Nothing consumes them yet (Task 8 does), so this stays fully backward-compatible with every existing call site.

**Files:**
- Modify: `client/src/net/relayClient.ts`
- Modify: `client/src/crypto/framing.ts`
- Test: `client/src/crypto/framing.test.ts`

**Interfaces:**
- Produces: `Channel` gains `"confirm"`; `Envelope`'s `"pubkey"` variant gains `identityPublicKey?: string` and `displayName?: string`; `PROTOCOL_VERSION` becomes `4`.

- [ ] **Step 1: Write the failing framing test**

Append to `client/src/crypto/framing.test.ts`:

```ts
it("round-trips a confirm frame like primer", () => {
  const body = new Uint8Array([1, 2, 3, 4]);
  const out = unframe(frame({ channel: "confirm", id: "", body }));
  expect(out.channel).toBe("confirm");
  expect(out.id).toBe("");
  expect(Array.from(out.body)).toEqual([1, 2, 3, 4]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npm run typecheck`
Expected: FAIL — `Type '"confirm"' is not assignable to type 'Channel'` in `framing.test.ts`.

- [ ] **Step 3: Add `"confirm"` to the `Channel` union**

In `client/src/crypto/framing.ts`, update the comment + union:

```ts
// "primer" is a hidden bootstrap message the initiator sends so the responder
// gains a sending chain (see the Double Ratchet init); it renders nothing.
// "confirm" is the responder's reply to "primer" -- proof to the initiator
// that both sides derived the same rootKey (see the persistent-identity
// reconciliation spec, "two-tier verification"). Also renders nothing.
export type Channel = "text" | "voice" | "presence" | "ack" | "profile" | "primer" | "confirm";
```

- [ ] **Step 4: Run to verify the framing test passes**

Run: `cd client && npm run typecheck && npx vitest run src/crypto/framing.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the `pubkey` envelope + bump `PROTOCOL_VERSION`**

In `client/src/net/relayClient.ts`:

```ts
// Bumped whenever the handshake / post-handshake wire format changes. Sent on
// `pubkey` and checked by the peer, so a stale client hits an error screen
// instead of deriving keys against a format it can't speak. v4 adds the
// long-term identity public key + optional display name to `pubkey`.
export const PROTOCOL_VERSION = 4;
```

```ts
  // `payload` = base64 X25519 handshake public key. `kem` (responder only) =
  // base64 ML-KEM-768 public key for the hybrid post-quantum leg.
  // `identityPublicKey` = base64 long-term X25519 identity public key;
  // `displayName` is the self-asserted name shown to the peer, if any.
  | { type: "pubkey"; payload: string; v: number; kem?: string; identityPublicKey?: string; displayName?: string }
```

- [ ] **Step 6: Run to verify green**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green (no existing call site is broken -- both new fields are optional).

- [ ] **Step 7: Commit**

```powershell
git add client/src/crypto/framing.ts client/src/crypto/framing.test.ts client/src/net/relayClient.ts
git commit -m "Add the confirm channel and identity fields to the handshake envelope"
```

---

### Task 5: `computeIdentitySafetyNumber`

New, identity-keys-only safety number. Added alongside the existing `computeSafetyNumber` (still in active use by `App.tsx` until Task 8 cuts over) -- not a permanent shim, just the natural TDD order for a call-site swap that needs its own task.

**Files:**
- Modify: `client/src/crypto/safetyNumber.ts`
- Modify: `client/src/crypto/safetyNumber.test.ts`

**Interfaces:**
- Produces: `computeIdentitySafetyNumber(identityPublicKeyA: Uint8Array, identityPublicKeyB: Uint8Array): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/crypto/safetyNumber.test.ts` (add `computeIdentitySafetyNumber` to the existing import):

```ts
describe("computeIdentitySafetyNumber", () => {
  it("is deterministic regardless of argument order", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);

    const ab = await computeIdentitySafetyNumber(a, b);
    const ba = await computeIdentitySafetyNumber(b, a);

    expect(ab).toBe(ba);
  });

  it("formats as space-separated groups of 5 digits", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);

    const result = await computeIdentitySafetyNumber(a, b);

    expect(result).toMatch(/^(\d{5} )*\d{5}$/);
  });

  it("produces a different number for a different key pair", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const c = sodium.randombytes_buf(32);

    const ab = await computeIdentitySafetyNumber(a, b);
    const ac = await computeIdentitySafetyNumber(a, c);

    expect(ab).not.toBe(ac);
  });

  it("is stable across repeated derivations with the same identity keys -- the property reconnects rely on", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);

    // Simulates two independent reconnects between the same two identities --
    // no session/ephemeral material is an input, so nothing here can vary it.
    const first = await computeIdentitySafetyNumber(a, b);
    const second = await computeIdentitySafetyNumber(a, b);

    expect(first).toBe(second);
  });

  it("never collides with the legacy per-session number's domain", async () => {
    await sodium.ready;
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    const rk = sodium.randombytes_buf(32);

    const identity = await computeIdentitySafetyNumber(a, b);
    const legacy = await computeSafetyNumber(a, b, rk);

    expect(identity).not.toBe(legacy);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/crypto/safetyNumber.test.ts`
Expected: FAIL — `computeIdentitySafetyNumber` is not exported.

- [ ] **Step 3: Implement `computeIdentitySafetyNumber`**

Append to `client/src/crypto/safetyNumber.ts` (leave the existing `computeSafetyNumber` untouched -- Task 8 removes it):

```ts
// Long-term identity-key safety number -- shown for manual once-per-contact
// verification and stored for recognized-contact matching. Deliberately
// independent of any session material (ephemeral keys, the ratchet root
// key): that's what makes it stable across reconnects with the same contact.
// Per-session tamper/downgrade detection is a separate, automatic mechanism
// (the handshake confirm exchange in App.tsx) -- see
// docs/superpowers/specs/2026-07-26-persistent-identity-revival-design.md,
// "Two-tier verification", for why these had to split.
export async function computeIdentitySafetyNumber(
  identityPublicKeyA: Uint8Array,
  identityPublicKeyB: Uint8Array
): Promise<string> {
  await sodium.ready;
  const [first, second] = [identityPublicKeyA, identityPublicKeyB].sort((a, b) =>
    sodium.to_hex(a).localeCompare(sodium.to_hex(b))
  );
  const domain = sodium.from_string("TTr:sas-identity:v4");
  const combined = new Uint8Array(domain.length + first.length + second.length);
  combined.set(domain, 0);
  combined.set(first, domain.length);
  combined.set(second, domain.length + first.length);
  const digest = sodium.crypto_generichash(20, combined);

  const decimal = Array.from(digest)
    .map((byte) => byte.toString().padStart(3, "0"))
    .join("");

  const groups: string[] = [];
  for (let i = 0; i < decimal.length; i += 5) {
    groups.push(decimal.slice(i, i + 5));
  }
  return groups.join(" ");
}
```

- [ ] **Step 4: Run to verify green**

Run: `cd client && npm run typecheck && npx vitest run src/crypto/safetyNumber.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add client/src/crypto/safetyNumber.ts client/src/crypto/safetyNumber.test.ts
git commit -m "Add the identity-keys-only safety number"
```

---

### Task 6: `SafetyNumberScreen` — three verification branches

Adds optional `branch`/`peerName` props for the "recognized" and "key-changed" states from 5.1. Optional so the existing `App.tsx` call site (unchanged until Task 8) keeps compiling and behaving exactly as today.

**Files:**
- Modify: `client/src/screens/SafetyNumberScreen.tsx`
- Modify: `client/src/screens/SafetyNumberScreen.css`

**Interfaces:**
- Produces: `SafetyNumberScreenProps` gains `branch?: "new" | "recognized" | "key-changed"` (default `"new"`) and `peerName?: string`.

- [ ] **Step 1: Add the props + branch rendering**

In `client/src/screens/SafetyNumberScreen.tsx`, update the props interface:

```ts
interface SafetyNumberScreenProps {
  roomCode: string;
  safetyNumber: string;
  branch?: "new" | "recognized" | "key-changed";
  peerName?: string;
  onVerified: () => void;
  onMismatch: () => void;
}
```

Update the function signature to destructure the new props:

```tsx
export function SafetyNumberScreen({
  roomCode,
  safetyNumber,
  branch = "new",
  peerName,
  onVerified,
  onMismatch,
}: SafetyNumberScreenProps) {
```

Right after the `groups`/state/ref declarations (before the `useEffect` cleanup block), add the early return for the "recognized" branch -- it never shows the drag-to-seal UI at all:

```tsx
  if (branch === "recognized") {
    return (
      <div className="confirm-key confirm-key--recognized">
        <div className="confirm-key__top">
          <div className="confirm-key__status" data-phase="sealed">
            <span>✓</span>
            <span>RECONNECTED</span>
          </div>
          <div className="confirm-key__room">Room {roomCode}</div>
        </div>
        <div className="confirm-key__center">
          <h1 className="confirm-key__title">
            {peerName ? `Reconnected with ${peerName}` : "Reconnected"}
          </h1>
          <p className="confirm-key__subtitle">Already verified -- no need to compare again.</p>
          <button type="button" className="confirm-key__continue-recognized" onClick={onVerified}>
            Continue
          </button>
        </div>
      </div>
    );
  }
```

For the "key-changed" branch, add a warning banner above the existing card in the `"verify"` phase JSX. Find the block that renders `<div className="confirm-key__card">` inside `confirm-key__center` and insert immediately before it:

```tsx
        {branch === "key-changed" && (
          <div className="confirm-key__key-changed-warning" role="alert">
            <div className="confirm-key__warning-title">This isn't who you verified before</div>
            <div className="confirm-key__warning-body">
              {peerName ? `Someone connected as "${peerName}"` : "Someone connected"} with a
              different key than the one you verified previously under that name. Compare the
              number carefully before continuing.
            </div>
          </div>
        )}
```

- [ ] **Step 2: Add the CSS for the two new states**

Append to `client/src/screens/SafetyNumberScreen.css`:

```css
.confirm-key--recognized .confirm-key__center {
  justify-content: center;
}
.confirm-key__continue-recognized {
  margin-top: 20px;
  border: none;
  border-radius: 10px;
  padding: 12px 24px;
  font-weight: 600;
  cursor: pointer;
  background: var(--bg-card);
  color: var(--text-primary);
}
.confirm-key__key-changed-warning {
  width: 100%;
  max-width: 380px;
  margin: 0 auto 16px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #ff6b6b;
  background: rgba(255, 107, 107, 0.08);
  text-align: left;
}
.confirm-key__key-changed-warning .confirm-key__warning-title {
  color: #ff6b6b;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
}
.confirm-key__key-changed-warning .confirm-key__warning-body {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
```

- [ ] **Step 3: Verify green**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green (existing `?screen=safety` dev preview keeps rendering the "new" branch exactly as before, since `branch` defaults to `"new"`).

- [ ] **Step 4: Commit**

```powershell
git add client/src/screens/SafetyNumberScreen.tsx client/src/screens/SafetyNumberScreen.css
git commit -m "Add recognized and key-changed states to the safety number screen"
```

---

### Task 7: `ContactsScreen` — list, delete, export

A modal (same shell pattern as `Settings`/`ProfileModal`: backdrop + panel, Esc-to-close), reachable from `Settings`.

**Files:**
- Create: `client/src/screens/ContactsScreen.tsx`
- Create: `client/src/screens/ContactsScreen.css`
- Modify: `client/src/components/Settings.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `listContacts`, `deleteContact`, `shortFingerprint`, `exportRecoveryCode` (Task 1/2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create `ContactsScreen.tsx`**

Create `client/src/screens/ContactsScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { listContacts, deleteContact, shortFingerprint, exportRecoveryCode, type ContactRecord } from "../identity/identity";
import "./ContactsScreen.css";

interface ContactsScreenProps {
  onClose: () => void;
}

export function ContactsScreen({ onClose }: ContactsScreenProps) {
  const [contacts, setContacts] = useState<ContactRecord[]>(() => listContacts());
  const [exported, setExported] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleDelete(identityPublicKey: string) {
    await deleteContact(identityPublicKey);
    setContacts(listContacts());
  }

  async function handleExport() {
    setExported(await exportRecoveryCode());
    setCopyLabel("Copy");
  }

  async function handleCopy() {
    if (!exported) return;
    await navigator.clipboard.writeText(exported);
    setCopyLabel("Copied!");
  }

  return (
    <div className="contacts-screen__backdrop" onClick={onClose}>
      <div className="contacts-screen__panel" onClick={(event) => event.stopPropagation()}>
        <div className="contacts-screen__header">
          <span className="contacts-screen__title">Contacts</span>
          <button className="contacts-screen__close" onClick={onClose} aria-label="Close contacts">
            ×
          </button>
        </div>

        {contacts.length === 0 && (
          <p className="contacts-screen__empty">No verified contacts yet.</p>
        )}
        <ul className="contacts-screen__list">
          {contacts.map((contact) => (
            <li key={contact.identityPublicKey} className="contacts-screen__row">
              <div className="contacts-screen__row-info">
                <span className="contacts-screen__row-name">
                  {contact.displayName || "Anonymous"}
                </span>
                <span className="contacts-screen__row-fingerprint">
                  {shortFingerprint(contact.identityPublicKey)}
                </span>
                <span className="contacts-screen__row-date">
                  Verified {new Date(contact.firstVerifiedAt).toLocaleDateString()}
                </span>
              </div>
              <button
                type="button"
                className="contacts-screen__delete"
                onClick={() => handleDelete(contact.identityPublicKey)}
                aria-label={`Remove ${contact.displayName || "contact"}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <div className="contacts-screen__export">
          {!exported ? (
            <button type="button" className="contacts-screen__export-button" onClick={handleExport}>
              Export my recovery code
            </button>
          ) : (
            <div className="contacts-screen__export-code">
              <p className="contacts-screen__export-warning">
                Treat this like a password -- anyone with it can restore your identity.
              </p>
              <code className="contacts-screen__export-value">{exported}</code>
              <button type="button" className="contacts-screen__copy-button" onClick={handleCopy}>
                {copyLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `ContactsScreen.css`**

Create `client/src/screens/ContactsScreen.css`:

```css
.contacts-screen__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.contacts-screen__panel {
  width: 380px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 20px;
  color: var(--text-primary);
  font-family: var(--font-ui);
}
.contacts-screen__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.contacts-screen__title {
  font-size: 15px;
  font-weight: 600;
}
.contacts-screen__close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}
.contacts-screen__empty {
  color: var(--text-secondary);
  font-size: 13px;
}
.contacts-screen__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.contacts-screen__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.contacts-screen__row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.contacts-screen__row-name {
  font-size: 13px;
  font-weight: 600;
}
.contacts-screen__row-fingerprint {
  font-size: 11px;
  font-family: monospace;
  color: var(--text-secondary);
}
.contacts-screen__row-date {
  font-size: 11px;
  color: var(--text-secondary);
}
.contacts-screen__delete {
  background: transparent;
  border: 1px solid var(--border);
  color: #ff6b6b;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.contacts-screen__export {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.contacts-screen__export-button {
  width: 100%;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  border-radius: 10px;
  padding: 10px;
  font-size: 13px;
  cursor: pointer;
}
.contacts-screen__export-code {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.contacts-screen__export-warning {
  font-size: 11px;
  color: #ff6b6b;
  margin: 0;
}
.contacts-screen__export-value {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 8px;
}
.contacts-screen__copy-button {
  align-self: flex-start;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-primary);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
```

- [ ] **Step 3: Add an entry point from `Settings`**

In `client/src/components/Settings.tsx`, add `onOpenContacts: () => void` to `SettingsProps` and destructure it in the function signature. Add a new section, after the existing "Session" section:

```tsx
        <div className="settings__section">
          <div className="settings__section-label">Identity</div>
          <button className="settings__row settings__row--button" onClick={onOpenContacts}>
            <span className="settings__row-label">Contacts</span>
          </button>
        </div>
```

- [ ] **Step 4: Wire `contactsOpen` state + render `ContactsScreen` in `App.tsx`**

Add the imports:

```ts
import { ContactsScreen } from "./screens/ContactsScreen";
```

Add state near `profilesOpen`:

```ts
const [contactsOpen, setContactsOpen] = useState(false);
```

Pass `onOpenContacts={() => setContactsOpen(true)}` to every `<Settings ... />` usage (there is one, inside `ChatScreen`'s rendering -- `ChatScreen` itself renders `<Settings ... />` internally, so instead thread it through: add `onOpenContacts: () => void` to `ChatScreenProps` in `client/src/screens/ChatScreen.tsx`, pass it down to its internal `<Settings onOpenContacts={onOpenContacts} ... />`, and pass `onOpenContacts={() => setContactsOpen(true)}` on `App.tsx`'s `<ChatScreen ... />` call site).

`ContactsScreen` is reachable from `Settings`, which only renders inside the `screen.name === "handshake" || screen.name === "safety-number" || screen.name === "chat"` block (via `ChatScreen`). In that same block, change the final line:

```ts
    return <HandshakeJourney activeKey={screen.name}>{content}</HandshakeJourney>;
```

to:

```tsx
    return (
      <HandshakeJourney activeKey={screen.name}>
        {content}
        {contactsOpen && <ContactsScreen onClose={() => setContactsOpen(false)} />}
      </HandshakeJourney>
    );
```

- [ ] **Step 5: Verify green**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green (no automated tests for this task's screens, per project convention).

- [ ] **Step 6: Commit**

```powershell
git add client/src/screens/ContactsScreen.tsx client/src/screens/ContactsScreen.css client/src/components/Settings.tsx client/src/screens/ChatScreen.tsx client/src/App.tsx
git commit -m "Add the contacts screen"
```

---

### Task 8: Wire identity into the handshake

The integration task: identity travels on `pubkey`, the safety-number branch is decided from the contacts store, and the confirm-frame exchange gates leaving the handshake screen on cryptographic proof instead of a fixed timer. This is the highest-risk task in the plan -- run it inline, not as a cold subagent, and re-read `client/src/App.tsx`'s current `exchangeKeys`/`finishHandshake`/`handleMsg` before starting (it's the most-changed function in the file).

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `getIdentityKeypair` state already wired in Task 3 (`identityKeypairRef`); `getContact`, `upsertContact`, `touchContact`, `listContacts` (Task 1); `computeIdentitySafetyNumber` (Task 5); the extended `pubkey` envelope + `"confirm"` channel (Task 4); the `branch`/`peerName` props (Task 6).
- Produces: nothing consumed by later tasks (this is the last code task).

- [ ] **Step 1: Extend the `Screen` type**

In `client/src/App.tsx`, change the `"safety-number"` variant of `Screen`:

```ts
  | {
      name: "safety-number";
      roomCode: string;
      safetyNumber: string;
      branch: "new" | "recognized" | "key-changed";
      peerName?: string;
    }
```

(The `"chat"` variant keeps only `roomCode`/`safetyNumber` -- unchanged.)

- [ ] **Step 2: Remove the old `computeSafetyNumber` import, add the new ones**

Replace:

```ts
import { computeSafetyNumber } from "./crypto/safetyNumber";
```

with:

```ts
import { computeIdentitySafetyNumber } from "./crypto/safetyNumber";
import { getContact, upsertContact, touchContact, listContacts } from "./identity/identity";
```

- [ ] **Step 3: Delete the now-unused `computeSafetyNumber`**

In `client/src/crypto/safetyNumber.ts`, delete the entire `computeSafetyNumber` function (the one taking `rootKey` as a third argument) -- its only caller was the code Step 8 replaces. In `client/src/crypto/safetyNumber.test.ts`, delete its `describe("computeSafetyNumber", ...)` block and the "never collides with the legacy per-session number's domain" test added in Task 5 (which referenced it).

- [ ] **Step 4: Add a `peerIdentityRef` alongside `sessionCryptoRef`**

Near `const sessionCryptoRef = useRef<SessionCrypto | null>(null);`, add:

```ts
// The peer's identity public key (base64) + presented display name for the
// in-progress or just-completed handshake -- read by the safety-number
// screen's onVerified handler to save/update the contact.
const peerIdentityRef = useRef<{ publicKey: string; displayName?: string } | null>(null);
```

In `handleLeave`, alongside the other ref resets, add:

```ts
    peerIdentityRef.current = null;
```

- [ ] **Step 5: Add `ownIdentity` to `exchangeKeys`'s signature and callers**

Change the signature:

```ts
  async function exchangeKeys(
    client: RelayClient,
    own: Keypair,
    ownIdentity: Keypair,
    role: "initiator" | "responder",
    roomCode: string
  ) {
```

Update both call sites. In `handleStart`, right after `const own = await generateKeypair();`, add:

```ts
    // identityKeypairRef is populated before StartJoinScreen can render (Task 3's
    // SetupScreen gate), so this is never null here.
    const ownIdentity = identityKeypairRef.current!;
```

then change `void exchangeKeys(client, own, "initiator", currentRoomCode);` to `void exchangeKeys(client, own, ownIdentity, "initiator", currentRoomCode);`.

In `handleJoin`, same pattern: add `const ownIdentity = identityKeypairRef.current!;` after `const own = await generateKeypair();`, and change `void exchangeKeys(client, own, "responder", roomCode);` to `void exchangeKeys(client, own, ownIdentity, "responder", roomCode);`.

- [ ] **Step 6: Add the confirmation-gate state inside `exchangeKeys`**

Right after the existing `let peerPub: Uint8Array | null = null;` line, add:

```ts
    let peerIdentityPub: Uint8Array | null = null;
    let peerDisplayName: string | undefined;
    let awaitingConfirmation = true;
    let resolveConfirmed: (() => void) | null = null;
    const confirmed = new Promise<void>((resolve) => {
      resolveConfirmed = resolve;
    });
```

- [ ] **Step 7: Split `finishHandshake` into `seedSession` + `completeHandshake`**

Replace the entire existing `finishHandshake` function with:

```ts
    // Everything that can happen the instant both secrets are in hand: seed
    // the ratchet, optionally share the profile, and (initiator only) send
    // the primer that also bootstraps the responder's sending chain. Does
    // NOT transition the screen -- that waits for completeHandshake's proof.
    async function seedSession(
      sessionKeys: SessionKeys,
      peerPublicKey: Uint8Array,
      pqSecret: Uint8Array
    ): Promise<void> {
      const sc = await initSession(sessionKeys, role, own, peerPublicKey, pqSecret);
      sessionCryptoRef.current = sc;
      if (shareProfileRef.current && activeProfileRef.current.kind === "named") {
        const self = activeProfileRef.current.profile;
        const card = JSON.stringify({ name: self.name, avatar: self.avatar, device: ownDevice });
        client.send(
          await sealStatic(sc, "profile", frame({ channel: "profile", id: "", body: textEncoder.encode(card) }))
        );
      }
      if (role === "initiator") {
        client.send(await sealContent(sc, frame({ channel: "primer", id: "", body: EMPTY_BODY })));
      }
    }

    // Waits for the bidirectional confirm proof, decides which
    // SafetyNumberScreen branch applies from the contacts store, then
    // transitions the screen (respecting the existing HANDSHAKE_MIN_MS hold)
    // and replays any buffered inbound messages.
    async function completeHandshake(peerIdentityPublicKey: Uint8Array): Promise<void> {
      await confirmed;
      if (disconnected) return;
      const peerIdKeyB64 = await toBase64(peerIdentityPublicKey);
      peerIdentityRef.current = { publicKey: peerIdKeyB64, displayName: peerDisplayName };

      const existingContact = getContact(peerIdKeyB64);
      const branch: "new" | "recognized" | "key-changed" = existingContact
        ? "recognized"
        : peerDisplayName && listContacts().some((c) => c.displayName === peerDisplayName)
          ? "key-changed"
          : "new";

      const safetyNumber = await computeIdentitySafetyNumber(ownIdentity.publicKey, peerIdentityPublicKey);
      const elapsed = performance.now() - handshakeStart;
      if (elapsed < HANDSHAKE_MIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_MIN_MS - elapsed));
      }
      if (disconnected) return;
      setScreen({ name: "safety-number", roomCode, safetyNumber, branch, peerName: peerDisplayName });
      const queued = inbound.splice(0);
      for (const env of queued) await handleMsg(env);
    }
```

- [ ] **Step 8: Update `handleMsg`'s catch block for handshake-window failures**

In `handleMsg`, replace:

```ts
      } catch (err) {
        // A content packet that genuinely won't decrypt gets a bubble; a bad
        // static signal (or a replay) is dropped silently, as before.
        if (envelope.c === 0 && !isSilentContentDrop(err)) {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
          ]);
        }
        return;
      }
```

with:

```ts
      } catch (err) {
        if (envelope.c === 0 && awaitingConfirmation) {
          // ML-KEM's implicit rejection never throws on a tampered/downgraded
          // handshake (see crypto/pqkem.ts) -- a mismatched rootKey surfaces
          // here as an ordinary AEAD failure on the confirm/primer frame.
          // This IS the automatic proof-of-mismatch this mechanism exists to
          // catch, replacing the old rootKey-bound safety number's job.
          awaitingConfirmation = false;
          if (!disconnected) {
            disconnected = true;
            setScreen({ name: "error", scenario: "handshake_failed" });
          }
          return;
        }
        // A content packet that genuinely won't decrypt gets a bubble; a bad
        // static signal (or a replay) is dropped silently, as before.
        if (envelope.c === 0 && !isSilentContentDrop(err)) {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), timestamp: Date.now(), kind: "decryption-error" },
          ]);
        }
        return;
      }
```

- [ ] **Step 9: Update the `"primer"` case, add a `"confirm"` case**

In `handleMsg`'s `switch (received.channel)`, replace:

```ts
        case "primer":
          // Hidden bootstrap message: its only job was to advance the ratchet.
          break;
```

with:

```ts
        case "primer":
          // Hidden bootstrap message: gives the responder (us, if we're
          // receiving this) a sending chain. Decrypting it successfully is
          // also our proof that we derived the same rootKey as the
          // initiator -- reply so the initiator gets the same proof, then
          // release our own confirmation gate.
          if (role === "responder") {
            client.send(await sealContent(sc, frame({ channel: "confirm", id: "", body: EMPTY_BODY })));
          }
          awaitingConfirmation = false;
          resolveConfirmed?.();
          resolveConfirmed = null;
          break;
        case "confirm":
          // The responder's reply, proving it derived the same rootKey we
          // (the initiator) did.
          awaitingConfirmation = false;
          resolveConfirmed?.();
          resolveConfirmed = null;
          break;
```

- [ ] **Step 10: Parse identity from the `pubkey` envelope, call the new functions**

In the `pubkey` handler, right after the existing `v !== PROTOCOL_VERSION` check and before `classicalKeys = await deriveSessionKeys(own, peerPub, role);`, add:

```ts
          if (!envelope.identityPublicKey) {
            setScreen({ name: "error", scenario: "handshake_failed" });
            return;
          }
          peerIdentityPub = await fromBase64(envelope.identityPublicKey);
          peerDisplayName = envelope.displayName;
```

Then, further down in the same handler, replace:

```ts
            const { cipherText, sharedSecret } = kemEncapsulate(await fromBase64(envelope.kem));
            client.send({ type: "kemct", payload: await toBase64(cipherText) });
            await finishHandshake(classicalKeys, peerPub, sharedSecret);
```

with:

```ts
            const { cipherText, sharedSecret } = kemEncapsulate(await fromBase64(envelope.kem));
            client.send({ type: "kemct", payload: await toBase64(cipherText) });
            await seedSession(classicalKeys, peerPub, sharedSecret);
            void completeHandshake(peerIdentityPub);
```

In the `kemct` handler, add `!peerIdentityPub` to the existing top-level guard (the same pattern `!peerPub` already follows there) -- replace:

```ts
        if (
          role !== "responder" ||
          !classicalKeys ||
          !peerPub ||
          !kemKeypair ||
          sessionCryptoRef.current
        ) {
```

with:

```ts
        if (
          role !== "responder" ||
          !classicalKeys ||
          !peerPub ||
          !peerIdentityPub ||
          !kemKeypair ||
          sessionCryptoRef.current
        ) {
```

Then, in the same handler's `try` block, replace:

```ts
          const sharedSecret = kemDecapsulate(await fromBase64(envelope.payload), kemKeypair.secretKey);
          await finishHandshake(classicalKeys, peerPub, sharedSecret);
```

with:

```ts
          const sharedSecret = kemDecapsulate(await fromBase64(envelope.payload), kemKeypair.secretKey);
          await seedSession(classicalKeys, peerPub, sharedSecret);
          void completeHandshake(peerIdentityPub);
```

(`peerIdentityPub` is non-null here for the same reason `peerPub` already is on this line today -- both are narrowed by the guard above, across the same `try` boundary.)

- [ ] **Step 11: Send identity on the outbound `pubkey` envelope**

Replace the block at the bottom of `exchangeKeys`:

```ts
    const payload = await toBase64(own.publicKey);
    if (kemKeypair) {
      client.send({
        type: "pubkey",
        payload,
        v: PROTOCOL_VERSION,
        kem: await toBase64(kemKeypair.publicKey),
      });
    } else {
      client.send({ type: "pubkey", payload, v: PROTOCOL_VERSION });
    }
```

with:

```ts
    const payload = await toBase64(own.publicKey);
    const identityPublicKey = await toBase64(ownIdentity.publicKey);
    const displayName = getDisplayName() || undefined;
    if (kemKeypair) {
      client.send({
        type: "pubkey",
        payload,
        v: PROTOCOL_VERSION,
        kem: await toBase64(kemKeypair.publicKey),
        identityPublicKey,
        displayName,
      });
    } else {
      client.send({ type: "pubkey", payload, v: PROTOCOL_VERSION, identityPublicKey, displayName });
    }
```

(Add `getDisplayName` to the existing `import { getContact, upsertContact, touchContact, listContacts } from "./identity/identity";` line from Step 2.)

- [ ] **Step 12: Update the `SafetyNumberScreen` render call site**

In the render section, where `screen.name === "safety-number"` builds `content`, replace:

```tsx
      content = (
        <SafetyNumberScreen
          roomCode={screen.roomCode}
          safetyNumber={screen.safetyNumber}
          onVerified={() =>
            setScreen({ name: "chat", roomCode: screen.roomCode, safetyNumber: screen.safetyNumber })
          }
          onMismatch={() => {
            for (const dispose of listenerCleanupsRef.current) dispose();
            listenerCleanupsRef.current = [];
            clientRef.current?.close();
            clientRef.current = null;
            zeroizeSession(sessionCryptoRef.current);
            sessionCryptoRef.current = null;
            setScreen({ name: "error", scenario: "handshake_failed" });
          }}
        />
      );
```

with:

```tsx
      content = (
        <SafetyNumberScreen
          roomCode={screen.roomCode}
          safetyNumber={screen.safetyNumber}
          branch={screen.branch}
          peerName={screen.peerName}
          onVerified={async () => {
            const peer = peerIdentityRef.current;
            if (peer) {
              if (screen.branch === "recognized") {
                await touchContact(peer.publicKey);
              } else {
                await upsertContact({
                  identityPublicKey: peer.publicKey,
                  displayName: peer.displayName,
                  safetyNumber: screen.safetyNumber,
                });
              }
            }
            setScreen({ name: "chat", roomCode: screen.roomCode, safetyNumber: screen.safetyNumber });
          }}
          onMismatch={() => {
            for (const dispose of listenerCleanupsRef.current) dispose();
            listenerCleanupsRef.current = [];
            clientRef.current?.close();
            clientRef.current = null;
            zeroizeSession(sessionCryptoRef.current);
            sessionCryptoRef.current = null;
            setScreen({ name: "error", scenario: "handshake_failed" });
          }}
        />
      );
```

- [ ] **Step 13: Verify green**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green. This is the task most likely to surface a real typecheck mismatch (e.g. a stale `finishHandshake` reference) -- if `npm run typecheck` fails, grep the file for `finishHandshake` to confirm no call site was missed.

- [ ] **Step 14: Manual two-browser eyeball**

`cd client && npm run dev`, open two browser contexts:
1. First launch on each: `SetupScreen` appears, enter a display name, land on `StartJoinScreen`.
2. Pair them (start/join a room). Confirm the handshake completes and reaches `SafetyNumberScreen` with `branch === "new"` (the normal drag-to-seal UI) -- confirm it doesn't hang waiting on the confirm exchange (should resolve within roughly `HANDSHAKE_MIN_MS`, not noticeably slower).
3. Verify on both sides, reach chat, exchange a message, leave.
4. Reconnect the same two browsers in a fresh room. Confirm both sides land directly on the "recognized" banner ("Reconnected with `<name>`") with no drag-to-seal step, and reach chat on clicking Continue.
5. In DevTools on one side, confirm `IndexedDB > trojan-troy-identity` holds the `vault` record with a `contacts` entry for the other side's identity key.
6. Optional (do not skip if time allows): simulate a tamper by editing one side's stored contact's `safetyNumber` to a wrong value before a third reconnect, and confirm `branch` still resolves correctly (this only affects the *stored comparison value*, not the actual recognition key -- recognition is by identity key, not by the stored number, so this specifically checks that a corrupted stored number doesn't cause a false "key-changed"; if it does misfire, this is a bug to fix before Task 9).

(No browser-automation tool is required by hand -- a throwaway Playwright script against `http://localhost:5173/` can drive two contexts through pairing twice and assert the branch transitions; Python Playwright 1.61.0 + chromium are installed in this environment, per prior phases. Write/run/delete it.)

- [ ] **Step 15: Commit**

```powershell
git add client/src/App.tsx client/src/crypto/safetyNumber.ts client/src/crypto/safetyNumber.test.ts
git commit -m "Wire identity into the handshake and gate on a confirm exchange"
```

---

### Task 9: Docs, decisions log, PR

**Files:**
- Modify: `decisions.md`
- Modify: `progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Log the decision**

Append to `decisions.md` (newest-first, matching the existing format) a `2026-07-26` entry covering: the reversal of the 2026-07-22 "retired persistent identity" decision; identity coexisting with Local Profiles as a separate, unrelated layer; the three reconciliation calls (informational-layer identity -- no change to `deriveRootKey`; identity riding the existing `pubkey` envelope rather than a new type; the two-tier verification split between the stable identity safety number and the automatic confirm-frame exchange); and that this plan (Plan A) covers only 5.1's scope, with 5.1a (pseudonyms, contacts-only/block list, at-rest vault) deferred to a separate plan. Reference `docs/superpowers/specs/2026-07-26-persistent-identity-revival-design.md`.

- [ ] **Step 2: Update `progress.md`**

Add a dated entry summarizing: identity keypair + contacts store (Task 1), plaintext recovery codes (Task 2), `SetupScreen` (Task 3), the extended `pubkey` envelope + `confirm` channel (Task 4), `computeIdentitySafetyNumber` (Task 5), the 3-branch `SafetyNumberScreen` (Task 6), `ContactsScreen` (Task 7), and the handshake integration + confirm-exchange mechanism (Task 8) -- files touched, final test count, and the Task 8 manual eyeball result. Note that 5.1a (privacy layer: pseudonyms, contacts-only/block list, at-rest vault, passphrase recovery codes) is a separate, not-yet-started plan, and that PR #11 (`feat/identity-vault-modules`) remains the intended starting point for it.

- [ ] **Step 3: Update `roadmap.md`**

Reword the entry that currently reads "Local Profiles (REPLACES the retired persistent-identity...)" -- Local Profiles and identity now coexist, not replace each other. Point to `docs/superpowers/specs/2026-07-26-persistent-identity-revival-design.md`.

- [ ] **Step 4: Commit docs**

```powershell
git add decisions.md progress.md roadmap.md
git commit -m "Log the persistent-identity revival build"
```

- [ ] **Step 5: Open a PR against `main` (do not merge)**

Confirm `git rev-parse HEAD origin/feat/persistent-identity-revival` match, then:

```bash
gh pr create --base main --title "Revive persistent identity + contacts (core)" --body "Gives each browser a persistent identity keypair + display name, recognized across reconnects via a stable identity-keys-only safety number and a contacts list, plus an automatic per-session confirm exchange that replaces the old rootKey-bound safety number's tamper detection. Session confidentiality (the Double Ratchet + hybrid PQ handshake) is untouched; Local Profiles is untouched. This is Plan A (core) of a two-plan revival of the 2026-07-22-retired persistent-identity direction -- the privacy layer (pseudonyms, contacts-only/block list, at-rest vault) is a separate follow-up plan. Spec: docs/superpowers/specs/2026-07-26-persistent-identity-revival-design.md"
```

---

## Self-Review

**Spec coverage (against `2026-07-26-persistent-identity-revival-design.md`'s Plan A scope):**
- Identity keypair generation/persistence + `SetupScreen` → Tasks 1, 3. ✅
- Extended `pubkey` envelope + `PROTOCOL_VERSION` bump → Task 4. ✅
- `computeIdentitySafetyNumber` + confirm-frame mechanism (sequencing resolved concretely, per the spec's explicit ask) → Tasks 5, 8. ✅
- Contacts store → Task 1. ✅
- 3-branch `SafetyNumberScreen` → Task 6, wired in Task 8. ✅
- `ContactsScreen` → Task 7. ✅
- Plaintext recovery code export/import → Task 2, UI in Tasks 3 (import) and 7 (export). ✅
- Session confidentiality untouched → confirmed no task modifies `kdf.ts`/`ratchet.ts`/`ratchetSession.ts`'s `initSession`. ✅
- Local Profiles untouched → confirmed no task modifies `client/src/profiles/*`. ✅
- Out of scope (5.1a) confirmed absent: no PIN/vault code, no `accessControl.ts`/block list, no per-contact labels, no passphrase-wrapped recovery codes anywhere in this plan. ✅

**Placeholder scan:** No TBD/TODO. Every code step has concrete, complete code (no "similar to Task N", no elided error handling). The manual eyeball (Task 8 Step 14) is inherently descriptive but has explicit, checkable observations, matching this project's established convention for screen verification.

**Type consistency:** `ContactRecord`, `SelfRecord`, `IdentityStatus` (Task 1) are used with matching shapes in Tasks 2, 3, 7, 8. `computeIdentitySafetyNumber(a, b)` (Task 5) is called with matching 2-argument signature in Task 8. `SafetyNumberScreenProps`'s `branch`/`peerName` (Task 6) match the `Screen["safety-number"]` fields set in Task 8. `exchangeKeys`'s new `ownIdentity` parameter (Task 8) matches both call sites. `getContact`/`upsertContact`/`touchContact`/`listContacts`/`getDisplayName` (Task 1/3) are imported and called with matching signatures in Task 8.

**Sequencing check (every task leaves the app green):** Task 4's new envelope fields and `Channel` value are additive/optional -- no existing call site breaks. Task 5 adds `computeIdentitySafetyNumber` without removing `computeSafetyNumber` (still used by the not-yet-updated `App.tsx`) -- Task 8 removes it in the same task that stops calling it. Task 6's new `SafetyNumberScreen` props are optional with a default preserving today's behavior -- the pre-Task-8 `App.tsx` call site (unchanged) keeps compiling. Task 8 is the single point where `finishHandshake` is fully replaced, `computeSafetyNumber` is deleted, and every dependent call site updates together.
