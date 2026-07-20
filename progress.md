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
