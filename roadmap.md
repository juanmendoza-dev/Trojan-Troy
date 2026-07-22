# Roadmap — Trojan Troy (Version A)

End-to-end encrypted chat app. The core promise: even the relay server
should never be able to read plaintext. Built for Hack Club Horizons Polaris
(Toronto), tracked via Hackatime.

Build in this order. Do not skip ahead to a later phase before the current
one works.

## Phase 1 — Foundation
- [ ] Key generation and key exchange between two users, using an existing
      audited crypto library (libsodium.js or Web Crypto API — X25519 for
      exchange, AES-GCM for symmetric encryption). No hand-rolled crypto.
- [ ] Safety number verification screen — lets two users confirm they're
      talking to who they think they're talking to (Signal-style
      fingerprint verification).

## Phase 2 — Encrypted messaging
- [ ] Thin relay server that only ever sees ciphertext, never plaintext.
- [ ] Real-time encrypted text messaging between two clients.

## Phase 3 — Encrypted voice messages
- [ ] Async voice messages only — record a clip, encrypt it, send it,
      recipient decrypts and plays it. NOT live/streaming calling.

**Backlog (not blocking, come back to later):**
- Known bug (flagged by Jay, 2026-07-20): recorded voice message duration
  is inaccurate on playback — e.g. a ~5s recording shows/sends as ~23s.
  Needs investigation into how clip duration is measured/stored (likely
  timing the record/encode/send pipeline instead of the actual audio
  length).

## Phase 4 — UI design
- [ ] A genuinely clean, beautiful interface. Handled externally via a
      separate design tool/process, not built by an agent in this repo.
      Comes after the plumbing works, not before.
- [ ] Known gap found during preview: Iris Glass and Pulse Slate are both
      missing their background animations from the design handoff — Iris
      Glass's two drifting ambient orbs (`floatOrb`), Pulse Slate's central
      ambient glow pulse (`glowPulse`). Both keyframes already exist in
      `client/src/styles/keyframes.css` but aren't applied to any element
      yet. Iris Glass's fix is now the blocking first task of Phase 4.5
      below; Pulse Slate's is backlog — not on the critical path now that
      Iris Glass is the standard design.

## Phase 4.5 — Working prototype: unify design, add settings, host it
Before touching Phase 5's expanded scope, get one polished, hosted,
end-to-end chat prototype solid. Build in this order:

- [ ] Fix Iris Glass's missing background-orb animation (`floatOrb` — see
      Phase 4 gap above). Blocking prerequisite for everything else in this
      phase.
- [ ] Make Iris Glass the standard/default design and unify the loading
      screen with the chat screen so they share one consistent visual
      language. Today the loading screen always renders Apple-style
      regardless of the selected chat theme (a deliberate Phase 4 deviation,
      see `decisions.md`) — revisit that now that Iris Glass is becoming the
      default instead of Apple.
