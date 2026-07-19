# Phase 2 — Encrypted Messaging: Design Spec

Status: Approved
Date: 2026-07-18

## Purpose

Phase 2 of `roadmap.md`: real-time, end-to-end encrypted text messaging
between the two paired clients, over the same thin relay built in Phase 1.
Phase 1 already derives a shared session key pair (`tx`/`rx`) per client and
discards it after computing the safety number — Phase 2 wires that key
material to actual message encryption and builds the chat UI on top of it.

## Scope

In scope for this spec:
- Symmetric message encryption/decryption using the session keys Phase 1
  already derives.
- One new relay envelope variant (`ciphertext`), reusing the existing
  pass-through relay logic — no server code changes.
- A chat screen: message list, text input, send.
- Gating chat access behind safety-number verification.
- Per-message decryption-failure handling (corrupted/tampered ciphertext).

Still 1:1 only — Phase 1's room model pairs exactly two peers, and Phase 2
doesn't change that. Group chat is not in scope for any phase of Version A.

Out of scope (later phases / explicitly deferred):
- Message history persistence — chat state is in-memory only, same as
  Phase 1's ephemeral session keys. Refreshing the page ends the session;
  no reconnect, no local storage.
- Typing indicators, read receipts, message editing/deletion, timestamps,
  delivery confirmation.
- File/voice attachments (voice messages are Phase 3).
- Any change to the relay server's forwarding logic beyond recognizing that
  `ciphertext` is one more opaque pass-through type (it already is, per the
  Phase 1 implementation's `server.ts` comment: "Anything else ... is an
  opaque blob the relay just forwards without inspecting").

## Correction to `decisions.md`

The original crypto decision named `crypto_box` (libsodium's public-key
authenticated encryption) for message encryption. Phase 1's actual
implementation derives symmetric session keys via `crypto_kx` instead —
`crypto_box` is the wrong primitive for a shared-secret situation.
`crypto_secretbox` is libsodium's standard answer for "authenticate and
encrypt with a symmetric key you already have," which is exactly this case.
This spec uses `crypto_secretbox_easy`; `decisions.md` gets a new entry
correcting the earlier note (see Testing/rollout below).

## Architecture

No new packages, no server changes. Additions are entirely within
`/client`:

```
client/src/
  crypto/
    messages.ts        # encryptMessage / decryptMessage (crypto_secretbox_easy)
    messages.test.ts
  screens/
    ChatScreen.tsx      # message list + input, presentational only
  net/relayClient.ts    # +1 Envelope variant: { type: "ciphertext", payload }
  App.tsx                # captures session keys, wires ChatScreen in/out
```

## Components

### `client/src/crypto/messages.ts`
Thin wrapper around libsodium, same style as Phase 1's `encoding.ts` /
`keys.ts` / `safetyNumber.ts` — no crypto logic inlined into UI code:
- `encryptMessage(key: Uint8Array, plaintext: string): Promise<string>` —
  encrypts with `crypto_secretbox_easy`, using a fresh random nonce
  (`crypto_secretbox_NONCEBYTES`, via `randombytes_buf`) per call. Returns
  base64 of `nonce || ciphertext` concatenated.
- `decryptMessage(key: Uint8Array, payload: string): Promise<string>` —
  splits the decoded bytes back into nonce and ciphertext, calls
  `crypto_secretbox_open_easy`, and throws if the MAC check fails (tampered
  or corrupted data, or wrong key).

Each client uses its own `tx` key to encrypt outgoing messages and the
peer-derived `rx` key to decrypt incoming ones — same asymmetric-by-role
pattern `deriveSessionKeys` already established in Phase 1, so a message
this client sends can never be decrypted by replaying it back at the same
client (`tx` and `rx` are different keys).

### `client/src/screens/ChatScreen.tsx`
Presentational component, no network/crypto logic — matches Phase 1's
screen components exactly:
```ts
interface ChatMessage {
  id: string;               // crypto.randomUUID() — React list key only,
                             // never sent over the wire
  from: "me" | "peer" | "decryption-error";
  text: string;
}

interface ChatScreenProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}
```
Message list (styled by `from`) + a form with a text input and send button,
using the same uncontrolled-`FormData` pattern as `StartJoinScreen`
(read the value on submit, `form.reset()` after — no controlled-input
`useState` needed). Enter-to-submit works for free via native form
behavior. A `decryption-error` message renders as a distinct placeholder
("Message could not be decrypted") rather than being dropped silently.

### `client/src/net/relayClient.ts`
One additive change to the existing `Envelope` union:
```ts
| { type: "ciphertext"; payload: string }
```
No other changes — `RelayClient` already treats all envelope types
generically.

### `client/src/App.tsx`
- `Screen` union gains `{ name: "chat"; messages: ChatMessage[] }`.
- `exchangeKeys` now captures `deriveSessionKeys`'s result (currently
  discarded) into a ref (`sessionKeysRef`), since it's set once per session
  and read from callbacks registered before and after it's available.
