# Traffic-Analysis Resistance (cover traffic + cadence jitter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the timing/rhythm of a conversation from the relay by emitting a steady, jittered stream of decoy `msg` frames that are byte-indistinguishable from real content, plus jittering the presence heartbeat.

**Architecture:** A cover frame is a normal ratcheted content message (`c:0`) whose sealed channel is a new `"cover"` value — decrypted-then-dropped on receipt, exactly like the existing `"primer"`. A pure decision module (`coverTraffic.ts`) says when to emit; the timer/randomness live in `App.tsx`. The recommended **zero-latency** cadence model sends real messages immediately and emits a cover frame only when the content line has been idle ≥ a jittered interval, so the relay never sees idle gaps but real messages incur no delay. A companion change jitters the presence heartbeat so it doesn't tick like a metronome.

**Tech Stack:** TypeScript, React 18, Vite 5, Vitest 2. No new crypto, no new dependency — cover frames reuse `ratchetSession.sealContent` + `crypto/framing.ts`.

## Global Constraints

- **Audited crypto only; no new dependency.** Cover frames reuse the existing ratchet path (`sealContent`); no new primitive. (AGENTS.md hard constraint.)
- **Relay never reads plaintext.** Cover frames are real ratcheted `msg` envelopes (`c:0`), byte-indistinguishable from content.
- **No UX change / zero added latency (Jay's filter).** Real messages send immediately. The strict constant-rate model (adds latency) stays an off-by-default documented opt-in; this plan wires only the zero-latency model.
- **Invisible to the user.** Cover frames render nothing (drop like `"primer"`); no bubbles, no acks, no status side effects.
- **Stays under the relay abuse cap once Track B ships.** Baseline ~1 frame/sec + a client-side interval floor keeps cover far under Track B's 30 msg/sec sustained throttle (Track B is built on `fix/relay-dos-limits`, not yet merged — safe with or without it live).
- **Presence heartbeat jitter must stay below `PRESENCE_EXPIRY_MS` (5000 ms)** so the peer's indicator never flickers off between beats.
- **Every sodium import in this repo is `"libsodium-wrappers-sumo"`.** (Not touched by this plan, but relevant if you add a sodium import.)
- **Branch:** `feat/traffic-analysis-cover` off `main` (already created; the approved spec is committed there at `b98150d`). Commit via PowerShell so GPG signing works; small human-readable messages, no AI trailer. A post-commit hook auto-pushes — never run `git push` yourself. Do not merge — open a PR.

Spec: `docs/superpowers/specs/2026-07-23-traffic-analysis-resistance-design.md`.

---

### Task 1: Add the `"cover"` channel to `framing.ts`

Adds `"cover"` to the sealed-frame `Channel` union so cover frames round-trip through `frame`/`unframe` and satisfy `tsc`. `frame`/`unframe` are channel-generic at runtime, so the real gate for this task is **typecheck** (a test referencing `"cover"` is a type error until the union is updated).

**Files:**
- Modify: `client/src/crypto/framing.ts:12-14` (the `Channel` union + its comment)
- Test: `client/src/crypto/framing.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Channel` now includes `"cover"`; `frame({ channel: "cover", ... })` / `unframe` round-trip it.

- [ ] **Step 1: Write the failing (type-level) test**

Append to `client/src/crypto/framing.test.ts`:

```ts
it("round-trips a cover frame like primer", () => {
  const body = new Uint8Array([1, 2, 3, 4]);
  const out = unframe(frame({ channel: "cover", id: "", body }));
  expect(out.channel).toBe("cover");
  expect(out.id).toBe("");
  expect(Array.from(out.body)).toEqual([1, 2, 3, 4]);
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd client && npm run typecheck`
Expected: FAIL — `Type '"cover"' is not assignable to type 'Channel'` in `framing.test.ts`.

- [ ] **Step 3: Add `"cover"` to the `Channel` union**

In `client/src/crypto/framing.ts`, update the comment + union:

```ts
// "primer" is a hidden bootstrap message the initiator sends so the responder
// gains a sending chain (see the Double Ratchet init); it renders nothing.
// "cover" is decoy traffic (see traffic-analysis spec) — also decrypted then
// dropped, byte-indistinguishable from real content on the wire.
export type Channel = "text" | "voice" | "presence" | "ack" | "profile" | "primer" | "cover";
```

- [ ] **Step 4: Run typecheck + the test to verify they pass**

Run: `cd client && npm run typecheck && npx vitest run src/crypto/framing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add client/src/crypto/framing.ts client/src/crypto/framing.test.ts
git commit -m "Add cover channel to sealed-frame union"
```

---

### Task 2: `coverTraffic.ts` — pure cadence decision + helpers (TDD)

The pure decision module (mirrors `presenceState.ts` / `readAckDecision.ts`): when to emit a cover frame, the jittered interval, and the cover-body length picker. Randomness is injected as a `rand: () => number` so the module is deterministic under test.

**Files:**
- Create: `client/src/protocol/coverTraffic.ts`
- Test: `client/src/protocol/coverTraffic.test.ts`
- Reuses (in the test only): `frame` from `../crypto/framing`

**Interfaces:**
- Consumes: `frame` from `../crypto/framing` (test only, to assert bucket landing).
- Produces:
  - `type CoverAction = "flush-real" | "cover" | "wait"`
  - `const COVER_INTERVAL_MS = 1500`, `COVER_JITTER_FRAC = 0.4`, `COVER_INTERVAL_FLOOR_MS = 500`
  - `interface CoverInput { now: number; lastContentSentAt: number; hasQueuedReal: boolean; interval: number }`
  - `nextAction(input: CoverInput): CoverAction`
  - `jitteredInterval(base: number, jitterFrac: number, rand: () => number): number`
  - `coverBodyLen(rand: () => number): number`

- [ ] **Step 1: Write the failing tests**

Create `client/src/protocol/coverTraffic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  nextAction,
  jitteredInterval,
  coverBodyLen,
  COVER_INTERVAL_MS,
  COVER_JITTER_FRAC,
  COVER_INTERVAL_FLOOR_MS,
} from "./coverTraffic";
import { frame } from "../crypto/framing";

describe("nextAction", () => {
  it("flushes a queued real message regardless of timing (strict model)", () => {
    expect(nextAction({ now: 0, lastContentSentAt: 0, hasQueuedReal: true, interval: 1500 })).toBe("flush-real");
  });
  it("emits cover once the interval has elapsed with nothing queued", () => {
    expect(nextAction({ now: 1500, lastContentSentAt: 0, hasQueuedReal: false, interval: 1500 })).toBe("cover");
  });
  it("waits before the interval elapses", () => {
    expect(nextAction({ now: 1499, lastContentSentAt: 0, hasQueuedReal: false, interval: 1500 })).toBe("wait");
  });
});

describe("jitteredInterval", () => {
  it("returns the base with no jitter at rand=0.5", () => {
    expect(jitteredInterval(COVER_INTERVAL_MS, COVER_JITTER_FRAC, () => 0.5)).toBe(COVER_INTERVAL_MS);
  });
  it("stays within +/- jitterFrac of the base across the rand range", () => {
    for (const r of [0, 0.1, 0.3, 0.6, 0.9, 0.999]) {
      const v = jitteredInterval(COVER_INTERVAL_MS, COVER_JITTER_FRAC, () => r);
      expect(v).toBeGreaterThanOrEqual(COVER_INTERVAL_MS * (1 - COVER_JITTER_FRAC) - 1);
      expect(v).toBeLessThanOrEqual(COVER_INTERVAL_MS * (1 + COVER_JITTER_FRAC) + 1);
    }
  });
  it("never returns below the floor (guards a misconfigured tiny base)", () => {
    expect(jitteredInterval(100, 0.9, () => 0)).toBe(COVER_INTERVAL_FLOOR_MS);
  });
});

describe("coverBodyLen", () => {
  it("produces frames that land in common, varied buckets", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const len = frame({ channel: "cover", id: "", body: new Uint8Array(coverBodyLen(Math.random)) }).length;
      expect([64, 256, 1024]).toContain(len);
      seen.add(len);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2); // not pinned to one size
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/protocol/coverTraffic.test.ts`
Expected: FAIL — `./coverTraffic` has no exports yet.

- [ ] **Step 3: Implement `coverTraffic.ts`**

Create `client/src/protocol/coverTraffic.ts`:

```ts
// Pure cadence decisions for cover traffic (see the traffic-analysis spec).
// The timer, randomness source, and actual sends live in App.tsx; this module
// holds only testable decisions, matching presenceState.ts / readAckDecision.ts.

export type CoverAction = "flush-real" | "cover" | "wait";

// ~1 frame/sec baseline with +/-40% jitter. The floor guards against a
// misconfigured tiny interval approaching the relay's rate cap.
export const COVER_INTERVAL_MS = 1500;
export const COVER_JITTER_FRAC = 0.4;
export const COVER_INTERVAL_FLOOR_MS = 500;

export interface CoverInput {
  now: number;
  lastContentSentAt: number;
  hasQueuedReal: boolean;
  interval: number;
}

// Zero-latency model uses only "cover"/"wait" (real sends fire immediately, so
// hasQueuedReal is always false). "flush-real" supports the optional strict
// constant-rate model (off by default).
export function nextAction(input: CoverInput): CoverAction {
  if (input.hasQueuedReal) return "flush-real";
  if (input.now - input.lastContentSentAt >= input.interval) return "cover";
  return "wait";
}

export function jitteredInterval(base: number, jitterFrac: number, rand: () => number): number {
  const delta = (rand() * 2 - 1) * jitterFrac; // [-jitterFrac, +jitterFrac)
  return Math.max(COVER_INTERVAL_FLOOR_MS, Math.round(base * (1 + delta)));
}

// Pick a cover-body byte length so the padded frame lands in a common, varied
// bucket (mostly the 64/256 text sizes, occasionally 1024 to mimic a larger
// message). Ranges are overhead-aware for the "cover" channel's ~33B frame
// header so bucketFor lands where intended.
export function coverBodyLen(rand: () => number): number {
  const r = rand();
  if (r < 0.7) return Math.floor(rand() * 25); // -> 64 bucket
  if (r < 0.95) return 40 + Math.floor(rand() * 170); // -> 256 bucket
  return 230 + Math.floor(rand() * 750); // -> 1024 bucket
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npm run typecheck && npx vitest run src/protocol/coverTraffic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add client/src/protocol/coverTraffic.ts client/src/protocol/coverTraffic.test.ts
git commit -m "Add pure cover-traffic cadence decision module"
```

---

### Task 3: Wire the cover scheduler into `App.tsx`

Adds the background timer that keeps the outbound `c:0` frame rate at/above the baseline while in chat, routes every real content send through one helper so the timer sees them, and drops received cover frames. No unit test (timer + randomness live in the component, same division as presence); verified by typecheck + build + the Task 5 two-browser eyeball.

**Files:**
- Modify: `client/src/App.tsx` (imports; `sendContentFrame` helper + the three content-send sites; `lastContentSentRef`/`coverTimerRef`; the cover `useEffect`; the receive-switch `"cover"` case; `handleLeave` teardown)

**Interfaces:**
- Consumes: `nextAction`, `jitteredInterval`, `coverBodyLen`, `COVER_INTERVAL_MS`, `COVER_JITTER_FRAC` (Task 2); `frame` (existing); `sealContent` (existing); `sodium.randombytes_buf` (existing import).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the import**

After the existing `presenceState` import block in `client/src/App.tsx`, add:

```ts
import {
  nextAction,
  jitteredInterval,
  coverBodyLen,
  COVER_INTERVAL_MS,
  COVER_JITTER_FRAC,
} from "./protocol/coverTraffic";
```

- [ ] **Step 2: Add the two refs**

Next to `outboxRef` (near `const outboxRef = useRef<Uint8Array[]>([]);`), add:

```ts
// Last time a real-or-cover c:0 content frame went to the wire — the cover
// scheduler backs off whenever this is recent (see protocol/coverTraffic.ts).
const lastContentSentRef = useRef(0);
const coverTimerRef = useRef<number | null>(null);
```

- [ ] **Step 3: Add a single content-send helper and route all c:0 sends through it**

Add this helper inside the component (e.g. just above `sendContent`):

```ts
// One choke point for every real ratcheted content send, so the cover timer
// sees real traffic and backs off. Static signals (presence/ack/profile) do
// NOT go through here — only c:0 content counts toward the cover baseline.
async function sendContentFrame(sc: SessionCrypto, client: RelayClient, frameBytes: Uint8Array) {
  lastContentSentRef.current = performance.now();
  client.send(await sealContent(sc, frameBytes));
}
```

Then replace the three existing `client.send(await sealContent(sc, ...))` content-send sites:

In `sendContent`, replace `client.send(await sealContent(sc, frameBytes));` with:
```ts
    await sendContentFrame(sc, client, frameBytes);
```

In `flushOutbox`, replace the loop body `client.send(await sealContent(sc, frameBytes));` with:
```ts
      await sendContentFrame(sc, client, frameBytes);
```

In `finishHandshake` (the initiator primer), replace
`client.send(await sealContent(sc, frame({ channel: "primer", id: "", body: EMPTY_BODY })));` with:
```ts
        await sendContentFrame(sc, client, frame({ channel: "primer", id: "", body: EMPTY_BODY }));
```

(Leave all `sealStatic` sends — presence/ack/profile — unchanged.)

- [ ] **Step 4: Add the `"cover"` drop case to the receive switch**

In `handleMsg`, in the `switch (received.channel)`, add right after the `case "primer":` block:

```ts
        case "cover":
          // Decoy traffic: its only job was to advance the ratchet. Drop it.
          break;
```

- [ ] **Step 5: Add the cover scheduler effect**

Add this `useEffect` alongside the other effects in the component body:

```ts
// Cover traffic: while in chat with an established sending chain, keep the
// outbound c:0 frame rate at/above a jittered baseline so the relay can't see
// idle gaps or typing pauses. Real sends reset lastContentSentRef, so cover
// only fills genuine silence — real messages incur zero added latency.
useEffect(() => {
  if (screen.name !== "chat") return;
  let cancelled = false;
  function scheduleCover() {
    if (cancelled) return;
    const interval = jitteredInterval(COVER_INTERVAL_MS, COVER_JITTER_FRAC, Math.random);
    coverTimerRef.current = window.setTimeout(async () => {
      const sc = sessionCryptoRef.current;
      const client = clientRef.current;
      if (sc && client && sc.ratchet.CKs) {
        const action = nextAction({
          now: performance.now(),
          lastContentSentAt: lastContentSentRef.current,
          hasQueuedReal: false,
          interval,
        });
        if (action === "cover") {
          const body = sodium.randombytes_buf(coverBodyLen(Math.random));
          await sendContentFrame(sc, client, frame({ channel: "cover", id: "", body }));
        }
      }
      scheduleCover();
    }, interval);
  }
  scheduleCover();
  return () => {
    cancelled = true;
    if (coverTimerRef.current !== null) {
      clearTimeout(coverTimerRef.current);
      coverTimerRef.current = null;
    }
  };
}, [screen.name]);
```

- [ ] **Step 6: Clear the cover timer in `handleLeave`**

In `handleLeave`, alongside the existing `presenceExpiryRef` teardown, add:

```ts
    if (coverTimerRef.current !== null) {
      clearTimeout(coverTimerRef.current);
      coverTimerRef.current = null;
    }
```

- [ ] **Step 7: Verify green**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green (existing suite unchanged; no new unit tests in this task).

- [ ] **Step 8: Commit**

```powershell
git add client/src/App.tsx
git commit -m "Emit and drop cover traffic while in chat"
```

---

### Task 4: Jitter the presence heartbeat (TDD)

The presence heartbeat re-broadcasts on a fixed 2500 ms period — itself a weak timing fingerprint. Add a bounded per-heartbeat jitter, keeping the max safely below `PRESENCE_EXPIRY_MS`.

**Files:**
- Modify: `client/src/protocol/presenceState.ts`
- Modify: `client/src/protocol/presenceState.test.ts`
- Modify: `client/src/App.tsx` (pass a jittered heartbeat into `shouldSendPresence`)

**Interfaces:**
- Consumes: `PRESENCE_HEARTBEAT_MS`, `PRESENCE_EXPIRY_MS` (existing).
- Produces:
  - `const PRESENCE_HEARTBEAT_JITTER_FRAC = 0.3`
  - `jitteredHeartbeatMs(rand: () => number): number`
  - `PresenceSendInput` gains optional `heartbeatMs?: number`; `shouldSendPresence` uses `input.heartbeatMs ?? PRESENCE_HEARTBEAT_MS`.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/protocol/presenceState.test.ts` (add the two new names to the existing import from `./presenceState`):

```ts
import { jitteredHeartbeatMs, PRESENCE_HEARTBEAT_JITTER_FRAC, PRESENCE_EXPIRY_MS, PRESENCE_HEARTBEAT_MS } from "./presenceState";

describe("jitteredHeartbeatMs", () => {
  it("stays within +/- the jitter fraction of the base", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const v = jitteredHeartbeatMs(() => r);
      expect(v).toBeGreaterThanOrEqual(PRESENCE_HEARTBEAT_MS * (1 - PRESENCE_HEARTBEAT_JITTER_FRAC) - 1);
      expect(v).toBeLessThanOrEqual(PRESENCE_HEARTBEAT_MS * (1 + PRESENCE_HEARTBEAT_JITTER_FRAC) + 1);
    }
  });
  it("never reaches PRESENCE_EXPIRY_MS (indicator must not flicker off)", () => {
    expect(jitteredHeartbeatMs(() => 1)).toBeLessThan(PRESENCE_EXPIRY_MS);
  });
});

