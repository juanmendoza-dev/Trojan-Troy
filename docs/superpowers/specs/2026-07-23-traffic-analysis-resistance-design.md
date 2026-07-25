# Traffic-Analysis Resistance (cover traffic + cadence jitter, review B12): Design Spec

Status: Draft (brainstormed with Jay 2026-07-23; awaiting approval)
Date: 2026-07-23

## Purpose

The relay can't read message *content* (E2EE) and, since Phase 5.2, can't read
message *size* precisely (size-bucket padding in `framing.ts`) or *type* (one
opaque `msg` envelope). But it can still watch the **timing and rhythm** of the
`msg` frames it forwards and infer:

- **When** the two people are actively chatting vs. idle vs. "typing then thinking."
- **How intense** an exchange is (a rapid back-and-forth vs. an occasional line).
- Bursts that correlate with real-world events.

This spec adds **cover traffic**: a steady, jittered stream of indistinguishable
dummy `msg` frames so the relay sees a **continuous baseline of traffic** whether
or not the humans are actually saying anything. Real messages hide *within* that
baseline. It's the metadata-privacy complement to the padding already shipped.

**This is invisible to the user.** Cover frames are decrypted-then-dropped on
receipt (the exact pattern the existing `primer` uses) and never render. The one
thing to protect carefully is **latency** — see the design decision below; the
recommended model adds **zero** latency to real messages. Per Jay's steer: backend
only.

## Relationship to the other 2026-07-23 specs

Independent follow-on branch, built **after** the PQ handshake (①/②) and at-rest
(④) land, because it sits on the live message-send path and is cleanest to add once
the handshake work has settled. It builds directly on Phase 5.2's `framing.ts`
channels and `ratchetSession.sealContent`/`openMsg`.

## Hard constraints (carried, all satisfied)

- **Audited libraries only.** Cover frames reuse the existing ratchet path
  (`sealContent`) — no new crypto, no new dependency. ✅
- **Relay never reads plaintext.** Cover frames are real ratcheted `msg` envelopes
  (`c:0`), byte-indistinguishable from content; the relay can't tell cover from
  real. ✅
- **No live calling / P2P.** Unchanged. ✅
- **Stays within Track B abuse limits.** The relay's per-connection throttle
  (60 burst / 30 msg/sec sustained) bounds cover traffic; the recommended rate
  (~1–2 frames/sec) sits far under it. The two hardening efforts are consistent.

## Invariants preserved (must not regress)

- **The ratchet stays correct under cover traffic.** Cover frames advance the
  sending chain exactly like content (they *are* content-class), so the receiver
  processes them in order and the chain counters stay in sync. Dropped cover frames
  are handled by the existing skipped-key logic (`MAX_SKIP`).
- **Reduced-motion / battery:** cover traffic is a fixed, low, bounded rate; it does
  not scale with anything user-visible.

---

## Design

### Cover frames ride the content channel (`c:0`)

A cover frame is a normal **ratcheted content** message (`c:0`, carries a
`RatchetHeader`) whose framed channel is a new `"cover"` value. On receipt,
`openMsg` unframes it, the `App.tsx` switch sees `channel === "cover"` and
**drops it silently** — identical to how `"primer"` is handled today.

Why content-class and not a static channel: a `c:0` cover frame is
**byte-indistinguishable** from a real text/voice message (same class, same ratchet
header, same size buckets), so the relay cannot filter cover out. Bonus: spinning
the ratchet on cover traffic gives *extra* key rotation (more forward secrecy) for
free.

```
frame({ channel: "cover", id: "", body: randomBytes(k) })   // k chosen to land in a common bucket
  -> sealContent(sc, ...)  -> { type:"msg", c:0, header, payload }
```

- The cover body is random bytes sized so the padded frame lands in the **same
  buckets real messages commonly use** (e.g., the 64/256 text buckets, and
  occasionally a larger bucket to mimic voice — see §Residuals on voice). Vary the
  target bucket per cover frame so cover isn't pinned to one size.

### Cadence model — recommended: "minimum frame rate" (zero added latency)

