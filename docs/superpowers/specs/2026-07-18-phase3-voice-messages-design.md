# Phase 3 — Encrypted Voice Messages: Design Spec

Status: Approved
Date: 2026-07-18

## Purpose

Phase 3 of `roadmap.md`: async, end-to-end encrypted voice messages between
the two paired clients. Record a clip, encrypt it, send it over the same
thin relay Phase 2 built for text, recipient decrypts and plays it. Not
live/streaming calling — that stays out of scope per `decisions.md` and
`AGENTS.md`.

## Scope

In scope for this spec:
- Recording a voice clip in-browser (`MediaRecorder`/`getUserMedia`), capped
  at 60 seconds, auto-stopping at the cap.
- A preview step (listen back, discard, or send) before anything is
  encrypted or transmitted.
- Symmetric encryption of the recorded audio using the same session keys
  and primitive (`crypto_secretbox_easy`) Phase 2 already uses for text.
- One new relay envelope variant (`voice`), reusing the existing
  pass-through relay logic — no server code changes.
- Playback of received voice messages inline in the existing chat message
  list, interleaved chronologically with text messages, using the native
  `<audio controls>` element.
- A small refactor extracting the shared byte-level encrypt/decrypt
  primitive out of `crypto/messages.ts` into `crypto/secretbox.ts`, so voice
  and text share one implementation instead of duplicating nonce/ciphertext
  handling.

Still 1:1 only — no change to Phase 1's room model.

Out of scope (later phases / explicitly deferred):
- Live/streaming voice or calling of any kind.
- Chunked or progressive upload — each clip is encrypted and sent as a
  single blob.
- Message history persistence — same ephemeral, in-memory-only model as
  Phase 2. Refreshing the page ends the session.
- Waveform visualization, custom audio player UI, or any other visual
  polish — Phase 4's territory, not this phase's.
