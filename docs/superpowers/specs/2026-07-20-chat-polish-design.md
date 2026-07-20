# Chat Polish: Themed Bubble Animations + Read/Delivered Receipts Design

Two related, deliberately low-cost additions to the chat surface, done before
the bigger Phase 4.6 (screen styling) and Phase 4.7 (Fable code review) work
and well before Phase 5 (new features/security scope): (1) richer,
theme-specific entrance animation for chat bubbles, replacing the single
shared animation all three themes currently use; (2) WhatsApp-style
delivered/read receipts on your own sent messages, with a "Ghost Mode"
setting that lets a user suppress the read signal specifically.

Builds on top of Phases 1-4.5's unchanged crypto/relay layers and the
existing three-theme system (Apple, Iris Glass, Pulse Slate). Does not touch
`StartJoinScreen`, `WaitingScreen`, or `SafetyNumberScreen` — those are
Phase 4.6's job. Does not add offline delivery, message persistence, or any
new crypto primitive.

## 1. Themed bubble entrance animations

Today every theme shares one `msgIn` keyframe (`MessageBubble.css:1-3`) — a
plain fade + slide + scale. This replaces it with three theme-specific,
multi-layered animations, selected via the same `[data-theme="..."]`
attribute selector already used everywhere else in this codebase. All pure
CSS — no new dependencies, no JS animation library.

- **Apple** (`data-theme="apple"`): scale 0.92 → 1 + a small upward pop
  (~0.25s, ease-out), plus a brief shadow-depth increase as the bubble
  "lands." Snappy and understated, matching this theme's restrained,
  native-feeling identity — the point is that it does *not* show off.
- **Iris Glass** (`data-theme="iris"`): fade + slight upward drift +
  `blur(6px) → blur(0)` (~0.6s), plus a one-shot glow sweep across the
  bubble as it resolves into focus. The sweep reuses the existing `sheen`
  keyframe (`keyframes.css:6`, currently only used for `Sidebar`'s looping
  shimmer) but played once on arrival instead of looping.
