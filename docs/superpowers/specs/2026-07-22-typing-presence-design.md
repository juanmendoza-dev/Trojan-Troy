# Peer Presence Indicator (Typing + Recording) Design

A real-time presence indicator: while your peer is composing a message you
see a live "typing…" bubble, and while they're recording a voice note you
see a "recording audio…" bubble. Instagram-style three-dot motion, reskinned
in Trojan Troy's visual language, with the presence signal itself
**encrypted end-to-end** (the relay can't tell what kind of activity it is)
and gated behind an expanded Ghost Mode.

This was cut from Phase 4 as needing a "protocol change" (`decisions.md`,
2026-07-19) and parked in the Phase 5 backlog with a note to revisit
(`roadmap.md`); Jay asked for it back on 2026-07-20. It's built here as a
small, self-contained feature on top of Phases 1–4.5's unchanged
crypto/relay layers and the existing three-theme system (Apple, Iris Glass,
Pulse Slate). It adds **no new crypto primitive** (it reuses the Phase 2
`secretbox` message-encryption path), **no server change**, and no message
persistence. It does not touch `StartJoinScreen`, `WaitingScreen`, or
`SafetyNumberScreen`.

## 1. Transport: a new `presence` envelope (client-only)

Correction to the Phase 4 note: this needs **no relay/server change at all**.
`server.ts` special-cases only `create` and `join`; every other envelope
type falls through to `rooms.forward()` and is relayed opaquely — exactly how
`ciphertext`, `voice`, `delivered`, and `read` were all added with zero
server work. One new type is added to the client `Envelope` union
(`relayClient.ts`):

```ts
{ type: "presence"; payload: string }
```

`payload` is the encrypted presence state (Section 2). The relay sees
`type: "presence"` and an opaque base64 blob, and forwards it to the other
peer. `roadmap.md`'s backlog note (which called this a "relay event/protocol
change") is corrected: it's a client-only addition.

## 2. Encrypting the presence state

Unlike the cleartext `delivered`/`read` acks, the presence *state* is
encrypted so the relay cannot distinguish "started typing" from "recording"
from "stopped." The payload is a tiny JSON object encrypted through the
**existing** message path — no new primitive, no hand-rolled crypto:

```ts
// send
const payload = await encryptMessage(keys.tx, JSON.stringify({ state }));
client.send({ type: "presence", payload });

// receive
const { state } = JSON.parse(await decryptMessage(keys.rx, payload));
```

`encryptMessage`/`decryptMessage` (`crypto/messages.ts`) already wrap
`secretbox.ts`, which generates a fresh random nonce per call and prepends
it — so every presence event is independently sealed, with no nonce-reuse
concern, using the same audited `crypto_secretbox_easy` path as text
messages.

**What is and isn't hidden.** The `type: "presence"` field stays cleartext
(it's structural routing, the same category as the already-cleartext
`messageId` — see `decisions.md`, 2026-07-20). Encryption hides *which*
activity is happening; it does not hide *that* presence packets are flowing.
A relay doing traffic analysis could still infer "the peer is composing
something" from the cadence of small `presence` envelopes. That residual
metadata leak is accepted for this version — it's the same threat-model line
already drawn for `messageId`, and hardening traffic-analysis resistance
belongs in Phase 5's security work (see Deferred).

## 3. Presence states

```ts
type PresenceState = "idle" | "typing" | "recording";
```

- `typing` — the peer is actively editing text in the composer.
- `recording` — the peer is recording a voice message.
- `idle` — the peer stopped (sent, cleared the input, blurred, or finished
  recording without sending).

`typing` and `recording` are mutually exclusive; the composer input is
disabled while the `VoiceRecorder` is active today, so both can't fire at
once.

## 4. Send model: heartbeat + stop

Presence is **not** emitted per keystroke (that would spam the relay and, per
Section 2, widen the timing leak). Instead:

- **Heartbeat** — while the peer is actively typing/recording, a `presence`
  event for the current state is sent at most once every
  `PRESENCE_HEARTBEAT_MS` (~2500ms). Composer keystrokes and the recorder's
  active state re-arm the heartbeat; they don't each send.
- **Stop** — an `idle` event is sent immediately on send, on the input going
  empty, on composer blur, or when recording ends.

The heartbeat interval is deliberately shorter than the receiver's expiry
window (Section 5) so the indicator never flickers off mid-activity even if a
single heartbeat is dropped.

**Wiring.** `Composer` (`components/Composer.tsx`) gains an `onActivity`
callback fired from its existing `onChange` (and a stop on blur/empty/submit);
`VoiceRecorder` (`screens/VoiceRecorder.tsx`) reports `recording`/`idle`
around its existing start/stop. `App.tsx` owns the actual encrypt-and-send,
mirroring the existing `maybeSendReadAck` + `ghostModeRef` machinery almost
line-for-line.

**Throttle logic is pure and tested.** The "should I send a heartbeat now,
given the last-sent timestamp and current state" decision, and the state
that tracks it, live in `protocol/presenceState.ts` alongside
`messageStatus.ts` / `readAckDecision.ts`, and are unit-tested in isolation —
this codebase's established convention of extracting pure logic from its
timer/DOM wiring (`crossfadeState.ts`, `barPhases.ts`).

## 5. Receive model: peer presence + auto-expiry

`App.tsx` holds `peerPresence: PresenceState` (default `idle`) and passes it
to `ChatScreen`. On each incoming `presence` envelope it decrypts, parses,
sets the state, and arms/re-arms an auto-expiry timer of `PRESENCE_EXPIRY_MS`
(~5000ms) that resets the state to `idle`. The expiry is a safety net: if a
`stop`/`idle` event is ever dropped, the indicator clears itself rather than
sticking forever.

Presence is also cleared implicitly the moment a real message arrives: when a
`ciphertext` or `voice` envelope from the peer is handled, `peerPresence` is
reset to `idle` in the same update — the "they were typing → the message is
here" hand-off (Section 6).

## 6. UI and animation

A single `PresenceIndicator` component (`components/PresenceIndicator.tsx` +
`.css`) renders a transient incoming bubble pinned to the bottom of
`ChatScreen`'s message list (below the last real message), shown only when
`peerPresence !== "idle"`. Base motion is the familiar three-dot bounce, with
the Trojan Troy touch layered in per theme:

- **Iris Glass / Pulse Slate** (`data-theme="iris"|"pulse"`): the dots are
  periwinkle (`#8FA6FF`) beads on the same frosted glass bubble skin as
  incoming message bubbles, bouncing on a staggered offset using the
  project's **signature easing** (`cubic-bezier(0.2, 0.9, 0.3, 1)`, the same
  curve `barPhases.ts` uses). A faint glow breathes behind the bubble using
  the **`glowPulse` keyframe** in `keyframes.css` — currently defined but
  unused (flagged as a gap in the Phase 4 roadmap note); this gives it a
  home.
