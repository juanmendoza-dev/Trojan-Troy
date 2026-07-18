# Decisions Log

Record of non-obvious calls made on this project and why — so any agent
picking this up understands the reasoning, not just the outcome. Newest
entries at the top.

Format: **Date — Decision.** Rationale. (Decided by: who)

---

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