describe("shouldSendPresence heartbeat override", () => {
  it("honors a passed heartbeatMs for an unchanged active state", () => {
    const base = { nextState: "typing" as const, lastSentState: "typing" as const, lastSentAt: 0, ghostMode: false };
    expect(shouldSendPresence({ ...base, now: 1200, heartbeatMs: 1000 })).toBe(true);
    expect(shouldSendPresence({ ...base, now: 1200, heartbeatMs: 3000 })).toBe(false);
  });
});
```

(If `shouldSendPresence` isn't already imported in this test file, add it to the existing import.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/protocol/presenceState.test.ts`
Expected: FAIL — `jitteredHeartbeatMs` / `PRESENCE_HEARTBEAT_JITTER_FRAC` not exported; `heartbeatMs` not accepted.

- [ ] **Step 3: Implement in `presenceState.ts`**

Add the constant + helper (after `PRESENCE_EXPIRY_MS`):

```ts
// +/- jitter on the heartbeat so presence resends don't tick like a metronome
// (a weak timing fingerprint). Bounded so the max stays below
// PRESENCE_EXPIRY_MS — the peer's indicator must never flicker off between beats.
export const PRESENCE_HEARTBEAT_JITTER_FRAC = 0.3;

export function jitteredHeartbeatMs(rand: () => number): number {
  const delta = (rand() * 2 - 1) * PRESENCE_HEARTBEAT_JITTER_FRAC;
  return Math.round(PRESENCE_HEARTBEAT_MS * (1 + delta));
}
```

