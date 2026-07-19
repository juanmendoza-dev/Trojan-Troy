# Decisions Log

Record of non-obvious calls made on this project and why — so any agent
picking this up understands the reasoning, not just the outcome. Newest
entries at the top.

Format: **Date — Decision.** Rationale. (Decided by: who)

---

- **2026-07-19 — Phase 5.1 overrides the original no-accounts/
  ephemeral-identity decision**: users now get a long-term identity keypair
  persisted client-side (IndexedDB), plus a self-chosen display name. This
  is *not* a server-side account system — no login, no password, no central
  user database; the relay still only ever forwards opaque envelopes. Full
  design in
  `docs/superpowers/specs/2026-07-19-persistent-identity-design.md`.
  (Decided by: Jay)

- **2026-07-19 — Roadmap restructured: Phase 4 is now UI design (handled
  externally, not built by an agent in this repo); Phase 5 is now a
  sequence of new-feature sub-projects instead of the marketing/landing
  site; Phase 6 is a new phase for polishing whatever Phase 5 builds.**
  Rationale: this is a Hackatime-tracked hackathon — around 4 hours were
  logged against a ~35-hour target, so Phase 5's scope was deliberately
  expanded well beyond the original Version A plan to sustain that much
  real engineering work, split across both deepening the crypto/security
  design (persistent identity, forward secrecy, offline delivery) and
  broadening user-facing features (group chat, file sharing, disappearing
  messages, local history). The landing page originally planned for Phase 5
  is deferred/unscheduled — it can still be picked up independently later
  since it doesn't depend on the app's internals. Build order for Phase 5's
  sub-projects is dependency-driven: persistent identity and the
  forward-secrecy ratchet come first since later sub-projects (offline
  delivery, group chat) build on top of them. See `roadmap.md`. (Decided
  by: Jay)

- **2026-07-18 — Message encryption uses `crypto_secretbox`, not
  `crypto_box`** (corrects the earlier crypto note below; full design in
  `docs/superpowers/specs/2026-07-18-phase2-messaging-design.md`).
  `crypto_box` is libsodium's public-key encryption primitive; Phase 1's
  actual implementation derives symmetric session keys via `crypto_kx`
  instead, so the two sides already share a secret before any message is
  sent. `crypto_secretbox_easy` is libsodium's standard primitive for
  exactly that situation — authenticate and encrypt with a symmetric key
  you already have. (Decided by: Jay)

- **2026-07-18 — Phase 1 architecture locked in** (full design in
  `docs/superpowers/specs/2026-07-18-phase1-foundation-design.md`):
  - **Client is a single web app (React + Vite + TypeScript).** Desktop
    comes later as an Electron wrapper around the same app (the Discord
    model) — not a separate build track. Mobile is not in scope for
    Version A.
  - **Crypto library: libsodium.js**, not the Web Crypto API. Purpose-built
    API for key exchange (`crypto_kx`) and authenticated encryption
    (`crypto_box`), and it behaves identically in the browser and in Node,
    unlike Web Crypto's less consistent X25519 support.
  - **Relay server: Node.js + WebSocket (`ws`)**, in-memory only, no
    database. Same language as the client, so libsodium.js and any shared
    types work the same on both sides — one runtime for a 2-person team.
  - **Pairing is room/invite-link based — no user accounts.** One person
    starts a session, gets a shareable code, the other joins with it. No
    usernames, passwords, or user database. Much less to build than
    Discord-style accounts, and the "share a link, instantly E2E
    encrypted" story is a stronger hackathon demo anyway.
  - **Session keys are ephemeral (fresh per session), not a persistent
    identity.** Simplest option for Version A. Trade-off: the safety
    number verifies *this session*, not "this person forever" the way
    Signal's does. Revisit if we want persistent identity keys later —
    that's a bigger scope add (local key storage, rotation UI).
  - **Repo layout is two independent packages, `/client` and `/server`,
    no monorepo tooling.** Simplest thing that works; not worth the extra
    tooling for two packages and two people.
  (Decided by: Jay)

