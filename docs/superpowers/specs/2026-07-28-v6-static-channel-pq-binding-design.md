# v6 — Static-channel PQ binding + two hardening fixes

**Date:** 2026-07-28
**Type:** Backend / crypto only. **Zero user-visible change.**
**Baseline:** clean `main` @ `13654dd`, 243 client tests + 31 server tests green.

---

## 0. The binding constraint — read this first

**Nothing in this spec may change how a user interacts with Trojan Troy.** No new
screens, no new prompts, no changed copy, no changed timings, no changed safety-number
format, no re-onboarding, no PIN re-entry, no new settings.

Every change here is key-derivation and validation logic underneath an unchanged UI.
If you find yourself editing a `.tsx` screen, a copy string, or anything in `ui/`, stop —
you have left the scope.

Three properties that must hold after your change, because the UI depends on them:

| Property | Why it must not change |
|---|---|
| `rootKey` value is unchanged by this work | The safety number derives from it. Changing it churns the digits for no reason. |
| Sealed header stays exactly **84 bytes** | `openMsg` slices on `SEALED_HEADER_LEN`; frame sizes feed the padding buckets and the cover-traffic distribution. |
| Padding buckets stay `64 / 256 / 1024 / 4096 / 16384` | `coverTraffic.ts` picks decoy body lengths to land in these exact buckets. Changing them makes cover traffic distinguishable. |

---

## 1. Primary fix — static channels are X25519-only (real, undisclosed gap)

### The finding

`client/src/protocol/ratchetSession.ts:135-138` derives all static-channel keys from the
**raw `crypto_kx` outputs**, not from the hybrid root key:

```ts
txSub: await deriveSubkeys(sessionKeys.tx),    // presence/ack/profile body keys
rxSub: await deriveSubkeys(sessionKeys.rx),
txHdr: await deriveHdrSubkeys(sessionKeys.tx), // and their sealed-header keys
rxHdr: await deriveHdrSubkeys(sessionKeys.rx),
```

So the `presence`, `ack`, and `profile` channels are protected by **X25519 alone** — no
ML-KEM, no transcript binding — while the ratchet and its header keys correctly take both
from `rk0`.

