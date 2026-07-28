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

// A shared identity card (opt-in): the peer's, shown in the chat header + on
// message avatars, and your own for outgoing message avatars. `device` is a
// best-effort "computer"/"phone" hint, null when not shared/known.
export interface PeerProfile {
  name: string;
  avatar: string | null;
  device: DeviceKind | null;
}

export const ANONYMOUS_ID = "anonymous";
