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

## Phase 4 — UI polish
- [ ] A genuinely clean, beautiful interface. Comes after the plumbing
      works, not before.

## Phase 5 — Marketing / landing site (parallel track)
- [ ] Short, well-designed landing page explaining what Trojan Troy is and
      why the encryption approach matters — understandable by a
      non-technical reader in one pass. Can be built independently of
      Phases 1–4.

## Hard constraints (apply to every phase)
- Never implement custom cryptographic primitives — audited libraries only.
- The relay server must be architecturally incapable of reading message
  content.
- Live calling / true peer-to-peer networking is explicitly out of scope
  for this version.