Add the optional field to `PresenceSendInput`:

```ts
  ghostMode: boolean;
  /** Overrides PRESENCE_HEARTBEAT_MS for this check (caller passes a jittered value). */
  heartbeatMs?: number;
```

And change the final line of `shouldSendPresence`:

```ts
  return input.now - input.lastSentAt >= (input.heartbeatMs ?? PRESENCE_HEARTBEAT_MS);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npm run typecheck && npx vitest run src/protocol/presenceState.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass the jittered heartbeat from `App.tsx`**

In `App.tsx`, add `jitteredHeartbeatMs` to the existing `presenceState` import, then in `sendPresence`'s `shouldSendPresence({ ... })` call add the field:

```ts
        ghostMode: ghostModeRef.current,
        heartbeatMs: jitteredHeartbeatMs(Math.random),
```

- [ ] **Step 6: Verify green**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```powershell
git add client/src/protocol/presenceState.ts client/src/protocol/presenceState.test.ts client/src/App.tsx
git commit -m "Jitter the presence heartbeat interval"
```

---

### Task 5: Honest copy, docs, manual eyeball, PR

**Files:**
- Modify: `client/src/components/Settings.tsx:102-111` (about/security copy)
- Modify: `decisions.md`
- Modify: `progress.md`

- [ ] **Step 1: Update the about/security copy honestly**

In `client/src/components/Settings.tsx`, replace the sentence
`The relay can still tell that you're chatting and roughly how much, but never what's said.`
with:

```tsx
            The app also blends in a steady stream of decoy traffic, so the relay can tell a chat is
            happening but not its rhythm — when you're typing, pausing, or sitting idle — and never
            what's said.
