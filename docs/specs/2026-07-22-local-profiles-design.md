# Local Profiles + Per-Profile Conversation History: Design Spec

Status: Draft (brainstormed with Jay 2026-07-22; awaiting approval)
Date: 2026-07-22

## Purpose

Today Trojan Troy has no notion of "who you are" on a device: every session
mints a throwaway ephemeral keypair, nothing is remembered between chats, and
the UI is anonymous. A short-lived attempt at persistent *cryptographic*
identity (Phase 5.1 + contacts privacy) was built and then rolled back (`main`
@ `1ee0e35` "Redeploy the pre-identity client") in favor of a lighter,
UI-first idea:

**Local Profiles** — device-local, PIN-gated personas (name + picture) you pick
when you open the app, each of which owns its own saved conversation history. An
always-present **Anonymous** profile preserves today's zero-trace behavior as
the default.

This replaces persistent identity as the Phase 5 identity direction. It is
deliberately *light*: no long-term cryptographic identity keypair, no change to
the session crypto, no relay changes. It's a local personalization + history
layer on top of the existing ephemeral-pairing model.

## Design decisions (from the 2026-07-22 brainstorm)

Locked with Jay:
1. **Light / local only.** Session crypto is unchanged — still a fresh
   ephemeral `crypto_kx` keypair per room; the safety number attests to the
   session, as today. No persistent identity keypair, no server changes.
2. **PIN gates opening a profile.** Exactly 4 digits. Stored as a salted hash,
   never plaintext. It is a *local access gate*, not strong encryption (see
   "Honest scope of the PIN").
3. **Anonymous is the always-present default** — a built-in profile that can't
   be created or deleted, shares nothing, keeps no history, and is what the app
   opens on. Named profiles are opt-in on top.
4. **Each profile has a name + picture.** The picture is an uploaded photo
   (downscaled, kept crisp) or, when there's no photo, a bundled **default
   profile picture** (the taiyaki-hat cat Jay provided).
5. **Opt-in identity sharing.** A Settings → Privacy toggle "Show my name &
   photo to the person I'm chatting with", **default OFF**. When ON with a named
   profile active, the name + picture are sent to the peer *encrypted* (the relay
   never sees them). Anonymous never shares.
6. **Per-profile conversation history, archive-only.** Named profiles persist
   their chat transcripts locally (IndexedDB). Because there is no persistent
   identity, saved conversations are read-back archives; "New chat" always
   starts a fresh, separately-verified room — the app cannot auto-reconnect to a
   past peer.
7. **History encrypted at rest** under a PIN-derived key, with an explicit
   "stored on this device" note in the UI — honest that a 4-digit PIN is a weak
   secret.

Adopted by Claude as sensible defaults during spec-writing (easy to revisit —
Jay green-lit the spec without objecting to these):
- **Anonymous keeps no history** (ephemeral, like today) — this is what makes it
  the "no trace" mode; named profiles are where history lives.
- **One bundled default profile picture** (the taiyaki-hat cat) is the avatar
  for Anonymous and for any profile without an uploaded photo — no emoji set, no
  random assignment, one fewer dependency. (Trade-off: every no-photo profile
  looks the same until a photo is uploaded; a small *set* of default pictures
  could add variety later if wanted.)

## Scope

In scope:
- A `profiles` module + IndexedDB store: create / list / select / delete
  profiles; the synthesized built-in Anonymous profile.
- 4-digit PIN: set on create, required to select a named profile; salted-hash
  verify.
- Avatar: photo upload (downscaled to ~128px, quality-preserving), else the
  bundled default profile picture (the taiyaki-hat cat).
- A soft-white rounded-cube **profile launcher button** on the home screen, and
  a **profile modal** (reusing the Settings modal shell) to create/select/delete.
- Settings → Privacy **"Show my name & photo"** toggle (default off) + the
  encrypted profile-card exchange with the peer.
- **Per-profile conversation history** in IndexedDB (named profiles only),
  encrypted at rest under a PIN-derived key: transcripts (text + voice/image
  references) written live as a chat proceeds; a conversations list in the
  ChatScreen sidebar; read-only playback of past conversations; "New chat"
  starts a fresh room.

Out of scope (explicitly, or later):
- Any persistent *cryptographic* identity / stable cross-session peer
  recognition / contacts list — retired (the rolled-back 5.1 work). Saved
  conversations therefore cannot be "continued" with a guaranteed-same peer.
- Strong at-rest security. A 4-digit PIN is brute-forceable (10^4); history
  encryption raises the bar against casual disk inspection only.
