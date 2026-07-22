import { generateKeypair, publicKeyFromSecret, type Keypair } from "../crypto/keys";
import { toBase64, fromBase64 } from "../crypto/encoding";
import { deriveVaultKey, generateSalt, sealVault, openVault } from "./atRest";
import { encodeRecoveryCode, decodeRecoveryCode } from "./recoveryCode";
import { isIndexedDbAvailable, idbGet, idbPut } from "./store";

// Owns the in-memory identity/contacts vault for the session and its
// persistence (plaintext, or Argon2id+secretbox-sealed when a PIN is set).
// Everything is client-side; the relay never sees any of it.

const VAULT_KEY = "vault";

export interface ContactRecord {
  identityPublicKey: string; // base64
  label?: string; // local-only, never transmitted
  displayName?: string; // last self-asserted name they presented (cosmetic)
  safetyNumber: string;
  firstVerifiedAt: number;
  lastSeenAt: number;
}

export interface SelfRecord {
  identityPublicKey: string; // base64
  identitySecretKey: string; // base64
  displayName: string;
  aliases: string[];
}

interface VaultData {
  self: SelfRecord;
  contacts: Record<string, ContactRecord>;
  blocked: string[];
}

type StoredRecord =
  | { locked: false; payload: string }
  | { locked: true; salt: string; nonce: string; ciphertext: string };

export type IdentityStatus = "setup" | "locked" | "ready";

let vault: VaultData | null = null;
let vaultKey: Uint8Array | null = null;
let vaultSalt: Uint8Array | null = null;
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
      aliases: [],
    },
    contacts: {},
    blocked: [],
  };
}

async function persist(): Promise<void> {
  if (!persistent || !vault) return;
  const json = JSON.stringify(vault);
  if (vaultKey && vaultSalt) {
    const { nonce, ciphertext } = await sealVault(new TextEncoder().encode(json), vaultKey);
    const record: StoredRecord = {
      locked: true,
      salt: await toBase64(vaultSalt),
      nonce: await toBase64(nonce),
      ciphertext: await toBase64(ciphertext),
    };
    await idbPut(VAULT_KEY, record);
  } else {
    await idbPut(VAULT_KEY, { locked: false, payload: json } satisfies StoredRecord);
  }
}

// Load or create the identity. "setup" → SetupScreen (fresh or no name yet),
// "locked" → UnlockScreen, "ready" → loaded into memory. Never throws to the UI
// — corrupt/missing/blocked storage self-heals to a fresh in-memory identity.
export async function initIdentity(): Promise<IdentityStatus> {
  if (!isIndexedDbAvailable()) {
    persistent = false;
    vault = await freshVault();
    return "setup";
  }
  let record: StoredRecord | undefined;
  try {
    record = await idbGet<StoredRecord>(VAULT_KEY);
  } catch {
    persistent = false;
    vault = await freshVault();
    return "setup";
  }
  if (!record) {
    vault = await freshVault();
    await persist();
    return "setup";
  }
  if (record.locked) return "locked";
  try {
    vault = JSON.parse(record.payload) as VaultData;
  } catch {
    vault = await freshVault();
    await persist();
    return "setup";
  }
  return vault.self.displayName ? "ready" : "setup";
}

export async function unlock(passphrase: string): Promise<boolean> {
  let record: StoredRecord | undefined;
  try {
    record = await idbGet<StoredRecord>(VAULT_KEY);
  } catch {
    return false;
  }
  if (!record || !record.locked) return false;
  try {
    const salt = await fromBase64(record.salt);
    const key = await deriveVaultKey(passphrase, salt);
    const bytes = await openVault(
      { nonce: await fromBase64(record.nonce), ciphertext: await fromBase64(record.ciphertext) },
      key
    );
    vault = JSON.parse(new TextDecoder().decode(bytes)) as VaultData;
    vaultKey = key;
    vaultSalt = salt;
    return true;
  } catch {
    return false;
  }
}

export function isLoaded(): boolean {
  return vault !== null;
}
export function hasPin(): boolean {
  return vaultKey !== null;
}
export function isPersistent(): boolean {
  return persistent;
}

export async function saveDisplayName(name: string): Promise<void> {
  requireVault().self.displayName = name;
  await persist();
}

export async function restoreFromRecoveryCode(code: string, passphrase?: string): Promise<void> {
  const { secretKey, displayName } = await decodeRecoveryCode(code, passphrase);
  const publicKey = await publicKeyFromSecret(secretKey);
  vault = {
    self: {
      identityPublicKey: await toBase64(publicKey),
      identitySecretKey: await toBase64(secretKey),
      displayName,
      aliases: vault?.self.aliases ?? [],
    },
    contacts: vault?.contacts ?? {},
    blocked: vault?.blocked ?? [],
  };
  await persist();
}

export async function exportRecoveryCode(passphrase?: string): Promise<string> {
  const self = requireVault().self;
  return encodeRecoveryCode(await fromBase64(self.identitySecretKey), self.displayName, passphrase);
}

export async function setPin(passphrase: string): Promise<void> {
  requireVault();
  vaultSalt = await generateSalt();
  vaultKey = await deriveVaultKey(passphrase, vaultSalt);
  await persist();
}

export async function removePin(): Promise<void> {
  requireVault();
  vaultKey = null;
  vaultSalt = null;
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
export function getAliases(): string[] {
  return [...requireVault().self.aliases];
}
export async function addAlias(name: string): Promise<void> {
  const self = requireVault().self;
  const trimmed = name.trim();
  if (trimmed && !self.aliases.includes(trimmed)) {
    self.aliases.push(trimmed);
    await persist();
  }
}
export async function removeAlias(name: string): Promise<void> {
  const self = requireVault().self;
  self.aliases = self.aliases.filter((a) => a !== name);
  await persist();
}

// A short, stable visual id for a peer who presents no name.
export function shortFingerprint(identityPublicKey: string): string {
  return identityPublicKey.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
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
  label?: string;
}): Promise<void> {
  const v = requireVault();
  const existing = v.contacts[entry.identityPublicKey];
  const now = Date.now();
  v.contacts[entry.identityPublicKey] = {
    identityPublicKey: entry.identityPublicKey,
    label: entry.label ?? existing?.label,
    displayName: entry.displayName ?? existing?.displayName,
    safetyNumber: entry.safetyNumber,
    firstVerifiedAt: existing?.firstVerifiedAt ?? now,
    lastSeenAt: now,
  };
  await persist();
}
export async function setContactLabel(identityPublicKey: string, label: string): Promise<void> {
  const c = requireVault().contacts[identityPublicKey];
  if (c) {
    c.label = label.trim() || undefined;
    await persist();
  }
}
export async function deleteContact(identityPublicKey: string): Promise<void> {
  delete requireVault().contacts[identityPublicKey];
  await persist();
}
export async function touchContact(identityPublicKey: string): Promise<void> {
  const c = requireVault().contacts[identityPublicKey];
  if (c) {
    c.lastSeenAt = Date.now();
    await persist();
  }
}

export function blockedSet(): Set<string> {
  return new Set(requireVault().blocked);
}
export function isBlocked(identityPublicKey: string): boolean {
  return requireVault().blocked.includes(identityPublicKey);
}
export async function blockKey(identityPublicKey: string): Promise<void> {
  const v = requireVault();
  if (!v.blocked.includes(identityPublicKey)) {
    v.blocked.push(identityPublicKey);
    await persist();
  }
}
export async function unblockKey(identityPublicKey: string): Promise<void> {
  const v = requireVault();
  v.blocked = v.blocked.filter((k) => k !== identityPublicKey);
  await persist();
}
