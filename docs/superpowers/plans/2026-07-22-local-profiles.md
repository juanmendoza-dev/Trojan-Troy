# Local Profiles — Layer A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add device-local, PIN-gated **profiles** (name + picture) chosen from a Settings-style modal launched by a soft-white rounded-cube button on the home screen, plus opt-in encrypted name/photo sharing with the chat peer. An always-present **Anonymous** profile is the default and preserves today's zero-trace behavior. This is **Layer A** of the spec; per-profile conversation history is **Layer B** (a separate follow-up plan).

**Architecture:** Entirely client-side, no server changes, session crypto unchanged. Three pure/testable modules (`pin`, `profileModel`, and the IndexedDB `profileStore`), two components (`ProfileButton`, `ProfileModal`) that reuse the existing `Settings` modal shell, one bundled default-avatar asset, and wiring into `App.tsx`'s existing state machine + `StartJoinScreen`/`ChatScreen`/`Settings`. Sharing rides a new opaque-forwarded `profile` envelope carrying a `secretbox`-sealed `{ name, avatar }` card (same pattern as the existing encrypted `presence` envelope — relay never sees it).

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`environment: "node"`, no jsdom/RTL — pure logic only). libsodium-wrappers (sumo) for hashing, as used across `client/src/crypto/`.

## Global Constraints

- **No persistent cryptographic identity.** Session pairing stays exactly as today (fresh ephemeral `crypto_kx` per room, `pubkey` handshake, safety number attests to the session). Profiles are a local personalization layer only.
- **Anonymous is synthesized, never stored**, has id `"anonymous"`, cannot be created/deleted/renamed, shares nothing, and is the fallback whenever no named profile is active.
- **PIN is exactly 4 digits** (`/^\d{4}$/`), stored only as a salted hash, never plaintext. It is a *local access gate* — the UI must not imply it encrypts anything (Layer A stores nothing sensitive; Layer B adds history + at-rest encryption).
- **Sharing is opt-in, default OFF** (`localStorage` key `trojan-troy-share-profile`). When on *and* a named profile is active, the name/photo are sent to the peer as an encrypted `profile` envelope. Anonymous never sends one.
- **`App.tsx`'s `Screen` union and its start→waiting→handshake→safety-number→chat transitions are unchanged.** Layer A adds active-profile state + a modal launched from the home screen + a peer-card in the chat header; it introduces no new screens.
- **Work on a branch `feat/profiles` off the current pre-identity `main` (`1ee0e35`).** Commit per task with **explicit file paths** — never `git add -A` (the working tree may hold unrelated in-flight edits).
- Every task leaves the app typechecking + tests green (`npm run typecheck`, `npm run test` in `client/`).

Spec: `docs/superpowers/specs/2026-07-22-local-profiles-design.md`.

---

### Task 1: PIN pure logic

**Files:**
- Create: `client/src/profiles/pin.ts`
- Test: `client/src/profiles/pin.test.ts`

**Interfaces:**
- Produces: `isValidPin(pin: string): boolean`, `newSalt(): Promise<string>`, `hashPin(pin: string, salt: string): Promise<string>`, `verifyPin(pin: string, salt: string, hash: string): Promise<boolean>` — consumed by Task 3 (store create) and Task 6 (modal create/unlock).

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/profiles/pin.test.ts
import { describe, expect, it } from "vitest";
import { isValidPin, newSalt, hashPin, verifyPin } from "./pin";

describe("isValidPin", () => {
  it("accepts exactly 4 digits", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("0000")).toBe(true);
  });
  it("rejects wrong length or non-digits", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });
});

