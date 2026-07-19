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
| 4 — UI polish | In progress — plan written and committed, worktree set up, no implementation tasks started yet |
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

- **2026-07-19** — Phase 4 UI redesign kicked off, in progress (not merged,
  not implemented yet). Read this entry fully before touching Phase 4 —
  it's the resume point for a fresh session/agent with no memory of this
  work.

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
