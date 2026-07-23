# Decisions Log

Record of non-obvious calls made on this project and why — so any agent
picking this up understands the reasoning, not just the outcome. Newest
entries at the top.

Format: **Date — Decision.** Rationale. (Decided by: who)

---

- **2026-07-23 — Track B relay hardening (`fix/relay-dos-limits`): DoS + lifecycle
  limits on the relay; several implementation calls, all server-only (no crypto,
  no wire change).** Closes review H3/M1/M5/L5 — the last piece of the Phase 5.2
  cluster, built as direct-patch `superpowers:receiving-code-review` work per the
  review's routing (three commits B1-B3 + this log). Calls:
  (1) **`maxPayload` = 2 MiB**, the review's recommended size. Confirmed against a
  realistic worst-case voice send *at the protocol level* rather than a real
  browser recording (no browser-automation tool here, as in every prior phase): a
  throwaway two-client probe against the running hardened relay forwarded a
  1.78 MiB opaque `msg` envelope (well above a real ~1.35 MB 60s Opus envelope) and
  a 3 MiB frame was rejected with close 1009. The recorder sets no
  `audioBitsPerSecond`, so the browser picks a conservative Opus voice bitrate —
  2 MiB has comfortable headroom. It's one constant; bump it if a real 60s clip is
  ever seen near the cap.
  (2) **Origin allowlist fails OPEN, by design.** The relay is live on Render and
  the exact production Vercel origin isn't known here; a strict default could lock
  out prod. So `verifyClient` allows any origin when the `ALLOWED_ORIGINS` (comma-
  separated) env var is unset — logging a one-time startup warning — and *always*
  allows localhost so `npm run dev` works. **Action for Jay:** set the real Vercel
  origin(s) in Render's env to actually restrict it, or leave it permissive. (L5.)
  (3) **Abuse limits are code constants, overridable via a new `startRelay` options
  arg** (tests inject tiny values); only the origin allowlist reads env, since it's
  the one that needs per-deploy config. Values: 2 MiB payload; 1000 global / 30
  per-IP connections; 5000 active rooms; a 60-token / 30-per-sec message bucket
  (generous — a real 2-person chat peaks at a few msgs/sec) that closes the socket
  on breach; a tighter **dedicated join bucket** (10 / 1-per-sec) so blind
  room-code enumeration is throttled without affecting a legit one-time join; a 30s
  ping/pong heartbeat reaping half-open sockets.
  (4) **Connection caps are enforced in the `connection` handler (post-upgrade,
  close 1013), not `verifyClient`** — simpler correct increment/decrement paired
  with the socket's `close` event, at the cost of completing the WS handshake
  before rejecting an over-cap socket (negligible; the rate limiter + per-IP cap
  are the real flood defenses).
  (5) **Global active-room cap is a pre-check (`RoomManager.atRoomCapacity()`)
  rather than changing `createRoom`'s return type** — keeps its `string` signature
  and every existing call site/test intact. Marginal edge case accepted (a peer
  alone in a room re-creating at exactly the cap is rejected even though create
  would free their old room first — noise at a 5000-room cap).
  (6) **One-room-per-peer + self-join live in `RoomManager` (`createRoom`/
  `joinRoom`)**, calling the existing `disconnect(peer)` first on a second
  create/join (clears the stale TTL timer, notifies a real partner) — closing the
  M5 orphan/timer leak; self-join is rejected *before* that teardown so it isn't
  erased. **Create/join SHAPE validation lives at the wire layer (`server.ts`)**
  and gates ONLY those two structural branches — the unknown-type pass-through
  (`pubkey`, the unified opaque `msg`) is forwarded verbatim and untouched, since
  all post-handshake E2EE traffic depends on the relay never inspecting it.
  Refuted finding §C.2 left alone: no try/catch was added around `peer.send()` —
  `ws.send()` on a closing/closed socket doesn't throw synchronously. Verified:
  `server` 30/30 vitest, `npm run build` (tsc) clean, both dev servers boot, probe
  as above. Not merged yet — a fast-forward merge redeploys the relay to Render
  (production), so it waits on Jay. (Decided by: Jay (direction: harden the
  backend, keep the UX identical) + Claude (implementation calls))

