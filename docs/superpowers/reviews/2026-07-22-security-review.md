# Trojan Troy — Security Review & Remediation Plan

- **Date:** 2026-07-22
- **Phase:** 4.7 (Fable/Ultra code review — see `roadmap.md`)
- **Type:** Review + remediation guidance. **Not** an applied change set — findings
  are triaged with Jay, then applied deliberately as normal feature-branch work
  (`superpowers:receiving-code-review`).
- **Scope reviewed:** the relay (`server/src/*`), the crypto core
  (`client/src/crypto/*`), the client transport (`client/src/net/relayClient.ts`),
  the `App.tsx` handshake/state machine, the voice pipeline, client build/deploy
  config, and the forward-looking Phase 5.1 / 5.1a / local-profiles design specs.
- **Method:** 7 independent dimension reviewers → adversarial verification of every
  finding (each verifier reopened the cited lines, tried to *refute* exploitability
  against the threat model, and re-scored severity) → completeness critic →
  features architect. 57 findings raised, 52 confirmed, 3 uncertain, 2 refuted.

> **Line numbers were accurate as of 2026-07-22.** They drift as code changes —
> an implementer agent MUST re-locate the symbol before editing, not trust the
> line number blindly.

---

## 0. How to use this doc (read before patching)

If you are an agent applying these fixes:

1. **Read §1 (constraints) and §2 (invariants that must not regress) first.** Several
   findings are one layer above correctly-built crypto. Do not "fix" the crypto core;
   it is sound. Breaking an invariant in §2 is worse than any finding below.
2. **One finding-cluster per branch.** Follow `AGENTS.md`: branch off `main`
   (`git switch -c fix/<slug>`), keep commits short/plain/human-authored, **never**
   set an AI author or `Co-Authored-By` trailer, don't disable commit signing.
   Suggested branch names are given per finding.
3. **Respect the project's workflow.** Non-trivial changes (H4, M2, M6, and all of §S)
   change the wire format or a spec — those go through
   `superpowers:brainstorming → writing-plans → subagent-driven-development`, not a
   drive-by edit. The small, self-contained ones (H2, H3, M3, M4, M5, most of §L) are
   direct patches. Each finding says which it is under **Effort/route**.
4. **Verify, don't assume.** Every fix lists **Acceptance criteria**. Client:
   `cd client && npm run typecheck && npm test && npm run build`. Server:
   `cd server && npm test`. There is no browser-automation tool in this environment;
   UI-visible behavior is verified by eye (`npm run dev`) as in every prior phase.
5. **Log it.** When a fix involves a non-obvious call, add a `decisions.md` entry and
   update `progress.md`, per `AGENTS.md`.
6. **Don't touch refuted items (§C.2)** expecting a bug — there isn't one.

Severity legend: 🔴 High · 🟠 Medium · 🟡 Low · ⚪ Info. "Confidence" is the reviewer's
certainty the issue is real; "Uncertain" findings are in §C.1.

---

## 1. Hard constraints (every fix MUST respect these)

Carried verbatim from `AGENTS.md` / the project brief. A remediation that violates any
of these is rejected regardless of how well it closes the finding.

- **Never hand-roll cryptographic primitives.** Audited libraries only (libsodium.js /
  Web Crypto). Today: `crypto_kx` (session keys), `crypto_secretbox_easy`
  (message/voice), `crypto_generichash` (safety number). Adding
  `libsodium-wrappers-sumo` for `crypto_pwhash`/`crypto_kdf` is allowed — still an
  audited library.
- **The relay must never be able to read plaintext.** It only ever forwards opaque
  envelopes. It may continue to forward unknown envelope types opaquely (this is
  relied on by presence/receipts — see `decisions.md` 2026-07-22).
- **No live/streaming calling or true P2P.** Out of scope; do not build toward it.

### Threat model (who the adversaries are)

Assume all three simultaneously:

- **Malicious/compromised relay operator** — the server is UNTRUSTED. It cannot read
  plaintext, but it can reorder, drop, replay, inject, and substitute anything it can
  see (envelope types, `messageId`, `mimeType`, public keys in transit).
- **Network MITM** — an on-path attacker between a client and the relay.
- **Malicious peer** — the other party in the chat.

---

## 2. Invariants that MUST NOT regress (verified-good today)

These were checked and found correct. Preserve them; add tests if you touch nearby code.

- **`crypto_kx` rx/tx separation is correct and load-bearing.** A→B messages seal under
  A's `tx` (= B's `rx`); the reverse direction uses the opposite key. This is what
  prevents the relay from *reflecting* your own ciphertext back to you (it won't open
  under your `rx`). Any refactor of `deriveSessionKeys`/`encryptMessage` must keep
  direction separation. Covered by `client/src/crypto/keys.test.ts`,
  `secretbox.test.ts`, `messages.test.ts`.
- **`crypto_secretbox_easy` nonces are fresh 24-byte random per message**
  (`secretbox.ts:6`), prepended to the ciphertext. No nonce reuse. Keep it.