The strict-privacy model is constant-rate quantization (every real message waits
for the next fixed slot), but that adds up to one interval of **latency to every
message**, which is a user-visible UX change — **out of scope under Jay's filter.**

**Recommended model (zero latency):** *maintain a minimum frame rate.* Real
messages send **immediately**, as today. A background scheduler ensures that if no
`c:0` frame (real or cover) has gone out in the last `INTERVAL` (jittered), it emits
a cover frame. Real sends reset the timer. Result: the relay always sees **at least
one frame per interval**, so it cannot detect idle gaps, typing pauses, or
"composing then deleting" — the conversation's *rhythm of silence* is masked — while
real messages incur **no delay**.

```
// pure decision, protocol/coverTraffic.ts
nextAction(now, lastContentSentAt, hasQueuedReal, interval):
  if hasQueuedReal: return "flush-real"          // (only used by the optional strict model)
  if now - lastContentSentAt >= interval: return "cover"
  return "wait"
```

- `INTERVAL` default **~1500 ms with ±40% jitter** (so ~1 frame/sec baseline).
  Jitter is applied by the caller (App.tsx) and passed in, keeping the decision
  function deterministic/testable.
- Active while in the `chat` screen with an established sending chain; stopped on
  leave. Not running on the start/waiting/handshake screens (nothing to hide yet).

**Optional stronger model (opt-in, small latency):** true constant-rate — real
messages queue and fire on fixed jittered slots (`INTERVAL` ~300–500 ms so added
latency stays near/under perceptibility), cover fills empty slots. This also masks
*burst intensity*, not just idle gaps. Gated behind a constant so Jay can flip it on
if he later relaxes the "zero latency" bar. The pure `coverTraffic.ts` supports both
via the `flush-real` branch above.

### Presence cadence jitter (small companion measure)

The presence heartbeat (`presenceState.ts`, fixed `PRESENCE_HEARTBEAT_MS = 2500`)
has a fixed period, which is itself a weak fingerprint. Add **±jitter** to the
heartbeat interval so presence packets don't tick like a metronome. Presence stays a
static channel (`c:1`) — see the residual about class visibility. This is a
one-constant change plus jitter in the send path; keep it small.

---

## Module plan (`/client`)

```
client/src/crypto/
  framing.ts / framing.test.ts             # add "cover" to the Channel union; round-trips like "primer"
client/src/protocol/
  coverTraffic.ts / coverTraffic.test.ts   # NEW: pure nextAction() decision + interval/jitter helpers
                                           #      (matches presenceState.ts / readAckDecision.ts style)
  presenceState.ts / .test.ts              # jittered heartbeat interval (small change)
client/src/App.tsx                         # cover scheduler: a timer while in chat with a sending chain;
                                           # emit sealContent(frame({channel:"cover",...})); reset on real send;
                                           # stop/clear on leave. Add a "cover" case to the msg switch -> drop.
```

`coverTraffic.ts` is a pure decision module (Vitest coverage); the timer/loop and
randomness live in `App.tsx` (same division as presence). Note the harness rule that
`Math.random()`/`Date.now()` are unavailable *in workflow scripts* — this is app
runtime code, so `performance.now()` + `Math.random()` for jitter are fine here
(as already used by `sendPresence`).

### `App.tsx` integration points

- A `coverTimerRef` started when entering `chat` with `sc.ratchet.CKs` present
  (sending chain established — reuse the existing outbox/primer readiness signal).
- Each real content send (`sendContent`) updates `lastContentSentAt` so cover
  backs off — route both through one helper so the timer sees real sends.
- The receive switch (`App.tsx`, the `openMsg` result `switch (received.channel)`)
  gains `case "cover": break;` — drop silently, exactly like `"primer"`.
- `handleLeave` clears `coverTimerRef` alongside the existing teardown.

---

## Data flow (unchanged for the user)

1. In an active chat, a background timer keeps the outbound `c:0` frame rate at or
   above the baseline: real messages when you send them, cover frames to fill gaps.
2. The relay sees a steady, jittered stream of identical-looking `msg` frames and
   cannot distinguish chatting from silence, or cover from content.
