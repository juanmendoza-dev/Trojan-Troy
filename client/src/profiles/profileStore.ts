import type { Profile } from "./profileModel";
import { ANONYMOUS_ID } from "./profileModel";

const DB_NAME = "trojan-troy-profiles";
const STORE = "profiles";
const ACTIVE_KEY = "trojan-troy-active-profile";
const SHARE_KEY = "trojan-troy-share-profile";

// IndexedDB may be unavailable (e.g. some private-browsing modes). Fall back to
// an in-memory map for the session rather than crashing — profiles just don't
// persist, matching today's ephemeral behavior (spec's error-handling rule).
const hasIndexedDb = typeof indexedDB !== "undefined";
const memory = new Map<string, Profile>();

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

export async function listProfiles(): Promise<Profile[]> {
  if (!hasIndexedDb) return [...memory.values()];
  return (await run<Profile[]>("readonly", (s) => s.getAll() as IDBRequest<Profile[]>)) ?? [];
}

export async function putProfile(profile: Profile): Promise<void> {
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

// Small prefs — synchronous localStorage, wrapped so a blocked store never throws.
export function getActiveProfileId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? ANONYMOUS_ID;
  } catch {
    return ANONYMOUS_ID;
  }
}
export function setActiveProfileId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
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