```

(Do not claim burst intensity or total volume is hidden — those are documented residuals.)

- [ ] **Step 2: Verify green after the copy change**

Run: `cd client && npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 3: Manual two-browser eyeball**

`cd client && npm run dev`, open two browser contexts, pair them, and reach chat. In DevTools → Network → the WebSocket → Messages:
1. Sit idle → confirm a steady, jittered stream of outbound frames (~1/sec) with sizes matching real sends (64/256, occasional 1024) — cover is indistinguishable from content.
2. Send a real message → confirm it goes out immediately (no perceptible lag) and briefly suppresses cover.
3. Confirm **no** stray/empty message bubbles appear on either side, and no status/ack flicker.
4. Leave the chat → confirm the outbound frame stream stops (timer cleared).

(No browser-automation tool is required by hand — a throwaway Playwright script against `http://localhost:5173/` can drive the pairing and assert the WebSocket frame cadence + absence of bubbles; Python Playwright 1.61.0 + chromium are installed in this environment. Write/run/delete it, as prior phases did.)

- [ ] **Step 4: Log decisions** (append to `decisions.md`, newest-first, matching the existing format)

Add a `2026-07-25` entry covering: cover traffic rides the `c:0` content channel (byte-indistinguishable, bonus ratchet rotation); the **zero-latency "minimum frame rate"** cadence chosen as default (real sends immediate; cover only fills idle ≥ jittered interval) with the strict constant-rate model left as an off-by-default opt-in per Jay's no-latency filter; `COVER_INTERVAL_MS = 1500` ± 40% (~1/sec) with a 500 ms floor and its relation to Track B's cap (safe once Track B ships); presence heartbeat jitter (±30%, bounded < `PRESENCE_EXPIRY_MS`); and the honest residuals (burst intensity, voice size, session existence/duration still leak).