- `SafetyNumberScreen`'s `onVerified` (currently a no-op) transitions to
  `{ name: "chat", messages: [] }` — verification is required before chat
  unlocks; there is no path to the chat screen that skips it.
- The existing `onMessage` listener (already registered in `exchangeKeys`)
  gains a `ciphertext` branch: decrypts with `sessionKeysRef.current.rx`,
  appends a `peer` message on success, or a `decryption-error` placeholder
  on failure (caught, not thrown).
- `ChatScreen`'s `onSend(text)` encrypts with `sessionKeysRef.current.tx`,
  sends `{ type: "ciphertext", payload }` via the relay client, and
  optimistically appends a `me` message to local state immediately (no
  round-trip needed to show your own message, no delivery confirmation per
  the bare-minimum scope decision).

## Data flow

1. Both clients complete Phase 1's key exchange and land on the safety
   number screen, each holding `{ tx, rx }` session keys in memory
   (captured now, previously discarded).
2. Both users compare the safety number out of band and click "Verified" —
   this is the only path into the chat screen.
3. User types a message, hits send: `ChatScreen` calls `onSend(text)` →
   `App.tsx` encrypts with `tx`, sends `{ type: "ciphertext", payload }` →
   relay forwards it verbatim (no inspection, same as Phase 1's `pubkey`
   forwarding) → peer's `onMessage` listener decrypts with its `rx`,
   appends the message to its own chat state.
4. If a peer disconnects mid-chat, the existing Phase 1 `peer-disconnected`
   handling applies unchanged — full error screen, no reconnect, matching
   how every other Phase 1 screen already handles it.

## Error handling

- **Decryption failure** (new in Phase 2): a `ciphertext` envelope that
  fails the MAC check is caught, not thrown — appends a
  `decryption-error` placeholder to the message list and the session
  continues. One corrupted or tampered message doesn't end the
  conversation, and the failure is visible rather than silently dropped
  (same reasoning as Phase 1's malformed-relay-frame handling — the relay
  and any messages routed through it are treated as untrusted).
- **Send failure** (e.g. socket already closed): reuses Phase 1's existing
  relay-error handling path (Important fix from Phase 1's final review) —
  no new logic needed here.
- **Peer disconnects mid-chat**: reuses the existing full-screen
  `{ name: "error" }` transition — no new state.
- Nothing new persists to disk or `localStorage` — chat messages live only
  in `App.tsx`'s React state, exactly as ephemeral as the session keys that
  encrypt them. A refresh loses the whole conversation, same as Phase 1's
  existing "no reconnect" behavior.

## Known limitation: no replay/reordering protection

`crypto_secretbox`'s MAC guarantees a message wasn't forged or tampered
with, but it does not guarantee a message wasn't duplicated, dropped, or
reordered by the relay. An untrusted relay could replay an earlier
ciphertext and it would decrypt cleanly, appearing as a duplicate message.
Considered out of scope for this phase — a hackathon 1:1 chat over a
short-lived session — but noted here rather than left implicit, since this
is a security-weighted phase. A future version wanting replay protection
would need a per-direction sequence number authenticated alongside the
ciphertext (bigger scope: requires synchronized counters, which Phase 2's
design proposal explicitly avoided for message *encryption* — the same
trade-off would need revisiting).

## Testing

- **`crypto/messages.ts`** (pure functions, no network/UI, same style as
  Phase 1's crypto tests):
  - round-trips plaintext through `encryptMessage` → `decryptMessage` with
    matching keys.
  - `decryptMessage` rejects when the ciphertext bytes are tampered with
    (flip a byte) — proves the MAC actually catches corruption.
  - `decryptMessage` rejects when given the wrong key.
  - two `encryptMessage` calls on the same plaintext produce different
    ciphertext — proves the nonce is actually randomized per call, not
    accidentally reused (a reused nonce would be a real vulnerability for
    this cipher).
- **`ChatScreen`**: no automated test — presentational only, same "manual
  UI verification" approach as Phase 1's screens (no component-test infra
  exists in this project).
- **`App.tsx` wiring**: same approach as Phase 1's Task 8 — a protocol-level
  integration script (two simulated clients complete key exchange, then
  exchange a few `ciphertext` messages, assert plaintext round-trips
  end-to-end through the real relay) plus a final manual two-browser-window
  check (type messages back and forth, confirm both sides see correct
  plaintext, confirm a disconnect mid-chat still shows the error screen).
- **Server**: no changes, so no new server tests — the existing relay tests
  already cover forwarding opaque envelopes generically regardless of
  `type`.

## Rollout

Before implementation starts, add a `decisions.md` entry correcting the
`crypto_box` → `crypto_secretbox` note (see "Correction to `decisions.md`"
above) — this is a real correction to a previously logged decision, not
just an implementation detail, so it needs to be logged per `AGENTS.md`.