- [ ] Settings — a floating centered modal (gear icon in the chat
      screen's title bar), holding: the theme switcher, room/session info
      (room code + safety number), a "leave chat" action, and an
      about/security info panel. Design in
      `docs/superpowers/specs/2026-07-19-phase4.5-design.md`.
- [ ] Host the prototype: client on Vercel, relay server on Render (split
      hosting — the relay's in-memory WebSocket state doesn't fit
      Vercel's serverless model). One persistent shareable link instead
      of ad-hoc localhost link-sharing.

**Backlog (not in this phase, come back to later):**
- Make the loading screen fully theme-aware (a distinct style per
  Apple/Iris/Pulse selection) instead of always rendering Iris-Glass-
  styled once Phase 4.5 lands.
- Brainstorm additional settings scope beyond the four items Phase 4.5
  builds (theme switcher, room/session info, leave chat, about/security).
- Redesign the delivered/read receipt indicator — Jay's feedback
  (2026-07-20) on the shipped Chat polish work is that it currently reads
  as too generic/"AI vibe coded." Revisit the visual treatment (tick
  icons, styling, animation) once back in a design/polish pass.

## Phase 4.6 — Style the remaining unstyled screens
Follow-up to Phase 4's design scope cut: `StartJoinScreen` (the app's
home/entry screen), `WaitingScreen`, and `SafetyNumberScreen` were
explicitly left unstyled in Phase 4 and 4.5 — the original design handoff
only specced the loading and chat screens (see `decisions.md`).
`SafetyNumberScreen` has since gotten a minimal legibility-only CSS pass
(dark background/text color) as part of the handshake-to-chat transition
work, but none of the three have real design applied. Jay is designing
these with Fable (the same external design-tool workflow used for the
original Phase 4 handoff), taking advantage of a window of substantially
higher compute availability starting 2026-07-21.

- [ ] Fable design handoff for `StartJoinScreen`, `WaitingScreen`, and
      `SafetyNumberScreen`, matching the existing chat-theme visual
      language (Apple / Iris Glass / Pulse Slate) established in Phase 4.
- [ ] Implement the handoff via this project's usual workflow
      (superpowers:brainstorming → spec → plan →
      superpowers:subagent-driven-development) — don't build ahead of the
      handoff landing.

## Phase 4.7 — Fable Ultra code review
Jay plans to run an ultra-depth code review of the existing codebase using
Fable (the frontier-capability model), during the same high-compute window
as Phase 4.6, to surface improvement opportunities before Phase 5 adds more
scope on top. This is a review pass, not a rewrite — findings get triaged
and applied deliberately (see superpowers:receiving-code-review), not
auto-applied wholesale.

- [ ] Run the review.
- [ ] Triage findings with Jay; apply agreed fixes as normal follow-up
      work, logging any resulting non-obvious calls in `decisions.md`.

## Phase 5 — New features
Substantially expands project scope/complexity beyond Version A's original
plan (see `decisions.md` for why). Waits until Phase 4.5's working
prototype, Phase 4.6's screen styling, and Phase 4.7's code review are all
done — get the chatting version solid and reviewed before increasing
security complexity (5.2 onward). Built as a sequence of independent
sub-projects, each with its own spec in `docs/superpowers/specs/` and its
own plan/implementation cycle. Build in this order — later items depend on
earlier ones:

- [ ] 5.1 — **Local Profiles** (REPLACES the retired persistent-identity
      approach — Jay's call, 2026-07-22, see `decisions.md`). Device-local,
      PIN-gated profiles (name + picture) with an always-present Anonymous
      default, plus opt-in *encrypted* name/photo sharing with the peer.
      Deliberately light: no long-term identity keypair, session crypto
      unchanged. Layer A (profiles + PIN + modal + sharing) built on
      `feat/profiles`; Layer B (per-profile saved conversation history,
      IndexedDB, archive-only, encrypted at rest) is a follow-up. Spec:
      `docs/superpowers/specs/2026-07-22-local-profiles-design.md`; plan:
      `docs/superpowers/plans/2026-07-22-local-profiles.md`.
      The earlier persistent-identity (5.1) + contacts-privacy (5.1a) build was
      rolled back (`main` @ `1ee0e35`); those specs are shelved, not deleted.
      NOTE: 5.2 (ratchet) and 5.3 (offline delivery) below were specced on top of
      persistent identity keys — with identity retired, revisit their design
      before building (neither is started).
- [ ] 5.2 — Forward-secrecy ratchet (Double Ratchet-style per-message key
      rotation), built on top of 5.1's identity/ephemeral key split.
- [ ] 5.3 — Encrypted offline delivery: server holds ciphertext for a peer
      who isn't currently connected, addressed via 5.1's persistent
      identity, instead of dropping it.
- [ ] 5.4 — Local encrypted message history/search (client-side storage,
      encrypted at rest), sharing a storage layer with 5.3's delivery
      mailbox.
- [ ] 5.5 — Group chats (3+ people). Requires group-key encryption (e.g.
      sender-keys), built on top of 5.2's ratchet.
- [ ] 5.6 — Encrypted file/image sharing, extending the voice-message
      encryption pattern to arbitrary files.
- [ ] 5.7 — Disappearing messages (self-destruct timer).

**Backlog (not in this phase, come back to later):**
- Harden the read/delivered-receipt protocol's metadata privacy: the
  `messageId` used to correlate delivery/read acks to a specific message is
  currently sent as a cleartext envelope field, visible to the relay (see
  `decisions.md`, 2026-07-20). Revisit embedding it inside the encrypted
  payload instead once back in a security-hardening phase — see the chat
  UI polish spec's design for the exact current mechanism.
- Add a "peer is typing" indicator. Cut from Phase 4's UI-only scope (see
  `decisions.md`, 2026-07-19); Jay requested it back on 2026-07-20. Now
  designed as an **encrypted presence indicator** (typing *and* voice
  recording) — spec at
  `docs/superpowers/specs/2026-07-22-typing-presence-design.md`. The Phase 4
  note that this needs a "relay event/protocol change" is corrected there:
  the relay forwards unknown envelope types opaquely (as it already does for
  `ciphertext`/`voice`/`delivered`/`read`), so it's a client-only change with
  no server work. Spec'd, not yet built.

## Phase 6 — Polish
- [ ] Harden and polish whatever Phase 5 sub-projects actually get built —
      UX rough edges, error states, edge cases — once the new feature set
      is in place.

## Hard constraints (apply to every phase)
- Never implement custom cryptographic primitives — audited libraries only.
- The relay server must be architecturally incapable of reading message
  content.
- Live calling / true peer-to-peer networking is explicitly out of scope
  for this version.