- **Safety number is 160-bit BLAKE2b over the two sorted public keys**
  (`safetyNumber.ts`) — sound entropy. (Hardening in §L2 is additive, not a fix to a
  break.)
- **Dev overrides (`?screen=`, `?theme=`) are `import.meta.env.DEV`-gated**
  (`App.tsx:59`) and confirmed absent from production bundles. Keep the gate.
- **Dependency / secrets / source-map posture is clean.** No committed secrets, no
  prod source maps, no known-vulnerable pinned deps at review time.
- **The core promise holds:** no reviewed path lets the relay read plaintext. Every fix
  below must keep it that way.

---

## 3. Findings (Section A)

Ordered by severity. Each entry is self-contained.

---

### 🔴 H1 — Key-exchange MITM is defended only by an optional, unenforced safety-number check

- **Confidence:** High · **Category:** authentication / MITM · **Route:** design decision + M-size UI change
- **Files:** `client/src/App.tsx:181-191,265`; `client/src/screens/SafetyNumberScreen.tsx:88-94,128-157`; chat gate at `client/src/App.tsx:469-478`
- **Root cause:** The relay relays the `pubkey` envelopes, and the safety-number screen's
  `onVerified` simply advances to chat. The user reaches chat whether or not they actually
  compared the number out-of-band.
- **Attack scenario:** A malicious relay hands each side its own public key, derives two
  separate sessions, and transparently re-encrypts traffic between them — reading everything.
  The *only* thing that detects this is two humans comparing the safety number on another
  channel. Nothing in the app requires or even strongly encourages that.
- **Fix:** Keep the Signal-style model (this is inherent to fingerprint verification — do
  **not** try to make the relay trusted). Raise the floor:
  - Make skipping *deliberate*: require an explicit "I compared these and they match"
    affirmation (a distinct action from "continue"), not a single advance button.
  - Show a persistent **"Unverified — the relay could be listening"** banner in-chat until
    the user affirms a match; optionally block first send until then.
  - Persistent identity (Phase 5.1 / §S + B7) reduces this to a first-contact check via
    TOFU pinning — cross-reference that work.
- **Constraint check:** UI/UX only. No crypto change, relay stays untrusted. ✅
- **Acceptance criteria:** A user cannot reach the "verified" state without an explicit
  match affirmation; the unverified banner renders until then; manual two-browser eyeball.
- **Note:** The verifier downgraded the "unenforced" half to Medium (it is by-design for
  fingerprint UX). It stays clustered at **High** because it is the entire security promise
  of the product. This is a **triage decision for Jay** — how hard to gate vs. UX friction.
- **Branch:** `fix/enforce-safety-number-verification`

---

### 🔴 H2 — A second `pubkey` envelope silently re-keys the live session and resets the screen

- **Confidence:** High · **Category:** MITM / protocol state · **Route:** small direct patch (highest value-per-line)
- **Files:** `client/src/App.tsx:181-196` (the `pubkey` branch inside `exchangeKeys`)
- **Root cause:** The `pubkey` handler runs on *every* `pubkey` envelope for the connection.
  There is no "keys already established" guard.
- **Attack scenario:** After a session is live (and possibly verified), a malicious relay/peer
  sends a second `pubkey`. The client re-runs `deriveSessionKeys`, overwrites
  `sessionKeysRef.current`, recomputes a new safety number, and bounces the UI back to the
  safety-number screen — replacing the verified peer or forcing a silent re-key mid-chat.
- **Fix:** Make the handshake single-shot. Track a `keysEstablished` flag (a `useRef`, or a
  closure var in `exchangeKeys` set right after the first successful `deriveSessionKeys`). On
  any later `pubkey`, treat it as a protocol violation → route to the error screen; **never**
  silently re-derive. If re-keying is ever wanted it must be an explicit, mutually-driven,
  freshly-verified flow.

  *Illustrative (confirm exact structure before editing):*
  ```ts
  if (envelope.type === "pubkey") {
    if (sessionKeysRef.current) {            // already established → reject
      setScreen({ name: "error", message: "Unexpected key change." });
      return;
    }
    // …existing derive + safety-number path…
  }
  ```
- **Constraint check:** Client-side state hygiene only. ✅
- **Acceptance criteria:** After keys are set, a second injected `pubkey` does not change
  `sessionKeysRef` and does not return to safety-number; typecheck/tests/build green.
- **Branch:** `fix/handshake-rekey-guard`

---

### 🔴 H3 — Relay is wide open to denial-of-service

- **Confidence:** High · **Category:** availability / DoS · **Route:** direct patch (server)
- **Files:** `server/src/server.ts:11` (no `maxPayload`); `server/src/server.ts:9-58` (no rate/connection limits, no heartbeat); `server/src/rooms.ts:31-42` (unbounded rooms + 10-min timers)
- **Root cause:** `new WebSocketServer({ port })` inherits `ws`'s **100 MiB** default
  `maxPayload` (confirmed in installed `ws@8.21.1`). Each inbound frame is fully buffered and
  then `JSON.parse(raw.toString())`'d (a second copy) *before* any room-membership check. No
  per-IP/connection rate limiting, no total-connection or total-room cap, and no ping/pong
  dead-connection reaping.
