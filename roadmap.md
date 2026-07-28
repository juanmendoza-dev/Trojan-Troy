# Roadmap — Trojan Troy (Version A)

End-to-end encrypted chat app. The core promise: even the relay server
should never be able to read plaintext. Built for Hack Club Horizons Polaris
(Toronto), tracked via Hackatime.

Build in this order. Do not skip ahead to a later phase before the current
one works.

---

## Where things stand (2026-07-28)

Phases 1–4.7 are **done and on `main`**. The app pairs two browsers over a
room code, runs a hybrid post-quantum handshake, and exchanges encrypted text
and voice messages through a relay that can't read any of it.

Since then the crypto has been deepened twice, in two backend-only rounds that
kept the UX identical (see the next section — that work is the strongest part
of this project and used to be one unchecked line here). Everything from both
rounds is merged. A third, smaller round (**v6**) then closed a real gap an external
review found — the non-ratcheted channels were X25519-only — putting
`PROTOCOL_VERSION` at **6**.

What's left is Phase 5's remaining *feature* work (offline delivery, history,
group chats, files, disappearing messages), Phase 6 polish, and finishing the
mobile pass.

---

## Security architecture — what's actually shipped

All of this is live on `main`, verified by 248 client + 31 server tests plus a
committed two-browser Playwright test (`client/e2e/handshake.spec.ts`). No custom
primitives: libsodium (sumo) and `@noble/post-quantum` only.

**Pairing and key agreement**
- Ephemeral X25519 (`crypto_kx`) **+ ML-KEM-768** (FIPS 203) — both secrets
  folded into the ratchet's initial root key, so a session stays safe unless
  *both* break. Defeats "harvest now, decrypt later."
- **Commit-then-reveal** (ZRTP-style): each side publishes a hash commitment to
  its ephemeral key(s) and reveals only after holding the peer's commitment, so
  neither side — nor a malicious relay — can choose keys adaptively.
- **Transcript binding**: a canonical hash of the whole handshake (version, both
  public keys, KEM public key + ciphertext) is folded into the root key, so any
  framing tamper or version downgrade changes the root key *and* the safety
  number. Fails closed; there is no classical fallback path.
- **Safety number binds the derived session**, not just the relayed public keys.

**Message encryption**
- **Double Ratchet** — per-message keys (forward secrecy) and post-compromise
  self-healing. XChaCha20-Poly1305 bodies, keyed-BLAKE2b chains.
- **Post-quantum healing**: fresh ML-KEM secrets are agreed in-band and folded
  into the root chain roughly every 30 seconds, so recovery from a compromise
  doesn't rest on X25519 alone. (Honest claim: "re-secures every ~30s" — *not*
  "every message is post-quantum.")
- **Encrypted ratchet headers**: the key class, sender's ratchet public key and
  chain counters are sealed in a fixed 84-byte header. The relay sees
  `{type, payload}` and nothing else.
- **Sealed framing + size-bucket padding**: channel, message id, voice mimeType
  and receipt kind all live inside the ciphertext, padded to fixed buckets.
- **Static channels bound to the root key (v6)**: `presence`/`ack`/`profile` used to
  derive from the raw `crypto_kx` outputs, making them X25519-only. Each direction is
  now bound to `RK0` first, so they inherit the hybrid-PQ + transcript binding and the
  harvest-now-decrypt-later claim holds for *all* wire traffic, not just content.
- Replay protection on both the ratcheted and the static channels; transactional
  decrypt, so a tampered packet can never corrupt a live session. A static frame whose
  body fails to authenticate no longer consumes its replay counter (v6), and `unframe`
  allowlists the channel rather than trusting the decrypted JSON.

**Metadata resistance**
- **Cover traffic**: a jittered ~1/sec stream of decoy frames, byte-
  indistinguishable from real content, so the relay can't read the conversation's
  rhythm (typing, pausing, idle). Real sends incur **zero** added latency.