- **2026-07-18 — Two working-process rules added before starting Phase 1:**
  (1) commit messages must be short, plain-language, and human-sounding —
  no AI-flavored verbosity; (2) if an agent thinks part of the roadmap is
  inefficient, it asks before deviating — roadmap only changes by agreement,
  logged here. (Decided by: Jay)

- **2026-07-18 — Multi-agent docs use the standard `AGENTS.md` filename**,
  not a custom `agent.md`. Many coding agents/tools auto-discover
  `AGENTS.md` specifically, so future agents pick up the rules without
  being told where to look. (Decided by: Jay)

- **2026-07-18 — Commits/pushes must never be authored or co-authored as an
  AI agent.** Always use the human git identity. Commits must be verified
  (signed). Commit and push frequently, even for tiny changes, because this
  hackathon is judged on time and Hackatime reads commit activity. See
  `AGENTS.md`. (Decided by: Jay)

- **Crypto: use an existing, audited library — libsodium.js or the Web
  Crypto API (X25519 for key exchange, AES-GCM for symmetric encryption).**
  Never hand-roll encryption primitives — too easy to get subtly wrong, and
  a security-focused hackathon project needs to actually be secure, not
  just look secure. (Decided by: Jay)

- **Scope is "Version A" — no live/streaming calling in this build.** Live
  calling and true peer-to-peer networking are explicitly out of scope for
  now; they're a stretch goal for a later version. Keeps the hackathon
  build achievable in the time available. (Decided by: Jay)

- **Voice messages are async only (Phase 3), not live calls.** Record a
  clip, encrypt it, send it, recipient decrypts and plays it. Simpler to
  build and secure than a live audio stream, and fits the "no live calling"
  scope decision above. (Decided by: Jay)

- **The relay server must be architecturally incapable of reading message
  content** — it only ever handles/stores ciphertext, never plaintext. This
  is the core promise of the app, so it's a hard constraint on every phase,
  not just a nice-to-have. (Decided by: Jay)

- **Build order is fixed: Foundation → Encrypted messaging → Encrypted
  voice messages → UI polish → Landing site (parallel).** UI polish
  explicitly comes after the plumbing works, not before — don't let visual
  progress get prioritized over the crypto/messaging core actually working.
  Landing site (Phase 5) is the one exception — it can run in parallel
  since it doesn't depend on the app's internals. (Decided by: Jay)

- **2026-07-19 — Phase 4 UI redesign: implement all three chat themes
  (Apple, Iris Glass, Pulse Slate) behind a runtime switcher, not just the
  "final" Apple direction.** More build surface than picking one, but the
  design handoff explicitly approved all three and the user wanted them
  available to demo. `StartJoinScreen`, `WaitingScreen`, and
  `SafetyNumberScreen` stay unstyled for this pass — the handoff only
  specced the loading and chat screens. (Decided by: Jay)

- **2026-07-19 — Phase 4 UI redesign deviates from the design handoff in
  five ways** (full rationale in
  `docs/superpowers/plans/2026-07-19-phase4-ui-redesign.md`'s "Design
  deviations" section):
  1. No fixed 1180×740 mock window / macOS traffic-light dots — the real
     app is a resizable browser tab, not Electron/Tauri, so the chat and
     loading screens fill the real viewport instead.
  2. No typing indicator — there's no "peer is typing" relay event
     (would be a protocol change, out of scope for a UI-only phase).
  3. The loading screen always renders in the Apple light/dark style
     (5a/5b) regardless of which chat theme is selected — the handoff
     calls it "the final loading screen," not theme-specific, and a white
     loader before a near-black Iris/Pulse chat would look broken.
  4. The checklist/percent-counter choreography is driven by a JS timer
     plus real key-exchange completion (transition once both are done),
     not the mockup's infinite CSS loop — the handoff itself calls those
     timings "demo stand-ins."
  5. Kinetic-wordmark letter-column widths are measured at runtime via
     `canvas.measureText()` instead of hardcoded — the mockup's hardcoded
     widths are tuned to SF Pro Display (macOS/Safari-only), which would
     clip letters in the fallback font on Windows/Linux/Chrome.
  (Decided by: Jay + Claude, while writing the implementation plan)