- **2026-07-22 — Building Phase 5.2 (forward-secrecy ratchet) now, ahead of any
  remaining 5.1 work, and dropping 5.2's old dependence on persistent-identity
  keys.** With the UI/features ship-ready, Jay chose to "turn up the complexity"
  on the backend and strengthen the encryption for the submission (see the
  `phase-5-security-direction` steer: keep the user-facing flow identical, focus
  on data handling under the hood). The headline is a **Double Ratchet** — the
  Signal-style per-message key rotation giving forward secrecy (a stolen key
  can't read past messages) + post-compromise "self-healing" (a transient
  compromise heals on the next DH step). Key call: **it does NOT need persistent
  identity.** `roadmap.md` had 5.2 "built on top of 5.1's identity/ephemeral key
  split," but persistent identity was retired for Local Profiles, which
  deliberately left session crypto untouched — so the ratchet is seeded from the
  existing ephemeral `crypto_kx` handshake instead, making 5.2 independent of 5.1
  and buildable on today's `main`. This reorders the roadmap (5.2 before the rest
  of 5.1); Jay green-lit it. Built entirely from primitives already in the shipped
  `libsodium-wrappers` build (`crypto_scalarmult`, `crypto_aead_xchacha20poly1305`,
  keyed `crypto_generichash`) — **no new dependency, no `-sumo`** (the Phase 4.7
  review's note that `crypto_kdf` needs `-sumo` was checked and is wrong for this
  build; that caveat only applies to `crypto_pwhash`/Argon2, a different feature).
  The same refactor seals framing (channel/`messageId`/`mimeType` move inside the
  ciphertext) and pads payloads to size buckets, collapsing the content/signal
  envelopes into one opaque `msg` type (the relay still forwards it blindly — no
  server change). This closes review findings H4, M2, M6, L4, H2 and partially
  B12; the safety number and `crypto_kx` rx/tx separation are preserved unchanged.
  A separate branch (`fix/relay-dos-limits`) hardens the relay itself
  (H3/M1/M5/L5) — independent, no crypto. Full design:
  `docs/superpowers/specs/2026-07-22-phase5.2-forward-secrecy-ratchet-design.md`;
  plan: `docs/superpowers/plans/2026-07-22-phase5.2-forward-secrecy-ratchet.md`.
  Deliberately NOT changing: first-contact MITM is still gated by the safety
  number (the identity/TOFU option that would change the UX was set aside per the
  steer). Branch: `feat/forward-secrecy-ratchet`. (Decided by: Jay (direction +
  go-ahead) + Claude (crypto/design/implementation calls))

- **2026-07-22 — Error screen extracted from the retired identity branch and
  shipped to `main` on its own, rather than merging the stranded branch or
  hand-redoing the wiring.** The error screen was already built (commit
  `cf92d00`: a themed `ErrorScreen` + `errorScenario.ts` with six scenarios, a
  `?screen=error` dev preview, the `App.tsx` wiring replacing the bare
  `<h1>Something went wrong</h1>` placeholder, and the design HTML), but it sat
  on `feat/error-screen`, which was stacked on top of the persistent-identity/PIN
  work — the direction retired in favor of Local Profiles and rolled back off
  `main` (`1ee0e35`, see the "Retired persistent identity" entry below). So the
  screen had never reached production, and merging that branch as-is would have
  re-shipped the rolled-back PIN work. Since it has no actual dependency on the
  identity code (verified: `ErrorScreen`/`errorScenario` reference nothing about
  identity/vault/PIN, and its `App.tsx` diff only touches error-handling paths
  that also exist on `main`), the clean fix was to cherry-pick just `cf92d00`
  onto a fresh branch off `main` — which applied with zero conflicts
  (`screenOverride.ts` byte-identical to its base; main's `App.tsx` still had
  every context line the patch expected, the identity wiring being elsewhere in
  the file) — verify (typecheck / 104 tests / build all green), and fast-forward
  merge to `main` (`275d834`) + push, chosen over merging the whole stranded
  branch or re-implementing the wiring by hand. Committed directly on `main`,
  like the other deploy/rollback commits. Note: the earlier PIN rollback
  (`1ee0e35`) was never logged as a decision in its own right — it's captured
  indirectly by the "Retired persistent identity" entry below. Residual: the six
  error states are unverified pixel-wise (no browser automation here; preview via
  `?screen=error&scenario=…`). (Decided by: Jay (asked to get it into
  production) + Claude (extraction approach))