- [ ] **Step 5: Update `progress.md`** with a dated entry summarizing the cover-traffic + heartbeat-jitter work, files touched, test count, and the manual eyeball result.

- [ ] **Step 6: Commit docs**

```powershell
git add client/src/components/Settings.tsx decisions.md progress.md
git commit -m "Log traffic-analysis cover traffic; honest metadata copy"
```

- [ ] **Step 7: Open a PR against `main` (do not merge)**

The post-commit hook has already pushed the branch. Confirm `git rev-parse HEAD origin/feat/traffic-analysis-cover` match, then:

```bash
gh pr create --base main --title "Traffic-analysis resistance: cover traffic + cadence jitter" --body "Cover traffic (decoy c:0 frames, dropped like the primer) masks the conversation's idle/typing rhythm from the relay with zero added latency to real messages; presence heartbeat gets bounded jitter. No new crypto/dependency, no server change. Spec: docs/superpowers/specs/2026-07-23-traffic-analysis-resistance-design.md"
```

---

## Self-Review

**Spec coverage:**
- Cover frames ride `c:0` via a new `"cover"` channel, dropped like `"primer"` → Task 1 (channel) + Task 3 (emit + drop). ✅
- Cover body varies across common buckets → Task 2 `coverBodyLen` + its bucket-landing test. ✅
- Zero-latency "minimum frame rate" cadence; strict model supported by the pure fn but not wired → Task 2 (`nextAction` incl. `flush-real`) + Task 3 (wires only cover/wait). ✅
- Scheduler active only in chat with a sending chain; reset on real send; cleared on leave → Task 3 (effect keyed on `screen.name`, `sc.ratchet.CKs` guard, `sendContentFrame`, `handleLeave`). ✅
- Presence heartbeat jitter, bounded < expiry → Task 4. ✅
- Rate stays under Track B cap (floor) → Task 2 `COVER_INTERVAL_FLOOR_MS` + its test. ✅
- Honest about/security copy → Task 5 Step 1. ✅
- Tests: cover cadence/jitter/bucket, presence jitter/override, cover-frame round-trip → Tasks 1,2,4. ✅
- Docs + manual eyeball + PR → Task 5. ✅

**Placeholder scan:** No TBD/TODO; every code step has concrete code. The manual eyeball (Task 5 Step 3) is inherently descriptive but has explicit, checkable observations.

**Type consistency:** `nextAction(CoverInput)`, `jitteredInterval(base, jitterFrac, rand)`, `coverBodyLen(rand)`, constants `COVER_INTERVAL_MS`/`COVER_JITTER_FRAC`/`COVER_INTERVAL_FLOOR_MS` defined in Task 2 and consumed with matching signatures in Task 3. `sendContentFrame(sc, client, frameBytes)` defined and used consistently within Task 3. `jitteredHeartbeatMs(rand)` + optional `heartbeatMs` on `PresenceSendInput` defined in Task 4 Step 3 and used in Step 5. `frame({ channel: "cover", ... })` valid after Task 1.
