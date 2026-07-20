# Progress Log

What's actually been done, in order. Update this after finishing a chunk of
work — not just at the end of a session. See `roadmap.md` for what's left
and `decisions.md` for why things were done a certain way.

## Status by phase

| Phase | Status |
|---|---|
| 1 — Foundation (key gen/exchange, safety number) | Complete — key exchange + safety number screen working end-to-end |
| 2 — Encrypted messaging (relay + real-time text) | Complete — encrypted text messaging working end-to-end |
| 3 — Encrypted voice messages | Complete — async encrypted voice messages working end-to-end |
| 4 — UI polish | Complete — kinetic-cipher loading screen and all three chat themes (Apple, Iris Glass, Pulse Slate) built and verified end-to-end |
| 5 — Marketing/landing site | Not started |

## Log

- **2026-07-18** — Project scaffolding: created `AGENTS.md`, `roadmap.md`,
  `decisions.md`, `progress.md`. Connected local repo to GitHub remote
  (`juanmendoza-dev/Trojan-Troy`). No app code written yet.

- **2026-07-18** — Phase 1 complete: room-code pairing relay (`/server`),
  React client with libsodium.js key exchange and safety-number screen
  (`/client`). Verified end-to-end with two browser windows landing on a
  matching safety number. See
  `docs/superpowers/plans/2026-07-18-phase1-foundation.md`.

- **2026-07-18** — Phase 2 complete: real-time end-to-end encrypted text
  messaging (`crypto_secretbox_easy` with Phase 1's session keys), reusing
  the same relay and envelope pattern with one new pass-through type
  (`ciphertext`) and no server changes. Verified end-to-end with two
  browser windows exchanging messages after safety-number verification.
  See `docs/superpowers/plans/2026-07-18-phase2-messaging.md`.

- **2026-07-18** — Phase 3 complete: async end-to-end encrypted voice
  messages (`crypto_secretbox_easy` on raw audio bytes via a shared
  `secretbox.ts` primitive, reused from Phase 2's text encryption), one new
  pass-through envelope type (`voice`) and no server changes. Record →
  preview → send/discard flow with a 60-second cap, native `<audio>`
  playback, interleaved with text messages in the same chat list. Crypto and
  relay transport verified via an automated round-trip script (real relay,
  real crypto, both directions, tamper rejection); manual two-browser
  recording/playback verification still pending. See
  `docs/superpowers/plans/2026-07-18-phase3-voice-messages.md`.

- **2026-07-19** — Phase 4 UI redesign complete: kinetic-cipher loading
  screen and three runtime-switchable chat themes (Apple, Iris Glass, Pulse
  Slate) built on top of Phases 1-3's unchanged crypto/relay/audio layers —
  `TitleBar`, `Sidebar`, `MessageBubble`, `VoiceMessageBubble`, and `Composer`
  components, a rewritten `ChatScreen`, and a `handshake` screen state wired
  into `App.tsx`'s state machine between "waiting" and "safety-number".
  `StartJoinScreen`, `WaitingScreen`, and `SafetyNumberScreen` stay unstyled
  per the agreed scope cut. Verified end-to-end with a real two-browser-context
  run (headless Chromium via Playwright, not the manual click-through the plan
  assumed): room pairing, handshake animation, matching safety numbers,
  themed chat screen, text messages both directions, and a recorded/sent/
  received voice message, across all three themes and both light/dark
  schemes — zero console errors. One real bug was found and fixed during this
  verification pass (not present in the reviewed Task 8-12 diffs, inherited
  from Task 5's original implementation): `CipherWord.tsx`'s letter-width
  measurement built a canvas font string containing a literal
  `var(--font-display)` CSS reference, which the Canvas 2D API silently
  rejects (falling back to its default `10px sans-serif`) — every letter
  column was measured far too narrow, clipping almost the entire glyph and
  making the "Trojan Troy" wordmark unreadable on the loading screen in every
  theme/scheme. Fixed by resolving the custom property via `getComputedStyle`
  before building the canvas font string. See
  `docs/superpowers/plans/2026-07-19-phase4-ui-redesign.md` and
  `decisions.md` for the design deviations from the handoff.
