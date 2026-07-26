# Multi-Chat (Concurrent 1:1 Sessions) Design

Lets you have more than one chat open at once — up to 5 — each with a
different person, all live simultaneously, switchable via a chat list on the
left. "New chat" reuses today's Start/Join screen (as a modal) rather than
replacing it; on submit it hands off immediately to a new row in the list so
you're never blocked from checking your other chats while the new one
connects.

**Not group chat.** This is N independent 2-party rooms, each with its own
room code, its own Double Ratchet session, its own safety number — the same
1:1 model the app already has, just N of them at once. It is unrelated to
roadmap Phase 5.5 ("Group chats (3+ people)," which needs sender-keys group
encryption on one shared room). No crypto primitive changes here.

## 1. Architecture: from singular refs to a `ChatSession` map

Today `App.tsx` holds exactly one of everything in flat refs/state:
`clientRef`, `sessionCryptoRef`, `messages`, `outboxRef`,
`pendingReadIdsRef`, `coverTimerRef`, `peerPresence`, `peerProfile`, and the
single `screen` state machine (`App.tsx:144-160`, `:148-212`). This becomes a
`Map<ChatId, ChatSession>` (max size 5), where each `ChatSession` bundles:

- `RelayClient` instance (its own WebSocket connection/room)
- `SessionCrypto` (ratchet + subkeys — `initSession`/`zeroizeSession` already
  operate on one of these; unchanged, just no longer singular)
- message list, outbox, pending-read-ack set
- cover-traffic timer + `lastContentSentAt`
- presence: own heartbeat state, peer's live presence, peer's shared profile
- connection status: `connecting | waiting | handshake | safety-number |
  chat | error`, mirroring today's `Screen` union but scoped per session
  instead of app-wide
- a user-editable label (default `"Chat N"`, N = creation order, not
  reused after a chat closes)

**Stays global** (one value, shared by every session): active profile /
share-profile preference (5.1), Ghost Mode, the room-hidden eye-toggle
default, theme. None of these are conversation-specific today, and nothing
in this feature gives a reason to fork them (see Section 6 on Ghost Mode).

**No server change.** Verified directly: `server/src/server.ts` caps
connections at `maxConnectionsPerIp` = 30 (`server.ts:13`), so 5 concurrent
connections from one browser is well under the limit. `RelayClient`
(`relayClient.ts`) holds no module-level or shared state — every field is
per-instance (`ws`, `listeners`, `state`, `pendingOpen`) — so N live
instances behave exactly like today's one. `RoomManager` already models
"one room, up to 2 peers, keyed by the socket" (`rooms.ts:27-96`); opening 5
chats is just 5 independent `create`/`join` round trips over 5 sockets,
identical to today's single flow repeated 5 times.

## 2. UI shell

- **Zero chats open:** unchanged — the full-screen Start/Join hero
  (`StartJoinScreen`) is still the first thing you see, exactly as today.
- **≥1 chat open:** a persistent left-side chat list replaces the current
  per-chat `Sidebar`, with the active session's content filling the rest of
  the window.
  - Each row shows the session's label, a status indicator (connecting /
    waiting / handshake / safety-number / live / error), and — once live —
    an unread dot + one-line last-message preview when that row isn't the
    active one.
  - A pencil icon on the active (or hovered) row lets you rename it inline.
    Labels are **session-only** (kept in the `ChatSession` map, not
    persisted to `localStorage`/IndexedDB) — consistent with the rest of
    the app: messages, room codes, and connections already don't survive a
    reload, so a label wouldn't outlive its chat anyway.
  - `+ New chat` sits at the top of the list. Disabled (not just
    click-swallowed) once 5 sessions exist, counting sessions in any
    status — a chat mid-handshake still holds a WebSocket slot, so it
    counts toward the cap the same as a live one.
- **Header bar** above the active chat's messages replaces what the old
  `Sidebar` showed globally: room code (+ eye toggle to mask it), the
  verified badge, and an entry point into the data-monitor visualizer.
  These become per-session because each chat has its own room code and
  its own verification state.

## 3. New chat flow

Clicking `+ New chat` opens today's `StartJoinScreen` content (Create /
Join) as a modal over whatever you're currently looking at. Every other
open session keeps running underneath, untouched.

The instant you click Create, or submit a room code via Join, the modal
closes and a new row appears in the list in `connecting` status. From that
point on, **all progress and all errors for that new chat render inside its
own row's pane** — not in a reopened modal, not by taking over the whole
window:

- `connecting` → `waiting` (room created, waiting for the peer) →
  `handshake` (key exchange + hybrid PQ handshake, `LoadingScreen`) →
  `safety-number` (`SafetyNumberScreen`) → `chat` (`ChatScreen`), reusing
  each of those existing components unchanged, just mounted inside the
  content pane instead of as the whole app.