describe("hashPin / verifyPin", () => {
  it("verifies a matching pin against its salted hash", async () => {
    const salt = await newSalt();
    const hash = await hashPin("1234", salt);
    expect(await verifyPin("1234", salt, hash)).toBe(true);
  });
  it("rejects a wrong pin", async () => {
    const salt = await newSalt();
    const hash = await hashPin("1234", salt);
    expect(await verifyPin("9999", salt, hash)).toBe(false);
  });
  it("produces different hashes for the same pin under different salts", async () => {
    const [s1, s2] = [await newSalt(), await newSalt()];
    expect(await hashPin("1234", s1)).not.toBe(await hashPin("1234", s2));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail** — `npm run test -- pin` → FAIL (`Cannot find module './pin'`).

- [ ] **Step 3: Write the implementation**

Mirror the libsodium init/usage pattern already in `client/src/crypto/safetyNumber.ts` (await the ready promise, `crypto_generichash`, base64 helpers).

```ts
// client/src/profiles/pin.ts
import sodium from "libsodium-wrappers";

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function newSalt(): Promise<string> {
  await sodium.ready;
  return sodium.to_base64(sodium.randombytes_buf(16));
}

// Salted BLAKE2b. A 4-digit PIN is low-entropy by design; this only keeps the
// PIN out of storage in plaintext, it is NOT strong protection (see spec).
export async function hashPin(pin: string, salt: string): Promise<string> {
  await sodium.ready;
  const input = sodium.from_string(salt + ":" + pin);
  return sodium.to_base64(sodium.crypto_generichash(32, input));
}

export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  await sodium.ready;
  const computed = await hashPin(pin, salt);
  return sodium.memcmp(sodium.from_base64(computed), sodium.from_base64(hash));
}
```

- [ ] **Step 4: Run tests** — `npm run test -- pin` → PASS.
- [ ] **Step 5: Typecheck** — `npm run typecheck` → clean.
- [ ] **Step 6: Commit**
```powershell
git add client/src/profiles/pin.ts client/src/profiles/pin.test.ts
git commit -m "Add profile PIN hashing"
```

---

### Task 2: Profile model pure logic

**Files:**
- Create: `client/src/profiles/profileModel.ts`
- Test: `client/src/profiles/profileModel.test.ts`

**Interfaces:**
- Produces: `Profile` type, `ActiveProfile` type, `ANONYMOUS_ID`, `resolveActiveProfile(profiles, activeId)` — consumed by every later task.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/profiles/profileModel.test.ts
import { describe, expect, it } from "vitest";
import { resolveActiveProfile, ANONYMOUS_ID, type Profile } from "./profileModel";

const jay: Profile = {
  id: "p1", name: "Jay", avatar: null, pinSalt: "s", pinHash: "h", createdAt: 0,
};

describe("resolveActiveProfile", () => {
  it("returns anonymous for null / the anonymous id", () => {
    expect(resolveActiveProfile([jay], null).kind).toBe("anonymous");
    expect(resolveActiveProfile([jay], ANONYMOUS_ID).kind).toBe("anonymous");
  });
  it("returns the named profile when the id matches", () => {
    const active = resolveActiveProfile([jay], "p1");
    expect(active).toEqual({ kind: "named", profile: jay });
  });
  it("falls back to anonymous when the id is unknown (e.g. deleted)", () => {
    expect(resolveActiveProfile([jay], "gone").kind).toBe("anonymous");
  });
});
```

- [ ] **Step 2: Run** — `npm run test -- profileModel` → FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/profiles/profileModel.ts
export interface Profile {
  id: string;
  name: string;
  avatar: string | null; // uploaded photo as a data-URL, or null → default picture
  pinSalt: string;
  pinHash: string;
  createdAt: number;
}

export type ActiveProfile =
  | { kind: "anonymous" }
  | { kind: "named"; profile: Profile };

export const ANONYMOUS_ID = "anonymous";

export function resolveActiveProfile(profiles: Profile[], activeId: string | null): ActiveProfile {
  if (!activeId || activeId === ANONYMOUS_ID) return { kind: "anonymous" };
  const profile = profiles.find((p) => p.id === activeId);
  return profile ? { kind: "named", profile } : { kind: "anonymous" };
}
```

(Avatar-source resolution — `profile.avatar ?? defaultAvatarAsset` — lives in the components, since it imports the bundled image and stays out of this pure, node-tested module.)

- [ ] **Step 4: Run tests** → PASS. **Step 5: Typecheck** → clean.
- [ ] **Step 6: Commit**
```powershell
git add client/src/profiles/profileModel.ts client/src/profiles/profileModel.test.ts
git commit -m "Add profile model and active-profile resolution"
```

---

### Task 3: Profile store (IndexedDB) + prefs

**Files:**
- Create: `client/src/profiles/profileStore.ts`
- Test: `client/src/profiles/profileStore.test.ts`
- Modify: `client/package.json` (dev dep `fake-indexeddb`, only if not already present)

**Interfaces:**
- Consumes: `Profile` (Task 2).
- Produces: `listProfiles()`, `putProfile(p)`, `deleteProfile(id)` (async, IndexedDB), and sync `localStorage` prefs `getActiveProfileId()/setActiveProfileId(id)`, `getShareProfile()/setShareProfile(on)` — consumed by Task 7 (App).

- [ ] **Step 1: Ensure an IndexedDB test shim**

Vitest runs in `environment: "node"` (no IndexedDB). Check `client/package.json`; if `fake-indexeddb` isn't a devDependency, add it: `npm install -D fake-indexeddb` (from `client/`). The test imports `import "fake-indexeddb/auto";` at the top.

- [ ] **Step 2: Write the failing tests**

```ts
// client/src/profiles/profileStore.test.ts
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { listProfiles, putProfile, deleteProfile } from "./profileStore";
import type { Profile } from "./profileModel";

const mk = (id: string, name: string): Profile => ({
  id, name, avatar: null, pinSalt: "s", pinHash: "h", createdAt: 0,
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
  it("deletes a profile", async () => {
    await putProfile(mk("p1", "Jay"));
    await deleteProfile("p1");
    expect(await listProfiles()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run** — `npm run test -- profileStore` → FAIL (module missing).

- [ ] **Step 4: Write the implementation**

Thin IndexedDB wrapper (`trojan-troy-profiles` db, one `profiles` object store keyed by `id`) — no query logic beyond key lookup, matching the server's `rooms.ts` "thin wrapper" style. Prefs are plain `localStorage`.

```ts
// client/src/profiles/profileStore.ts
import type { Profile } from "./profileModel";
import { ANONYMOUS_ID } from "./profileModel";

const DB = "trojan-troy-profiles";
const STORE = "profiles";
const ACTIVE_KEY = "trojan-troy-active-profile";
const SHARE_KEY = "trojan-troy-share-profile";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listProfiles(): Promise<Profile[]> {
  return (await tx("readonly", (s) => s.getAll() as IDBRequest<Profile[]>)) ?? [];
}
export async function putProfile(p: Profile): Promise<void> {
  await tx("readwrite", (s) => s.put(p));
}
export async function deleteProfile(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

// Prefs (small, synchronous).
export function getActiveProfileId(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? ANONYMOUS_ID;
}
export function setActiveProfileId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}
export function getShareProfile(): boolean {
  return localStorage.getItem(SHARE_KEY) === "true";
}
export function setShareProfile(on: boolean): void {
  localStorage.setItem(SHARE_KEY, String(on));
}
```

Wrap `open()`/`indexedDB` access so that if IndexedDB is unavailable (private mode) the store degrades to an in-memory array + returns empty — no crash (spec's error-handling rule). Keep this fallback minimal.

- [ ] **Step 5: Run tests** → PASS. **Step 6: Typecheck** → clean.
- [ ] **Step 7: Commit**
```powershell
git add client/src/profiles/profileStore.ts client/src/profiles/profileStore.test.ts client/package.json client/package-lock.json
git commit -m "Add profile IndexedDB store and prefs"
```

---

### Task 4: Default avatar asset + downscale util

**Files:**
- Create: `client/src/assets/default-avatar.jpg` (from `…\Downloads\5ece57d850017a91b215be1fd83ca53e.jpg`)
- Create: `client/src/profiles/avatar.ts`

**Interfaces:**
- Produces: `defaultAvatar` (imported asset URL), `downscaleToDataUrl(file: File, maxPx?: number): Promise<string>` — consumed by Tasks 5/6.

- [ ] **Step 1: Add the asset.** Copy the provided image to `client/src/assets/default-avatar.jpg`, ideally re-saved square ~256px to keep it small. (Vite fingerprints/inlines it on import.)

- [ ] **Step 2: Write the util** (browser-only — canvas; no unit test, per the project's "pure logic only" testing rule):

```ts
// client/src/profiles/avatar.ts
import defaultAvatarUrl from "../assets/default-avatar.jpg";

export const defaultAvatar = defaultAvatarUrl;

// Draw the image onto a square canvas at maxPx and export a compressed JPEG
// data-URL, so uploaded photos stay small in IndexedDB / the shared card.
export async function downscaleToDataUrl(file: File, maxPx = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = maxPx;
  const ctx = canvas.getContext("2d")!;
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, maxPx, maxPx);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function avatarSrc(avatar: string | null): string {
  return avatar ?? defaultAvatar;
}
```

- [ ] **Step 3: Typecheck** → clean (declare an image module type if TS complains: most Vite React templates already include `vite/client` types for `*.jpg`).
- [ ] **Step 4: Commit**
```powershell
git add client/src/assets/default-avatar.jpg client/src/profiles/avatar.ts
git commit -m "Add default avatar asset and downscale util"
```

---

### Task 5: ProfileButton (home-screen launcher)

**Files:**
- Create: `client/src/components/ProfileButton.tsx`, `client/src/components/ProfileButton.css`

**Interfaces:**
- Consumes: `ActiveProfile` (Task 2), `avatarSrc` (Task 4).
- Produces: `<ProfileButton active={ActiveProfile} onClick={() => void} />` — mounted in Task 7.

- [ ] **Step 1: Component.** A `<button className="profile-button">` showing a rounded-square avatar (`avatarSrc(active.kind === "named" ? active.profile.avatar : null)`) + the name (`active.kind === "named" ? active.profile.name : "Anonymous"`). `aria-label="Profiles"`.

- [ ] **Step 2: CSS.** Soft-white frosted rounded-cube (`border-radius: 14px`, `background: rgba(255,255,255,0.9)` or a light frosted token, subtle shadow) so it reads against the dark Iris backdrop; the avatar is a `36px` rounded-square (`border-radius: 10px`, `object-fit: cover`); name in `Schibsted Grotesk`, dark text. Hover: slight lift/scale like `StartJoinScreen`'s buttons (reuse the `cubic-bezier(0.2,0.9,0.3,1)` easing). Add a `prefers-reduced-motion` no-animation guard.

- [ ] **Step 3: Typecheck** → clean. **Step 4: Commit**
```powershell
git add client/src/components/ProfileButton.tsx client/src/components/ProfileButton.css
git commit -m "Add profile launcher button"
```

---

### Task 6: ProfileModal (create / select / delete)

**Files:**
- Create: `client/src/components/ProfileModal.tsx`, `client/src/components/ProfileModal.css`

**Interfaces:**
- Consumes: `Profile`/`ANONYMOUS_ID` (Task 2), `isValidPin`/`verifyPin`/`hashPin`/`newSalt` (Task 1), `downscaleToDataUrl`/`avatarSrc` (Task 4).
- Produces: `<ProfileModal profiles activeId onSelectAnonymous onSelectNamed(profile) onCreate(profile) onDelete(id) onClose />`. **PIN entry/verify happens inside the modal**; it calls `onSelectNamed(profile)` only after a correct PIN.

- [ ] **Step 1: Reuse the Settings modal shell.** Match `Settings.tsx`/`Settings.css` structure (backdrop, centered floating panel, blur, header, Escape-to-close). Factor the shared overlay/panel classes if convenient, or mirror them under `.profile-modal__*`.

- [ ] **Step 2: Views (local `useState` for `view`):**
  - **`list`** — grid of rounded-cube tiles: the **Anonymous** tile first (avatar = default picture, no delete), then each named profile (avatar + name + a **soft-red rounded-cube delete** button matching the tile silhouette). A **"＋ New profile"** tile opens `create`. Tapping Anonymous → `onSelectAnonymous()`; tapping a named tile → `unlock` for that profile.
  - **`create`** — name input; avatar row (preview + "Upload photo" → `downscaleToDataUrl`, defaulting to the cat if none); a 4-digit PIN input + confirm; "Create" (disabled until `isValidPin` && name non-empty && PINs match) → builds `{ id: crypto.randomUUID(), name, avatar, pinSalt: await newSalt(), pinHash: await hashPin(pin, salt), createdAt: Date.now() }`, calls `onCreate`, returns to `list`.
  - **`unlock`** — the chosen profile's avatar/name + a 4-digit PIN entry; on submit `verifyPin` → success calls `onSelectNamed(profile)` and closes; failure shakes + clears (reuse a small shake keyframe).
  - **`confirm-delete`** — "Forget '<name>'? This removes it from this device." → `onDelete(id)` back to `list`. (Layer B will extend this copy to mention erasing saved chats.)

- [ ] **Step 3: CSS.** Rounded-cube tiles (`border-radius: 16px`), avatar filling the tile top with the name below; the delete button a small soft-red rounded-cube (`background: rgba(255,90,90,0.14)`, `color:#ff7a7a`, `border-radius: 10px`) pinned to the tile corner; the "＋ New profile" tile dashed/ghost. Keep the palette consistent with Settings.

- [ ] **Step 4: Typecheck** → clean. **Step 5: Commit**
```powershell
git add client/src/components/ProfileModal.tsx client/src/components/ProfileModal.css
git commit -m "Add profile modal (create, select, delete)"
```

---

### Task 7: Wire profiles into App + StartJoinScreen

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/screens/StartJoinScreen.tsx`
- Modify: `client/src/dev/screenOverride.ts` + `.test.ts` (dev preview)

**Interfaces:**
- Consumes: everything above.
- Produces: `activeProfile` available in `App`; `StartJoinScreen` gains an `onOpenProfiles` prop + renders `<ProfileButton>`; a `?screen=profiles` dev override.

- [ ] **Step 1: App state.** In `App()` add:
```tsx
const [profiles, setProfiles] = useState<Profile[]>([]);
const [activeProfileId, setActiveProfileId] = useState<string>(() => getActiveProfileId());
const [profilesOpen, setProfilesOpen] = useState(false);
useEffect(() => { void listProfiles().then(setProfiles); }, []);
const activeProfile = resolveActiveProfile(profiles, activeProfileId);
```
Handlers: `handleSelectAnonymous` (set id `ANONYMOUS_ID` + `setActiveProfileId` pref + close), `handleSelectNamed(profile)` (set id + pref + close), `handleCreateProfile(p)` (`await putProfile(p)`, refresh list, select it), `handleDeleteProfile(id)` (`await deleteProfile(id)`, refresh; if it was active, fall back to Anonymous). Persist active id via `setActiveProfileIdPref` (Task 3) whenever it changes.

- [ ] **Step 2: Mount the button + modal.** Pass `onOpenProfiles={() => setProfilesOpen(true)}` and `activeProfile` to `StartJoinScreen`; render `<ProfileModal>` (when `profilesOpen`) at the App root so it floats above the home screen.

- [ ] **Step 3: StartJoinScreen.** Add `activeProfile` + `onOpenProfiles` props; render `<ProfileButton active={activeProfile} onClick={onOpenProfiles} />` top-right (mirroring the top-left `start-join-screen__badge`). Keep everything else unchanged.

- [ ] **Step 4: Dev override.** Add `"profiles"` to `screenOverride.ts`'s screen union + `VALID_SCREENS`; add a test case (mirrors the existing `waiting`/`safety` cases). In `App`, a `devOverride?.screen === "profiles"` branch renders `StartJoinScreen` with the modal open over sample profiles for eyeballing.

- [ ] **Step 5: Typecheck + tests** → clean/green. **Step 6: Commit**
```powershell
git add client/src/App.tsx client/src/screens/StartJoinScreen.tsx client/src/dev/screenOverride.ts client/src/dev/screenOverride.test.ts
git commit -m "Wire profiles into the home screen"
```

---

### Task 8: Encrypted profile-card sharing

**Files:**
- Modify: `client/src/net/relayClient.ts` (+ `.test.ts`)
- Modify: `client/src/App.tsx`
- Modify: `client/src/screens/ChatScreen.tsx`

**Interfaces:**
- Produces: `Envelope` gains `{ type: "profile"; payload: string }`; `App` sends it after key exchange when sharing is on + a named profile is active, and surfaces a received `peerProfile` to `ChatScreen`, which shows it in the header.

- [ ] **Step 1: Envelope.** Add `| { type: "profile"; payload: string }` to `Envelope`; add a relayClient test that it round-trips (mirror the existing `presence`/`ciphertext` pass-through tests). No server change.

- [ ] **Step 2: Send.** In `App`, add `const shareProfileRef = useRef(getShareProfile())` (kept in sync like `ghostModeRef`). After the peer's `pubkey` is processed and `sessionKeysRef` is set (end of the `pubkey` branch in `exchangeKeys`, right before/after `setScreen({ name: "safety-number", ... })`), if `shareProfileRef.current` and `activeProfile.kind === "named"`, send:
```tsx
const card = JSON.stringify({ name: p.name, avatar: p.avatar });
client.send({ type: "profile", payload: await encryptMessage(keys.tx, card) });
```
(Reuses `encryptMessage`/`secretbox` — the relay only sees ciphertext, same as `presence`.)

- [ ] **Step 3: Receive.** Add a `peerProfile` state (`{ name: string; avatar: string | null } | null`). In `exchangeKeys`'s `onMessage`, handle `envelope.type === "profile"`: `decryptMessage` → `JSON.parse` → `setPeerProfile(...)` (guard/try-catch like the `presence` branch). Reset `peerProfile` to null in `handleLeave`.

- [ ] **Step 4: Header.** Pass `peerProfile` to `ChatScreen`; when present, render the peer's `avatarSrc(avatar)` + `name` in the chat header (next to / in place of the room code). When null, today's header is unchanged (anonymous).

- [ ] **Step 5: Typecheck + tests** → clean/green. **Step 6: Commit**
```powershell
git add client/src/net/relayClient.ts client/src/net/relayClient.test.ts client/src/App.tsx client/src/screens/ChatScreen.tsx
git commit -m "Add encrypted profile-card sharing"
```

---

### Task 9: "Show my name & photo" Settings toggle

**Files:**
- Modify: `client/src/App.tsx`, `client/src/screens/ChatScreen.tsx`, `client/src/components/Settings.tsx`

**Interfaces:**
- Produces: `shareProfile: boolean` + `onShareProfileChange` threaded `App → ChatScreen → Settings`, backing `shareProfileRef` (Task 8) and the `trojan-troy-share-profile` pref.

- [ ] **Step 1: App state.** Add `const [shareProfile, setShareProfile] = useState(() => getShareProfile())`, keep `shareProfileRef.current = shareProfile`, and `updateShareProfile(next)` that persists via `setShareProfile` pref (Task 3) + sets state. Pass `shareProfile`/`onShareProfileChange={updateShareProfile}` to `ChatScreen` in both the real and dev-override renders.

- [ ] **Step 2: Thread through ChatScreen** to `<Settings>` (same pattern as the existing `ghostMode`/`onGhostModeChange` props).

- [ ] **Step 3: Settings row.** In the existing **Privacy** section (next to Ghost mode), add a "Show my name & photo" toggle reusing the existing `.settings__toggle` markup/CSS. Helper copy: "Only the person you're chatting with sees it — sent encrypted, never the relay. Applies when a named profile is active." Default off.

- [ ] **Step 4: Typecheck + tests** → clean/green. **Step 5: Commit**
```powershell
git add client/src/App.tsx client/src/screens/ChatScreen.tsx client/src/components/Settings.tsx
git commit -m "Add show-my-profile privacy toggle"
```

---

### Task 10: Manual verification + docs

**Files:** none (verification), plus `progress.md`, `roadmap.md`, `decisions.md`.

- [ ] **Step 1: Dev-preview eyeball.** `npm run dev`; open `?screen=profiles` — confirm the button, modal grid, Anonymous tile, create form (upload + default cat), the 4-digit PIN gate, and the soft-red delete confirm all render on-theme.

- [ ] **Step 2: Scratch-Playwright round trip** (same pattern as prior phases — no browser-automation tool in this env). Two contexts: create a profile "Jay" (PIN 1234) in context A; confirm PIN gate rejects 9999 and accepts 1234; toggle **Show my name & photo** on in A's Settings; pair A↔B; assert B's chat header shows "Jay" + the avatar; repeat with sharing **off** and assert B stays anonymous. Capture console errors; fail on any.

- [ ] **Step 3: Update `progress.md`** with a dated entry (Layer A: profiles, PIN gate, Anonymous default, default cat avatar, encrypted opt-in sharing; how verified).

- [ ] **Step 4: Roadmap/decisions (the one agreed roadmap change).** Update `roadmap.md` so Phase 5 reflects **Local Profiles** replacing persistent identity (5.1) and absorbing the storage half of 5.4; add a `decisions.md` entry logging the reversal + rationale (Jay's call, 2026-07-22), per `AGENTS.md`.

- [ ] **Step 5: Commit**
```powershell
git add progress.md roadmap.md decisions.md
git commit -m "Verify local profiles and log the roadmap change"
```

---

## Deferred to Layer B (separate plan)
Per-profile conversation history: the `conversations` IndexedDB store, `history.ts` (live append + at-rest encryption under a PIN-derived key), the functional ChatScreen sidebar (list + read-only playback), and "New chat". None of Layer A blocks on it; Layer A ships and demos on its own.