- **Pulse Slate** (`data-theme="pulse"`): a bounce-overshoot entrance
  (~0.4s) reusing the shape of the existing `checkPop` keyframe
  (`keyframes.css:15`, currently used for the loading screen's checklist),
  plus a brief accent-color glow flash on landing, echoing this theme's
  existing gradient/glow language.

**Additional motion layers, applied across all three themes:**

- **Staggered group entrance**: when multiple messages arrive in quick
  succession, each bubble's entrance animation is offset by ~70ms from the
  previous one instead of all firing simultaneously — the same staggering
  technique already used for `CipherWord`'s letter-by-letter reveal
  (`CipherWord.tsx`).
- **Animated read-receipt ticks** (see Section 2): the check icon itself
  pops in using `checkPop`, and the grey → blue color change when a message
  flips from delivered to read is a smooth transition, not an instant swap.
- **Send-button micro-interaction**: pressing send gives the button a
  quick tactile scale-down, and the composer's input clears with a small
  motion rather than an instant value reset.
- **Hover treatment extended to Apple**: today only Iris Glass and Pulse
  Slate bubbles lift slightly on hover (`MessageBubble.css:38-41`); Apple
  gets its own, more subtle hover response so no theme feels inert to the
  cursor.

Nothing about bubble layout, color, radius, or the existing per-theme
border treatment changes — only entrance/interaction motion.

## 2. Delivered/read receipts

### 2.1 Message identity

Today the sender and receiver each generate their own independent random
`id` for the same logical message (`App.tsx:87` for the receiver,
`App.tsx:168` for the sender) — there is no shared identifier either side
can use to say "this specific message." This adds one: the sender's
existing `id` (already generated at send time via `crypto.randomUUID()`) is
included as a new cleartext `messageId` field alongside the ciphertext in
the envelope:

```ts
{ type: "ciphertext", payload, messageId }
{ type: "voice", payload, mimeType, messageId }
```

`messageId` is a random correlation identifier, not message content, so
this does not touch the "relay must never see plaintext" hard constraint —
it's the same category as the `mimeType` field voice messages already send
in cleartext today. See `decisions.md` (2026-07-20) for the fuller
rationale and the explicitly deferred alternative (embedding the ID inside
the encrypted payload instead) — flagged there for revisiting once back in
a security-hardening phase, not part of this pass.

The receiver reuses this same `messageId` when constructing its own local
`ChatMessage` for that incoming message, instead of generating a new random
one — this is what lets acks reference a message both sides recognize.

### 2.2 New envelope types

Two new pass-through envelope types, forwarded by the relay exactly like
`ciphertext`/`voice` already are (no server changes at all — `rooms.ts`'s
`forward()` already forwards any type it doesn't specifically recognize):

- `{ type: "delivered", messageId }` — sent by the receiving client the
  moment it successfully decrypts an incoming `ciphertext` or `voice`
  message. Always sent, unconditionally — Ghost Mode does not affect this.
- `{ type: "read", messageId }` — sent by the receiving client when that
  message has actually been seen (see 2.3). Suppressed entirely when Ghost
  Mode is on (2.5).

### 2.3 Read trigger: tab-focus based

"Read" means the receiving client's tab was focused and visible while that
message was the latest one received — not simply "successfully decrypted"
(which is what "delivered" already covers). The receiving client tracks the
most recent message it has received. Whenever the tab is both:

- visible (`document.visibilityState === "visible"`), and
- focused (`document.hasFocus()`)

...and there is a received message that hasn't had a `read` ack sent for it
yet, one is sent. This can happen immediately (tab already focused when the
message arrives) or later (tab was backgrounded/minimized, then the user
switches back — a `visibilitychange`/`focus` listener triggers the check).
If several messages arrive while backgrounded, only one `read` ack fires
once focus returns (for the latest message), not one per message — batching
matches how real chat apps treat "you opened the conversation," not
"you looked at every individual line."

The decision "should a read ack be sent right now" — given
`(isFocused, isVisible, ghostModeOn, alreadyAckedThisId)` — is a small pure
function, unit-tested in isolation, the same way `crossfadeState.ts`
separates timing/state logic from its DOM wiring.

### 2.4 Status tracking and display

Every message you send gets an internal status:
`"sent" | "delivered" | "read"`, starting at `"sent"` the moment it's
optimistically added to your own message list (unchanged from today).
When a `delivered` or `read` envelope arrives, the matching message (found
by `messageId`) has its status updated. Status only ever advances —
`sent → delivered → read` — never backward; this is a small pure function
(`advanceStatus(current, incoming)`), unit-tested the same way as 2.3's
decision function.

Only your most recent sent message displays a status indicator (not every
message you've ever sent) — 1 grey check for sent, 2 grey checks for
delivered, 2 blue checks for read. Incoming (peer's) messages never show a
status indicator — that would only ever reflect back your own read state to
yourself, which is meaningless.

### 2.5 Ghost Mode

A new toggle in the `Settings` modal, in its own small "Privacy" section
between the existing "Session" and "About" sections. When on, the
tab-focus check in 2.3 is skipped entirely — `read` envelopes are never
sent, regardless of actual focus state. `delivered` envelopes are
unaffected; the peer still learns the message reached your device, just
never that you've seen it.

Persisted in `localStorage` under `trojan-troy-ghost-mode`, the same
pattern the theme preference already uses (`ThemeContext.tsx`), defaulting
to **off**. Lives as plain state in `App.tsx`, passed down as props to
`Settings` — not a new React Context. Unlike theme (read in several
disparate places, including dev overrides), Ghost Mode has exactly one
read site (the read-ack decision in 2.3) and one write site (the Settings
toggle), so a Context would be more machinery than the two call sites
justify. Toggling it applies prospectively only — it does not retroactively
un-send a `read` ack already sent for earlier messages.

## 3. Error handling

- **Ack referencing an unknown `messageId`** (e.g. the page was refreshed
  mid-conversation, losing local message-list state) — silently ignored,
  no crash. Same defensive-drop convention `RelayClient` already uses for
  malformed incoming data.
- **Peer disconnects mid-chat** — already routes the whole app to the
  existing plain error screen (`App.tsx`'s `peer-disconnected` handling);
  the chat UI unmounts entirely, so there's no "stuck on Sent forever"
  state to reconcile.
- **Multiple messages arrive while backgrounded** — covered by 2.3's
  batching (one `read` ack for the latest, not one per message).
- **Out-of-order ack arrival** — not really possible given a single ordered
  WebSocket connection and that a client always sends `delivered` before
  `read` for the same message, but harmless regardless because of 2.4's
  forward-only status rule.

## 4. Testing

- `advanceStatus` (status transition rule): unit tests covering forward
  transitions (`sent → delivered → read`), rejection of backward
  transitions, and unknown/no-op inputs.
- The read-ack decision function from 2.3: unit tests covering all
  combinations of focused/visible/ghost-mode/already-acked.
- Bubble animations, the one-shot sheen, staggered entrance, and hover
  treatment: CSS-only, no unit tests — matches this codebase's existing
  convention (no jsdom/React-Testing-Library setup anywhere) — verified
  manually/via Playwright instead, consistent with every prior visual
  phase.
- Full protocol end-to-end (messageId threading, delivered/read envelopes,
  Ghost Mode suppression): verified with the same live two-browser
  Playwright pattern used for every other feature in this project — send a
  message from A, confirm the tick on A's side progresses grey-single →
  grey-double → blue-double as B decrypts and then focuses; separately
  confirm A's tick freezes at grey-double when B has Ghost Mode on, even
  after B focuses.

## Deferred (not in this pass — see `decisions.md` and `roadmap.md`)

- Hiding `messageId` from the relay entirely (embedding it inside the
  encrypted payload instead of sending it in cleartext) — explicitly
  deferred to a future security-hardening pass (Phase 5), not part of this
  low-cost polish pass. See `decisions.md`, 2026-07-20.
- Full theme-awareness for the loading screen (pre-existing backlog item,
  unrelated to this spec) — untouched here.