- **Apple** (`data-theme="apple"`): a flatter iMessage-style grey three-dot
  bubble, no glass/glow — consistent with how `MessageBubble` already gates
  the cipher/decrypt treatment to the dark themes only and gives Apple a
  restrained, native-feeling variant.

**Recording variant.** Same bubble, but the three dots are preceded by a
small periwinkle mic glyph and the label reads "recording audio…" — reusing
the voice-message visual vocabulary so the two states read distinctly at a
glance.

**Continuity with the arriving message.** When the peer's real message lands
and `peerPresence` clears (Section 5), the presence bubble exits with a quick
fade + scale-down (~150ms, reusing the `Crossfade` sensibility) timed to
overlap the incoming message bubble's own entrance animation — so the eye
reads one continuous "it was forming, now it's here" beat rather than a hard
swap. On Iris/Pulse, the arriving message then plays its existing **decrypt
reveal** (`DecryptReveal` — the width-driven focus sweep on `main`), so that
reveal still lands at the payoff even though the lead-in is classic dots. A true shared-element morph (the dots
bubble physically transforming into the message bubble) is deferred as
polish — it's brittle across variable message heights and this codebase has
no layout-animation library.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, the dots don't
bounce and the glow doesn't breathe — a static "typing…" / "recording…"
bubble is shown instead, matching how `DecryptReveal` and `SafetyNumberScreen`
already degrade.