3. The receiver decrypts every frame (ratchet advances), renders real ones, and
   drops `cover` ones. Nothing visible changes.

## Error handling / edge cases

- **Cover frame dropped by the relay:** the receiver skips a key
  (`skipMessageKeys`, bounded by `MAX_SKIP`) and continues — same as a dropped real
  message. No user impact.
- **Rapid real sends:** in the recommended (zero-latency) model, real sends fire
  immediately and simply reset the cover timer; no queue, no delay. Burst intensity
  is a documented residual.
- **Leaving mid-tick:** timer cleared on `handleLeave`; no stray sends after
  teardown.
- **Rate-limit safety:** baseline ~1/sec + real traffic stays well under Track B's
  30/sec; add a client-side floor on `INTERVAL` so a misconfig can't approach the
  cap.

## Testing

- **`coverTraffic.test.ts`:** `nextAction` returns `"cover"` once `interval`
  elapsed with nothing queued; `"wait"` before then; `"flush-real"` when a real
  message is queued (strict model); interval-floor/jitter helper stays within
  bounds.
- **`framing.test.ts`:** `"cover"` frames round-trip; land in the intended bucket;
  unframe recovers channel `"cover"`.
- **Receiver drop:** a decoded `"cover"` frame produces **no** message bubble and no
  status/ack side effects (unit-test the switch's handling, or assert in the
  App-level integration).
- **Rate bound:** a test asserting the scheduler's emitted rate over N seconds stays
  under the Track B sustained cap.
- **Manual:** two-browser session — watch the WebSocket frames in devtools and
  confirm a steady stream during idle (cover) that's indistinguishable in size/shape
  from real sends; confirm **no** stray bubbles and **no** perceptible send lag.

Acceptance: `cd client && npm run typecheck && npm test && npm run build` green;
cover frames never render; measured baseline rate is within Track B limits; real
sends show no added latency in the recommended model.

## Residuals (documented, honest — do not oversell)

- **Burst intensity still leaks (recommended model).** Zero-latency cover masks
  *silence/idle*, not the *rate* of an active back-and-forth. Masking intensity
  needs the strict constant-rate model (small latency) — available as an opt-in,
  off by default under the UX filter.
- **Non-content channel cadence.** Presence/ack/profile are static classes
  (`c:1/2/3`) and remain distinguishable *by class* from `c:0` content+cover.
  Jitter reduces the presence-heartbeat fingerprint but doesn't hide the class.
  Fully uniform classing (routing everything through `c:0`) is possible future
  scope; not done here.
- **Voice bursts.** A real voice clip is a large frame; unless cover occasionally
  emits large frames too (this spec varies bucket sizes, which helps), a determined
  observer can still guess "large frame ⇒ probably voice." Fully hiding voice would
  mean fragmenting clips into many small frames — deliberate future scope.
- **Session existence + duration** (that *a* chat is happening, and for how long)
  remains visible to the relay. Out of scope; inherent to a relay that forwards at
  all.
- **Bandwidth/battery cost** of continuous cover traffic — accepted (Jay's "infinite
  compute"; the rate is low and bounded regardless).

## Build order

1. `framing.ts` — add the `"cover"` channel (+ test).
2. `coverTraffic.ts` — the pure scheduler decision (+ tests).
3. `App.tsx` — the cover timer, `lastContentSentAt` plumbing, the receive-drop case.
4. `presenceState.ts` — heartbeat jitter (+ test).
5. Two-browser eyeball (devtools frame inspection + no-lag/no-bubble confirmation).

## Rollout

- Independent branch off `main` (after ①/②/④): suggested `feat/traffic-analysis-cover`.
- Full workflow (touches the live message path): brainstorming → **this spec** →
  plan → `subagent-driven-development`.
- **Log on build** (`AGENTS.md`): the chosen `INTERVAL`/jitter defaults and the
  zero-latency-vs-strict decision in `decisions.md`; update `progress.md`. Update
  the about/security copy honestly (mask idle rhythm; intensity/voice residuals
  remain).
- Commit/push per `AGENTS.md`.
