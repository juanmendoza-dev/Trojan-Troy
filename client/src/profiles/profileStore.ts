import type { StoredProfile } from "./profileModel";

const DB_NAME = "trojan-troy-profiles";
const STORE = "profiles";
const SHARE_KEY = "trojan-troy-share-profile";

// IndexedDB may be unavailable (e.g. some private-browsing modes). Fall back to
// an in-memory map for the session rather than crashing — profiles just don't
// persist, matching today's ephemeral behavior (spec's error-handling rule).
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
