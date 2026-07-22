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
| — Peer presence indicator: encrypted typing + recording (unscheduled, user-requested) | Built on `feat/typing-presence-indicator` — typecheck/tests/build green; visual eyeball + live round-trip pending |
| — Seal-slider sparks: canvas ember effect on the safety-number slider (unscheduled, user-requested) | Merged to `main` — typecheck/95 tests/build green; visual eyeball via `?screen=safety` pending |
| — Error screen: themed six-scenario error screen (unscheduled; was built but stranded on the retired identity branch) | Merged to `main` (`275d834`) — typecheck/104 tests/build green; visual eyeball (`?screen=error`) pending |
| 4.6 — Style remaining unstyled screens | In progress — `WaitingScreen` (Radar/Signal) + `StartJoinScreen` (home + connecting bar) redesigned; `SafetyNumberScreen` still pending |
| 5.1 + 5.1a — Persistent identity + contacts privacy settings | Rolled back (`main` @ `1ee0e35`); superseded by Local Profiles below (Jay's call, see `decisions.md`) |
| 5.1 — Local Profiles (Layer A): PIN-gated device-local profiles + encrypted opt-in sharing | Built on `feat/profiles` — typecheck/108 tests/build green; manual eyeball (`?screen=profiles`) + live round-trip pending |
| 5.2 — Forward-secrecy ratchet (Double Ratchet) + sealed framing + padding | In progress on `feat/forward-secrecy-ratchet` — crypto foundation (Tasks 0-4: aead/kdf/framing/ratchet) built + committed, 150/150 client tests green; wire format + App wiring (Tasks 5-7) + relay hardening (Track B) remain. See the log entry below + the plan's BUILD STATUS banner. |

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