- **Attack scenario:** An anonymous client (no room, no pairing) opens a socket and streams
  ~100 MiB frames (or many fragmented continuation frames) to OOM the single free-tier Render
  process, denying service to the real pair. Separately, spamming `create` accumulates rooms +
  10-minute timers; half-open sockets accumulate with no reaping.
- **Fix (all in-memory, no new dependency):**
  1. `new WebSocketServer({ port, maxPayload: <bytes> })` sized to the **largest legitimate
     encrypted voice envelope** (base64/JSON-inflated). A 60s clip is on the order of ~1 MB →
     base64 ~1.35 MB → pick a headroom value like **2 MiB** and confirm against a real
     max-length voice send. `ws` then rejects oversized frames (close 1009) before buffering.
  2. Per-connection message-rate throttle (token bucket / max msgs-per-sec) that closes on
     breach; per-source-IP connection cap via `req.socket.remoteAddress` in the `connection`
     handler; a global connection cap and a **total active-rooms cap** with a rejection path.
  3. Add a `ws` `isAlive` ping/pong sweep (`setInterval` ping; `terminate()` on missed pong)
     and/or an idle-connection timeout.
  4. Also cap **creates/rooms per connection** (ties to M5's one-room-per-peer invariant).
- **Constraint check:** Bounds resource use only; envelopes stay opaque; no crypto. ✅
- **Acceptance criteria:** Oversized frame is rejected/closed, not buffered; a flood of
  connections/messages from one source is throttled/capped; dead sockets are reaped. Extend
  `server/src/server.test.ts` / `rooms.test.ts` with a maxPayload-reject test and a
  room-cap-rejection test.
- **Branch:** `fix/relay-dos-limits`

---

### 🔴 H4 — No message-layer replay / reorder / drop protection

- **Confidence:** High · **Category:** protocol integrity / replay · **Route:** wire-format change → full workflow (bundle with Phase 5.2)
- **Files:** `client/src/crypto/secretbox.ts:4-20`; `client/src/App.tsx:197-241`
- **Root cause:** `secretbox` authenticates each message but there are no sequence numbers or
  a replay cache. The receiver keys rendered messages on the **sender-chosen, cleartext**
  `messageId`.
- **Attack scenario:** A malicious relay replays a captured `ciphertext`/`voice` envelope — it
  authenticates fine, so the victim re-decrypts and re-renders a duplicate. The relay can also
  silently reorder or drop messages. (Backlogged in the Phase 2 spec; still a real capability.)
- **Fix:** Seal an anti-replay value **inside** the encrypted payload (no new primitive —
  reshape `encryptMessage`/`decryptMessage` to seal a small JSON envelope, e.g.
  `{ v:1, seq, id, body }`, instead of raw text):
  - On receive, **drop any payload whose `seq` ≤ the highest accepted `seq`** for that
    direction, or whose `id` is already in a per-session seen-set.
  - **Critical detail (verifier):** do **not** dedup on the envelope's cleartext `messageId` —
    the relay chooses it and can mint a fresh one per replay. The authoritative value must be
    the sealed `seq` (or the per-message secretbox **nonce**, which is already unique per
    encryption and inside the payload). A cleartext-`messageId` `Set` alone is insufficient.
  - This subsumes the cleartext-`messageId` leak (§L4) and pairs naturally with M2/M6.
  - The Double Ratchet (Phase 5.2) provides this intrinsically via chain counters — **ship
    this as the first step of 5.2** rather than a throwaway.
- **Constraint check:** Uses only `crypto_secretbox`; value stays opaque/unforgeable to the
  relay. ✅
- **Acceptance criteria:** A replayed envelope is dropped (no duplicate message, no duplicate
  `delivered`); out-of-order/`seq`-regressed payloads are rejected; round-trip + tamper tests
  updated in `messages.test.ts`/`media.test.ts`.
- **Branch:** `feat/message-replay-protection` (or fold into the 5.2 branch)

---

### 🟠 M1 — Pairing hijack via room-code enumeration / race

- **Confidence:** High (verifier set Medium) · **Category:** pairing integrity · **Route:** direct patch (server) + optional UX
- **Files:** `server/src/rooms.ts:44-59`; `server/src/server.ts:39-45`
- **Root cause:** ~2³⁰ code space (6 chars, 32-char alphabet) with **no join-attempt rate
  limit**.
- **Attack scenario:** An attacker sprays `join` guesses to land in an active room as the 2nd
  peer before the real friend (becoming the MITM peer, caught only by the safety number), or to
  lock the friend out with "Room is full."
- **Fix:** The safety number stays the required MITM defense. Raise the enumeration bar:
  (1) join rate limits + total-room caps (from H3) make blind enumeration impractical;
  (2) consider a longer / higher-entropy code (UX cost; note this does **not** help against an
  attacker who already observed the code — it only fights enumeration);
  (3) defense-in-depth: surface "Room is full" to the *creator* as "someone already joined /
  possible unexpected third party," so a locked-out pair notices.
- **Constraint check:** No crypto change; relay stays opaque. ✅
- **Acceptance criteria:** Rapid failed joins from one source are throttled; creator sees a
  signal when their room fills unexpectedly.
- **Branch:** `fix/pairing-hijack-hardening` (can ride with `fix/relay-dos-limits`)

---

### 🟠 M2 — Unauthenticated envelope `type` enables cross-channel ciphertext confusion

- **Confidence:** Medium · **Category:** message authenticity · **Route:** wire-format change → workflow (bundle with H4)
- **Files:** `client/src/App.tsx:122,202,224,246`; `client/src/net/relayClient.ts:8-12`
- **Root cause:** Text, voice, and presence all seal under the same session `tx` key, and the
  logical `type` lives in the **cleartext, relay-controlled** envelope.
- **Attack scenario:** A relay relabels a captured `voice` ciphertext as `text` (or `presence`).
  The payload still authenticates, so it is mis-decoded / mis-routed — a confusion/injection
  primitive.
- **Fix (pick one; both are libsodium-only):**
  - **Preferred:** derive per-channel subkeys with `sodium.crypto_kdf_derive_from_key` from the
    `crypto_kx` session key, so a text ciphertext simply won't open under the presence key.
  - **Or:** include a domain tag inside the sealed plaintext (e.g. `{ v:1, channel:"text"|"voice"|"presence", body }`)
    and reject on decrypt if the inner `channel` ≠ the envelope `type`.
  - Do this together with H4's sealed envelope (same refactor).
- **Constraint check:** Audited-library KDF or plaintext framing; relay stays blind. ✅
- **Acceptance criteria:** A voice ciphertext presented as `type:"text"` fails to decode/verify
  and is dropped; per-channel round-trip tests added.
- **Branch:** fold into `feat/message-replay-protection` / 5.2

---

### 🟠 M3 — TLS (`wss://`) is neither enforced nor validated

- **Confidence:** High (verifier set Medium) · **Category:** transport · **Route:** small direct patch
- **Files:** `client/src/App.tsx:28` (`RELAY_URL`)
- **Root cause:** `RELAY_URL` defaults to `ws://localhost:8080`; a missing `VITE_RELAY_URL`
  falls back to `ws://` even in a prod build, with no failure.
- **Attack scenario:** A `ws://` deployment exposes the whole key exchange + room codes to an
  on-path network MITM (distinct from the relay operator). Browsers already block `ws://` from
  an `https://` origin, but nothing in-app fails closed or catches the http-origin misconfig.
- **Fix:** Startup guard — if `location.protocol === "https:"` and the resolved `RELAY_URL`
  does not start with `wss://`, **refuse to connect** (error screen), don't just warn. Gate the
  `ws://localhost` default behind `import.meta.env.DEV`. Optionally auto-normalize `ws://` →
  `wss://` on an HTTPS page. Document TLS as mandatory in the deploy docs.
- **Constraint check:** No crypto change; safety number remains the real MITM defense. ✅
- **Acceptance criteria:** On an HTTPS origin with a non-`wss` relay URL, the app shows the
  error screen instead of connecting; `ws://localhost` still works in `npm run dev`.
- **Branch:** `fix/enforce-wss-transport`

---

### 🟠 M4 — No Content-Security-Policy, security headers, or anti-framing on the client

- **Confidence:** High (verifier Medium) · **Category:** defense-in-depth / XSS / clickjacking · **Route:** small direct patch (config)
- **Files:** `client/index.html:1-13`; **no** `vercel.json` in repo (client is deployed to Vercel)
- **Root cause:** An app whose entire value is confidentiality ships with zero XSS containment
  and no framing protection.
- **Attack scenario:** Any injected/XSS script runs unrestricted and can exfiltrate decrypted
  plaintext or keys; the app (incl. the safety-number screen) can be framed for clickjacking.
- **Fix:** Add a strict CSP + headers via `client/vercel.json` (and/or a `<meta http-equiv>` CSP
  as a fallback for non-Vercel hosting):
  ```jsonc
  // client/vercel.json (illustrative — set connect-src to your real wss relay host)
  {
    "headers": [{
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy",
          "value": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' wss://YOUR-RELAY-HOST; base-uri 'none'; frame-ancestors 'none'; object-src 'none'" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "no-referrer" }
      ]
    }]
  }
  ```
  - Confirm the CSP against the real app: Vite may need `style-src 'unsafe-inline'` (inline
    styles are used, e.g. `VoiceMessageBubble` `animationDelay`); `media-src blob:` and
    `img-src data:` are needed for voice object-URLs and (future) avatar data-URLs. Tighten
    from there. Verify no console CSP violations in `npm run dev`/preview.
- **Constraint check:** Config only. ✅
- **Acceptance criteria:** Response carries the headers; app functions with no CSP violations;
  cannot be framed.
- **Branch:** `fix/csp-security-headers`

---

### 🟠 M5 — Relay room-lifecycle bugs (orphaned rooms, self-join, thin validation)

- **Confidence:** Medium · **Category:** state management / input validation · **Route:** direct patch (server)
- **Files:** `server/src/rooms.ts:31-59`; `server/src/server.ts:24-49`
- **Root cause / scenarios:**
  - **Orphan + timer leak:** repeated `create`/`join` from one socket overwrites
    `peerRooms.set(peer, …)`, stranding the earlier room and its 10-minute TTL timer.
  - **Self-join:** a creator can `join` their own code (`rooms.ts:49` length check passes),
    becoming both peers.
  - **Thin validation:** `roomCode` is used as a Map key with no type/shape check; a JSON `null`
    envelope can null-deref at `server.ts:33`, and a number/array can reach the join path.
- **Fix:**
  - At the top of `createRoom`/`joinRoom`, enforce one-room-per-peer: if `peerRooms.has(peer)`,
    prefer calling the existing `disconnect(peer)` first (also notifies a real partner via
    `peer-disconnected` and clears the prior timer) — better than a bare reject.
  - Reject self-join (joiner already a member of the target room).
  - Validate the parsed envelope before dispatch: it's a plain object; `type` is an allowlisted
    string; `roomCode` (when required) is a string of the expected length/alphabet — else reply
    with an `error` envelope. **Gate the allowlist only on the structural `create`/`join`
    branches** — the pass-through path for unknown types must stay opaque (required by the
    presence/receipts design in `decisions.md`).
- **Constraint check:** Server state only; opaque forwarding preserved. ✅
- **Acceptance criteria:** No orphaned rooms/timers after a double `create`/`join`; self-join
  rejected; malformed `create`/`join` gets an `error`, unknown types still forward. Extend
  `rooms.test.ts`.
- **Branch:** `fix/relay-room-lifecycle`

---

### 🟠 M6 — Unauthenticated cleartext `delivered`/`read` acks (forgeable + decryption oracle)

- **Confidence:** Medium · **Category:** protocol integrity / metadata · **Route:** wire-format change → workflow (bundle with H4)
- **Files:** `client/src/App.tsx:254-262` (handler), `208-216` / `231-239` (ack sent *inside* the decrypt try-block); `client/src/net/relayClient.ts:10-11`
- **Root cause / scenarios:**
  - Receipts are cleartext + unauthenticated → a relay can **forge** ("read" it never sent) or
    **suppress** them.
  - Subtler (completeness critic): the client sends `delivered` **only on successful decrypt**,
    so its mere presence tells the untrusted relay whether an injected/replayed ciphertext
    **decrypted** — a decryption-success oracle.
- **Fix:** Seal receipts inside the encrypted channel (reuse `encryptMessage`) with a body like
  `{ type:"ack", kind:"delivered"|"read", id }`. A forged/tampered ack then fails the MAC and is
  dropped, the relay can't read it, and the cleartext `messageId` leaves the ack envelope.
  Decouple ack emission from decrypt success (ack on receipt, or ack encrypted) so it stops
  being an oracle. **Note:** this closes *forgery*, not *suppression* — an untrusted relay can
  always drop packets; that residual is acceptable and should be documented.
- **Constraint check:** Reuses `crypto_secretbox`; relay stays blind. ✅
- **Acceptance criteria:** A relay-forged plaintext ack is ignored; `delivered` no longer leaks
  decrypt success; ack round-trip test added.
- **Branch:** fold into `feat/message-replay-protection` / 5.2

---

### 🟠 M7 — Add-only listeners stack; a post-handshake `error` envelope forces an error screen mid-chat

- **Confidence:** Medium · **Category:** protocol state / availability · **Route:** direct patch
- **Files:** `client/src/net/relayClient.ts:74-77`; `client/src/App.tsx:281-333` (connect handlers), `296-299` / `317-320` (persistent `error`→error-screen), `167-266` (`exchangeKeys`)
- **Root cause:** `RelayClient.onMessage` only *adds* listeners (returns a disposer that is
  never used here). The `handleStart`/`handleJoin` handler mapping `type:"error"` → error screen
  is never removed; re-pairing also registers duplicate handshake handlers.
- **Attack scenario:** A relay sends an `error` envelope after chat has started and yanks the
  user to the error screen (availability/UX abuse). Stacked handshake handlers can double-process
  a re-pair.
- **Fix:** Use the disposer returned by `onMessage` to scope listeners per phase / tear them down
  on transition; ignore `error` (or handle it non-destructively) once in-chat.
- **Constraint check:** Client state hygiene only. ✅
- **Acceptance criteria:** A post-handshake `error` envelope does not navigate away from chat;
  no duplicate handshake handlers after re-pair; typecheck/tests/build green.
- **Branch:** `fix/relay-listener-scoping`

---

### 🟠 M8 — Decrypted-audio object-URLs leak (replay-driven growth) + mic stream not always stopped

- **Confidence:** Medium/Low · **Category:** object-URL lifetime / privacy · **Route:** direct patch
- **Files:** `client/src/App.tsx:219-241`; `client/src/screens/VoiceRecorder.tsx:51-89`; `client/src/audio/recorder.ts:19-42`
- **Root cause / scenarios:**
  - Inbound voice object-URLs are revoked only on unmount/leave, so a relay replaying voice
    envelopes forces unbounded decrypted-audio accumulation. (H4's replay dedup — **on nonce/seq,
    not `messageId`** — closes the amplification; the per-message revoke is the independent half.)
  - `VoiceRecorder` leaks object-URLs on the discard/error and back-to-back re-record paths.
  - The `getUserMedia` mic track is stopped only inside `recorder.onstop`; if `new MediaRecorder`
    or `.start()` throws, the **mic stays live** (privacy leak).
- **Fix:** Revoke a message's `audioUrl` as soon as it is removed/superseded (not only on leave);
  cap retained inbound voice blobs; revoke on every discard/error/re-record path; stop
  `getUserMedia` tracks in a `finally`/catch so a failed recorder start can't leave the mic on.
- **Constraint check:** Client resource hygiene; no crypto. ✅
- **Acceptance criteria:** Replaying N voice envelopes does not retain N decrypted blobs; a failed
  recorder start releases the mic (track `readyState` ended).
- **Branch:** `fix/voice-url-and-mic-lifetime`

---

## 3b. Forward-looking design findings (Section S) — fix in the spec *before* building

These are **design** findings against not-yet-built features. The active post-rollback direction
is `docs/superpowers/specs/2026-07-22-local-profiles-design.md` (the "roll back the PIN screen"
commit superseded the earlier contacts-privacy PIN flow). Update the spec/plan; don't code yet.

### 🟠 S1 — The planned at-rest PIN vault is near-worthless as specced (highest-value pre-build catch)

- **Confidence:** High · **Files:** `docs/superpowers/specs/2026-07-22-local-profiles-design.md:93-104,132-139,167-177`; `docs/superpowers/specs/2026-07-22-contacts-privacy-design.md:13,168,255-256`; `client/package.json:14`
- **Root cause:** `crypto_pwhash` (Argon2id) is **not in the shipped `libsodium-wrappers`
  build** (it's in `-sumo`). The local-profiles spec flags this and falls back to
  `crypto_generichash(salt‖pin)` — a **fast** hash — over a 4-digit (~13-bit) PIN with
  *explicitly no lockout*. Both the stored `pinHash` and the PIN-derived history/vault key are
  then instantly brute-forced offline. The spec is honest that the PIN is "casual-inspection
  defense only," but the fast-hash fallback undercuts even that.
- **Fix (spec + build order):**
  1. Make **`libsodium-wrappers-sumo` a build-order prerequisite** for any at-rest feature (it's
     an audited library — constraint-compliant; it's a bundle-size change, not a free add). State
     it explicitly in the Architecture/Rollout section.
  2. **Forbid the `generichash`/fast-hash fallback** for the vault key. Argon2id only.
  3. For the identity-secret vault, require **SENSITIVE** `opslimit`/`memlimit` (or an explicit
     high custom cost); document per-unlock latency.
  4. **Allow/encourage an alphanumeric passphrase**, not only a 4-digit PIN, for anything
     protecting the identity secret — OR explicitly downgrade the claim to "casual snooping only"
     and keep the UI copy honest.
  5. Add an **on-device attempt delay/lockout** as a speed bump for the live-device case.
- **Constraint check:** `crypto_pwhash` params + UX only; audited library. ✅
- **Acceptance criteria (when built):** vault key is Argon2id-derived with documented cost; no
  fast-hash path exists; passphrase entropy validated.

### 🟠 S2 — Recovery code is the weak link

- **Confidence:** Medium · **Files:** `2026-07-19-persistent-identity-design.md:53-55,123-135`; `2026-07-22-contacts-privacy-design.md:52-53,197-200`
- **Root cause:** Plaintext in 5.1; only *optional* passphrase-wrap in 5.1a. The code restores the
  vault, so it bypasses the PIN entirely.
- **Fix:** Make passphrase protection **mandatory** whenever an app-lock PIN is set (default-on
  otherwise), same `crypto_pwhash`+`secretbox` path; show once, never persist; require the
  passphrase to unwrap on **import** so a leaked-but-wrapped code isn't directly usable; keep the
  "anyone with this code IS you" warning.

### 🟠 S3 — Peer profile card (name + avatar data-URL) rendered before verification, avatar is an untrusted sink

- **Confidence:** Medium · **Files:** `2026-07-22-local-profiles-design.md:202-215,223-226`
- **Root cause:** The encrypted `profile` card (`{ name, avatar }`, avatar = peer-controlled
  data-URL) is sent "once keys are established" and shown in the chat header — potentially before
  the (optional) safety-number check.
- **Fix (spec):** (a) render the card only *after/gated behind* verification and label it as
  unverified self-asserted presentation, never identity; (b) on **receive**, strictly validate the
  avatar is a `data:image/{png,jpeg,webp}` URL, enforce a hard max byte size, and decode it through
  an `<img>`/canvas **re-encode** — never inject into `innerHTML` or CSS.

### 🟡 S4 — Combined identity+ephemeral key derivation lacks domain separation / ordering

- **Confidence:** Low · **Files:** `2026-07-19-persistent-identity-design.md:146-151`
- **Fix (spec):** the 5.1 combiner must personalize the `generichash` with a fixed app/version
  context string and use a canonical, fixed input ordering (or use `crypto_kdf` with a domain
  label). Prevents cross-context key confusion.

### 🟡 S5 — Block / contacts-only access gate runs *after* the identity envelope

- **Confidence:** Low · **Files:** `2026-07-22-contacts-privacy-design.md:143-149,160-162`
- **Fix (spec):** make `refuse-blocked` and `refuse-unknown` byte- and timing-identical (same
  delay/no-op teardown path, no distinguishing envelope), and document that a peer holding the room
  code can still infer allow-vs-refuse from protocol continuation — so contacts-only is
  defense-in-depth over the room code, **not** an unlinkable membership secret.

---

## 3c. Low / Info findings (Section L)

Small, mostly self-contained. Batch them.

| ID | Finding | Files | Fix summary |
|---|---|---|---|
| **L1** | Peer public key never validated before `crypto_kx` | `client/src/crypto/keys.ts:19-30`; `App.tsx:183-184` | Reject a decoded pubkey that isn't `crypto_kx_PUBLICKEYBYTES` long / is all-zero before `deriveSessionKeys`; surface as key-exchange failure. |
| **L2** | Safety number lacks domain separation & isn't re-bound to the derived session key | `client/src/crypto/safetyNumber.ts:11-14`; `App.tsx:183-185` | Personalize the `generichash` with an app/version context string; optionally mix in a hash of the derived session key so the number binds the *session*, not just relayed pubkeys. |
| **L3** | Keys & decrypted plaintext/voice never zeroized | `App.tsx:363-380`; `client/src/crypto/keys.ts:15-29` | `sodium.memzero` secret/session key buffers on leave; drop decrypted buffers promptly. Best-effort in JS; pair with §B13. |
| **L4** | Cleartext `messageId` correlation, presence cadence, per-type routing (metadata) — *known/accepted* | `client/src/net/relayClient.ts:8-11`; `App.tsx:242-252` | Subsumed by H4/M6 (seal `messageId` inside the payload). Cadence/size leakage → §B12 (traffic-analysis resistance). Documented backlog item. |
| **L5** | No `Origin`/`verifyClient` check → cross-site WebSocket hijack | `server/src/server.ts:11-17` | Add a `verifyClient`/`WebSocketServer` origin allowlist for the deployed client origin(s). Low impact (no ambient auth) but cheap. |
| **L6** | Voice `mimeType` unvalidated (latent navigable-blob sink; not live today) | `client/src/crypto/media.ts:8-15`; `App.tsx:224`; `VoiceMessageBubble.tsx:44-50` | Allowlist expected audio MIME types on receive; replace/ignore others. Only bound to `<audio src>` today, so defense-in-depth. |
| **L7** | Invite-code hash unvalidated + lingers in URL/history before `replaceState` | `client/src/net/inviteLink.ts:20-23`; `App.tsx:61,157-163` | Validate length/charset in `parseInviteCode`; strip the hash as early as possible. |
| **L8** | Read-ack de-dup is **dead code** (`alreadyAcked` hardcoded `false`) + racy single-slot `pendingReadIdRef` | `App.tsx:31-48`; `client/src/protocol/readAckDecision.ts:8-12` | Track already-acked ids (a `Set`) and pass the real value; the `if (alreadyAcked) return false` guard is currently unreachable. Correctness cleanup. |
| **L-info** | `crypto.randomUUID()` assumes a secure context (fails on `ws://`/insecure fallback) | `App.tsx:341,354,214,237` | Resolved by M3 (force `wss://`/secure context). No separate action if M3 lands. |

Suggested combined branch for the mechanical ones: `fix/low-severity-hardening-batch`
(L1, L2, L5, L6, L7, L8). L3 pairs with §B13.

---

## 4. Section B — New security features to add (not bug fixes)

Prioritized. "Slot" = existing roadmap phase. Effort S/M/L. All respect the hard constraints.

| # | Feature | Effort | Slot | Note |
|---|---|---|---|---|
| **B1** | Enforce/strengthen safety-number verification (explicit match affirmation + persistent unverified banner) | M | 4.6 (SafetyNumberScreen) / 6 | = H1 remediation |
| **B2** | Per-message replay/reorder protection (monotonic seq inside the AEAD; dedup on seq/nonce) | M | **5.2** (first step) | = H4 |
| **B3** | Lock the session after first key exchange (reject re-keying) | S | 4.7 triage / 6 | = H2 |
| **B4** | Relay abuse controls: `maxPayload` + rate/connection/room caps + ping/pong reaping | M | 6 (cheap — do now) | = H3 |
| **B5** | Enforce `wss://`, fail closed on missing/insecure relay URL | S | 4.5 hosting / 6 | = M3 |
| **B6** | Strict CSP + security headers (incl. `frame-ancestors`) | S | 4.5 hosting / 6 | = M4 |
| **B7** | Key-continuity / TOFU pinning on persistent identity (detect swapped returning-peer key) | L | **5.1** | biggest structural MITM win |
| **B8** | Authenticate `type`/receipts/presence inside the encrypted channel (also hides `messageId`) | S–M | **5.2** | = M2 + M6, addresses cleartext-`messageId` backlog |
| **B9** | Real slow KDF + lockout for at-rest (Argon2id via `-sumo`; no fast-hash fallback; passphrase over 4-digit PIN) | M | 5.1a / local-profiles | = S1 |
| **B10** | Validate peer pubkey + harden room lifecycle (no self-join, no `peerRooms` overwrite, longer/one-time codes) | M | 6 / 4.7 triage | = L1 + M5 + M1 |
| **B11** | Validate/re-encode peer avatar (image-only, bounded, sandboxed `<img>`; gate card behind verification) | S | with local-profiles | = S3 |
| **B12** | Traffic-analysis resistance: pad ciphertext to size buckets; jitter presence cadence | M | 6 (dovetails 5.7) | reduces relay metadata |
| **B13** | Zeroize key material (`sodium.memzero`) + per-message object-URL revocation | S | 5.1a / 6 | = L3 + M8 |

**Cheapest high-impact wins that need no Phase-5 scope:** B3/H2, B4/H3, B5/M3, B6/M4, plus the
M5 server hardening.

---

## 5. Section C — Uncertain & refuted (do not silently drop / do not "fix")

### C.1 Uncertain — flagged, kept for triage

- **U1 — Dropping the 5.1a name-based "key-changed" warning removes the only *automatic*
  re-verify prompt.** `2026-07-22-contacts-privacy-design.md:29-38,123-130`. A UX/detection
  regression, not a confidentiality loss (the safety number was always the real defense). Verifier
  agreed it's real, downgraded to Low. **Triage call for Jay:** is the simpler two-branch screen
  worth losing the automatic nudge? Consider keeping a key-change *notice* even under key-based
  recognition.
- **U2 — Initiator/responder role is influenced by who creates vs joins (relay-authored events).**
  A reviewer imagined a relay-forced "role-collision" DoS; the verifier showed it is **not
  achievable** — the `crypto_kx` role is bound to the *local* button press (`handleStart` →
  initiator, `handleJoin` → responder), not chosen by the relay. **Info only — no action.**
- **U3 — Phase 5.1 would store the identity *secret* key raw in IndexedDB before the at-rest wrap
  lands.** `2026-07-19-persistent-identity-design.md:53-55,110-116`. Out of the stated threat model
  (needs local device access / XSS) and mooted by building 5.1+5.1a together (or by local-profiles
  superseding it). Revisit when building; ensure the at-rest wrap (S1/B9) lands with, not after,
  raw key persistence.

### C.2 Refuted — verified NOT a bug (don't add defensive code expecting a crash)

- **"Unguarded `peer.send()` in `forward()`/`joinRoom()`/`disconnect()` can throw on a stale
  socket and crash the relay's message handler."** `server/src/rooms.ts:61-71,84-86`;
  `server/src/server.ts:49`. **Refuted:** the verifier read `ws@8.21.1` — `send()` on a
  CLOSING/CLOSED socket invokes the callback with an error (or drops silently when no callback is
  passed); it does **not** throw synchronously, so there is no crash. (These were the reviewer's
  own seeded candidates; adversarial verification correctly killed them.) Wrapping sends in
  try/catch is harmless but unnecessary. **Note:** the room-lifecycle *leak* in M5 is a separate,
  real issue — that one stands.

---

## 6. Appendix — Suggested batching & sequencing

1. **Batch 1 — quick server/config wins (no wire change):** H2, H3, M3, M4, M5, M1. Independent,
   low-risk, high value. Separate branches or a couple of grouped ones.
2. **Batch 2 — low-severity hardening:** L1, L2, L5, L6, L7, L8 (+ L3/B13). One branch.
3. **Batch 3 — the wire-format cluster (full workflow, bundle into Phase 5.2):** H4 + M2 + M6 +
   B8. Design → spec → plan → SDD; the Double Ratchet subsumes the anti-replay counters.
4. **Batch 4 — the H1 verification-UX decision:** needs a Jay triage call first (how hard to gate).
   Pairs with the 4.6 SafetyNumberScreen work and B7 (5.1 TOFU pinning).
5. **Before building any at-rest / identity feature:** apply the §S spec edits (S1–S5), especially
   **S1/B9** (Argon2id via `-sumo`, no fast-hash fallback) — that's a prerequisite, not a follow-up.

Cross-reference: the raw per-dimension findings and full verifier reasoning/exploit traces live in
the Phase 4.7 review workflow output (66 agents; run `wf_3a953a1e-94b`). This doc is the
consolidated, deduplicated, triage-ready view.