- **2026-07-22 — Profile avatars on messages + a click-to-open profile card
  (extends Local Profiles).** Design calls with Jay: **hybrid, not full
  Discord** — keep the themed left/right bubbles and just add a small clickable
  avatar beside each message (peer's on incoming, yours on outgoing), rather than
  rebuilding the message area as Discord-style rows (which would retire the
  bubble animation / read-receipt work). Avatar shows on the **last message of a
  consecutive run** (`endsGroup` + `align-items: flex-end`) — the iMessage-tail
  position that fits bubbles, vs Discord's top-of-run. The card shows name +
  picture + **device** ("computer"/"phone"): device is a best-effort UA
  heuristic (`profiles/device.ts`) carried inside the existing *encrypted*
  `profile` card (no new envelope; relay stays blind), gated by the same opt-in
  sharing toggle — accepted that it's a small extra metadata disclosure to the
  peer and can be wrong/spoofed. Peer hasn't shared → avatars/card fall back to
  the default cat + "Anonymous". `ProfileCard` is a lightweight popover anchored
  above the clicked avatar (no positioning lib). (Decided by: Jay (direction) +
  Claude (implementation calls))

- **2026-07-22 — Retired persistent identity (5.1) + contacts privacy (5.1a) in
  favor of "Local Profiles"; built Layer A.** After the persistent-identity +
  PIN/contacts build was rolled back (`main` @ `1ee0e35` "Redeploy the
  pre-identity client"), Jay chose a lighter, UI-first direction and said he
  likes it a lot better. Local Profiles = device-local, PIN-gated profiles
  (name + picture) with an always-present **Anonymous** default, plus opt-in
  name/photo sharing with the peer. Key calls (Jay unless noted): **light/local
  only** — no long-term identity keypair, session crypto unchanged, no server
  change; **PIN is a 4-digit local access gate**, salted-hashed, explicitly NOT
  encryption (the UI says so); **Anonymous** shares nothing and keeps no history;
  **avatar** is an uploaded photo or a single bundled default picture (the
  taiyaki-hat cat Jay supplied) — no emoji set, one fewer dependency; **sharing
  is opt-in, default off**, and the name/photo go to the peer as an *encrypted*
  `profile` envelope (relay-blind, same pattern as `presence`). Claude calls:
  archive-only history + at-rest encryption under the PIN for the deferred Layer
  B; the profile card is sent right after the key exchange. Layer A (profiles +
  PIN + modal + sharing) is built on `feat/profiles`; per-profile conversation
  history is Layer B (a separate plan). The 5.1/5.1a specs are shelved, not
  deleted. Spec: `docs/superpowers/specs/2026-07-22-local-profiles-design.md`;
  plan: `docs/superpowers/plans/2026-07-22-local-profiles.md`. (Decided by: Jay
  (direction) + Claude (implementation calls))

- **2026-07-22 — Building Phase 5.1 (persistent identity) + 5.1a (contacts
  privacy settings) now, together, ahead of the 4.6/4.7 ordering.** Jay asked to
  build the contacts-privacy spec; since it's an extension that sits entirely on
  the still-unbuilt 5.1 foundation (identity keypair, contacts store, `identity`
  envelope, combined key derivation), "following the spec" requires building 5.1
  first. Jay chose to build them **together** on one feature branch rather than
  5.1-then-extension, because they modify the same surfaces and a split would
  mean building-then-reworking (5.1's three-branch safety screen collapses to
  two; the plaintext contacts store becomes encrypted). This overrides the
  2026-07-20 decision that put Phase 4.6 (SafetyNumberScreen styling) and 4.7
  (Fable code review) before any Phase 5 work — Jay explicitly accepted that
  trade. Built on branch `feat/persistent-identity-contacts`. Specs:
  `docs/superpowers/specs/2026-07-19-persistent-identity-design.md` +
  `docs/superpowers/specs/2026-07-22-contacts-privacy-design.md`. (Decided by:
  Jay)

- **2026-07-22 — Contacts privacy settings brainstormed and spec'd as an
  extension to Phase 5.1; three settings, headline directions chosen by Jay,
  finer calls delegated to Claude.** Full design in
  `docs/superpowers/specs/2026-07-22-contacts-privacy-design.md`. Jay wanted a
  contact feature "similar to crypto" (a public-key / address-book model — which
  5.1's identity-key contacts list already is) with more privacy settings, chose
  to build on 5.1, and picked three: (a) **per-contact pseudonyms**,
  **cosmetic** (one shared identity key; choose the name/none each contact sees
  + local-only labels) over true per-contact unlinkability (a separate key per
  relationship — much larger, breaks the single recovery code / one safety
  number; deferred); (b) **contacts-only mode + block list**, opt-in / off by
  default; (c) **at-rest encryption** of the identity/contacts store, unlocked
  with a PIN + **idle re-lock (session timeout)** over app-lock-every-launch or
  lazy. Delegated implementation calls (Claude):
  (1) **Recognition becomes key-based only** — 5.1's name-based "key-changed"
  warning branch is dropped (self-asserted names are now cosmetic/optional, so
  correlating a new key to an old contact by name is unreliable and noisy; the
  safety number was always the real protection, and 5.1 framed the warning as
  routing into it, not replacing it). 5.1's three `SafetyNumberScreen` branches
  collapse to two (recognized / new); the `identity` envelope's `displayName`
  becomes optional (anonymous presentation). This overrides part of the Approved
  5.1 spec — confirmed with Jay before writing it down.
  (2) **"Join as" picker** on the start/join screen (default name / saved alias
  / anonymous), scoped to the room and chosen before the handshake — sidesteps
  the fact that both peers send their `identity` envelope simultaneously on
  `peer-connected`, so you can't pick a per-contact name after learning who the
  peer is without a two-phase handshake.
  (3) **Access gate keys on the identity key, never the presented name** (pure
  `net/accessControl.ts`), so anonymous-but-known peers are allowed and
  unknown-but-named peers refused; `refuse-blocked` is silent (looks like a
  failed connection — no block signal, no retaliation bait).
  (4) **At-rest uses libsodium only** — `crypto_pwhash` (Argon2id) derives the
  vault key and the existing `crypto_secretbox` wraps the identity secret key +
  contacts store (no new primitive). Idle re-lock gates the contacts/identity
  store but does **not** kill an active in-memory chat (its session keys are
  already derived, independent of the identity secret). Forgot-PIN restores via
  5.1's recovery code; the recovery-code export gains **optional passphrase
  protection** (nudged when a PIN is set) so it isn't the weak link.
  Pure logic (`atRest`, `lockState`, `accessControl`, extended `recoveryCode`)
  gets Vitest coverage; screens are manually verified, per the standing
  convention. No server change. Documented residual limits: pseudonyms hide
  names not the shared key (colluding contacts can still correlate — true
  unlinkability deferred); blocking is per-key not per-person; at-rest
  encryption protects a locked/stolen device, not malware-while-unlocked or a
  known PIN; no PIN brute-force lockout this pass (relies on Argon2id cost).
  Design-ahead — build stays gated under Phase 5.1 (and Phase 5's 4.6 / 4.7
  prerequisites), same as the presence indicator. (Decided by: Jay (headline
  directions) + Claude (implementation calls))

- **2026-07-22 — Seal-slider spark effect on the safety-number screen: a
  canvas particle layer; three design directions + several implementation
  calls.** Brainstormed with Jay from scratch (make the "drag to seal" slider
  throw sparks as it moves right, as rich and smooth as possible); full design
  in `docs/superpowers/specs/2026-07-22-seal-slider-sparks-design.md`. Jay chose
  the three headline directions: **canvas particle system** (over lightweight
  CSS/DOM sparks or a particle-library dependency), **rainbow embers** whose hue
  is sampled from the existing trail gradient at each spark's birth point (over
  a hot-friction or electric/plasma palette), and **full cinematic** intensity
  (embers escape up off the rail while dragging + a radial burst on seal). The
  finer implementation calls (Claude):
  (1) The spark canvas is a **persistent child of `.confirm-key__seal`, rendered
  outside the `phase === "verify"` conditional.** On seal that block (track +
  knob) unmounts, so a canvas nested inside it would vanish before the burst
  could draw; as an outside sibling it survives to shower over the "Channel
  sealed" box during the existing `OPENING_HOLD_MS` hold.
  (2) **The loop runs for the component's lifetime rather than the spec's
  "self-park + restart" model.** Self-parking would need an imperative handle or
  the parent re-kicking the loop; since `SafetyNumberScreen` is short-lived and
  an idle frame is just one cheap `clearRect` on a small canvas, always-running-
  while-mounted is simpler and stays fully ref-driven — the `holdingRef` the
  spec earmarked for parking wasn't needed and was dropped from the component's
  props.
  (3) **The one-shot seal "sheen" sweep moved from the fill to the
  `.confirm-key__sealed-box`.** The spec put it on the fill, but the fill lives
  in the verify block that unmounts on seal, so it can't sweep post-seal; the
  green sealed box carries it instead (same reused global `sheen` keyframe).
  (4) **Physics are dt-normalized to 60fps units** (motion speed is refresh-rate
  independent) while emission stays per-frame — a 120Hz display simply throws
  denser sparks, bounded by the `MAX_PARTICLES` cap, which is fine.
  (5) **Keyboard parity via a synthetic velocity impulse:** `ArrowRight` briefly
  sets `velocityRef` so the same velocity-driven emission path puffs for that
  step; Enter / arrow-to-100% seal and trigger the burst like a drag does.
  The pure emission-count + trail-color-sampling math is extracted to a tested
  `screens/sparkModel.ts` (matching `barPhases.ts` / `readAckDecision.ts`); the
  canvas drawing itself is visual-only with no unit test, per the project's
  standing convention. Reduced motion renders no canvas but keeps a
  progress-scaled static knob glow. No new dependency, no crypto/relay/server
  change. (Decided by: Jay (design directions) + Claude (implementation calls))

- **2026-07-22 — Peer presence indicator designed as an *encrypted*
  typing+recording signal; several design/implementation calls.** Brainstormed
  with Jay from the Phase 5 backlog "peer is typing" item; full design in
  `docs/superpowers/specs/2026-07-22-typing-presence-design.md`. Jay set the
  direction (classic Instagram-style dots with a Trojan Troy touch; encrypt +
  respect Ghost Mode; cover text *and* voice recording), then delegated the
  finer calls ("do whatever you think is best").
  (1) **Transport is client-only, not a "protocol change."** The Phase 4 note
  (`decisions.md`, 2026-07-19) that a typing indicator needs a relay/protocol
  change is corrected: the relay forwards unknown envelope types opaquely
  (same as `ciphertext`/`voice`/`delivered`/`read`), so a new `presence`
  envelope is one line in the client `Envelope` union with zero server work.
  `roadmap.md`'s backlog note updated to match.
  (2) **The presence state is encrypted**, unlike the cleartext
  `delivered`/`read` acks — the payload is a tiny JSON `{state}` sealed
  through the existing `encryptMessage`/`secretbox` path (no new primitive),
  so the relay can't tell typing from recording from stop. The `type:
  "presence"` field stays cleartext (structural routing, same category as the
  already-cleartext `messageId`). Accepted residual leak: the relay can still
  see presence-packet *cadence* (traffic analysis) even without contents —
  same threat-model line as `messageId`, hardening deferred to Phase 5.
  (3) **Ghost Mode is broadened** from "suppress read receipts" to "don't
  broadcast my activity" — it now also suppresses outgoing presence, reusing
  the same `trojan-troy-ghost-mode` toggle/`ghostModeRef` gate (no new
  setting). It governs only what you send; you still see the peer's presence.
  Settings "Privacy" copy to be updated.
  (4) **Send model is a throttled heartbeat** (~2.5s while active) + immediate
  stop, with the receiver auto-expiring the indicator (~5s) as a dropped-stop
  safety net; the pure timing logic goes in `protocol/presenceState.ts` with a
  unit test, matching `messageStatus.ts`/`readAckDecision.ts`.
  (5) Delegated calls: **continuity** is a light overlapping fade of the dots
  bubble into the arriving message (not a full shared-element morph — brittle
  across variable heights, and there's no layout-animation lib; the message's
  existing `DecryptReveal` reveal still carries the payoff);
  **recording variant** = mic glyph + dots labelled "recording audio…";
  **Apple theme** gets a flat grey iMessage-style bubble (not skipped),
  Iris/Pulse get periwinkle glass beads + the currently-unused `glowPulse`
  keyframe + the signature easing.
  (Decided by: Jay (feature direction) + Claude (implementation calls))

- **2026-07-22 — Reworked the incoming-message "decrypt" reveal from a
  per-character scramble to a width-driven focus sweep (`CipherText` →
  `DecryptReveal`).** The old scramble read as a bug rather than a feature for
  four reasons: (1) the scramble layer used the bubble's proportional font, so
  random-width glyphs made the text wobble horizontally frame to frame; (2) the
  reveal outlasted the bubble's entrance animation, so the text kept flickering
  after the bubble had visibly settled; (3) the scramble alphabet was lowercase
  alphanumeric only, so real text (capitals/punctuation) resolved out of a
  character set that never matched it, reading as corruption; and (4) it was a
  per-character lock front, which needs length to read as a "sweep" — a two-char
  message like "hi" got ~744ms of two glyphs strobing with nothing sweeping (Jay's
  main complaint). The new effect renders the real text throughout (no scramble):
  a blurred+dim copy in normal flow reserves the wrapped box, a sharp copy is
  masked in on top, and a glowing `--accent`-colored edge sweeps left→right. It's
  one fixed-duration (560ms) CSS timeline tied to the bubble's width via an
  animated `mask-position`, so a two-letter message sweeps exactly like a
  paragraph — fixing the short-message case by construction, along with the wobble
  (real glyphs at fixed positions), the trailing flicker (the sweep now ends
  within the entrance envelope), and the alphabet mismatch (there's no scramble at
  all). Bonus: it's simpler and more accessible than the scramble — no rAF loop,
  and the sharp text is real from the first frame. Implementation calls: renamed
  the component (nothing "cipher" remains) and retired `cipherReveal.ts` + its
  Vitest test — the effect is now pure CSS with no per-character timing logic left
  to test, so this branch adds no new unit tests (consistent with the repo rule
  that only pure-logic modules get coverage; the animation itself is verified by
  eye). The surrounding gate is unchanged: still incoming-only, Iris/Pulse-only,
  once per message id, Apple stays instant, `prefers-reduced-motion` shows text
  immediately. The per-bubble `bubbleDecryptGlow` box-shadow bloom was removed —
  the sweep's glowing edge replaces it. Chosen from four brainstormed directions
  (focus sweep / cipher scan / redacted-block / minimal fix). (Decided by: Jay
  (picked the focus-sweep direction) + Claude (implementation calls))

- **2026-07-21 — Home-screen (`StartJoinScreen`) redesign + connecting-bar
  wiring, built from the Fable home handoff; several implementation calls.**
  The Fable home handoff (`ui/Trojan Troy Home Screen/Trojan Troy Home.dc.html`)
  was ported as normal feature-branch work, same as the waiting-room task; it
  lives alongside the desktop-redesign handoff under `ui/` (see `ui/README.md`).
  The implemented React screens (`StartJoinScreen`, `ConnectingBar`) are the
  source of truth for the design — the `.dc.html` is reference/provenance only,
  not part of the build. `SafetyNumberScreen` styling stays open.
  (1) `StartJoinScreen` follows the `WaitingScreen` template — its own fixed
  Iris-Glass gradient shell + the shared `<AmbientOrbs/>`, hardcoded palette
  (theme-independent), staggered rise-in entrances on the signature easing —
  so the entry screen flows into the waiting/loading screens it precedes.
  (2) The handoff's top-right "Demo relay / Warm / Cold" controls were dropped
  from the shipped screen: they're the designer's preview harness for driving
  the bar without a live relay (the same category as the Phase 4 mockup's
  "demo stand-ins"), not product UI. A dev-only `?screen=connecting` override
  (extending `screenOverride`) replaces them for eyeballing the bar's "alive"
  cold-start state without a relay. (3) The connecting bar is driven by the
  REAL connection lifecycle, wired via a `connectStatus` prop
  (`idle | connecting | connected`) passed from `App` down to `StartJoinScreen`
  (chosen over a callback/ref handle to keep `App.tsx` changes minimal and
  localized for the in-flight `fix/security-review-findings` merge). `App`
  flips it to `connecting` on tap and `connected` on the real event
  (`created` for Start, `peer-connected` for Join), then holds a beat
  (`CONNECT_COMPLETE_HOLD_MS`, mirroring the existing `HANDSHAKE_MIN_MS`
  pattern) at 100% before `setScreen`. The error path (relay unreachable / bad
  code / `waitForOpen` reject) resets `connectStatus` to `idle` so the bar
  never hangs or falsely completes. (4) For Join, `exchangeKeys` is called
  IMMEDIATELY on `peer-connected` (only the `setScreen` is delayed for the
  beat), because `RelayClient.onMessage` stacks listeners rather than replacing
  — delaying the exchange would drop the peer's pubkey (no handler registered
  yet) and hang the handshake. The delayed transitions use a functional
  `setScreen` guard (`prev.name === "start"`) so a peer connecting inside the
  ~1.25s hold window can't be clobbered. (5) The bar is modelled in phases
  (surge → hold → complete → settle → exit) with CSS width transitions exactly
  like the handoff — NOT a per-frame JS fill curve — with the pure phase→visual
  mapping + timings factored into a tested `barPhases.ts` (in the `percent.ts`
  spirit). The "alive" sheen + breathing-glow are CSS layers independent of the
  fill %, killed by `prefers-reduced-motion`. (6) Reused the shared
  `SECURITY_TICKER_TEXT` and `<AmbientOrbs/>` rather than the handoff's slightly
  different marquee copy / corner-anchored orbs, for consistency with the
  loading/waiting screens (the chat-polish review flagged duplicated constants
  as a smell). (Decided by: Jay (design) + Claude (implementation calls))

- **2026-07-21 — Waiting-room redesign built directly from Jay's inline brief;
  six related implementation calls.** The task brief delivered the approved
  "Radar / Signal" design plus a file-by-file spec directly, so this was built
  as normal feature-branch work rather than the full
  brainstorm→spec→plan→SDD cycle Phase 4.6 nominally prescribes; only
  `WaitingScreen` was built (plus a functional `StartJoinScreen` prop), so
  4.6's `StartJoinScreen`/`SafetyNumberScreen` styling stays open.
  (1) `WaitingScreen` renders its own fixed gradient shell + the shared
  `<AmbientOrbs/>` rather than being wrapped in `HandshakeJourney` — it isn't
  part of the handshake→safety→chat journey and doesn't need HandshakeJourney's
  `Crossfade`; the only duplication is a one-line background gradient. Its
  palette is hardcoded to Iris Glass like `LoadingScreen.css`, so it's
  theme-independent and flows straight into the loading screen it precedes.
  (2) An invite link (`…/#CODE`) prefills the join form and highlights it
  rather than auto-joining on load — matches the existing click-to-join UX;
  the hash is cleared via `history.replaceState` after reading so a refresh
  doesn't re-trigger. (3) The dim security marquee text was extracted into a
  shared `securityTicker.ts` consumed by both the loading and waiting screens
  instead of duplicating the string (the chat-polish review flagged duplicated
  constants as a smell). (4) The QR encodes the same invite link and uses
  periwinkle (`#8FA6FF`) modules on a transparent background per the design's
  "light or periwinkle modules" — inverted (light-on-dark) QRs scan slightly
  less reliably on some third-party scanners than dark-on-light, so `level="M"`
  error correction is set; if real-device scanning proves flaky, switching
  `fgColor` to `#E8EAF2` is a one-liner. (5) Cancel reuses `handleLeave` — safe
  from the waiting state, since it just disposes the relay client and resets to
  the start screen. (6) Added a `?screen=waiting` dev override (extending
  `screenOverride`) so the radar can be previewed without a live relay/paired
  session, since visuals are verified manually. (Decided by: Jay (design) +
  Claude (implementation calls))

- **2026-07-20 — Read/delivered-receipt protocol (spec being written) uses a
  cleartext `messageId` field alongside the ciphertext, not one embedded
  inside the encrypted payload — deliberately deferred for now, revisit
  later.** A message needs a shared ID both sides agree on before either
  side can ack "this specific message was delivered/read" — today the
  receiver generates its own random `id` on arrival (`App.tsx:87`),
  unrelated to the sender's `id` (`App.tsx:168`), so no such reference
  exists yet. Sending the ID in cleartext alongside the ciphertext (the
  same category as the already-cleartext `mimeType` field voice messages
  send today) is simplest and doesn't touch the "relay must never see
  plaintext" hard constraint, since a random correlation ID isn't message
  content. The more airtight alternative — embedding the ID inside the
  encrypted payload itself, hiding it from the relay entirely — would
  require reshaping `encryptMessage`/`decryptMessage` to carry a JSON
  envelope instead of raw text/bytes, which is more invasive than a field
  with no actual confidentiality requirement justifies right now. Jay
  explicitly wants to revisit hiding this (and any similar correlation
  metadata) from the relay once back in a higher-security-focus phase with
  more compute — Phase 5's security hardening work is exactly where this
  belongs; flag it there when Phase 5 starts. (Decided by: Jay + Claude,
  during brainstorming)

- **2026-07-20 — Roadmap inserts Phase 4.6 (style the remaining unstyled
  screens via Fable) and Phase 4.7 (Fable Ultra code review) before Phase
  5.** Jay has substantially higher compute availability for about 3 days
  starting 2026-07-21 and wants to spend it on two things before taking on
  Phase 5's added scope: (1) designing/styling `StartJoinScreen` (the app's
  home/entry screen), `WaitingScreen`, and `SafetyNumberScreen` — the three
  screens explicitly left unstyled by Phase 4's scope cut — via Fable,
  reusing the same external design-handoff workflow as the original Phase 4
  design; (2) running an ultra-depth code review of the existing codebase
  with Fable (the frontier-capability model) to catch improvement
  opportunities while the codebase is still relatively small, before Phase
  5 adds more surface area on top. Phase 5 (new features, starting with 5.1
  persistent identity) now also waits on 4.6 and 4.7 finishing, not just
  4.5. (Decided by: Jay)

- **2026-07-20 — Phase 4.5's implementation plan dropped the design spec's
  requested Vitest coverage for `App.tsx`'s `"chat"` screen `safetyNumber`
  field and `handleLeave` reset logic; caught by the final whole-branch
  review, not fixed.** The spec's Testing section asked for unit tests
  "following the pattern already used for `theme.test.ts` /
  `screenOverride.test.ts`," but `handleLeave` closes over refs and
  component state rather than being a pure function, and `App.tsx` — like
  every other top-level screen/component in this codebase
  (`ChatScreen.tsx`, `Sidebar.tsx`, `TitleBar.tsx`) — has no test file at
  all; only extracted pure-logic modules get Vitest coverage here. Both
  behaviors were verified for real via the Phase 4.5 Playwright
  verification pass (paired-session leave/disconnect flow — see
  `progress.md`'s 2026-07-20 entry) instead. Extracting `handleLeave` into
  a testable pure helper purely to satisfy this would be premature
  abstraction for a hackathon prototype with no second caller. Revisit if
  `handleLeave`-equivalent logic grows more complex in a later phase.
  (Decided by: Claude, confirmed via final whole-branch review)

- **2026-07-19 — Phase 4.5 design calls, made during brainstorming**
  (full design in `docs/superpowers/specs/2026-07-19-phase4.5-design.md`):
  1. The loading screen drops its "always Apple-style" behavior in favor
     of "always Iris-Glass-style" (matching Iris becoming the default
     chat theme), rather than becoming theme-aware for all three themes
     right away — full theme-awareness is deferred to the roadmap
     backlog.
  2. Apple and Pulse Slate stay selectable in the theme switcher — only
     the *default* for new/unset users changes to Iris Glass, nothing is
     removed.
  3. Settings is a floating, centered modal (claude.ai settings-panel
     style), not a sidebar drawer or dedicated screen, and its entry
     point (a gear icon) only appears on the chat screen — not on the
     out-of-scope start/waiting/handshake/safety-number screens — since
     its contents (room info, leave chat) only make sense mid-session.
  4. Settings ships with four items this phase — theme switcher,
     room/session info, leave chat, about/security info — with an
     explicit roadmap backlog note to revisit and expand scope later,
     rather than trying to fully enumerate settings scope now.
  5. Hosting is split: client on Vercel, relay server on Render — not a
     single-platform deploy — because the relay is a stateful WebSocket
     server with in-memory room state, which doesn't fit Vercel's
     serverless model. Render was chosen over Railway/Fly.io for
     zero-config GitHub deploys of a plain Node app, accepting its free
     tier's cold-start-after-inactivity trade-off.
  (Decided by: Jay)

- **2026-07-19 — New Phase 4.5 inserted before Phase 5: a working, hosted
  prototype (fixed Iris Glass animation, Iris Glass as the standard design,
  loading screen unified with the chat theme, a settings tab, Vercel
  hosting) comes before any of Phase 5's scope, including 5.2's
  forward-secrecy complexity increase.** Rationale: get the core chatting
  experience fully solid and demoable before layering on more security
  complexity. This also revises deviation #3 from the Phase 4 entry below
  (loading screen always Apple-style) — once Iris Glass's background-orb
  animation is fixed, the loading screen should match the (now Iris-Glass-
  default) chat theme instead of always rendering Apple. See `roadmap.md`.
  (Decided by: Jay)

- **2026-07-19 — Phase 4 UI redesign: user made three small keep-as-is/
  fix calls on plan-vs-design-source-file gaps surfaced during task review**:
  (1) the sidebar's "New chat" button radius — kept the plan's shared 12px
  for Iris and Pulse rather than matching the design file's distinct 8px for
  Pulse; (2) the voice-message waveform's per-bar color ramp on Pulse Slate —
  fixed to match the design file (was flat single-color in the plan's own
  code sample); (3) the composer's recording/preview/error states and the
  mic button's dark-theme background — both were missing any CSS anywhere in
  the plan (a real gap, not a cosmetic mismatch) and were fixed rather than
  left unstyled, since those states are user-visible mid-conversation.
  (Decided by: Jay)

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
     clip letters in the fallback font on Windows/Linux/Chrome. Verified
     end-to-end during Task 13 that this actually renders correctly — an
     earlier bug in this same measurement code (canvas silently rejecting a
     literal `var(--font-display)` CSS reference, falling back to a 10px
     default and clipping every letter) was caught and fixed, see
     `progress.md`'s 2026-07-19 Phase 4 entry.
  (Decided by: Jay + Claude, while writing the implementation plan)
