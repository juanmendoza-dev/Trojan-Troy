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