- Any failure at any stage (`server_unreachable`, `bad_code`, `room_full`,
  `handshake_failed`, peer disconnects before safety-number, safety-number
  mismatch) renders `ErrorScreen` inside that same pane, scoped to that one
  session. A retry (where today's app supports one) retries only that
  session's connection attempt.

You are free to switch to any other row at any point during this sequence —
switching away doesn't pause or cancel the in-progress connection.

## 4. Closing a chat

A close control on each row disconnects that session and wipes its keys
immediately — no confirmation step, matching today's instant single-chat
"Leave" behavior (`App.tsx`'s `handleLeave`, now scoped to one entry in the
map instead of the whole app's state). Closing the last remaining chat
returns you to the zero-chats full-screen hero (Section 2).

A `peer-disconnected` event on a live chat behaves the same way it does
today conceptually — the session moves to an `error` (`friend_left`) status
— but now that only affects that one row/pane. Your other chats are
unaffected and stay live.

## 5. Per-session focus semantics (read receipts)

Read-ack timing currently keys off `document.hasFocus()` +
`document.visibilityState` globally (`App.tsx:78-97`, `:260-272`). With
multiple simultaneously-live sessions, a session only counts as "focused"
(eligible to flush pending read acks) when **both**:

1. it is the currently-selected row in the chat list, **and**
2. the browser window itself has focus.

A background session still receives, decrypts, and stores incoming
messages normally (it must — Section 1 requires it to stay fully live) —
it just doesn't send `read` acks for them until you switch to it. This is
the direct multi-chat extension of today's single-chat behavior, not a
change in what read receipts mean or when they're allowed to fire.

Cover traffic and the presence heartbeat run per session on this same
"only matters whether *that session* is live" basis — they are **not**
gated on which row is currently active. A background chat keeps emitting
cover traffic and presence exactly as if it were foregrounded (Section 1 —
"stay fully live" was explicit: an outside observer must not be able to
tell which of your open chats, if any, you're currently looking at).

## 6. Ghost Mode stays global

Ghost Mode remains the single existing toggle (`trojan-troy-ghost-mode` in
`localStorage`) and applies to every open session at once — turning it on
suppresses read acks and presence broadcast across all chats, not just the
active one. A per-chat toggle was considered and rejected: it adds a mode
users have to remember is on in one chat and off in another, for a benefit
(different privacy posture per conversation) nobody asked for.

**One addition beyond today's Ghost Mode scope**, flagged here for
visibility since it wasn't explicitly requested: the unread-row preview
(Section 2) is suppressed — dot only, no message text — whenever Ghost Mode
is on. Showing plaintext previews in the chat list while Ghost Mode is
active would otherwise undercut the feature's whole point.

## 7. Known tradeoffs (accepted, not blockers)

- **Simultaneous-chat-count leak.** Running up to 5 live WebSocket
  connections at once is itself observable to a network onlooker as
  roughly "this device has this many conversations open right now." This
  sits in tension with this branch's cover-traffic work
  (`protocol/coverTraffic.ts`), which hides idle/typing gaps *within* one
  conversation but does nothing to hide *how many* conversations exist.
  Worth being conscious of; not addressed by this spec.
- **Cap is a fixed constant (5), not configurable.** Chosen for bounded
  resource use (5 ratchet sessions + 5 cover-traffic timers + 5 presence
  heartbeats, all concurrent) and to keep the chat list from needing to
  scroll. Revisit only if real usage shows 5 is too tight.

## 8. Testing

- **`ChatSession` map operations** (add / remove / enforce the 5-cap /
  relabel) as pure, unit-testable logic, following this codebase's existing
  pattern of extracting pure decision logic away from timer/DOM wiring
  (`coverTraffic.ts`, `presenceState.ts`, `readAckDecision.ts`).
- **Focus-scoping decision** (Section 5: is *this* session currently
  eligible to send a read ack, given which row is active and whether the
  window has focus) — unit-tested the same way `shouldSendReadAck` is
  tested today, extended with the "which row is active" input.
- **Ghost-Mode preview suppression** (Section 6) — unit test on the row
  render logic: preview text present when Ghost Mode is off, dot-only when
  on.
- **End-to-end**: the existing two-browser Playwright pattern used for
  every prior live feature, extended to three browser contexts — two peers
  each opening a second chat with a third party, confirming: both chats
  stay live and connected simultaneously, cover traffic/presence continue
  in the backgrounded chat, read acks only fire once that chat's row is
  actually selected, and closing one chat doesn't disturb the other.

## Deferred (not in this pass)

- **Persisting the chat list across reload.** Every session (connections,
  keys, messages, labels) is in-memory only and disappears on refresh —
  identical to today's single-chat behavior. Making chats (or their
  history) survive a reload depends on roadmap 5.3/5.4 (offline delivery /
  local encrypted history) and is out of scope here.
- **Per-chat Ghost Mode** (Section 6) — considered and rejected for this
  pass, not merely postponed; revisit only if real usage shows a concrete
  need.
- **Configurable chat cap** (Section 7).
- **Group chats (3+ people in one room)** — this is roadmap Phase 5.5, a
  different feature (shared-room sender-keys encryption) built on top of
  the 5.2 ratchet. Multi-chat as specified here is N separate 2-party
  rooms, not one room with 3+ participants.