`client/src/crypto/kdf.ts:91-92` shows the reasoning was already understood for the
*ratchet* header keys ("Derived from RK0 rather than the directional crypto_kx keys so they
inherit the hybrid-PQ + transcript binding"). The static path just never got the same
treatment.

### Impact

The `profile` channel carries `{name, avatar, device}` (`App.tsx:507`). A harvest-now,
decrypt-later adversary who breaks X25519 recovers **display names, avatars, presence
rhythm, and every read receipt** — even though message content stays safe. This
contradicts the README's blanket claim that "traffic recorded today can't be decrypted by
a future quantum computer", and it is not in the residuals table.

### Proof it's real (already verified — reproduce if you want)

A throwaway test that calls `initSession` twice with the **same** `crypto_kx` keys but
**different** `pqSecret` and `transcriptHash` gives:

```
rootKey:  differs        <- correct, PQ + transcript are folded in
presence  body same: true | header same: true
ack       body same: true | header same: true
profile   body same: true | header same: true
```

All six static keys come out **byte-identical**. That is the bug.

### The fix

**Step 1** — add to `client/src/crypto/kdf.ts` (place it directly above
`deriveChannelSubkey`):

```ts
// Bind a directional crypto_kx key to the hybrid root key before it is used to
// derive the static channels' subkeys (v6).
//
// Why this exists: the static channels (presence/ack/profile) used to derive
// straight from the raw crypto_kx output, which made them X25519-ONLY — no
// ML-KEM, no transcript binding — while the ratchet and its header keys took
// both from RK0. A harvest-now-decrypt-later adversary who broke X25519 would
// therefore have recovered the profile card (display name + avatar), the
// presence rhythm, and every read receipt, even though message content stayed
// safe. Folding RK0 in closes that gap.
//
// The directional key stays the *message* and RK0 the *key*, so tx/rx remain
// distinct: direction separation (a reflected frame must not open under our own
// receive subkey) survives the binding.
export async function bindDirKey(dirKey: Uint8Array, rk0: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_generichash(
    32,
    concat(sodium.from_string("TTr:dir:v6"), dirKey),
    rk0
  );
}
```

**Step 2** — in `client/src/protocol/ratchetSession.ts`, import `bindDirKey` and change
`initSession` to bind before deriving:

```ts
const txDir = await bindDirKey(sessionKeys.tx, rk0);
const rxDir = await bindDirKey(sessionKeys.rx, rk0);
return {
  ratchet,
  txSub: await deriveSubkeys(txDir),
  rxSub: await deriveSubkeys(rxDir),
  txHdr: await deriveHdrSubkeys(txDir),
  rxHdr: await deriveHdrSubkeys(rxDir),
  // ...rest unchanged
};
```

### Why this is correct (and the trap to avoid)

`crypto_kx` guarantees `sharedTx_Alice == sharedRx_Bob` and vice versa. Both sides compute
the identical `rk0`. Therefore `bindDirKey(A.tx, rk0) == bindDirKey(B.rx, rk0)` — the
mirroring survives, and the two directions stay distinct.

> **TRAP:** Do **not** sort or canonicalise the two directional keys the way
> `deriveRootKey` sorts `rx`/`tx`. That sorting exists so both sides agree on one *shared*
> value. Applying it here would collapse tx and rx into the same key and **destroy
> reflection protection** — a frame bounced back by the relay would open under our own
> receive subkey. Bind each direction independently.

> **TRAP:** Leave the existing `"TTr:sub:" + channel` and `"TTr:hdrsub:" + cls + ":v5"`
> domain tags alone. The input key material already changes, so no cross-version collision
> is constructible, and editing them widens the diff for zero benefit.

---

## 2. Secondary fix — static replay counter is consumed before the body is verified

`client/src/protocol/ratchetSession.ts:218-221` mutates the replay guard *before* the body
AEAD is checked:

```ts
if (!acceptStaticCounter(sc.rxGuard[channel], header.n)) {
  throw new Error("replayed or stale static frame");
}
const plain = await aeadDecrypt(sc.rxSub[channel], bodyB64, encHeader);
```

A relay that keeps an authentic header but mangles the body burns that counter, so the
genuine frame is then permanently rejected as a replay.

**Severity: low.** `openHeader` already succeeded, which proves the header came from the
peer, and the relay could simply drop the frame anyway. This is a robustness fix, not a
break.

**Fix — swap the two statements** so a failed body decrypt (which throws) leaves the guard
untouched:

```ts
const plain = await aeadDecrypt(sc.rxSub[channel], bodyB64, encHeader);
if (!acceptStaticCounter(sc.rxGuard[channel], header.n)) {
  throw new Error("replayed or stale static frame");
}
return unframe(plain);
```

Accepted cost: a replayed frame now pays one extra AEAD open before rejection. Negligible —
opening the header was already an AEAD operation.

---

## 3. Secondary fix — `unframe` returns an unvalidated channel

`client/src/crypto/framing.ts:85` returns `channel: meta.ch` straight from parsed JSON with
no check against the `Channel` union. This is post-authentication, so it is peer-only and
low severity, but the routing field deserves an allowlist.

**Fix** — add a type guard in `framing.ts` and reject unknown channels in `unframe`.

> **TRAP:** the allowlist must contain **all nine** channels, or you will silently break
> presence, receipts, voice, or the PQ rekey:
> `text, voice, presence, ack, profile, primer, cover, pqoffer, pqaccept`
>
> `pqoffer`/`pqaccept` are easy to forget — they carry the post-quantum rekey and are
> dropped after decryption, so a regression there degrades PQ healing **silently** rather
> than visibly. Do not rely on the UI to reveal that mistake.

---

## 4. Version bump

- `client/src/net/relayClient.ts:8` — `PROTOCOL_VERSION` `5` → `6`
- `client/src/crypto/header.ts:21` — `HEADER_VERSION` `5` → `6`

### Why this is safe and invisible

- **No migration needed.** Nothing persisted depends on the protocol version. Storage is
  only theme, ghost-mode/monitor flags, profile names, and the PIN-sealed avatar
  (`profileStore.ts`, `App.tsx:266`). No session state survives a reload.
- **The mismatch path already exists.** `App.tsx:702` and `App.tsx:740` already route a
  version mismatch to the existing `handshake_failed` screen. You are not adding a UX path.
- **Only cross-bundle pairings are affected.** Both peers load the same deploy, so this
  only bites if someone pairs a stale tab against a fresh one. Mitigation is a hard refresh,
  not a code change. Worth mentioning in the PR description.

### Do NOT bump these

Leave the `v4`/`v5` domain tags in `transcript.ts`, `safetyNumber.ts`, `deriveRootKey`, and
`kdfRoot` exactly as they are. The convention in this codebase is to bump a tag only where
the derivation actually changed — `transcript.ts` and `safetyNumber.ts` are still on `v4`
through two protocol revisions, deliberately.

Bumping `deriveRootKey`'s tags would change `rootKey`, which would **change the safety
number digits** — pointless churn and a violation of the constraint in §0.

---

## 5. README correction

Once §1 lands, the static channels *do* inherit hybrid PQ, so the existing
harvest-now-decrypt-later claim (README line ~52) becomes **accurate for all wire traffic**
rather than content-only. Update §1/§2 of the README to state that the static channels are
bound too, and note the fix in `progress.md` + `decisions.md` per existing convention.

The residuals table needs **no new row** for this — the gap is closed, not disclosed.

> **If you implement only part of this spec**, you must instead *qualify* the README claim
> to say post-quantum protection covers message content and that presence/receipts/profile
> remain classical. Do not leave an overclaim standing. The README's honesty is one of this
> project's strongest assets — an inaccurate line there costs more than the bug does.

Leave the existing residual rows alone. They are accurate: static channels still have no
per-message forward secrecy (ratcheting a 2.5s heartbeat would just churn the chain), and
that is correctly disclosed already.

---

## 6. Explicitly OUT of scope

Two further findings from the review are **deliberately excluded**. Do not implement them.

| Excluded | Why |
|---|---|
| PIN attempt backoff | A lockout or delay is by definition user-facing — violates §0. The 4-digit PIN's weakness is already honestly disclosed as a scoping choice. |
| Origin allowlist fail-closed (`server.ts:131`) | `render.yaml` sets **no** `ALLOWED_ORIGINS`, so flipping this to fail-closed would reject **every production connection**. Only viable together with setting the env var and verifying the deploy — not a mid-hackathon change. |

---

## 7. Verification checklist

Do all of these. Report actual output, including anything that fails.

1. `cd client && npx tsc --noEmit` — clean.
2. `cd client && npx vitest run` — **243 tests still pass.** No test should need editing.
   Two things that look like they need changing but do **not**:
   - `crypto/header.test.ts:126` sets `badVersion[1] = 4` and expects a throw. With
     `HEADER_VERSION = 6`, `4` is still wrong → still throws. **Leave it.**
   - `protocol/ratchetSession.test.ts:39,64` pass a literal `5` to
     `computeTranscriptHash`. That is a transcript *input*, unrelated to `HEADER_VERSION`.
     Both sides use the same literal, so they still agree. **Leave it.**
3. `cd server && npx vitest run` — 31 tests pass (untouched, but confirm no regression).
4. **New tests** in `protocol/ratchetSession.test.ts` — this is the load-bearing part of the
   change, so prove it rather than assuming:
   - Same `crypto_kx` keys, **differing** `pqSecret` → all six static keys now **differ**.
     (This is the exact assertion that fails on today's `main`; it is the regression test
     for the whole fix.)
   - Same `crypto_kx` keys, **differing** `transcriptHash` → all six static keys differ.
   - All three static channels still round-trip Alice → Bob under a correct pairing.
   - **Direction separation still holds:** a frame Alice sealed must NOT open under Alice's
     own receive subkeys. This is the test that catches the sorting trap in §1.
   - A replayed static frame is still rejected, and a static frame whose body was tampered
     does **not** burn its counter — the genuine frame with that counter still opens
     afterwards (regression test for §2).
5. `cd client && npx playwright test` — the two-browser run must still show both browsers
   deriving an identical safety number and folding PQ secrets in lockstep.
6. **Confirm the invariants from §0 by inspection:** `SEALED_HEADER_LEN` is still 84,
   `PAD_SCHEDULE` is unchanged, and `computeSafetyNumber`'s inputs are untouched.

## 8. Acceptance criteria

- [ ] All six static keys demonstrably bind both the ML-KEM secret and the transcript hash.
- [ ] `rootKey`, sealed-header length, and padding buckets are byte-for-byte unchanged.
- [ ] Direction separation proven by test, not assumed.
- [ ] 243 + 31 existing tests pass with **no test edits**.
- [ ] Zero changes to any `.tsx` file, any copy string, or anything under `ui/`.
- [ ] README/`progress.md`/`decisions.md` updated; no overclaim left standing.
