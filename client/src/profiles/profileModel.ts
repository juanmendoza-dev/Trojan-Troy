export interface Profile {
  id: string;
  name: string;
  /** Uploaded photo as a data-URL, or null → the bundled default picture. */
  avatar: string | null;
  pinSalt: string;
  pinHash: string;
  createdAt: number;
}

export type ActiveProfile =
  | { kind: "anonymous" }
  | { kind: "named"; profile: Profile };

export const ANONYMOUS_ID = "anonymous";

// Resolve which profile is active from the stored id. Anything unknown (never
// set, the anonymous sentinel, or an id whose profile was deleted) falls back
// to Anonymous — the always-present, share-nothing default.
export function resolveActiveProfile(profiles: Profile[], activeId: string | null): ActiveProfile {
  if (!activeId || activeId === ANONYMOUS_ID) return { kind: "anonymous" };
  const profile = profiles.find((p) => p.id === activeId);
  return profile ? { kind: "named", profile } : { kind: "anonymous" };
}
