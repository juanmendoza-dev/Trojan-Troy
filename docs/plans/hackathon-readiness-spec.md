# Hackathon Readiness Spec — Trojan Troy

**Date:** 2026-07-28 · **Event:** Hack Club Horizons Polaris (Toronto)
**Basis:** four parallel code reviews (crypto/protocol, client UI/UX, server/deploy, tests/docs) on branch `feat/v6-static-channel-pq-binding`. All ratings verified against actual code, not docs.

---

## Verdict

The engineering is well above the hackathon bar — the crypto layer reads like a small
production protocol stack, the test suite (248 client + 31 server, all passing) is a
genuine differentiator, and several screens are portfolio-grade. The project's problem
is **asymmetry**: the deepest work (PQ ratchet, cover traffic, sealed headers) is
completely invisible in a demo, while the most judge-visible surfaces are unfinished —
the README's live-demo line is literally `_add your Vercel URL_`, there are zero
screenshots, no demo video, no LICENSE, the strongest work sits on an unmerged PR with
4 unpushed commits, and the one crypto claim shown on screen one ("SHA-256 encryption
method") is **wrong**.

Fixing the visibility gap is cheaper than any new crypto and worth more points.

---

## Feature ratings

Scale: 1–10. **Quality** = how well it's built. **Judge impact** = how much it helps in a
3-minute demo + repo skim, as it stands today.

### Crypto & protocol

| Feature | Quality | Judge impact | Notes |
|---|---|---|---|
| Hybrid PQ handshake (X25519 + ML-KEM-768) | 9 | 9 | Correct hybrid construction, fail-closed downgrade refusal (`App.tsx:759`), domain-separated KDF (`crypto/kdf.ts`). Headline judges instantly understand. |
| Double Ratchet | 9 | 7 | Clean Signal-style impl with the standout **transactional decrypt** (clone-then-commit, `crypto/ratchet.ts:234-246`). Invisible without narration. |
| Sealed 84-byte headers | 9 | 6 | Textbook header encryption; size-invariant so PQ material can't be fingerprinted. Hard to show visually. |
| PQ ratchet folds (~30s in-band ML-KEM rekey) | 8 | 8 | **Most novel thing in the repo** — post-quantum post-compromise healing. Dev counters exist (`App.tsx:353-366`) but no visible UI. |
| Cover traffic + size-bucket padding | 8 | 9 | Unusually thoughtful bucket distribution (`protocol/coverTraffic.ts:45-50`). Very demoable via the network tab. |
| Commit-then-reveal + transcript binding | 8 | 6 | Solid ZRTP-style hardening, enforced single-shot. Needs a "villain" to be seen defeating. |
| Safety number bound to hybrid root key | 8 | 8 | Correct, and it IS a screen — very showable. |
| v6 static-channel binding + replay windows | 8 | 4 | Careful gap-closing work; near-invisible to judges but a great "we red-teamed ourselves" story. |
| Relay DoS hardening | 8 | 5 | Token buckets, caps, heartbeat reaping, CSPRNG room codes — all tested. One real defect: per-IP cap keys on the proxy address in production (`server/src/server.ts:170`). |
| Argon2id at-rest vault | 6 | 5 | Correct construction but small honest scope: a 4-digit PIN sealing only the avatar. INTERACTIVE params ≈ 17 min offline grind of the whole PIN space. |

### Client UI/UX

| Feature | Quality | Judge impact | Notes |
|---|---|---|---|
| SafetyNumberScreen + seal-slider sparks | 9 | 9 | **Best screen in the app.** Velocity-driven embers, mismatch flow, keyboard a11y, reduced-motion fallbacks. Demo centerpiece. |
| DecryptReveal animation | 9 | 8 | Mask-sweep with scan edge, no reflow, SR-safe. Plays once for 560ms — prime the judges. Disabled on Apple theme. |
| ErrorScreen (desert island) | 9 | 8 | Charming enough to show deliberately. But subcopy is wrong for half its scenarios (`ErrorScreen.tsx:95`). |
| Kinetic-cipher LoadingScreen | 8 | 9 | Standout. Note the checklist is fixed-delay theater, not tied to real handshake events. |
| DataMonitor visualizers | 8 | 9 | Great demo texture, but only MorphViz shows real data — the rest is `Math.random()` presented as "raw ciphertext, live". |
| Start/Join home screen | 8 | 8 | Cohesive — but carries the wrong "SHA-256" badge (`StartJoinScreen.tsx:64-65`). |
| WaitingScreen (radar + QR invite) | 8 | 8 | Clean and demoable. |
| Mobile drawer + responsive pass | 8 | 7 | Rigorous (safe areas, 44px targets, keyboard tracking). Better mobile engineering than most hackathon winners. Real-device soft-keyboard still unverified. |
| Presence indicator (typing/recording) | 8 | 7 | Reads great live on two machines. |
| ProfileCard particle reveal | 8 | 8 | Lovely; violates own Icon.tsx convention with raw emoji. |
| ConnectingBar | 8 | 5 | Well-engineered cold-start phases; still just a progress bar to a judge. |
| ChatScreen composite | 7 | 7 | Solid, but a **dead "New chat" button** (`ChatScreen.tsx:181`), no timestamps, hardcoded "Today" divider. |
| Themes (Apple/Iris/Pulse) | 7 | 7 | Genuinely distinct, but pre-chat is hardcoded Iris, and switching to Apple silently loses DecryptReveal. Demo in Iris or Pulse. |
| Profiles + PIN vault UI | 7 | 6 | Full flow works, but **PIN renders in cleartext as typed** (`ProfileModal.tsx:253-266`). |
| Settings modal | 7 | 6 | Excellent security story buried in one 16-line paragraph. |
| Voice messages | 6 | 7 | Robust flow, but fake hardcoded waveform, no seek/progress, stock native `<audio>` widget in the glass composer. |

### Infrastructure & presentation

| Item | Rating | Notes |
|---|---|---|
| Test suite | 9 | 248 client + 31 server, verified passing; adversarial, real-crypto, no mocks; 3 Playwright specs incl. a two-browser wire-capture test. No CI enforcing it. |
| Docs / decision log | 9 | Exceptional: 41 dated decisions, verification evidence with measured numbers, a 57-finding security review. |
| README as a pitch | 7.5 | Strong writing, honest threat model, mermaid diagram — undermined by the placeholder demo link and zero images. |
| Deploy config (render.yaml + Vercel story) | 7 | Correct and essentially complete, **but never exercised**. Landmines: silent `ws://localhost:8080` fallback if `VITE_RELAY_URL` is unset (`App.tsx:73`), no connect timeout for Render cold starts. |
| Repo hygiene | 6 | Clean tree, real PR discipline, zero TODOs — but PR #18 unmerged, 4 commits unpushed, ~20 stale branches, no LICENSE. |
| Demo assets (live URL, video, screenshots) | 1 | None exist. This is where submissions are won and lost. |
| Session resilience | 3 | No reconnect anywhere: one Wi-Fi blip or locked phone → terminal error screen for both sides. #1 live-demo risk. |

---

## The fix list

### P0 — submission blockers (do these no matter what)

1. **Merge PR #18 and push the 4 local commits.** If judging snapshots `main`, the v6
   crypto story, the handshake e2e test, and the entire mobile chat fix don't exist.
   Note PR #18's title says "v6 static-channel binding" but now also carries mobile
   WP-D commits — mention both in the PR body or split, then merge.
2. **Deploy and link it.** Render Blueprint → relay; Vercel (root dir `client`,
   `VITE_RELAY_URL=wss://…`) → client; set `ALLOWED_ORIGINS` on Render (an open
   action since Phase 4.5); paste the URL over README line 7's placeholder. Warm the
   relay ~2 min before judging (free tier sleeps after 15 min idle).
3. **Fix the SHA-256 badge** (`StartJoinScreen.tsx:64-65`). Replace with
   "X25519 + ML-KEM-768 · post-quantum hybrid key exchange". Highest-ROI 15 minutes
   in the repo: turns your worst rough edge into your best differentiator, on screen one.
4. **Guard the relay-URL fallback** (`App.tsx:73`): fail the production build (or at
   least show a clear error) when `VITE_RELAY_URL` is unset, and add a timeout to
   `RelayClient.waitForOpen()` (`net/relayClient.ts:100-112`) so a cold start shows
   "waking the relay…" instead of hanging silently.
5. **Demo assets:** 2-minute two-browser demo video, a GIF + 2–3 screenshots in the
   README, and a LICENSE file (MIT). Hack Club judges expect all three; the app is
   visually strong and currently 100% invisible without cloning it.
6. **Two embarrassment fixes:** mask the PIN input (`type="password"`,
   `ProfileModal.tsx:253,321`) and wire or delete the dead "New chat" button
   (`ChatScreen.tsx:181`).

### P1 — high-impact, hours each

7. **Session reconnect** — the #1 live-demo failure mode. Even a minimal version
   (detect close → auto-rejoin room → re-run handshake → "Session re-secured" banner)
   converts a demo-killer into a *feature you can show off* (see new-feature §1 below).
   Until built: keep both demo devices awake and don't push commits during judging
   (Render auto-deploys).
8. **Make the invisible crypto visible** — a sixth DataMonitor row fed by the real
   `__ttRatchetCounters`: "ratchet msg #47 · PQ re-secured ×3 · cover frames 212".
   Turns "trust me, it re-keys every 30 s" into something judges watch happen.
9. **Copy tone pass** — fix "vizualize ur data" (misspelled, `Sidebar.tsx:88`),
   "ur keys…", "ur secure line" to match the quiet-confident voice, or commit to the
   bit consistently. Also: style the raw `[Message could not be decrypted]` bubble
   (`ChatScreen.tsx:70`), fix ErrorScreen subcopy for no-session scenarios, break the
   Settings About paragraph into bullets.
10. **Say "post-quantum" in the visible flow** — LoadingScreen checklist line
    (`LoadingScreen.tsx:87`) → "Hybrid post-quantum keys agreed — X25519 + ML-KEM-768".
    Right now the phrase first appears in a buried Settings paragraph.
11. **Ghost Mode indicator** (small glyph in TitleBar when active) so it can be demoed
    by pointing, not narrating.
12. **CI + badge** — a GitHub Actions workflow running both suites converts
    "248 tests, all green" from a claim into proof.
13. **Favicon + `theme-color`** (`client/index.html`) — the demo tab currently shows
    the default globe.

### P2 — worth it if time remains

14. Fix the duplicate `peer-connected` → double `exchangeKeys` race (`App.tsx:855,894`)
    with a once-guard; add a timeout/abort to the PQ-accept buffer (`App.tsx:552-555`).
15. Bump Argon2id to MODERATE params (one line, `profiles/pin.ts:26-33`) — ~1 s unlock,
    10× the grind cost, and a better talking point.
16. Real timestamps + computed day divider; real voice waveform + seek; themed audio
    preview player.
17. Dialog semantics + focus trap on Settings/Profile modals; `role="log"` on the
    message list.
18. Update stale `AGENTS.md` crypto-constraints text (still says Web Crypto/AES-GCM);
    delete ~20 merged branches; remove the stale `.worktrees/typing-presence-indicator`.
19. Per-IP cap behind proxy: parse `X-Forwarded-For` gated on a `TRUST_PROXY` env var
    (`server/src/server.ts:170`).

---

## New features that would genuinely impress judges

Ranked by wow-per-hour. §1–3 all exploit the same insight: **the app's best material is
already built and tested — it just has no stagecraft.**

1. **"What the relay sees" split view** *(~half a day — the killer demo)*
   A dev-mode panel (or a second browser tab pointed at a relay tap) showing the live
   wire: an unbroken wall of identical `{"type":"msg","payload":"…"}` blobs at ~1/sec,
   whether or not anyone is typing — side-by-side with the plaintext chat. This is the
   single most visceral proof of the entire thesis ("the server can't read *or infer*
   anything") and needs ~20 lines of relay logging or a network-tab walkthrough. Pitch
   line: *"Left screen is your conversation. Right screen is everything our own server
   can see. Notice it doesn't change when she starts typing."*

2. **Evil-relay demo mode** *(~a day — turns crypto into theater)*
   A toggle that makes the dev relay actively hostile: strip the ML-KEM field
   (downgrade), swap a public key (MITM), replay a captured frame. The client already
   defeats all three — fail-closed abort, changed safety-number digits, silent replay
   drop — and every path is unit-tested. Judges don't reward defenses they can't see;
   this stages a live attack and lets them watch it lose.

3. **Security HUD** *(hours — P1 §8 grown into a feature)*
   A compact always-on strip: current protocol version, ratchet position, PQ re-key
   count with a lock-pulse on each fold, cover-frame counter, session age. Signal
   doesn't show you its ratchet ticking; you can.

4. **Session healing / reconnect** *(1–2 days — fixes the demo risk AND demos well)*
   Auto-rejoin + fresh handshake on drop, framed on screen as "connection lost —
   re-securing…" with the safety number re-verified. Judges see resilience engineering
   plus a second run of your beautiful handshake animation for free.

5. **Disappearing messages** *(~a day — already on your roadmap)*
   Per-conversation timer, themed burn-away animation on expiry. Cheap, instantly
   understood, and consistent with the threat model (nothing persists anyway — this
   makes that visible).

6. **Encrypted image sharing** *(1–2 days)*
   Images ride the exact same sealed framing and size buckets as everything else —
   which lets you demo that a photo and a "hi" are indistinguishable on the wire.
   Reuses the voice-message envelope pattern wholesale. Watch the 2 MiB relay cap
   (downscale client-side like avatars already do).

7. **Judge mode** *(hours — pure presentation)*
   A `?judge=1` overlay: step-by-step captions during the handshake ("commitments
   exchanged — neither side can steer the keys now"), callouts on first decrypt-reveal
   and first PQ fold. The loading-screen checklist is currently theater on a timer;
   this makes it real narration, synced to actual protocol events.

**Skip for this hackathon:** group chats (multi-party ratcheting is a rewrite, not a
feature), offline delivery/history (server-side buffering contradicts the "relay knows
nothing" pitch unless done very carefully), native/PWA packaging.

---

## Suggested 3-minute demo script

1. **Open the live URL on two devices** (Iris or Pulse theme — not Apple). Start a
   chat, scan the QR from the WaitingScreen radar. *(30 s)*
2. **Handshake** → kinetic-cipher loading screen → both read the same safety number →
   drag the seal slider, sparks fly. *(45 s)*
3. **Chat**: send a message, point at the decrypt-reveal sweep; show typing presence;
   send a voice note. *(45 s)*
4. **The reveal**: flip to the "what the relay sees" view — identical opaque frames,
   steady rhythm, nothing changes when you type. "That's our own server. It can't
   read this, and it can't even tell when we're talking." *(45 s)*
5. **Close**: Security HUD showing "PQ re-secured ×4" — "the keys you saw agreed at
   the start? They've already been thrown away four times, with fresh post-quantum
   secrets each time. 279 tests, zero hand-rolled crypto." *(15 s)*