- Multi-device / sync — profiles and history live in one browser's IndexedDB.
- Search over history (roadmap 5.4's search half) — this delivers the
  storage/archive, not search. Can follow.
- Server changes — none. The relay still forwards opaque envelopes.

## Honest scope of the PIN

A 4-digit PIN has 10,000 possibilities — trivially brute-forced by anyone with
the device and the on-disk data. So:
- The PIN's *primary* job is a **local access gate**: it stops someone casually
  opening your profile from the picker.
- History encryption under a PIN-derived key is **defense-in-depth against
  casual disk inspection**, not protection against a determined local attacker.
- The UI must say so plainly ("These chats are saved on this device") and never
  imply the PIN makes them secure — consistent with the app's "don't oversell
  security" posture.

## Architecture

All client-side; no server changes. New/changed files under `/client`:

```
client/src/
  profiles/
    profileStore.ts       # IndexedDB wrapper: profiles + conversations stores
    profileStore.test.ts
    pin.ts                # 4-digit validate, salted hash + verify (pure)
    pin.test.ts
    history.ts            # append/list/load per-profile conversation records
    history.test.ts       # encrypt/decrypt record round-trip; Anonymous no-ops
  components/
    ProfileButton.tsx / .css    # home-screen launcher (soft-white rounded cube)
    ProfileModal.tsx   / .css    # create/select/delete (reuses Settings shell)
    Settings.tsx                 # + "Show my name & photo" Privacy toggle
  screens/
    ChatScreen.tsx               # sidebar lists this profile's conversations
    StartJoinScreen.tsx          # mounts ProfileButton
  net/relayClient.ts             # + "profile" envelope (encrypted card)
  App.tsx                        # active-profile state; PIN gate; history + sharing
  assets/default-avatar.jpg      # bundled default profile picture (the cat)
```

## Components

### `profiles/pin.ts` (pure)
- `isValidPin(pin): boolean` — exactly 4 ASCII digits.
- `hashPin(pin, salt): Promise<string>` — salted hash. Prefer libsodium
  `crypto_pwhash` (Argon2id) if the current build provides it; otherwise
  `crypto_generichash` over `salt‖pin`. **Confirm against the current libsodium
  build** — the Argon2id/sumo switch was part of the rolled-back work, so it may
  not be present on `main`.
- `verifyPin(pin, salt, hash): Promise<boolean>`.
Unit-tested: validation edges (3/5 digits, non-digits), hash→verify round-trip,
wrong PIN fails.

### Default avatar
`assets/default-avatar.jpg` is the single bundled fallback picture (the
taiyaki-hat cat Jay provided). It's used for Anonymous and any profile with no
uploaded photo — imported as a static asset (Vite fingerprints it) and displayed
cropped to a rounded square. Bundle a reasonably optimized copy (square, ~256px)
so it's small. Source to import into the repo:
`c:\Users\juanm\Downloads\5ece57d850017a91b215be1fd83ca53e.jpg`.

### `profiles/profileStore.ts`
IndexedDB (`trojan-troy-profiles`), object stores:
- `profiles` — keyed by `id`:
  `{ id, name, avatar: string | null, pinSalt, pinHash, createdAt }`
  (`avatar` = data-URL for an uploaded photo, or `null` → the bundled default
  picture). Anonymous is *not* stored — it's synthesized.
- `conversations` — keyed by `convId`, with a `profileId` index: an encrypted
  transcript blob (see `history.ts`) plus cleartext metadata
  `{ convId, profileId, startedAt, lastAt }`.
Exposes `listProfiles`, `putProfile`, `deleteProfile(id)` (cascade-deletes its
conversations), plus the conversation ops `history.ts` uses. Thin wrapper, no
query logic beyond key/index lookup (matches the rolled-back `store.ts` and the
server's `rooms.ts` style).
Small prefs stay in `localStorage`: `trojan-troy-active-profile`
(`id` | `"anonymous"`) and `trojan-troy-share-profile` (`"true"|"false"`).

### `profiles/history.ts`
- With a named profile active, a live conversation record accrues messages as
  they're sent/received; the transcript is JSON-serialized, encrypted under a
  PIN-derived key (`secretbox`, key derived from the PIN + `pinSalt`, held in
  memory only while the profile is unlocked this session), and written to
  `conversations`.
- `newConversation(profileId)`, `appendMessage(convId, msg)`,
  `listConversations(profileId)`, `loadConversation(convId, key)` (decrypt).
- Voice/image blobs are encrypted entries too (extending the existing media
  encryption) and referenced from the record.
- Anonymous: every op is a no-op (never persists).

### `components/ProfileButton.tsx`
Soft-white rounded-cube button, top-right on `StartJoinScreen` (mirrors the
top-left "secure channel ready" badge). Shows the active profile's picture +
name; on Anonymous it shows the default picture. Opens `ProfileModal`.
Frosted/soft-white to read against the dark Iris backdrop while still popping.

### `components/ProfileModal.tsx`
Reuses the Settings modal shell (floating-center, blur, esc-to-close):
- Grid of rounded-cube profile tiles (picture + name). Anonymous tile always
  first, no delete.
- "＋ New profile" tile (same silhouette) → create form: name; picture (upload a
  photo → downscale, else the default picture is used); 4-digit PIN + confirm.
- Per named profile: a **soft-red rounded-cube delete** button (same shape as
  the tile) → confirm ("Forget 'Jay'? This erases its saved chats on this
  device.") → `deleteProfile`.
- Selecting a named tile → 4-digit PIN entry (shake + clear on wrong) → derives
  the history key, sets active, closes.

### `components/Settings.tsx` (modified)
Add a Privacy row: **"Show my name & photo to the person I'm chatting with"**
(default off, persisted in `localStorage`), next to Ghost Mode. Copy note: only
applies when a named profile is active.

### `net/relayClient.ts` (modified)
Add `| { type: "profile"; payload: string }` to `Envelope` — an encrypted
`{ name, avatar }` card sent after the key exchange (same opaque-forward path as
`ciphertext`/`voice`; no server change). Sent only when sharing is on and a
named profile is active. (Note: the avatar is a small downscaled data-URL — keep
the shared payload modest.)

### `screens/ChatScreen.tsx` (modified)
- The existing sidebar's "New chat" affordance becomes functional: it lists the
  active profile's saved conversations (name + last-message time); selecting one
  loads it **read-only**; "New chat" tears down and starts a fresh room.
- If a peer `profile` card arrived, show their name/picture in the chat header;
  otherwise the anonymous treatment as today.
- On Anonymous: the sidebar shows only the live chat, no saved list.

### `App.tsx` (modified)
- Active-profile state (default `"anonymous"`); load `trojan-troy-active-profile`
  on mount.
- Selecting a named profile requires the PIN (via the modal), then derives + holds
  the history key in memory for the session.
- As chat messages flow with a named profile active, append them to the live
  conversation via `history.ts`.
- If sharing is on + named profile active, send the encrypted `profile` card once
  keys are established; on receiving one, surface it to `ChatScreen`.
- Anonymous: today's behavior exactly (no history, no card).

## Data flow

1. App loads → active profile = stored id or Anonymous. Home screen shows the
   profile button.
2. User opens the modal, picks "Jay", enters the 4-digit PIN → verified → history
   key derived + held in memory; Jay is active.
3. User starts/joins a room exactly as today; ephemeral key exchange +
   safety-number verification unchanged.
4. If sharing is on, after keys are established each side sends an encrypted
   `profile` card; the peer's name/photo appears in the header. (Off by default →
   anonymous, as today.)
5. As messages flow, they're appended to Jay's current conversation record
   (encrypted) in IndexedDB.
6. "New chat" starts a fresh room + a fresh conversation record. Past
   conversations are listed in the sidebar and open read-only.
7. On Anonymous, steps 4–6 are skipped — nothing shared or saved.

## Error handling / edge cases
- **IndexedDB unavailable** (private mode): profiles + history degrade to
  in-memory only for the session (Anonymous-like); no crash, console warning —
  mirrors the rolled-back identity spec's fallback.
- **Forgotten PIN**: no recovery (light model, no account). Deleting the profile
  is the only path — call this out in the UI. (A recovery-code option is possible
  later, out of scope.)
- **Corrupt/undecryptable conversation record**: skip it in the list with a
  subtle "couldn't open" marker; never crash.
- **Deleting the active profile** → fall back to Anonymous.
- **Avatar too large**: enforce downscale + a max byte size before storing;
  inline error if still too big.

## Testing
- Pure modules get unit tests (project convention): `pin.ts`
  (validate/hash/verify), `history.ts` (encrypt→decrypt record round-trip;
  Anonymous no-ops).
- `profileStore.ts`: IndexedDB round-trips (put/list/delete + cascade), matching
  the rolled-back `store.test.ts` precedent.
- Components/screens: manual UI verification (add `?screen=` dev overrides where
  useful) — same precedent as every screen here; no automated component tests.
- No server tests (no server change).

## Build order
- **A — Profiles** (self-contained, demoable): `profileStore` + `pin`,
  `ProfileButton`, `ProfileModal` (create/select/delete + PIN gate), the
  Anonymous default (default picture), and the Settings sharing toggle +
  encrypted `profile` card. Ship/verify this first.
- **B — Per-profile history** (on top of A): `history.ts` + the conversations
  store, the functional sidebar list + read-only playback, live persistence, and
  at-rest encryption.

## Rollout
- **Roadmap change (needs the usual `AGENTS.md` log):** this retires Phase 5.1
  (persistent identity) and 5.2's dependence on it, and absorbs the storage half
  of 5.4 (local history). Update `roadmap.md` so Phase 5 reflects Profiles
  replacing persistent identity; log the reversal + rationale in `decisions.md`
  (Jay's call, 2026-07-22).
- Build on a branch off the current pre-identity `main` (`1ee0e35`).
- Update `progress.md` as A and B land.
```