- Presence heartbeat jittered to kill its fixed-period fingerprint.

**At rest and in transit**
- Profile avatars sealed with **Argon2id** (`crypto_pwhash`) from the user's PIN;
  no fast-hash fallback, legacy cleartext records purged on load, and a reload
  reverts to Anonymous.
- Relay hardening: payload cap, per-connection rate limiting, per-IP and global
  connection caps, room caps, heartbeat reaping, origin allowlist, one-room-per-peer.

**Honest residuals** (documented, not hidden)
- Safety-number verification is **not enforced** — a user can proceed without
  comparing digits (review H1; the biggest remaining real-world gap).
- The relay still learns that a session exists, its duration, and how many
  frames cross it.
- The per-step DH inside the ratchet is still X25519; PQ material is folded in
  periodically, not per message.
- Profile *names* are stored in the clear for the picker UI; only avatars are
  sealed. No PIN attempt backoff.

---

## Phase 1 — Foundation ✅
- [x] Key generation and key exchange between two users, using an existing
      audited crypto library (X25519 via libsodium's `crypto_kx`). No
      hand-rolled crypto.
- [x] Safety number verification screen — Signal-style fingerprint comparison.

## Phase 2 — Encrypted messaging ✅
- [x] Thin relay server that only ever sees ciphertext, never plaintext.
- [x] Real-time encrypted text messaging between two clients.

## Phase 3 — Encrypted voice messages ✅
- [x] Async voice messages — record, encrypt, send, recipient decrypts and
      plays. Not live/streaming calling.
- [x] Voice clip duration reported accurately (was a known bug, fixed).

## Phase 4 — UI design ✅
- [x] Three chat themes (Apple, Iris Glass, Pulse Slate) behind a runtime
      switcher, plus the kinetic-cipher loading screen.
- [x] Iris Glass's missing ambient orb animation (`floatOrb`) applied.

## Phase 4.5 — Working prototype ✅
- [x] Iris Glass as the standard design; loading and chat screens unified.
- [x] Settings modal — theme switcher, room/session info, privacy toggles,
      leave chat, about/security panel.
- [x] Hosted: client on Vercel, relay on Render.
      **Action for Jay:** `ALLOWED_ORIGINS` is still unset on Render, so the
      relay accepts any origin (it fails open by design — see `decisions.md`).

## Phase 4.6 — Style the remaining screens ✅
- [x] Fable designs for `StartJoinScreen`, `WaitingScreen` and
      `SafetyNumberScreen`, **and** all three implemented in the repo (real
      React + CSS, wired into the theme system) — not just designed.

## Phase 4.7 — Fable Ultra code review ✅
- [x] Review run (`docs/superpowers/reviews/2026-07-22-security-review.md`).
- [x] Findings triaged and applied — all H1–H4 / M1–M8 / L1–L8 items
      remediated, except H1 (verification enforcement) which is deliberately
      deferred because it changes the UX, and one refuted finding left alone.

## Phase 5 — New features

### Security hardening — round 1 (2026-07-23, backend-only) ✅
Four specs under `docs/superpowers/specs/2026-07-23-*`, all merged:
- [x] Hybrid post-quantum handshake (X25519 + ML-KEM-768).
- [x] Safety-number session binding (review L2).
- [x] Traffic-analysis resistance — cover traffic + cadence jitter (review B12).
- [x] At-rest Argon2id profile encryption (review S1).
- [x] Relay DoS / lifecycle hardening (review H3/M1/M5/L5).

### Security hardening — round 2 (2026-07-26, backend-only) ✅ except E
- [x] **D** — hardened handshake: commit-then-reveal + transcript binding.
- [x] **A** — post-quantum ratchet: ML-KEM folded into the root chain ~every 30s.
- [x] **B** — ratchet header encryption.
- [ ] **E** — periodic rekey. **Re-scope before building.** A already re-seeds
      the root chain every 30s, and the ratchet rotates DH keys on every chain
      flip (~1/sec under cover traffic), so E's marginal value is small — and its
      core idea conflicts with itself: a re-handshake produces a *new safety
      number*, which either confuses the user or leaves the displayed number no
      longer describing the live session.
- Declined: (C) key-committing AEAD — niche in a two-party ratchet.

### Feature work
- [x] 5.1 — **Local Profiles** (Layer A): device-local, PIN-gated profiles
      (name + picture) with an always-present Anonymous default, plus opt-in
      encrypted name/photo sharing with the peer. No long-term identity keypair.
      Layer B (per-profile saved conversation history) is **not built**.
- [x] 5.2 — Forward-secrecy ratchet (Double Ratchet), sealed framing, size-bucket
      padding, one opaque `msg` envelope. Extended by round 2's A+B.
- [x] Encrypted presence indicator (typing + recording) — client-only, no server
      change.
- [ ] 5.3 — Encrypted offline delivery: relay holds ciphertext for a peer who
      isn't connected. **Needs redesign** — the original spec addressed peers via
      the retired persistent-identity keys.
- [ ] 5.4 — Local encrypted message history / search, sharing a storage layer
      with 5.3's mailbox. (Overlaps Local Profiles Layer B.)
- [ ] 5.5 — Group chats (3+ people). Needs group-key encryption (e.g.
      sender-keys) on top of the ratchet.
- [ ] 5.6 — Encrypted file / image sharing, extending the voice-message pattern.
- [ ] 5.7 — Disappearing messages (self-destruct timer).

## Phase 6 — Polish
- [ ] Harden and polish whatever Phase 5 work lands — UX rough edges, error
      states, edge cases.

## Mobile web support (added 2026-07-23)
Mobile web via a hamburger drawer plus responsive/app-like polish. No PWA.
- [x] Playwright set up for browser and mobile testing.
- [x] Responsive foundation (viewport, reset, safe-area, app-height).
- [ ] Finish the pass on `feat/mobile-web-support` (PR #10, still WIP). The core
      flow already works on a phone — no overflow, and the room code, QR and copy
      buttons are all reachable — but several screens still render at desktop
      scale (the waiting-screen radar overflows, the security ticker clips).

---

## Backlog (not blocking; revisit later)
- **Enforce safety-number verification** (review H1) — require an explicit "these
  match" confirmation and show a persistent unverified banner. Deliberately
  excluded from both hardening rounds because it changes the UX; it is the
  biggest remaining real-world security gap.
- Per-step post-quantum ratchet (Signal's SPQR direction) — fold ML-KEM on every
  ratchet step instead of every ~30s. Needs chunked key transmission; high
  complexity for a small delta over what's shipped.
- Pulse Slate's central ambient glow pulse is still not applied to the chat
  background (the `glowPulse` keyframe now drives the presence indicator instead).
- Make the loading screen fully theme-aware per Apple/Iris/Pulse selection.
- Redesign the delivered/read receipt indicator — Jay's feedback (2026-07-20) is
  that it currently reads as too generic.
- Brainstorm settings scope beyond what 4.5 shipped.
- PIN attempt backoff, and a passphrase option instead of a numeric PIN, for the
  at-rest vault.
- ~~Hide the cleartext `messageId` from the relay~~ — **done**: message ids moved
  inside the sealed frame in 5.2, and 4.7's remaining header metadata was sealed
  by round 2's feature B.

## Hard constraints (apply to every phase)
- **Never implement custom cryptographic primitives** — audited libraries only.
  Currently libsodium (`-sumo` build) and `@noble/post-quantum` (ML-KEM-768,
  Cure53-audited). Composition of audited primitives (KDF chains, hybrid
  combiners) is fine; new primitives are not.
- **The relay server must be architecturally incapable of reading message
  content** — it only ever handles ciphertext, and inspects only `create`/`join`.
- Live calling / true peer-to-peer networking is explicitly out of scope for
  this version.
