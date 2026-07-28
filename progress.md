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
| 4.5 — Ambient orbs, Iris Glass default, Settings modal, deploy config | Complete — verified end-to-end |
| — Continuous handshake-to-chat transition (unscheduled, user-requested polish) | Complete — verified end-to-end |
| — Chat polish: themed bubble animations, read receipts, Ghost Mode (unscheduled, user-requested) | Complete — verified end-to-end |
| — Decrypt-reveal redesign: width-driven focus sweep (unscheduled, user-requested polish) | Merged to `main` — typecheck/tests/build green; manual eyeball pending |
| — Peer presence indicator: encrypted typing + recording (unscheduled, user-requested) | Merged to `main` (PR #8) — and re-verified live on the v5 sealed format: the typing indicator appears and clears through the presence channel |
| — Seal-slider sparks: canvas ember effect on the safety-number slider (unscheduled, user-requested) | Merged to `main` — typecheck/95 tests/build green; visual eyeball via `?screen=safety` pending |
| — Error screen: themed six-scenario error screen (unscheduled; was built but stranded on the retired identity branch) | Merged to `main` (`275d834`) — typecheck/104 tests/build green; visual eyeball (`?screen=error`) pending |
| 4.6 — Style remaining unstyled screens | Complete — `WaitingScreen` (Radar/Signal), `StartJoinScreen` (home + connecting bar) and `SafetyNumberScreen` (Confirm Key + seal slider) all designed AND implemented on `main` |
| 5.1 + 5.1a — Persistent identity + contacts privacy settings | Rolled back (`main` @ `1ee0e35`); superseded by Local Profiles below (Jay's call, see `decisions.md`) |
| 5.1 — Local Profiles (Layer A): PIN-gated device-local profiles + encrypted opt-in sharing | On `main` — profiles + PIN + modal + opt-in encrypted sharing, now with Argon2id at-rest sealing (④). Layer B (per-profile saved history) not built. |
| 5.2 — Forward-secrecy ratchet (Double Ratchet) + sealed framing + padding | On `main` — Double Ratchet + sealed `msg` framing + padding + host-primer, plus honest about/security copy. Track B (relay DoS/lifecycle hardening — H3/M1/M5/L5) also on `main` (server 31/31). Extended by round 2's A+B (sealed headers + PQ root-chain folds). |
| PQ hardening ①+② — hybrid post-quantum handshake (X25519 + ML-KEM-768) + safety-number binding | Merged to `main` — typecheck/163 tests/build green; full handshake choreography verified via a throwaway real-module test (root-key agreement, session-bound safety number, joiner-first via primer, corrupt-`kemct` fails). |
| PQ hardening ③ — traffic-analysis resistance (cover traffic + cadence jitter) | On `main` (via PR #15) — typecheck/**189** tests/build green; two-browser Playwright eyeball 10/10 (steady ~1/sec jittered cover stream, byte-indistinguishable, zero added latency, no stray bubbles, stops on leave). Zero-latency "minimum frame rate" cadence + ±30% heartbeat jitter; honest metadata copy. |
| Round 2 — D: Hardened handshake (commit-then-reveal + transcript binding) | On `main` (via PR #15) — new opaque `commit` round (keys committed before either side reveals) + full-transcript binding into `RK₀`, `PROTOCOL_VERSION` 3→4, no server change, no new dep. typecheck / **185** tests / build green (transcript ×5 + kdf/ratchetSession binding cases). First of the round-2 four (A/B/D/E); A+B have since shipped too, leaving only E. |
| PQ hardening ④ — at-rest Argon2id profile vault | On `main` (via PR #15) — PIN derives a real Argon2id key (`crypto_pwhash`, sumo build) sealing the avatar with `crypto_secretbox`; fast-hash access check removed, legacy cleartext records purged on load, reload reverts to Anonymous. typecheck/**183** tests/build green; real-browser Playwright run 17/17 (IndexedDB holds `cipher`/`kdf`/`pinSalt` and no avatar bytes). |
| **Crypto round integration** — D + ③ + ④ merged onto one branch | **Merged to `main` (PR #15, `1dcb5b4`)** — all three unmerged crypto branches folded together (no code conflicts; ledger conflicts resolved), the split-libsodium defect fixed, `libsodium-wrappers` dropped for sumo-only. typecheck clean / **201** tests / build green (1,610 kB, no double wasm) + **two-browser Playwright run 19/19** — matching safety numbers on both sides, commit-before-pubkey on the wire, one `kemct`, cover traffic on both sides with no stray bubbles, joiner-first send at 88 ms, no console errors. Merged 2026-07-28. |
| **v6 — static-channel PQ binding + two hardening fixes** | On `feat/v6-static-channel-pq-binding` — closes a real, undisclosed gap: `presence`/`ack`/`profile` derived from the raw `crypto_kx` output, so they were **X25519-only** (no ML-KEM, no transcript binding) while the ratchet took both from `RK₀`. Reproduced first — same classical handshake with a different PQ secret gave byte-identical static keys — then fixed by binding each direction to `RK₀`. Plus: static replay counter no longer consumed before the body authenticates, and `unframe` now allowlists the channel. `PROTOCOL_VERSION` 5→6. typecheck / **248** tests / build green (+5 new, **zero edits to the existing 243**), server 31/31, and a **new committed two-browser Playwright test** passing. Zero `.tsx` / copy / `ui/` changes. |
| Round 2 — A+B: post-quantum ratchet + sealed ratchet headers | **Merged to `main` (PR #16, `898420e`)** — one wire revision, `PROTOCOL_VERSION` 4→5. The `msg` envelope is now `{type, payload}` and nothing else: the key class, ratchet public key and chain counters live in a fixed 84-byte sealed header. Fresh ML-KEM secrets fold into the root chain every ~30s via two new in-band channels, so post-compromise healing is post-quantum too. Static channels gained replay protection. typecheck / **243** tests / build green + **two-browser Playwright run 18/18** — 7 folds, both sides in sync, messages still decrypting after them. No server change. Remaining in round 2: **E** (periodic rekey), which A largely subsumes — re-scope before building. |
| Mobile web support — WP0 + WP-A/B/C/E/F (entry, loading, safety, message body, modals) | **Merged to `main` (PR #10, `13654dd`)** — responsive foundation (`viewport-fit=cover`, global reset, safe-area vars, `--app-height` visual-viewport hook) plus mobile blocks on every screen except the chat shell. |
| Mobile web support — **WP-D: chat shell + drawer + composer** | Built (this branch) — the critical-path package, never built in PR #10, so the chat screen was unusable on a phone. Hamburger off-canvas drawer + scrim, full-width single column, 16px composer with ≥44px controls, stacked voice preview, auto-scroll to newest, data-viz paused while the drawer is parked. typecheck / **248** tests (zero edits to existing) / build green + **new `e2e/chat-mobile.spec.ts` 17/17** across `iphone-safari` + `android-chrome` + a `desktop-chrome` regression, asserting **geometry** rather than overflow (the spec's overflow check passed on the broken screen). Still open: real-device soft-keyboard + true notch insets. |

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

- **2026-07-19** — Phase 4 UI redesign kicked off (superseded by the
  "complete" entry below — kept for the historical resume-point record).

  **What exists so far:**
  - A high-fidelity design handoff (external design work via Claude/Fable)
    landed at `ui/Trojan Troy Desktop Redesign/design_handoff_trojan_troy/`
    — `README.md` (spec: tokens, copy, motion, per-screen behavior) and
    `Trojan Troy Directions.dc.html` (exact markup/CSS/animations for every
    screen, open in a browser to see them live). Committed to `main` at
    `2537cd5`.
  - Scope confirmed with the user (Jay), 2026-07-19: implement **all three**
    chat-layout themes — Apple (4b/4d, light+dark, system-following), Iris
    Glass (2b), Pulse Slate (2c) — behind a runtime theme switcher, plus the
    kinetic-cipher loading screen (5a/5b). `StartJoinScreen`, `WaitingScreen`,
    and `SafetyNumberScreen` are explicitly **out of scope** for this pass —
    leave them unstyled.
  - Full implementation plan written and committed to `main` at `2537cd5`:
    `docs/superpowers/plans/2026-07-19-phase4-ui-redesign.md`. 13 tasks,
    file-by-file, with exact CSS/token values and code for the
    logic-bearing pieces (theme resolution, percent-counter timing, dev
    screen-override parsing). Read its "Design deviations from the
    handoff" section before assuming anything about the mockup applies
    literally — five deviations are already decided there (fixed-window
    frame dropped, typing indicator cut, loading screen always
    Apple-styled, JS-timed handshake instead of the mockup's infinite CSS
    loop, runtime-measured wordmark letter widths instead of hardcoded
    SF-Pro-tuned ones). See also `decisions.md`.
  - Executing via `superpowers:subagent-driven-development` in an isolated
    worktree: branch `phase4-ui-redesign`, worktree at
    `.worktrees/phase4-ui-redesign/` (this repo's convention — see
    `AGENTS.md`/git workflow notes, **not** `.claude/worktrees/`).
    `client/` dependencies installed there; baseline verified clean (25/25
    existing tests passing, `npm run typecheck` clean) before any Phase 4
    code was touched.
  - SDD progress ledger (per-task commit ranges, review status as tasks
    complete) lives at
    `.worktrees/phase4-ui-redesign/.superpowers/sdd/progress.md` — check
    that file first when resuming; it's the source of truth for which of
    the plan's 13 tasks are actually done, not this log.

  **Exact resume point:** nothing has been implemented yet. Task 1's brief
  was extracted to
  `.worktrees/phase4-ui-redesign/.superpowers/sdd/task-1-brief.md`, and the
  pre-Task-1 commit was recorded as `2537cd57dab82098b24b7c923050f81b9d993965`
  — but no implementer subagent has been dispatched. To resume: `cd` into
  the worktree, follow `docs/superpowers/plans/2026-07-19-phase4-ui-redesign.md`
  task-by-task via `superpowers:subagent-driven-development` starting at
  Task 1, checking the SDD ledger above first in case a later session made
  progress this log doesn't know about.

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

- **2026-07-20** — Phase 4.5 complete: a shared `AmbientOrbs` component wired
  into the chat screen (visible under the Iris Glass theme), Iris Glass
  promoted to the default theme for new users, the loading/handshake screen
  now always renders in Iris Glass style regardless of the selected theme
  (previously always Apple-styled), a floating `Settings` modal (gear icon in
  the chat screen's title bar, replacing the old always-on floating theme
  switcher) with theme switcher, room/safety-number info, a "leave chat"
  action, and about/security copy, plus `render.yaml` + README deployment
  docs for Vercel hosting. Verified end-to-end using the same scratch
  Playwright pattern as Phase 4 (no browser-automation tool available in this
  environment): a real two-browser-context paired session (fresh
  `localStorage` on both sides, confirming Iris Glass is the new-user
  default — 2 ambient orbs and `data-theme="iris"` on first load), Settings
  modal opened/closed (Escape) with room code, safety number, and "Connected"
  status all present, theme switcher exercised (Apple → Iris Glass) from
  inside Settings, and "Leave chat" verified both sides (initiator returns to
  the start screen, peer sees a disconnect) — zero console/page errors
  throughout. Also a cold `?screen=loading` page load in a fresh browser
  context (no prior paint to warm the `Schibsted Grotesk` web font) screenshotted
  and visually confirmed: "Trojan Troy." wordmark fully readable with no
  clipped letters, both ambient orbs visible, dark-gradient/periwinkle Iris
  Glass styling — confirmed this holds even with `localStorage`'s theme key
  explicitly set to `"apple"` beforehand (same visual result, proving the
  loading screen is genuinely theme-independent rather than defaulting to
  iris by coincidence). One gap found in the plan's verification script during this
  pass (not a product bug): it waited for `.chat-screen` right after the
  handshake screen, but the app has an explicit `SafetyNumberScreen` with a
  "Verified" button between handshake and chat that's a local-only gesture on
  each side (not synchronized with the peer) — the script needed an added
  click on "Verified" on both pages before chat screen assertions would ever
  resolve. Also bumped the loading-screenshot script's settle wait from the
  plan's 500ms to 2500ms: `CipherWord`'s reel animation for "Troy" doesn't
  finish until roughly 1.82s (`startDelayS` 0.68s + 3-letter stagger 0.24s +
  0.9s animation), so 500ms was catching the wordmark mid-scramble, not a
  rendering bug. See
  `docs/superpowers/plans/2026-07-19-phase4.5-working-prototype.md` and
  `.worktrees/phase4.5-working-prototype/.superpowers/sdd/` for the per-task
  ledger and this task's full verification report.

- **2026-07-20** — Continuous handshake-to-chat transition kicked off (superseded by the "complete" entry below — kept for historical resume-point record). Not a
  scheduled roadmap phase — a user-requested polish item (make the loading
  screen smoothly carry into the safety-number and chat screens instead of
  hard-cutting between them, with the ambient orb backdrop persisting the
  whole way through instead of resetting per screen). Went through the full
  `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:subagent-driven-development` cycle:
  - Spec: `docs/superpowers/specs/2026-07-20-handshake-chat-transition-design.md`.
  - Plan (8 tasks): `docs/superpowers/plans/2026-07-20-handshake-chat-transition.md`.
  - Branch/worktree: `handshake-chat-transition`, worktree at
    `.worktrees/handshake-chat-transition/` (this repo's convention). Client
    deps installed there; baseline verified clean (35/35 tests, typecheck
    clean) before Task 1.

  **Exact resume point (session ran out of usage mid-Task-6):** Tasks 1-5 are
  complete, implemented, and reviewed clean (Approved) — commits `ecb96cb`
  (crossfade state logic), `e84eb7c` (Crossfade component), `4db0048`
  (HandshakeJourney wrapper), `1b6588d` (loading screen orbs/bg moved to the
  wrapper), `47be198` (chat screen orbs/bg moved to the wrapper), all pushed
  to `origin/handshake-chat-transition`. **Task 6's code is also already
  committed** (`d559f1e`, "Style safety-number screen for the dark
  backdrop") and verified byte-for-byte identical to
  `.worktrees/handshake-chat-transition/.superpowers/sdd/task-6-brief.md`'s
  specified code — but it was never reviewed: the controller session was
  interrupted (out of usage) right as the Task 6 implementer subagent was
  dispatched, so no `task-6-report.md` exists and no task-reviewer subagent
  ran. **Do not re-implement Task 6** — the code is correct and already on
  the branch. To resume: follow `superpowers:subagent-driven-development`
  starting from generating the review package for Task 6
  (`scripts/review-package 47be198065c69e004e61251e9e7fcb9d2ee05fe7 HEAD`
  from the worktree) and dispatching a task reviewer against
  `task-6-brief.md` + that diff (note to the reviewer that no implementer
  report exists — the diff is tiny, 2 files/8 lines, reviewable without
  one). Then continue with Tasks 7 (wire `HandshakeJourney` into `App.tsx`)
  and 8 (manual Playwright verification) exactly as planned, followed by the
  final whole-branch review and `superpowers:finishing-a-development-branch`
  to merge to `main` — per this project's judge-visibility convention,
  merge promptly once the branch review is clean rather than leaving it
  open. The per-task progress ledger at
  `.worktrees/handshake-chat-transition/.superpowers/sdd/progress.md` is the
  authoritative source of truth for exactly which tasks are done/reviewed —
  check it (and `git log` on the branch) before trusting this summary if
  time has passed. `main` itself is untouched throughout (still at the
  "Plan continuous handshake-to-chat transition" commit) — all of this work
  is isolated on the `handshake-chat-transition` branch/worktree.

- **2026-07-20** — Continuous handshake-to-chat transition complete: a
  `crossfadeState.ts` pure state module (unit-tested), a generic `Crossfade`
  component built on it, and a `HandshakeJourney` wrapper that owns one
  `<AmbientOrbs />` for the lifetime of the `handshake` → `safety-number` →
  `chat` journey and cross-fades each screen's foreground content into the
  next (350ms, opacity + `translateY(8px)`). `LoadingScreen` and `ChatScreen`
  no longer render their own orbs/background (moved up to
  `HandshakeJourney`); `SafetyNumberScreen` got a small CSS file for
  legible text against the shared dark backdrop, with its markup/copy/button
  unchanged. `App.tsx`'s `Screen` union and state-transition logic
  (`handleStart`/`handleJoin`/`exchangeKeys`/etc.) are untouched — only the
  render layer changes, now wrapping the three screen states (plus both dev
  `?screen=` overrides) in one `HandshakeJourney` instead of three separate
  early returns. Verified end-to-end with the same scratch-Playwright
  pattern used for Phase 4/4.5 (no browser-automation tool available in this
  environment): a real two-browser-context paired session confirmed zero
  console/page errors, the ambient orbs animating throughout the
  handshake/safety-number screens (`animation-duration: 9s`, matching
  `AmbientOrbs.css`), orbs still visible (`display: block`) once chat
  renders under the Iris Glass default theme (the "never resets" goal), and
  orbs correctly hidden (`display: none`) once chat renders under the Apple
  theme (the accepted discontinuity case from the spec — Apple's opaque chat
  background covers the exiting layer, so no visual glitch, just no orb
  continuity). Screenshots taken mid cross-fade (~180ms into the 350ms
  transition) for both themes visually confirm real overlapping content
  during the transition, not a hard cut. See
  `docs/superpowers/specs/2026-07-20-handshake-chat-transition-design.md`
  and `docs/superpowers/plans/2026-07-20-handshake-chat-transition.md`.

- **2026-07-20** — Chat polish complete: themed bubble entrance animations
  (Apple: snappy scale+shadow pop; Iris Glass: soft blur/drift resolve plus
  a one-shot glassy sheen sweep; Pulse Slate: bounce-overshoot plus an
  accent glow flash — all pure CSS, reusing existing keyframes like
  `sheen`/`checkPop` where possible), a staggered entrance for rapid-fire
  message bursts, a send micro-interaction on the composer, and
  WhatsApp-style delivered/read receipts with a Ghost Mode privacy setting.
  Protocol: each sent message now carries a cleartext `messageId`
  (correlation only, not content — see `decisions.md`), the receiving
  client acks `delivered` immediately on successful decrypt and `read`
  only once its tab is actually focused/visible, and status only ever
  advances forward (sent → delivered → read). Only the sender's most
  recent own message shows a tick (1 grey check / 2 grey / 2 blue). Ghost
  Mode (Settings → Privacy, persisted in `localStorage`, default off)
  suppresses the read ack only — delivered is unaffected. Built via
  `superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:subagent-driven-development`, 9 tasks, all reviewed clean
  (two Important findings surfaced and resolved: a duplicated
  `STATUS_TICKS` constant across two components, accepted as-is with Jay's
  sign-off as a candidate for the upcoming Phase 4.7 code review rather
  than fixed now; and a composer timer with no unmount cleanup, fixed to
  match the existing `Crossfade.tsx` pattern). Verified end-to-end with the
  same scratch-Playwright pattern used for every prior phase: per-theme dev
  preview confirmed the right animation name and a single visible tick per
  theme with zero console errors, then a real two-browser paired session
  confirmed the delivered→read progression (tick stays grey-double until
  the peer's tab is focused, then flips blue) and that Ghost Mode keeps it
  frozen on delivered even after the peer focuses. Two script-only bugs
  were found and fixed during this pass (not product bugs): the toggle
  switch's deliberately overlapping visible track over an invisible
  checkbox tripped Playwright's default actionability check (fixed with a
  forced click on the actual input), and a race checking the checkbox's
  state immediately after clicking, before React's re-render committed
  (fixed by waiting on the DOM condition instead of assuming the click
  action's own promise resolving meant the state had already updated). See
  `docs/superpowers/specs/2026-07-20-chat-polish-design.md` and
  `docs/superpowers/plans/2026-07-20-chat-polish.md`.

- **2026-07-21** — Waiting-room redesign (part of Phase 4.6, `WaitingScreen`
  only). Rebuilt the previously-unstyled waiting screen to the approved
  "Radar / Signal" concept, matching the loading screen's Iris Glass world:
  its own fixed gradient shell + the shared `AmbientOrbs`, concentric radar
  rings (new `radarPing` keyframe) around the room code in large JetBrains
  Mono with a periwinkle glow, a pulsing "waiting for your friend…" line, and
  a dim security marquee + accent hairline, with staggered rise-in entrances
  on the signature easing. Net-new features wired in: **copy code** and **copy
  invite link** pill buttons (each flips to a green "Copied ✓" for ~1.5s),
  a pure/tested `net/inviteLink.ts` (`buildInviteLink` / `parseInviteCode`,
  8 unit tests) whose link is built from `window.location` so it works on both
  localhost and the deployed URL; opening that link **prefills the join code**
  into `StartJoinScreen` (new `initialCode` prop, focus+select) rather than
  auto-joining, with the hash cleared afterward; an on-theme **QR code**
  (`qrcode.react`) encoding the same link inside a frosted "SCAN TO JOIN"
  card; and a **Cancel** button that tears the room down via `handleLeave`.
  Also extracted the security ticker text into a shared `securityTicker.ts`
  (used by both loading and waiting screens) and added a `?screen=waiting`
  dev override for previewing. Verified: `npm run typecheck` clean, 65 vitest
  tests pass (9 new — 8 for `inviteLink`, 1 for the `waiting` override),
  `npm run build` green, and a dev-server smoke test (all new modules and the
  `qrcode.react` dep transform/resolve with HTTP 200). Radar/QR pixels still
  want a manual eyeball via `?screen=waiting` (no browser-automation tool in
  this environment, as in prior phases). Built on branch
  `feat/waiting-room-redesign` off `main` (does **not** include the in-flight
  `fix/security-review-findings` commit). Phase 4.6's `StartJoinScreen` and
  `SafetyNumberScreen` styling remain open. See `decisions.md` (2026-07-21).

- **2026-07-21** — Home-screen redesign (part of Phase 4.6, `StartJoinScreen` +
  the new connecting bar). Rebuilt the previously-unstyled home/entry screen to
  the Fable handoff (`ui/Trojan Troy Home Screen/Trojan Troy Home.dc.html`; the
  implemented React screens are the design's source of truth), matching the
  Iris-Glass world: own fixed gradient shell + shared
  `AmbientOrbs`, top-left "secure channel ready" badge, centered `Trojan Troy.`
  wordmark + tagline, a frosted action card (Start button → "or join" divider →
  room-code input + Join), a bottom security marquee (shared
  `SECURITY_TICKER_TEXT`) and accent hairline, with staggered rise-in entrances
  on the signature easing. The **connecting / waking-the-relay bar** (grassy
  green `#6FBF78→#7BC97F→#A6E0A0`) is new: phase-driven (surge → hold → complete
  → settle → exit) via CSS width transitions, with sheen + breathing-glow
  "alive" layers kept separate from the fill % so a ~60s cold start never looks
  frozen, plus a `prefers-reduced-motion` fallback. It's driven by the real
  connection event — `App` passes a `connectStatus` prop
  (`idle|connecting|connected`) down, flips it on tap and on `created`
  (Start) / `peer-connected` (Join), and holds a beat
  (`CONNECT_COMPLETE_HOLD_MS`) at 100% before transitioning; the error path
  resets it so the bar never hangs. Pure phase→visual logic + timings factored
  into a tested `barPhases.ts` (8 tests). Added a `?screen=connecting` dev
  override (replacing the handoff's demo relay/warm/cold preview controls,
  which were dropped as non-product UI) to eyeball the alive state without a
  relay. Preserves the invite-link `initialCode` prefill/focus/select. Verified:
  `npm run typecheck` clean, 74 vitest tests pass (8 new for `barPhases`, 1 for
  the `connecting` override), `npm run build` green, and a dev-server smoke test
  (home page + all new modules serve HTTP 200, grassy-green fill present).
  Layout/bar motion + the ~60s cold-start hold still want a manual eyeball via
  `npm run dev` (`/` and `?screen=connecting`) — no browser-automation tool in
  this environment, as in prior phases. Built on branch
  `feat/home-screen-redesign` off `main`. Phase 4.6's `SafetyNumberScreen`
  styling remains open. See `decisions.md` (2026-07-21).

- **2026-07-22** — Decrypt-reveal redesign (unscheduled, user-requested polish).
  Replaced the incoming-message per-character scramble (`CipherText` /
  `cipherReveal`) with a width-driven "focus sweep" (`DecryptReveal`): the message
  arrives blurred + dim and a glowing `--accent`-colored edge sweeps left→right
  bringing it into sharp focus, as one fixed-duration (560ms) CSS timeline masked
  across the bubble width. Fixes the four things that made the scramble read as a
  bug — horizontal glyph wobble (proportional font), flicker trailing past the
  bubble entrance, a scramble alphabet that never matched real text, and the
  short-message case ("hi" had nothing to sweep). Real glyphs throughout → no
  wobble, no reflow, and more accessible (no rAF loop; the sharp text is present
  from the first frame). Gate unchanged: incoming-only, Iris/Pulse-only, once per
  message id, Apple instant, reduced-motion shows text immediately; the old
  per-bubble `bubbleDecryptGlow` bloom was removed (the sweep edge replaces it).
  Retired `cipherReveal.ts` + its test (no per-char timing logic left to
  unit-test); `npm run typecheck` clean, 75/75 client vitest tests pass,
  `npm run build` green. No browser-automation tool in this environment (as in
  every prior visual phase), so the sweep's pixels still want a manual eyeball via
  `npm run dev` → `?screen=chat` (toggle Iris/Pulse) before merge. Built on branch
  `feat/decrypt-focus-sweep` off `main` (rebased clean onto `main` after it was
  initially branched on top of the unrelated typing-presence spec). See
  `decisions.md` (2026-07-22).

- **2026-07-22** — Peer presence indicator (typing + voice recording)
  brainstormed with Jay and spec'd. Not a scheduled phase — the Phase 5
  backlog "peer is typing" item, pulled forward as a small self-contained
  feature. Designed as an *encrypted* presence signal: a new client-only
  `presence` envelope carrying a `secretbox`-sealed `{state}` (the relay
  forwards it opaquely, no server change), an Instagram-style three-dot bubble
  reskinned per theme (periwinkle glass beads + the currently-unused
  `glowPulse` keyframe on Iris/Pulse, flat grey on Apple), gated behind an
  expanded Ghost Mode ("don't broadcast my activity"). Heartbeat-send +
  receiver auto-expiry, with the timing logic destined for a tested
  `protocol/presenceState.ts` (matching `messageStatus.ts`/`readAckDecision.ts`).
  Spec: `docs/superpowers/specs/2026-07-22-typing-presence-design.md`;
  rationale + delegated calls in `decisions.md` (2026-07-22); `roadmap.md`
  backlog note corrected (client-only, not a protocol change). Then implemented
  on branch `feat/typing-presence-indicator` off `main`: the `presence` envelope
  (`relayClient.ts`), a pure `protocol/presenceState.ts` (heartbeat-send decision
  + defensive state parse, 9 unit tests), a themed `PresenceIndicator` component
  (reuses the existing `typingDot`/`glowPulse` keyframes; SVG mic for the
  recording variant; light fade-out for the hand-off to the arriving message),
  and wiring through `Composer`/`VoiceRecorder`/`ChatScreen`/`App`.
  `encryptMessage`/`decryptMessage` reused for the sealed `{state}` payload — no
  new crypto primitive, no server change. Verified: `npm run typecheck` clean, 92
  vitest tests pass (9 new for `presenceState`), `npm run build` green. Visual
  eyeball (dev `?screen=chat` renders the indicator) + a live two-browser
  round-trip still want a manual look — no browser-automation tool in this
  environment, as in prior phases.

- **2026-07-22** — Seal-slider spark effect (unscheduled, user-requested
  polish, not a roadmap phase) — **merged to `main`**. The safety-number
  screen's "drag to seal" slider now throws rainbow embers off the knob as you
  drag right — intensifying with drag speed and progress — and bursts a radial
  shower on seal. Built as a canvas overlay (`components/SealSparks.tsx` +
  `.css`) mounted over `.confirm-key__seal`, with the pure emission-count +
  trail-color sampling in a tested `screens/sparkModel.ts` (11 new unit tests);
  `SafetyNumberScreen` gained pointer-velocity tracking on drag, a keyboard puff
  impulse, and a reduced-motion static knob glow. Rainbow-ember hue is sampled
  from the same trail gradient the track paints, so sparks look flung off the
  rail. No new dependency, no crypto/relay/server change. Verified on the merged
  tree: `npm run typecheck` clean, 95 vitest tests pass (11 new), `npm run build`
  green (102 modules). The live ember motion + seal burst still want a manual
  eyeball on the deployed site (or `npm run dev` → `?screen=safety`) — no
  browser-automation tool in this environment, as in every prior visual phase.
  Design: `docs/superpowers/specs/2026-07-22-seal-slider-sparks-design.md`;
  rationale + implementation calls in `decisions.md` (2026-07-22).

- **2026-07-22** — Contacts privacy settings (extension to Phase 5.1)
  brainstormed with Jay and spec'd. Design-ahead, same as the presence
  indicator — build stays gated under Phase 5.1 (and Phase 5's 4.6/4.7
  prerequisites); nothing built yet. Jay wanted a contact feature "similar to
  crypto" (a public-key/address-book model, which 5.1's identity-key contacts
  list already is) with more privacy controls, and chose three to design on top
  of 5.1: per-contact **pseudonyms** (cosmetic — one identity key; choose the
  name/none each contact sees + local-only labels), **contacts-only mode + block
  list** (opt-in), and **at-rest encryption** of the identity/contacts store
  (PIN + idle re-lock, `crypto_pwhash` + the existing `crypto_secretbox`, no new
  primitive). Recognition simplified to key-based only (5.1's name-based
  key-changed warning dropped; the `identity` envelope name is now optional). No
  server change. Spec:
  `docs/superpowers/specs/2026-07-22-contacts-privacy-design.md`; headline
  directions + delegated implementation calls in `decisions.md` (2026-07-22);
  `roadmap.md` gains a 5.1a note.

- **2026-07-22** — Local Profiles (Layer A) built — replaces the retired
  persistent-identity direction (see `decisions.md`). After the
  persistent-identity + PIN/contacts work was rolled back off `main` (`1ee0e35`),
  built device-local, PIN-gated profiles on `feat/profiles`: pure
  `profiles/pin.ts` (4-digit validate + salted hash) and
  `profiles/profileModel.ts` (Anonymous default + active-profile resolution), an
  IndexedDB `profileStore.ts` (+ `fake-indexeddb` for tests), the bundled default
  avatar (the taiyaki-hat cat) + a downscale util, a `ProfileButton` on the home
  screen, a Settings-style `ProfileModal` (create / select-with-PIN / delete with
  a soft-red cube confirm), and opt-in *encrypted* name/photo sharing (a new
  relay-forwarded `profile` envelope, a Settings toggle default off, peer card in
  the chat header). Session crypto unchanged; no server change. Added a
  `?screen=profiles` dev override. Verified: `npm run typecheck` clean, 108
  vitest tests pass (13 new), `npm run build` green (default-avatar bundled). Per-
  profile conversation history is Layer B (a separate plan). Manual eyeball
  (`?screen=profiles`) + a live two-browser sharing round-trip still pending — no
  browser-automation tool in this environment, as in every prior visual phase.
  Spec: `docs/superpowers/specs/2026-07-22-local-profiles-design.md`; plan:
  `docs/superpowers/plans/2026-07-22-local-profiles.md`.

- **2026-07-22** — Profile avatars on messages + click-to-open profile card
  (extends Local Profiles; user-requested). Hybrid Discord style — kept the
  themed bubbles, added a small avatar beside each message (peer's on incoming,
  yours on outgoing), shown on the last message of a consecutive run (tested
  `components/messageGrouping.ts`). Clicking an avatar opens a `ProfileCard`
  popover (name + larger picture + "on computer/phone"). Device is a best-effort
  heuristic (`profiles/device.ts`, tested) added to the existing *encrypted*
  `profile` card payload — relay-blind, opt-in via the same sharing toggle. Not
  shared → the message avatars/card fall back to the default cat + "Anonymous".
  Refactored the message row to `[avatar][stack]` (`MessageBubble` /
  `VoiceMessageBubble`), all themes. Verified: typecheck clean, 114 vitest tests
  (6 new), build green. Manual eyeball (`?screen=chat`, and a live two-browser
  round-trip with sharing on) still pending — no browser-automation tool here.
  Built on `feat/profiles`.

- **2026-07-22** — Error screen shipped to `main`/production (unscheduled — it
  had already been built, but was stranded). A themed `ErrorScreen` with six
  scenarios (friend left, handshake failed, relay unreachable, bad room code,
  room full, generic), a `?screen=error&scenario=…` dev preview, and the
  `App.tsx` wiring that replaces the old bare `<h1>Something went wrong</h1>`
  placeholder on every error path — plus the `ui/Trojan Troy - Error Screen.html`
  design file. It had been implemented earlier (commit `cf92d00`) on branch
  `feat/error-screen`, which was stacked on top of the persistent-identity/PIN
  work — the direction retired in favor of Local Profiles and rolled back off
  `main` (`1ee0e35`, see `decisions.md`). So it was never merged, and merging
  that branch as-is would have re-shipped the rolled-back PIN work. Since the
  screen has no real dependency on the identity code, it was extracted:
  cherry-picked just `cf92d00` onto a clean branch off `main` (applied with zero
  conflicts — `screenOverride.ts` was byte-identical to its base and `App.tsx`
  still had every context line the patch expected, because the identity wiring
  lived elsewhere in the file), verified (`npm run typecheck` clean, 104 client
  vitest tests pass, `npm run build` green), and fast-forward merged to `main`
  (`275d834`) + pushed for the Vercel redeploy. The Local Profiles work later
  landed on top (`42aadcb`) with the error screen still wired and intact. The six
  error states' visuals still want a manual eyeball on the deploy (or
  `npm run dev` → `?screen=error&scenario=…`) — no browser-automation tool in
  this environment, as in every prior visual phase. See `decisions.md`
  (2026-07-22).

- **2026-07-22** — Phase 5.2 (forward-secrecy ratchet) build STARTED on branch
  `feat/forward-secrecy-ratchet` off `main` (`8d8f1a2`); paused mid-plan with the
  crypto foundation done and green. This is the "turn up the backend security"
  work Jay green-lit: a Signal-style **Double Ratchet** (a fresh key per message →
  forward secrecy + post-compromise self-healing) riding on the existing ephemeral
  `crypto_kx` handshake (no persistent identity), plus sealed framing
  (channel/`messageId`/`mimeType` moved inside the ciphertext) and size-bucket
  padding, collapsing the content/signal envelopes into one opaque `msg`. Invisible
  to the user — bytes on the wire only. Built with libsodium only (no new
  dependency, no `-sumo`). Spec:
  `docs/superpowers/specs/2026-07-22-phase5.2-forward-secrecy-ratchet-design.md`;
  plan: `docs/superpowers/plans/2026-07-22-phase5.2-forward-secrecy-ratchet.md`
  (its **BUILD STATUS banner** at the top is the authoritative done/todo ledger);
  rationale in `decisions.md` (2026-07-22, top entry).

  **Done, committed, green (full client suite 150/150):**
  - Task 0 — roadmap/decisions reordering logged (`ad01fc7`).
  - Task 1 — `crypto/aead.ts`: XChaCha20-Poly1305 AEAD wrapper with associated
    data, `nonce||ct` base64 (5 tests) (`41d1a4d`).
  - Task 2 — `crypto/kdf.ts`: `deriveRootKey` (RK0 from the sorted crypto_kx
    session keys), `kdfRoot`, `kdfChain`, `deriveChannelSubkey` — all keyed
    BLAKE2b (6 tests) (`1cfb964`).
  - Task 3 — `crypto/framing.ts`: frame/unframe + one unified pad schedule
    `[64,256,1024,4096,16384]` then 16 KiB steps (a refinement over the spec's
    two-schedule idea — avoids a profile-avatar overflow) (7 tests) (`adb94ed`).
  - Task 4 — `crypto/ratchet.ts`: the Double Ratchet core (init{Alice,Bob},
    ratchetEncrypt/Decrypt, DH ratchet, skipped-key handling — MAX_SKIP=100,
    global cap 1000). `ratchetDecrypt` is **transactional** (clones state, commits
    only on successful decrypt) so a tampered/replayed packet can't corrupt the
    session. 9 tests: in-order, out-of-order within a chain and across a DH step,
    replay-drop, skip cap, header tamper, reflection (`128a87e`).

  **Resume at Task 5** (`net/relayClient.ts` Envelope collapse into the unified
  `msg` + new `protocol/ratchetSession.ts`), then Task 6 (`App.tsx` wiring: seed
  the ratchet in `exchangeKeys`, send/receive via `ratchetSession`, static
  per-channel subkeys for presence/ack/profile, the H2 re-key guard, zeroize on
  leave), Task 7 (docs + honest security copy), and the independent Track B (relay
  DoS/lifecycle hardening on its own branch `fix/relay-dos-limits`).

  **Scouted gotcha for Task 5:** `client/src/net/relayClient.test.ts` hard-codes the
  OLD envelope shapes in three cases ("includes messageId when sending a ciphertext
  envelope", "passes through delivered and read acks", "passes a profile card
  envelope through") — they must be rewritten to the unified `msg` envelope in the
  same task or the suite breaks. `crypto/messages.ts`/`media.ts`/`secretbox.ts` stay
  (tests still pass; unused by the live path after Task 6, kept for Layer-B). And
  `npm run typecheck` will be RED between Task 5 and the end of Task 6 (App.tsx still
  references the removed envelope types until rewired) — normal mid-phase; vitest
  still runs per-file. No live two-browser round-trip yet (that's Task 6's manual
  acceptance) — no browser-automation tool in this environment, as in every prior
  phase.

- **2026-07-23** — Phase 5.2 **Task 5 done** (`63a4b08`, pushed): the wire format +
  session binding. `net/relayClient.ts`'s `Envelope` union now collapses the
  post-handshake `ciphertext`/`voice`/`presence`/`profile`/`delivered`/`read` types
  into one opaque `{ type:"msg", c, header?, payload }` (`c`: 0=content, 1=presence,
  2=ack, 3=profile), adds `v` to `pubkey` + exports `PROTOCOL_VERSION = 2`, and
  re-exports `RatchetHeader`. New `protocol/ratchetSession.ts` binds the ratchet +
  static directional subkeys to a session: `initSession` (initiator → `initAlice`
  against the peer's handshake key; responder → `initBob` reusing his own handshake
  keypair), `sealContent` (ratcheted, `c:0`), `sealStatic` (presence/ack/profile,
  sealed under a per-channel subkey with the channel name as AAD), `openMsg` (decrypt
  + `unframe`; throws so the caller drops — the ratchet's transactional decrypt keeps
  the live session intact on a bad packet). 6 new `ratchetSession` tests (content /
  voice / each static channel round-trips; content-relabeled-as-static dropped;
  presence-relabeled-as-ack dropped; corrupt payload dropped with the session still
  usable) + the 3 stale `relayClient` tests rewritten to `msg`. Full suite **156/156**;
  `npm run typecheck` intentionally RED on **`App.tsx` only** (still on the old
  envelope types) until Task 6 — vitest green. **Resume at Task 6** (`App.tsx` wiring:
  seed the session in `exchangeKeys`, route send/receive through `ratchetSession`,
  static subkeys for presence/ack/profile, the H2 re-key guard, zeroize on leave).
  **Flag for Task 6:** by the Double Ratchet's design the responder has *no sending
  chain until he receives the initiator's first content message* — so a joiner who
  sends the very first text before receiving anything hits "no sending chain yet."
  Confirm the two-browser acceptance sends initiator-first, or handle the
  send-before-receive case explicitly.

- **2026-07-23** — Phase 5.2 **Task 6 done** (`4c8e37e`): the ratchet is live in the
  app. `App.tsx` now seeds a `SessionCrypto` (`initSession`) in `exchangeKeys` right
  after `deriveSessionKeys` (safety number path unchanged), sends/receives all content
  through `sealContent`/`openMsg` (fresh key per message), and routes presence / ack /
  profile through `sealStatic` static subkeys. The six per-type receive branches
  collapse into one `msg` handler that decrypts, then switches on the sealed channel.
  Receipts are now sealed on the "ack" channel (unforgeable; no longer a
  decrypt-success oracle — closes M6); `pubkey` carries `PROTOCOL_VERSION` and a
  mismatch → error screen; a second `pubkey` → error screen (H2 guard — never
  re-seeds a live session); ratchet secrets + channel subkeys are `sodium.memzero`'d
  on leave (L3/B13). **Host-primer** (the send-before-receive fix): the initiator sends
  a hidden `primer` content message right after keys are established, so the responder
  gains a sending chain and *either* side can type first (a new `"primer"` channel in
  `framing.ts`, decrypted then dropped by the UI). Belt-and-suspenders: the responder
  also buffers outgoing content in an `outboxRef` until a content receive establishes
  its chain, then flushes automatically — covers a slow/cold-start relay. Verified:
  `npm run typecheck` clean, 156/156 vitest, `npm run build` green, and a throwaway
  real-module protocol test (written, run, deleted) confirmed the primer lets the guest
  send first, replays drop with no duplicate, cross-class relabels + forged acks drop,
  and voice bytes + mimeType survive a JSON wire round-trip. **Still pending:** the
  manual two-browser acceptance (no browser-automation tool here, as every prior phase)
  and Task 7 (honest about/security copy). `crypto/messages.ts` / `media.ts` /
  `secretbox.ts` are now unused by the live path (kept for possible Layer-B history).

- **2026-07-23** — Phase 5.2 ratchet track **shipped to `main`** (`683d3a3`,
  fast-forward) + **Task 7** (honest security copy). After a two-browser smoke test
  confirmed messages flow normally and — the key primer case — the joiner can send the
  first message, the branch fast-forward-merged to `main` (Jay's call: merge now, copy
  as an immediate follow-up). Task 7 updated the Settings → About blurb to state forward
  secrecy honestly ("every message gets its own key, discarded right after… a stolen key
  can't unlock past messages, and the connection re-secures itself after a compromise")
  while keeping the residual honest ("the relay can still tell that you're chatting and
  roughly how much, but never what's said") — no overselling. roadmap 5.2 checked. What
  shipped: per-message forward secrecy + post-compromise self-healing, sealed framing
  (channel/id/mimeType inside the ciphertext), size-bucket padding, one opaque `msg`
  envelope, sealed unforgeable receipts, an H2 re-key guard, `PROTOCOL_VERSION`
  negotiation, and zeroize-on-leave — closing review findings H4, M2, M6, L4, H2 and
  partially B12, all with no server change. **Remaining for the 5.2 cluster:** Track B
  (relay DoS/lifecycle hardening — H3/M1/M5/L5 — on its own branch `fix/relay-dos-limits`,
  no crypto), and a fuller manual eyeball of voice + receipts + presence + profile
  sharing (text + joiner-first were confirmed; no browser-automation tool here).

- **2026-07-23** — Phase 5.2 **Track B (relay DoS/lifecycle hardening) built** on
  `fix/relay-dos-limits` off `main` — server-only, no crypto, no wire change,
  closing review H3/M1/M5/L5 and finishing the 5.2 cluster. Three commits:
  **B1** (`bd97d6f`) `maxPayload` (2 MiB) + a per-connection token-bucket
  message-rate throttle (closes the socket on breach) + per-IP (30) and global
  (1000) connection caps + a global active-room cap (5000, via a new
  `RoomManager.atRoomCapacity()` pre-check); **B2** (`42e1388`) an `isAlive`
  ping/pong heartbeat sweep (30s; terminates a socket that misses a pong) + an
  env-configurable origin allowlist (`ALLOWED_ORIGINS`) via `verifyClient` that
  *fails open* when unset (localhost always allowed, one-time startup warning) so
  it can't accidentally lock out prod; **B3** (`a2efcf9`) one-room-per-peer (a
  second `create`/`join` calls the existing `disconnect(peer)` first — clears the
  stale TTL timer, notifies a real partner), self-join rejection, `create`/`join`
  shape validation with a room-code format check (`isValidRoomCode`) replying
  `error` — while the unknown-type pass-through (`pubkey`, the opaque `msg`) stays
  forwarded verbatim — and a tighter dedicated join-attempt bucket (10 / 1-per-sec)
  against blind enumeration. All limits are code constants overridable via a new
  `startRelay` options arg (tests inject tiny values). Verified: `server` **30/30**
  vitest (oversized→1009, flood→1008, per-IP/global cap→1013, dead-socket reaping,
  origin reject/allow/localhost, double-create drops the orphan, self-join
  rejected, malformed join→error while the opaque `msg` still forwards), `npm run
  build` (tsc) clean, and a manual boot of both dev servers + a throwaway
  two-client protocol probe (deleted) that forwarded a 1.78 MiB voice-sized
  envelope and saw a 3 MiB frame rejected with close 1009 — confirming 2 MiB isn't
  too tight for a 60s voice message. A real browser text+voice eyeball through the
  hardened relay still wants a human (no browser-automation tool here, as every
  prior phase). Refuted finding §C.2 left alone (no try/catch around `peer.send()`).
  **Not yet merged** — a fast-forward merge redeploys the relay to Render
  (production), so it waits on Jay's go-ahead. See `decisions.md` (2026-07-23).

- **2026-07-23** — Post-quantum hardening ①+② built on `feat/pq-hybrid-handshake`
  (first of the four-spec backend-only security round — see `decisions.md` 2026-07-23
  and the specs/plan dated 2026-07-23). The session-key agreement is now **hybrid
  post-quantum**: alongside the existing ephemeral `crypto_kx` (X25519), the responder
  publishes an **ML-KEM-768** public key (`@noble/post-quantum` — the first crypto
  dependency beyond libsodium), the initiator encapsulates and returns a `kemct`, and
  both shared secrets are folded into the Double Ratchet's initial root key `RK₀` via a
  two-step keyed-BLAKE2b combiner (`deriveRootKey`, domain `v3`) — so a session is safe
  unless BOTH X25519 and ML-KEM break (defeats "harvest now, decrypt later"). The
  handshake became role-asymmetric (responder = KEM holder/decapsulator, initiator =
  encapsulator), **fails closed** if the KEM material is stripped (no classical
  fallback), bumps `PROTOCOL_VERSION` 2→3, buffers inbound `msg` until `RK₀` exists (the
  primer/profile card can race the responder's seed), and extends the H2 guard to the
  KEM leg. ② the **safety number now binds `RK₀`** (a one-way commitment) + domain tags,
  so a key swap or a PQ downgrade changes the digits (closes review L2); zeroize covers
  the root key. No server change — the KEM fields ride the relay's opaque pass-through.
  Honest about/security copy updated (hybrid PQ protects the key agreement / recorded
  traffic; deliberately **not** claimed "fully post-quantum" — the ongoing ratchet DH
  stays classical, a documented residual in the spec). Verified: `npm run typecheck`
  clean, **163** client tests (7 new: pqkem ×4, kdf pq-binding, session root-key
  agreement, safety-number binding), `npm run build` green, and a throwaway real-module
  handshake test (run then deleted) confirmed both sides reach an identical `RK₀` +
  safety number, the primer lets the joiner send first, and a corrupted `kemct` makes
  the primer fail to open. Manual two-browser eyeball still pending (no browser-automation
  tool here, as every prior phase). Remaining in the round: ④ at-rest Argon2id, then ③
  traffic-analysis, plus the optional ultracode adversarial crypto-review pass. Specs:
  `docs/superpowers/specs/2026-07-23-pq-hybrid-handshake-design.md` +
  `…-safety-number-binding-design.md`; plan:
  `docs/superpowers/plans/2026-07-23-pq-hybrid-handshake.md`.

- **2026-07-25** — Traffic-analysis resistance (spec ③) built on
  `feat/traffic-analysis-cover` (5 tasks). The relay now sees a **steady, jittered
  stream of decoy `msg` frames** whether or not anyone is talking, so it can no longer
  read the conversation's rhythm (idle / typing / pausing). A cover frame is a real
  ratcheted `c:0` content message — `frame({ channel: "cover", ... })` → `sealContent`
  — decrypted-then-dropped on receipt exactly like the `"primer"`, so it is
  **byte-indistinguishable** from real text/voice on the wire (same class, ratchet
  header, size buckets) and spins the ratchet for free. Cadence is the **zero-latency
  "minimum frame rate"** model (Jay's no-latency filter): real sends go out immediately
  through one `sendContentFrame` choke point that all three `c:0` send sites route
  through; a background timer emits cover only when the content line has been idle ≥ a
  jittered interval (`COVER_INTERVAL_MS = 1500` ±40%, ~1/sec, `500` ms floor, far under
  Track B's 30/sec cap). The strict constant-rate model is supported by the pure
  `nextAction` `flush-real` branch but left **unwired / opt-in**. The presence heartbeat
  now jitters ±30% (`jitteredHeartbeatMs`, max 3250 ms < 5000 ms expiry, so the online
  dot never flickers off). Files: `crypto/framing.ts` (+`"cover"` channel), new pure
  `protocol/coverTraffic.ts` (`nextAction`/`jitteredInterval`/`coverBodyLen`),
  `protocol/presenceState.ts` (heartbeat jitter), `App.tsx` (cover scheduler + drop
  case + teardown), and honest `Settings.tsx` copy (claims only that rhythm is hidden;
  burst intensity / voice size / session existence remain documented residuals).
  Verified: `npm run typecheck` clean, **189** client tests (11 new: framing cover
  round-trip, coverTraffic ×7, presence jitter/override ×3), `npm run build` green.
  **Two-browser Playwright eyeball (run then deleted): 10/10** — idle emits a steady
  ~1/1.3s cover stream, each frame carrying a ratchet header, **no** stray bubbles on
  either side, a real message goes out within 1s (zero added latency) and shows exactly
  one bubble per side, and the stream stops on leave.
  **Final whole-branch review (opus) found one Important efficacy defect, now fixed:**
  the original `coverBodyLen` put ~70% of cover in the 64-byte bucket, but real `c:0`
  text always lands in ≥256 (its 36-char UUID `id` overflows 64), so a size-aware relay
  could classify the 64-bucket stream as decoy on sight — breaking the
  byte-indistinguishability constraint. Fixed `coverBodyLen` to 256-modal (~80%) /
  1024-tail (~20%), never 64, and updated its test; re-verified live that a real "hi"
  send and idle cover both land at the 256 bucket (identical 396-byte wire payload).
  See `decisions.md` point (7) — a deliberate, verified deviation from the plan text.
  (Note: Playwright browser automation **is** available in this env — drive with
  `page.wait_for_timeout`, not Python `time.sleep`, which blocks event delivery and
  reads stale zeros.) Spec:
  `docs/superpowers/specs/2026-07-23-traffic-analysis-resistance-design.md`; plan:
  `docs/superpowers/plans/2026-07-25-traffic-analysis-cover.md`. Folded into
  `feat/crypto-round-integration` on 2026-07-28 (see that entry).

- **2026-07-25** — At-rest profile encryption (review S1, spec ④) built on
  `feat/at-rest-profile-vault`. The profile PIN now derives a real Argon2id key
  (`crypto_pwhash`) that seals the avatar at rest with `crypto_secretbox`; the old
  fast-hash access check (`crypto_generichash`) is removed with no fallback. Spec:
  `docs/superpowers/specs/2026-07-23-at-rest-encryption-design.md`; plan:
  `docs/superpowers/plans/2026-07-25-at-rest-profile-vault.md`; rationale in
  `decisions.md` (2026-07-25). **All 5 tasks done:**
  - Task 1 (`a084697`) — `libsodium-wrappers` → `-sumo` via a direct import-site swap
    of all ~10 sodium imports (the config-alias approach couldn't typecheck against
    the self-referential sumo `.d.ts`); `crypto_pwhash` now available. Bundle
    negligibly larger (1,606 → 1,608 kB, gzip ~499 kB). Reviewed clean.
  - Task 2 (`fa94c19`) — new `profiles/vault.ts` `sealProfileSecrets`/
    `openProfileSecrets` (`crypto_secretbox` + `TTr-vault-v1` magic sentinel); returns
    `null` on wrong key / tamper / bad-base64 / wrong-magic. 5 tests. Reviewed clean.
  - Task 3 (`df803d7`) — `deriveVaultKey` + `defaultKdfParams` (Argon2id
    INTERACTIVE / ARGON2ID13) added to `pin.ts`; `newSalt` sizes to
    `crypto_pwhash_SALTBYTES`. (Its dedicated task-review was interrupted; folded into
    the whole-branch review instead.)
  - Task 4 (`98cfc1f`) — storage-format split + migration + UI wiring, fast hash
    removed. `StoredProfile` (clear `id`/`name`/`createdAt`/`pinSalt`/`kdf` + opaque
    `cipher`) vs runtime in-memory `Profile` (decrypted `avatar`); new
    `ActiveProfile` union. `profileStore` retyped, migration deletes any legacy record
    lacking `cipher`/`kdf` on load (purging cleartext avatars). `hashPin`/`verifyPin`
    deleted + a guard test asserts no fast-hash export survives. `App.tsx` holds
    `activeProfile` as in-memory state defaulting to Anonymous — **reload reverts to
    Anonymous (Jay's R2 call)**, nothing named without the PIN re-entered.
    `ProfileModal` derives+seals on create, derives+opens on unlock, shows the default
    thumbnail until unlock. `resolveActiveProfile`/`get/setActiveProfileId` removed;
    obsolete `profileModel.test.ts` deleted.
  - Task 5 — this log + `decisions.md`.
  **Verification:** `npm run typecheck` clean, **183** vitest tests green (net −3
  deleted model tests +2 new: store legacy-drop, pin no-fast-hash guard), `npm run
  build` green. A throwaway real-module integration test (written, run, deleted)
  confirmed the module-level flow: create seals the avatar → the stored record holds
  `cipher`/`kdf`/`pinSalt` and **no** cleartext avatar → the correct PIN recovers it →
  a wrong PIN returns `null` → a legacy cleartext record is purged on load. **Then a
  real-browser end-to-end run** (headless-Chromium Playwright script against the live
  dev server, written/run/deleted — the same pattern prior visual phases used) drove
  the actual UI at `/` and confirmed all 17 checks: start Anonymous → open modal →
  create a profile *with an uploaded photo* → active shows the decrypted data-URL
  avatar → **DevTools-equivalent IndexedDB read** shows one record with
  `cipher`/`kdf.alg`/`pinSalt`, **no `avatar` field, and no `data:image` bytes** at
  rest → **reload reverts to Anonymous (R2)** while the profile still lists →
  wrong PIN shows "Wrong PIN — try again" and does not unlock → correct PIN unlocks
  and restores the avatar in memory → zero page/console errors throughout. **Only
  residual for a human:** a live two-browser *peer sharing* round-trip (needs the relay
  running + a second client) — the profile-card wire format is unchanged by this work,
  so it's confirmatory. Folded into `feat/crypto-round-integration` on 2026-07-28
  (see that entry).

- **2026-07-26** — Round-2 crypto hardening kicked off (A/B/D/E green-lit by Jay —
  backend-only, UX-invisible; see `decisions.md` 2026-07-26). **Feature D — hardened
  handshake — built** on `feat/hardened-handshake` off `main`, first in the round
  (handshake-only, lowest risk, and E will re-run it). Two additions, both closing gaps
  the hybrid-PQ handshake left open: (1) **commit-then-reveal** — each side sends a hash
  commitment to its ephemeral key(s) (a new opaque `commit` envelope) and reveals its
  `pubkey` only after receiving the peer's commit, verifying the reveal against it, so
  keys can't be chosen adaptively (ZRTP-style); (2) **transcript binding** — both sides
  fold a canonical hash of the whole transcript (version, both X25519 pubkeys, ML-KEM
  public key + ciphertext) into `RK₀` via a new third `deriveRootKey` step, so any framing
  tamper changes the root key (fails closed) and the safety number. New pure
  `crypto/transcript.ts` (`computeHandshakeCommit` + `computeTranscriptHash`);
  `deriveRootKey`/`initSession` gained a `transcriptHash` arg; kdf + safety-number domains
  bumped v3 → v4; `PROTOCOL_VERSION` 3 → 4; `App.tsx exchangeKeys` restructured to
  commit → reveal → verify → KEM → seed, with the single-shot guards extended to
  `commit`/`pubkey`/`kemct`. **No server change** (the relay forwards `commit` verbatim,
  like `pubkey`/`kemct`/`msg` — confirmed in `server.ts`) and **no new dependency**
  (BLAKE2b). One extra relay round-trip, hidden by the existing ≥2600 ms handshake
  screen — UX identical. Verified: `npm run typecheck` clean, **185** client tests pass
  (7 new: transcript ×5, kdf transcript-binding, ratchetSession per-side-transcript-
  mismatch), `npm run build` green. Spec:
  `docs/superpowers/specs/2026-07-26-hardened-handshake-design.md`; plan:
  `docs/superpowers/plans/2026-07-26-hardened-handshake.md`. Remaining in round 2: A+B
  (PQ ratchet + header encryption, co-designed as one wire revision) then E (periodic
  rekey).

- **2026-07-28** — **Crypto round integration**: the three finished-but-unmerged crypto
  branches folded onto one branch, `feat/crypto-round-integration` (off `main` @
  `4f43a56`), and verified together. Nothing new was designed here — this closes the gap
  where three completed features (D hardened handshake, ③ traffic-analysis cover traffic,
  ④ at-rest Argon2id vault) were each green on their own branch but had never met.
  Merged in order D → ③ → ④; **no code conflicts at all** (git auto-merged even
  `App.tsx`, where D restructured `exchangeKeys` while ③ added the cover scheduler and
  ④ moved the profile state), only the `decisions.md` / `progress.md` ledgers, resolved
  by keeping every entry in date order. Also fixed on the way:
  - **The split-libsodium defect** — ④ swapped all ~10 sodium imports to
    `libsodium-wrappers-sumo` (for Argon2id), but D's *new* `crypto/transcript.ts`
    imported plain `libsodium-wrappers`. Textually clean, semantically wrong: the merged
    app would have shipped two libsodium wasm builds with two independent `ready` gates.
    Pointed `transcript.ts` (+ its test) at sumo and **dropped `libsodium-wrappers` from
    `package.json`** so the wrong import can't resolve again — the same mistake is now a
    build error instead of a silent 2× wasm payload. Bundle confirmed at 1,610 kB (gzip
    500 kB), i.e. one wasm, matching ④'s own measurement.
  - The duplicated, mid-sentence-truncated ③ log entry in `progress.md`.
  - Stopped tracking `client/playwright-report/` + `client/test-results/` (730 KB of
    report artifacts an earlier auto-commit had swept in); both are now gitignored.
  **Verified:** `npm run typecheck` clean, **201** client tests (exactly the union:
  178 base + 7 D + 11 ③ + 8 ④ − 3 deleted), `npm run build` green, and a **throwaway
  two-browser Playwright run: 19/19** (written, run, deleted — driven from a scratch
  dir so no harness landed in the repo). What it proves, beyond the unit suites: both
  browsers derive the **same safety number** (so transcript binding + the hybrid root
  key agree across two real clients — the manual eyeball D was still waiting on);
  `commit` precedes `pubkey` on the wire on both sides and exactly one `kemct` is sent;
  cover traffic flows from both sides as `c:0` frames with ratchet headers while idle,
  rendering **zero** bubbles; the joiner can send first (primer) and it lands in 88 ms;
  exactly 2 bubbles per side after a round-trip; no decryption-error bubbles; no console
  errors. Observed `c:0` payload sizes 140 / 396 / 1420 — the once-per-session 64-bucket
  primer, real text *and* cover both at the 256 bucket, cover tail at 1024, which is ③'s
  size-indistinguishability fix holding in the merged build. **Merged to `main` as PR #15
  (`1dcb5b4`) later the same day**; PRs #13/#14 auto-closed as superseded by it. Remaining
  in round 2 at the time: **A+B** (PQ ratchet + ratchet header encryption, co-designed as
  one wire revision) then **E** (periodic rekey) — both unspecced at that point.

- **2026-07-28** — Round-2 **A+B built** on `feat/pq-ratchet-header-encryption`, off the
  integration branch (not `main` — they revise the same `msg` format PR #15 just
  consolidated). One wire revision, `PROTOCOL_VERSION` 4 → 5, no server change, no new
  dependency. Spec + plan dated 2026-07-28; rationale in `decisions.md`.
  **B — sealed ratchet headers.** The `msg` envelope is now `{type, payload}` and nothing
  else. Previously the relay read every sender's current ratchet public key, how many
  messages each chain held (`pn`), the position within the chain (`n`), and a cleartext
  class selector separating content from presence from receipts — a precise map of the
  conversation's structure even though it couldn't read a word. Now `payload` is
  `sealed header (84 bytes) ‖ body`, the header is XChaCha-sealed under a per-chain
  header key (Signal's header-encryption variant: HKs/HKr + NHKs/NHKr, with `kdfRoot`
  emitting the next header key one chain early), and the body's AEAD takes the sealed
  header as AAD so headers can't be swapped between messages. Receiving is trial
  decryption — HKr, then NHKr (which *is* how a new chain is detected), then the header
  keys stored alongside skipped message keys (capped at the 8 most recent chains), then
  the three static header keys.
  **A — post-quantum ratchet.** Fresh ML-KEM-768 secrets now fold into the ratchet's root
  chain every ~30s (jittered, or after 200 content sends), so post-compromise healing
  re-secures with post-quantum material instead of resting on X25519 alone. The initiator
  offers a fresh public key on a new sealed `pqoffer` channel, the responder encapsulates
  and replies on `pqaccept`, and both fold the secret at the next DH ratchet step — the
  only point where `RK` is consumed, and therefore the one place the two sides are already
  synchronised. **The sender decides when to fold and announces it in the header's `fold`
  counter; the receiver mirrors it**, so the fold point is deterministic rather than
  dependent on when a secret happened to arrive.
  **The key design call:** the ML-KEM blobs deliberately do *not* ride the header. B wants
  a fixed-size header and A wants ~2.3 KB on every chain flip — and with ③'s cover traffic
  both sides flip ~1/sec forever, so per-flip KEM material would have meant ~3 KB extra per
  message per side *and* made flips visible by size. Putting the blobs on ordinary content
  channels instead lets ③'s existing padding hide them and keeps the header **fixed at 84
  bytes, always**. Two smaller wins came with it: static channels (presence/ack/profile)
  gained a monotonic counter + 64-wide replay window, closing a documented residual; and
  `coverBodyLen` gained a ~3% 4096-byte tail so a PQ rekey isn't identifiable as the only
  frame of that size.
  **Verified:** `npm run typecheck` clean, **243** client tests (12 header, 8 pqRekey, 18
  ratchet incl. PQ folds, expanded ratchetSession/framing/kdf), `npm run build` green, and
  a **throwaway two-browser Playwright run: 18/18** (written, run, deleted; driven from a
  scratch dir with the rekey interval temporarily shortened to 4s, then restored and
  re-verified). It proved: both sides reach a matching safety number at v5; **no `c` or
  `header` field on ANY `msg` frame** — only `{type, payload}`; every payload is an 84-byte
  sealed header plus a body landing on a padding bucket (64/256/4096 observed); **both
  sides folded 7 post-quantum secrets and stayed exactly in sync** (`pqFold` 7/7, nothing
  left pending); a message sent *after* those folds still decrypted, in 64 ms; cover
  traffic still flowed with zero stray bubbles; no decryption-error bubbles; no console
  errors. A **DEV-only read-only counter hook** (`window.__ttRatchetCounters`, counters not
  keys, stripped from production builds) is what made the folds observable at all — the
  offer/accept frames are encrypted, so without it the run could only have assumed A
  worked. Two deliberate deviations from the plan text (BLAKE2b's 64-byte output cap means
  the root KDF takes two keyed calls, and only two header-key seeds are needed rather than
  four) are recorded in the plan's build-status block. **Merged to `main` as PR #16 (`898420e`)
  the same day, after a second verification pass — see the entry below.**
  **Remaining in round 2: E (periodic rekey) — and A largely subsumes it.** With the root
  chain already re-seeding with fresh ML-KEM secrets every ~30s, E reduces to re-running
  the *classical* handshake for a fresh ephemeral X25519 identity, a fresh transcript, and
  a new safety number. Re-scope it before building rather than building it as sketched.

- **2026-07-28** — **PR #15 merged to `main`** (`1dcb5b4`, GitHub merge commit, verified) —
  the hardened handshake + traffic-analysis cover traffic + at-rest vault are now on
  `main` at `PROTOCOL_VERSION` 4. PRs #13/#14 auto-closed as merged (their commits are
  ancestors of `main` via the integration branch). PR #16 (A+B) retargeted from the
  integration branch to `main`; still clean, and its diff is now just A+B.

- **2026-07-28** — **Second, deeper verification pass on PR #16**, prompted by a real gap
  in the first one: **static-channel failures are silent by design** (a dropped presence
  beat or receipt produces no bubble and no console error), so the original 18/18 run
  could not distinguish "receipts working" from "receipts silently broken" — and #16
  *changed* that path by adding per-channel counters and a replay window. A second
  two-browser script therefore asserted on the UI effects those channels produce, which
  is the only way a silent drop surfaces. **12/13**, at the **shipped 30s rekey interval**
  (not a shortened one):
  - **presence channel** — the peer's typing indicator appears *and* clears again, so
    state transitions flow, not just a single frame;
  - **ack channel** — the sender's own bubble advances to `message-status--read`, which
    only happens if the peer's receipt decrypted;
  - **PQ fold at production cadence** — `pqFold` 0 → **2** during a 50s soak, both sides
    agreeing, nothing left pending; text and receipts both still working *after* the folds;
  - **leave/rejoin** — returns to the entry screen and a fresh session starts cleanly
    (the zeroize path now wipes header keys and pending PQ secrets);
  - no decryption-error bubbles and no console errors anywhere in the run.
  **The one failure was voice, and it is NOT a v5 regression** — established by a
  controlled re-run of the same script against `main` (v4), where it fails identically.
  Headless Chromium's fake audio device (`--use-fake-device-for-media-stream`) never
  settles `MediaRecorder`'s stop, so the preview step never appears; `audio/recorder.ts`
  and `VoiceRecorder.tsx` are untouched by #16 in any case. (The first attempt also had a
  genuine test bug — `.composer__stop` / `.composer__send` carry no `aria-label`, so the
  original selectors matched the *text* composer's Send.)
  Since the browser can't reach voice, the part of it that #16 *does* own — the crypto
  path — was verified with a throwaway real-module test (written, run, deleted): a 700 KB
  clip round-trips **byte-for-byte** with its mimeType, a voice clip interleaves with text
  without desyncing the ratchet across a chain flip, and — the check worth having —
  **a worst-case 60s clip's envelope is 1,813,355 bytes, 86.5% of the relay's 2 MiB
  `maxPayload`**, so v5's extra 84-byte header per message has not pushed voice over the
  cap. **Still unverified by automation:** a real browser voice send (needs a human, and
  is equally unverifiable on `main`), and the `profile` static channel in a browser —
  marginal, since it shares one code path with presence/ack and differs only in key
  derivation, which is unit-tested (round-trip, cross-class rejection, independent
  counters).

- **2026-07-28** — **Jay sent a real 60-second voice message end-to-end on v5 and it
  went through** — closing the last verification gap automation couldn't reach, and at
  the worst case, since 60s is `MAX_RECORDING_MS`. Capture, encryption at maximum size,
  transit through the relay and decrypt on the far side all confirmed by hand.
  **Which surfaced a latent device-dependent bug, now fixed:** `audio/recorder.ts` created
  its `MediaRecorder` with only a mimeType, so the **bitrate was whatever the browser
  chose**. Clip size feeds a hard ceiling — the relay closes any frame over its 2 MiB
  `maxPayload` — and a 60s clip at one browser's default measured **86.5%** of that cap.
  Devices pick different defaults and Safari falls back to mp4/AAC, so a slightly
  higher-bitrate device would have exceeded the cap and had its socket closed with 1009,
  presenting as "voice just doesn't work on my phone" with nothing in the UI to explain
  it. Pinned `audioBitsPerSecond = 32_000` (a normal voice bitrate; a browser that doesn't
  honour it clamps or ignores it rather than throwing, so there's no regression risk).
  Re-measured with a throwaway test (written, run, deleted): a full-length clip is now
  **415,255 bytes on the wire = 19.8% of the cap**, a ~5× margin instead of a ~1.15×
  one. Bandwidth improves as a side effect. The only cost is some fidelity, most
  noticeable on the AAC fallback path — the constant is one line if it ever needs raising.

- **2026-07-28** — **WP-D built: the mobile chat shell.** Mobile web was dispatched as WP0
  plus six parallel packages; PR #10 landed WP0 and A/B/C/E/F, but **WP-D — the critical
  path — was never built**, so the one screen the app exists for did not work on a phone.
  Measured first, at iPhone 13 / `?screen=chat`: the sidebar took **256 of 390px**, the
  message column was **134px**, a bubble was **34px wide × 528px tall** (one character per
  line), and the composer's mic button sat at **x=521** — 131px past the right edge.
  Built, all behind `@media (max-width: 640px)` and additive to the existing rules:
  - **Off-canvas drawer.** `.sidebar` becomes `position: absolute; width: min(300px, 84vw)`,
    parked at `translateX(-100%)` and `visibility: hidden` (so nothing in it is tabbable
    while closed), sliding in over the chat with a tap-to-close scrim. `ChatScreen` owns the
    state — `App.tsx` untouched — plus a local `matchMedia` hook, because React has to know
    it's mobile: `paused={!drawerOpen}` would otherwise freeze the desktop visualizers.
    Escape closes it, and it stands down while Settings or a profile card is on top.
  - **Hamburger** as the TitleBar's first child (a new `menu` glyph in `Icon.tsx` — the one
    file outside WP-D's ownership, flagged); the room label, Verified pill and peer name hide
    on mobile since they live in the drawer and Settings. Bar height picks up `--safe-top`.
  - **Composer**: input 15px → **16px** (below that iOS Safari zooms on focus), mic and send
    42 → **44px**, `padding-bottom: max(20px, var(--safe-bottom))`. A busy voice recorder now
    takes the whole row via a `data-recorder` attribute, so the preview isn't squeezed beside
    the input: the clip goes full-width with Send | Discard splitting the width beneath it.
  - **Auto-scroll**, which did not exist at all: pin to bottom on a new message, *and* on a
    `ResizeObserver` — the column shrinking is what the soft keyboard looks like from in
    there, and without it the newest message slides out of view as `--app-height` drops.
  - **PacketViz** gained the `paused` prop the other four viz already had (four of five
    landed in PR #10), so the whole monitor stops while the drawer is parked.

  **The verification trap, and why the numbers are worth reading.** The spec's own
  acceptance check — `documentElement.scrollWidth <= window.innerWidth` — **passed on the
  broken screen at every size** (`overflow = 0px` while the sidebar ate two thirds of the
  viewport). The roots are `position: fixed`, so flexbox compresses children and the
  overflow never reaches the document's scroll width. `client/e2e/chat-mobile.spec.ts`
  therefore asserts geometry. Real numbers, iPhone 13 (390px) / Pixel 7 (412px):
  - parked drawer `rect = {left: -300, right: 0, width: 300}` — off-canvas, and `toBeHidden`;
  - `.chat-screen__main` **390px / 412px** wide at `left: 0` (was 134px at `left: 256`);
  - bubble **198.66 × 66px** (was 34 × 528) — the direct one-char-per-line regression test;
  - `.composer__input` computed font-size **exactly `16px`**; mic and send **44 × 44** at
    `right: 326 / 348` and `378 / 400`, both on screen;
  - composer bottom is flush with `.chat-screen`'s bottom to **0.00002px**, and the column's
    height equals `--app-height` exactly (664 / 839) — the measured-height chain that makes
    the composer ride the keyboard;
  - hamburger **44 × 44** at `left: 6`; open drawer `left: 0, width: 300`; after a scrim tap
    it re-parks at `right: 0`, and the hamburger still works;
  - voice: Stop **67.7 × 44**, preview block 366 / 388px wide inside the viewport, `<audio>`
    340 / 362px, Send **164 / 175 × 44**, Discard **166 / 177 × 44**, stacked below the clip;
  - `.viz-packet__p` computed `animation-play-state` is `paused` parked / `running` open;
  - a short-viewport run proves the auto-scroll isn't trivially true: `scrollHeight 352 >
    clientHeight 193`, pinned at `scrollTop 159`;
  - the avatar popover (WP-F's, but rendered outside the box WP-D now clips) still opens
    fully on screen: `{left: 8, right: 228, width: 220}`;
  - **desktop regression asserted, not eyeballed**: sidebar still `256px` at `left: 0`, main
    at `left: 256`, no hamburger, no scrim, room label + Verified pill + peer name all still
    visible, input still `15px`, mic still `42 × 42`, title bar still `46px`,
    `animation-play-state: running`.
  Also verified by eye at both phone sizes and on desktop, and at 360px explicitly.

  **One real bug found and fixed on the way** (`VoiceRecorder.tsx`): `mountedRef` was
  cleared on unmount and never set back, so React 18 `StrictMode`'s dev-only
  mount→unmount→remount left it `false` forever and **a finished recording never became a
  preview under the dev server, in any browser**. This is a correction to the 2026-07-28
  note that blamed Chromium's fake audio device for that same symptom; the app-side bug
  would have blocked the preview even with a working recorder. Production builds were fine.
  With it fixed, the preview *is* Playwright-testable by stubbing `getUserMedia` +
  `MediaRecorder` through `addInitScript` — the real component path still runs.

  `npx tsc --noEmit` clean, **248/248** Vitest (no existing test needed editing),
  `npm run build` green, `npx playwright test` **21/21** across all three projects
  (including the two-browser handshake), and a doubled `--repeat-each=2` run of the whole
  suite was clean too — no flakes. **Not verified here, and
  it can't be:** actual soft-keyboard riding and true iOS safe-area insets — Playwright
  emulation raises no keyboard and reports zero insets, so those need a real device.
  Cosmetic nit left for Jay: the composer placeholder "Message — encrypted end-to-end"
  truncates to "…end-to-" at 390px — a copy call, not a layout bug.