## 7. Ghost Mode, expanded

Ghost Mode today suppresses only the outgoing `read` ack
(`readAckDecision.ts`). Its meaning is broadened from "don't send read
receipts" to **"don't broadcast my activity"**: when on, the client emits no
`presence` events at all (neither heartbeat nor stop) — the same
`ghostModeRef` gate that already guards `maybeSendReadAck`.

It governs only what *you* send, symmetric with how it suppresses *your* read
ack: with Ghost Mode on you still *see* your peer's typing/recording bubble
(if they aren't in Ghost Mode), you just don't emit your own. No new setting
or storage — it reuses the existing `trojan-troy-ghost-mode` toggle and
defaults to **off**. The `Settings` "Privacy" copy, which currently mentions
only read receipts, is rewritten to cover typing/recording presence too.

## 8. Error handling

- **Decrypt/parse failure on an incoming `presence`** — silently ignored, no
  state change, no crash; the same defensive-drop convention `RelayClient`
  uses for malformed data. (A corrupt presence event simply means no
  indicator that beat; the next heartbeat recovers it.)
- **Dropped `idle`/stop event** — covered by the receiver's auto-expiry
  (Section 5): the bubble clears itself after `PRESENCE_EXPIRY_MS`.
- **Peer disconnects mid-typing** — already routes the whole app to the error
  screen (`App.tsx`'s `peer-disconnected` handling) and unmounts the chat, so
  there's no orphaned indicator to reconcile.
- **Presence arrives before session keys exist** — not possible in practice
  (presence is only emitted from the chat screen, after the handshake), and
  the receive handler no-ops if `sessionKeysRef.current` is null, matching
  the existing `ciphertext`/`voice` handlers.

## 9. Testing

- `presenceState.ts` (heartbeat-send decision + expiry/state transitions):
  unit tests covering "send when past the heartbeat interval," "suppress
  within the interval," state changes, and the Ghost-Mode short-circuit — the
  same way `advanceStatus` and the read-ack decision are tested.
- The indicator's per-theme animation, glow, recording variant, continuity
  exit, and reduced-motion fallback: CSS/visual, no unit tests — matches this
  codebase's convention (no jsdom/RTL setup) — verified manually and via the
  scratch two-browser Playwright pattern used for every prior visual feature.
- Full round-trip (encrypt → relay forward → decrypt → indicator, both
  directions, plus Ghost-Mode suppression and auto-expiry): verified with the
  live two-browser Playwright pattern — type in window A and confirm the
  bubble appears in B (and clears when the message sends), record in A and
  confirm the "recording audio…" variant in B, then turn Ghost Mode on in A
  and confirm B sees nothing while A still sees B's presence.

## Deferred (not in this pass — see `decisions.md` and `roadmap.md`)

- **Traffic-analysis resistance** for the presence channel (hiding the
  *cadence* of presence packets from the relay, not just their contents) —
  the same class of hardening as hiding `messageId` inside the encrypted
  payload, deferred to Phase 5's security work.
- **True shared-element morph** from the dots bubble into the message bubble
  — the lighter overlapping fade (Section 6) ships instead; the full morph is
  a later polish item.
- **Presence beyond typing/recording** (e.g. an online/last-seen indicator,
  or a per-message "seen" position) — out of scope; this is composition
  activity only.