- Cross-browser codec transcoding (see Known Limitations).
- Any relay server changes beyond recognizing `voice` as one more opaque
  pass-through envelope type (it already handles this generically, per
  Phase 1's `server.ts`).

## Architecture

No new packages, no server changes. Additions and one refactor, entirely
within `/client`:

```
client/src/
  crypto/
    secretbox.ts        # NEW — shared byte-level primitive, extracted from messages.ts
    secretbox.test.ts
    messages.ts          # refactored to a thin string<->bytes wrapper over secretbox.ts
    media.ts             # NEW — encryptVoiceClip / decryptVoiceClip (Blob <-> secretbox.ts)
    media.test.ts
  audio/
    recorder.ts           # NEW — thin wrapper around MediaRecorder/getUserMedia
  screens/
    ChatScreen.tsx         # extended: renders voice messages, hosts the recorder control
    VoiceRecorder.tsx      # NEW — mic button, recording/preview state machine
  net/relayClient.ts        # +1 Envelope variant: { type: "voice"; payload: string; mimeType: string }
  App.tsx                    # wires voice send/receive, decrypts on receipt
```

The `secretbox.ts` extraction is the one piece of existing-code cleanup:
`messages.ts` currently inlines nonce-generation and
`crypto_secretbox_easy` concat/split logic that voice messages need
byte-for-byte identically. Pulling it into a shared primitive avoids
copy-pasting that logic into `media.ts`.

## Components

### `client/src/crypto/secretbox.ts`
Extracted primitive, same style as Phase 1/2's crypto wrappers:
```ts
encryptBytes(key: Uint8Array, plaintext: Uint8Array): Promise<string>  // base64(nonce || ciphertext)
decryptBytes(key: Uint8Array, payload: string): Promise<Uint8Array>    // throws on MAC failure
```
Identical logic to what `messages.ts` already does, generalized from
`string` to `Uint8Array`.

### `client/src/crypto/messages.ts` (refactored, same public API)
`encryptMessage`/`decryptMessage` become thin wrappers: `sodium.from_string`
/ `sodium.to_string` around `encryptBytes`/`decryptBytes`. No behavior
change; existing tests continue to pass unchanged.

### `client/src/crypto/media.ts`
Voice-specific wrapper:
```ts
encryptVoiceClip(key: Uint8Array, blob: Blob): Promise<string>
  // blob.arrayBuffer() -> encryptBytes
decryptVoiceClip(key: Uint8Array, payload: string, mimeType: string): Promise<Blob>
  // decryptBytes -> new Blob([...], { type: mimeType })
```

### `client/src/audio/recorder.ts`
Thin wrapper around `MediaRecorder`:
- `startRecording(): Promise<RecordingHandle>` — calls
  `getUserMedia({ audio: true })`, picks the first supported mime type from
  a preference list (`audio/webm;codecs=opus`, `audio/ogg;codecs=opus`,
  `audio/mp4`) via `MediaRecorder.isTypeSupported`, starts `MediaRecorder`,
  auto-stops at 60 seconds.
- `RecordingHandle.stop(): Promise<{ blob: Blob; mimeType: string }>` —
  manual stop, resolves with the recorded clip.
- Throws a typed error on permission denial or when no supported mime type
  exists, so the UI can show a message instead of crashing.

### `client/src/screens/VoiceRecorder.tsx`
Small state machine (`idle → recording → preview → idle`):
- `idle`: mic button.
- `recording`: stop button + elapsed time, counting up to the 60s cap
  (auto-stops there).
- `preview`: native `<audio controls>` over the local blob, plus
  Send / Discard buttons. Discard drops the clip — nothing is encrypted or
  sent, returns to `idle`.
- Permission/unsupported-format errors render inline in the component and
  don't crash `ChatScreen`.

### `client/src/screens/ChatScreen.tsx`
`ChatMessage` becomes a discriminated union:
```ts
type ChatMessage =
  | { id: string; from: "me" | "peer"; kind: "text"; text: string }
  | { id: string; from: "me" | "peer"; kind: "voice"; audioUrl: string }
  | { id: string; kind: "decryption-error" };
```
Voice messages render `<audio src={audioUrl} controls>`. `VoiceRecorder`
sits next to the existing text input; `onSendVoice(blob, mimeType)` is a
new prop alongside the existing `onSend(text)`. Messages render in a single
chronological list — text and voice interleaved, no separate panel.

### `client/src/net/relayClient.ts`
One additive change to the existing `Envelope` union:
```ts
| { type: "voice"; payload: string; mimeType: string }
```
`mimeType` travels in the clear (see Known Limitations). No other changes
— `RelayClient` already treats all envelope types generically.

## Data flow

1. User taps the mic button in `ChatScreen` → `VoiceRecorder` calls
   `startRecording()`, which requests mic permission and begins capturing
   (auto-stops at 60s if not stopped manually).
2. User taps stop → recording resolves to `{ blob, mimeType }`,
   `VoiceRecorder` enters `preview`, plays back locally via
   `URL.createObjectURL(blob)`.
3. User taps Send → `ChatScreen` calls `onSendVoice(blob, mimeType)` →
   `App.tsx` runs `encryptVoiceClip(keys.tx, blob)`, sends
   `{ type: "voice", payload, mimeType }` over the relay (same opaque
   pass-through as `pubkey`/`ciphertext`) → optimistically appends a
   `kind: "voice"` message using the *local* blob URL (no round-trip needed
   to hear your own clip, same optimistic pattern Phase 2 used for text).
4. Peer's `onMessage` listener receives the `voice` envelope, calls
   `decryptVoiceClip(keys.rx, payload, mimeType)` → on success,
   `URL.createObjectURL`s the resulting `Blob` and appends a `kind: "voice"`
   message; on failure, appends `kind: "decryption-error"` (same as text).
5. User taps Discard in preview → clip is dropped, nothing is encrypted or
   sent, back to `idle`.

## Error handling

- **Mic permission denied / no microphone**: `startRecording()` rejects
  with a typed error; `VoiceRecorder` shows an inline message ("Microphone
  access denied") and stays in `idle` — doesn't crash the chat.
- **No supported recording format**: feature-detected via
  `MediaRecorder.isTypeSupported` before recording starts; if nothing in
  the preference list is supported, the mic button is disabled with a
  short inline note instead of failing on tap.
- **Decryption failure**: identical to Phase 2's text handling — caught,
  not thrown, renders as a `decryption-error` placeholder, session
  continues.
- **Send failure** (relay closed mid-send): reuses Phase 1/2's existing
  relay-error handling path — no new logic.
- **Peer disconnects mid-recording**: no special handling needed —
  recording is entirely local until Send is tapped; if the peer is gone by
  then, the existing relay-error path fires exactly as it would for a text
  message.
- Nothing persists to disk — recorded blobs and object URLs live only in
  React state/memory for the session, same ephemeral model as everything
  else so far. Object URLs are revoked on message-list cleanup/unmount to
  avoid leaking memory during a long session.

## Known limitations

- **`mimeType` travels unencrypted.** It's a generic codec label (e.g.
  `audio/webm`), not message content, but it is metadata visible to the
  relay — same category of trade-off as Phase 2's noted replay-protection
  gap, worth stating rather than leaving implicit.
- **No cross-browser codec guarantee.** If sender and recipient are on
  browsers with no common playable codec (e.g. one records `audio/mp4`,
  the other's `<audio>` element can't decode it), playback fails silently
  at the browser level. Not solvable without transcoding, which is out of
  scope for a hackathon build — noted, not fixed.

## Testing

- **`crypto/secretbox.ts`**: round-trips bytes through encrypt/decrypt with
  matching keys; rejects tampered ciphertext; rejects wrong key; two calls
  on the same plaintext produce different ciphertext (proves nonce
  randomization) — same rigor as Phase 2's `messages.test.ts`, which these
  tests replace/absorb.
- **`crypto/messages.ts`**: existing tests continue to pass unchanged (the
  refactor is behavior-preserving).
- **`crypto/media.ts`**: round-trips a `Blob` through `encryptVoiceClip` /
  `decryptVoiceClip`, confirms the returned `Blob`'s `type` matches the
  original `mimeType`.
- **`audio/recorder.ts`** and **`VoiceRecorder.tsx`**: no automated tests —
  `MediaRecorder`/`getUserMedia` aren't meaningfully testable under
  Vitest/jsdom; matches Phase 1/2's precedent of manual verification for
  browser-API-heavy UI.
- **`App.tsx` wiring**: same protocol-level integration script approach as
  Phase 2 (two simulated clients exchange a `voice` envelope with encrypted
  dummy bytes, assert round-trip through the real relay) plus a manual
  two-browser-window check: record a clip, send it, confirm the peer can
  play it, confirm a tampered/corrupted payload shows the
  decryption-error placeholder.
- **Server**: no changes, no new tests.
