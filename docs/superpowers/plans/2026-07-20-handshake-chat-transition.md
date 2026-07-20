# Continuous Handshake-to-Chat Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard cuts between the loading/handshake screen, the safety-number screen, and the chat screen with one continuous journey — a persistent ambient-orb backdrop that never remounts, and a cross-fade between each screen's foreground content.

**Architecture:** A new `HandshakeJourney` wrapper owns a single `<AmbientOrbs />` instance and a generic `Crossfade` component; `App.tsx` renders `HandshakeJourney` once for the `handshake`/`safety-number`/`chat` screen states instead of three separate early returns. `Crossfade`'s timing/state logic is a pure, unit-tested module; the React wiring around it (and all CSS) is verified manually, matching this project's existing convention (no DOM/React-rendering test setup exists in this codebase — `vitest.config.ts` runs in `"node"` environment, no jsdom, no React Testing Library).

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`environment: "node"`, no new dependencies).

## Global Constraints

- No new npm dependencies — hand-rolled CSS transitions only (per design decision in the spec).
- Crossfade duration: 350ms, easing `cubic-bezier(0.2, 0.9, 0.3, 1)` (already used elsewhere in `LoadingScreen.css`), opacity + `translateY(8px)`.
- `App.tsx`'s `Screen` union and its `handshake` → `safety-number` → `chat` transition logic must not change — only the render layer changes.
- `StartJoinScreen` and `WaitingScreen` are out of scope — untouched.
- `SafetyNumberScreen`'s existing markup, copy, and "Verified" button stay exactly as they are — only a CSS file is added for background/text-color legibility, no layout/redesign.
- Orb visibility rule: always visible during `handshake`/`safety-number`; visible during `chat` only when `data-theme="iris"` (matches today's behavior, now driven by a `data-active-screen` attribute instead of DOM nesting).
- Every task must leave the app compiling and typechecking cleanly (`npm run typecheck`, `npm run test` in `client/`), even before the feature is fully wired up in the final task.

Spec: `docs/superpowers/specs/2026-07-20-handshake-chat-transition-design.md`.

---

### Task 1: Crossfade pure state logic

**Files:**
- Create: `client/src/components/crossfadeState.ts`
- Test: `client/src/components/crossfadeState.test.ts`

**Interfaces:**
- Produces: `CrossfadeLayer { key: string; node: ReactNode }`, `CrossfadeState { current: CrossfadeLayer; exiting: CrossfadeLayer | null }`, `withActiveKey(state: CrossfadeState, key: string, node: ReactNode): CrossfadeState`, `settled(state: CrossfadeState): CrossfadeState` — all consumed by Task 2's `Crossfade` component.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/components/crossfadeState.test.ts
import { describe, expect, it } from "vitest";
import { withActiveKey, settled, type CrossfadeState } from "./crossfadeState";

describe("withActiveKey", () => {
  it("moves the previous current layer to exiting when the key changes", () => {
    const state: CrossfadeState = { current: { key: "a", node: "A" }, exiting: null };
    const next = withActiveKey(state, "b", "B");
    expect(next.current).toEqual({ key: "b", node: "B" });
    expect(next.exiting).toEqual({ key: "a", node: "A" });
  });

  it("updates the current node in place without touching exiting when the key is unchanged", () => {
    const state: CrossfadeState = {
      current: { key: "a", node: "A" },
      exiting: { key: "z", node: "Z" },
    };
    const next = withActiveKey(state, "a", "A2");
    expect(next.current).toEqual({ key: "a", node: "A2" });
    expect(next.exiting).toEqual({ key: "z", node: "Z" });
  });
});

describe("settled", () => {
  it("clears an exiting layer", () => {
    const state: CrossfadeState = {
      current: { key: "a", node: "A" },
      exiting: { key: "z", node: "Z" },
    };
    expect(settled(state)).toEqual({ current: { key: "a", node: "A" }, exiting: null });
  });

  it("is a no-op when there's nothing exiting", () => {
    const state: CrossfadeState = { current: { key: "a", node: "A" }, exiting: null };
    expect(settled(state)).toEqual(state);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `client/`): `npm run test -- crossfadeState`
Expected: FAIL — `crossfadeState.ts` doesn't exist yet (`Cannot find module './crossfadeState'`).

- [ ] **Step 3: Write the implementation**

```ts
// client/src/components/crossfadeState.ts
import type { ReactNode } from "react";

export interface CrossfadeLayer {
  key: string;
  node: ReactNode;
}

export interface CrossfadeState {
  current: CrossfadeLayer;
  exiting: CrossfadeLayer | null;
}

export function withActiveKey(state: CrossfadeState, key: string, node: ReactNode): CrossfadeState {
  if (state.current.key === key) {
    return { current: { key, node }, exiting: state.exiting };
  }
  return { current: { key, node }, exiting: state.current };
}

export function settled(state: CrossfadeState): CrossfadeState {
  if (state.exiting === null) return state;
  return { current: state.current, exiting: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- crossfadeState`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add client/src/components/crossfadeState.ts client/src/components/crossfadeState.test.ts
git commit -m "Add crossfade state logic"
```

---

### Task 2: `Crossfade` component

**Files:**
- Create: `client/src/components/Crossfade.tsx`
- Create: `client/src/components/Crossfade.css`
- Modify: `client/src/styles/keyframes.css`

**Interfaces:**
- Consumes: `withActiveKey`, `settled`, `CrossfadeState` from Task 1's `client/src/components/crossfadeState.ts`.
- Produces: `Crossfade` component with props `{ activeKey: string; durationMs?: number; children: ReactNode }` — consumed by Task 3's `HandshakeJourney`.

- [ ] **Step 1: Add the crossfade keyframes**

Append to `client/src/styles/keyframes.css` (after the existing `rowIn` line):

```css
@keyframes crossfadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes crossfadeOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-8px); } }
```

- [ ] **Step 2: Write `Crossfade.css`**

```css
/* client/src/components/Crossfade.css */
.crossfade {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
}
.crossfade__layer {
  position: absolute;
  inset: 0;
}
.crossfade__layer--current {
  animation: crossfadeIn 350ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.crossfade__layer--exiting {
  animation: crossfadeOut 350ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
  pointer-events: none;
}
```

- [ ] **Step 3: Write `Crossfade.tsx`**

```tsx
// client/src/components/Crossfade.tsx
import { useEffect, useState, type ReactNode } from "react";
import { withActiveKey, settled, type CrossfadeState } from "./crossfadeState";
import "./Crossfade.css";

interface CrossfadeProps {
  activeKey: string;
  durationMs?: number;
  children: ReactNode;
}

export function Crossfade({ activeKey, durationMs = 350, children }: CrossfadeProps) {
  const [state, setState] = useState<CrossfadeState>({
    current: { key: activeKey, node: children },
    exiting: null,
  });

  useEffect(() => {
    setState((prev) => withActiveKey(prev, activeKey, children));
  }, [activeKey, children]);

  useEffect(() => {
    if (!state.exiting) return;
    const timer = setTimeout(() => setState((prev) => settled(prev)), durationMs);
    return () => clearTimeout(timer);
  }, [state.exiting, durationMs]);

  return (
    <div className="crossfade">
      {state.exiting && (
        <div key={state.exiting.key} className="crossfade__layer crossfade__layer--exiting">
          {state.exiting.node}
        </div>
      )}
      <div key={state.current.key} className="crossfade__layer crossfade__layer--current">
        {state.current.node}
      </div>
    </div>
  );
}
```

`Crossfade` itself isn't unit-tested — it requires rendering React components, and this project's Vitest config runs in a plain `"node"` environment with no jsdom/React Testing Library set up anywhere (verified: no existing test in the codebase renders a component). Its correctness is covered by Task 1's tests for the logic it delegates to, plus Task 8's manual/Playwright verification.

- [ ] **Step 4: Typecheck**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add client/src/components/Crossfade.tsx client/src/components/Crossfade.css client/src/styles/keyframes.css
git commit -m "Add Crossfade component"
```

---

### Task 3: `HandshakeJourney` wrapper

**Files:**
- Create: `client/src/screens/HandshakeJourney.tsx`
- Create: `client/src/screens/HandshakeJourney.css`

**Interfaces:**
- Consumes: `AmbientOrbs` from `client/src/components/AmbientOrbs.tsx` (unchanged), `Crossfade` from Task 2.
- Produces: `HandshakeJourney` component with props `{ activeKey: string; children: ReactNode }` — consumed by Task 7's `App.tsx` wiring.

- [ ] **Step 1: Write `HandshakeJourney.css`**

```css
/* client/src/screens/HandshakeJourney.css */
.handshake-journey {
  position: fixed;
  inset: 0;
  background: linear-gradient(160deg, #0D0F18 0%, #101223 100%);
}
.handshake-journey[data-active-screen="chat"] .ambient-orbs__orb {
  display: none;
}
:root[data-theme="iris"] .handshake-journey[data-active-screen="chat"] .ambient-orbs__orb {
  display: block;
}
```

This is the same Iris-only-in-chat rule the app already has today (previously `.chat-screen .ambient-orbs__orb { display: none }` / iris override in `ChatScreen.css`, scoped by DOM nesting since `AmbientOrbs` used to render inside `ChatScreen`). It's relocated here because `AmbientOrbs` now renders once at this wrapper level instead of once per screen, so DOM nesting can no longer express "only when chat is showing" — a `data-active-screen` attribute does instead.

- [ ] **Step 2: Write `HandshakeJourney.tsx`**

```tsx
// client/src/screens/HandshakeJourney.tsx
import type { ReactNode } from "react";
import { AmbientOrbs } from "../components/AmbientOrbs";
import { Crossfade } from "../components/Crossfade";
import "./HandshakeJourney.css";

interface HandshakeJourneyProps {
  activeKey: string;
  children: ReactNode;
}

export function HandshakeJourney({ activeKey, children }: HandshakeJourneyProps) {
  return (
    <div className="handshake-journey" data-active-screen={activeKey}>
      <AmbientOrbs />
      <Crossfade activeKey={activeKey}>{children}</Crossfade>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add client/src/screens/HandshakeJourney.tsx client/src/screens/HandshakeJourney.css
git commit -m "Add HandshakeJourney wrapper"
```

---

### Task 4: Strip `LoadingScreen`'s own background and orbs

**Files:**
- Modify: `client/src/screens/loading/LoadingScreen.tsx`
- Modify: `client/src/screens/loading/LoadingScreen.css`

**Interfaces:**
- No prop/type changes — `LoadingScreen`'s existing `{ roomCode: string; durationMs?: number }` props are unchanged. Only its own background/orb rendering moves up to `HandshakeJourney` (Task 3).

- [ ] **Step 1: Remove the internal `AmbientOrbs` render**

In `client/src/screens/loading/LoadingScreen.tsx`, remove the import and render:

```tsx
import { AmbientOrbs } from "../../components/AmbientOrbs";
```

and

```tsx
      <AmbientOrbs />
```

(both currently present — see the component's existing `return` block).

- [ ] **Step 2: Make the screen fill its parent instead of the viewport**

In `client/src/screens/loading/LoadingScreen.css`, replace the `.loading-screen` block's `position`/`inset`/`background` lines:

```css
.loading-screen {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 72px 80px 96px;
  font-family: 'Schibsted Grotesk', sans-serif;
  background: transparent;
  color: #E8EAF2;
}
```

(was `position: fixed; inset: 0; ...; background: linear-gradient(160deg, #0D0F18 0%, #101223 100%);` — the gradient now lives on `HandshakeJourney`'s root, and `LoadingScreen` sits inside `Crossfade`'s absolutely-positioned layer, which already fills the full viewport via `HandshakeJourney`.)

- [ ] **Step 3: Typecheck and run existing tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all existing tests still pass (this task doesn't touch any tested logic).

- [ ] **Step 4: Commit**

```powershell
git add client/src/screens/loading/LoadingScreen.tsx client/src/screens/loading/LoadingScreen.css
git commit -m "Move loading screen's background and orbs to the journey wrapper"
```

---

### Task 5: Strip `ChatScreen`'s own background and orbs

**Files:**
- Modify: `client/src/screens/ChatScreen.tsx`
- Modify: `client/src/screens/ChatScreen.css`

**Interfaces:**
- No prop/type changes — `ChatScreen`'s existing `ChatScreenProps` are unchanged.

- [ ] **Step 1: Remove the internal `AmbientOrbs` render**

In `client/src/screens/ChatScreen.tsx`, remove the import and render:

```tsx
import { AmbientOrbs } from "../components/AmbientOrbs";
```

and

```tsx
      <AmbientOrbs />
```

- [ ] **Step 2: Update `ChatScreen.css`**

Replace the full contents of `client/src/screens/ChatScreen.css`:

```css
.chat-screen {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-ui);
}
:root[data-theme="iris"] .chat-screen {
  background: transparent;
}
.chat-screen__body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.chat-screen__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chat-screen__messages {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chat-screen__day-divider {
  align-self: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
```

Two things changed from before: `.chat-screen` no longer uses `position: fixed; inset: 0` (it now fills `Crossfade`'s layer instead of the viewport directly), and it's transparent specifically under Iris Glass (`--bg` for `iris` in `tokens.css` is the exact same gradient `HandshakeJourney` now paints, so this is visually identical to before — it just lets the shared, never-remounted orb layer show through instead of repainting the same gradient locally). Apple and Pulse Slate keep their own opaque `var(--bg)`, unchanged. The old `.chat-screen .ambient-orbs__orb` display rules and the `.chat-screen > .title-bar, .chat-screen__body { position: relative; z-index: 1 }` rule are removed — both existed only to manage orbs that were nested inside `.chat-screen`, which is no longer the case (orb visibility is now handled by `HandshakeJourney.css` from Task 3).

- [ ] **Step 3: Typecheck and run existing tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```powershell
git add client/src/screens/ChatScreen.tsx client/src/screens/ChatScreen.css
git commit -m "Move chat screen's background and orbs to the journey wrapper"
```

---

### Task 6: Style `SafetyNumberScreen` for the dark backdrop

**Files:**
- Modify: `client/src/screens/SafetyNumberScreen.tsx`
- Create: `client/src/screens/SafetyNumberScreen.css`

**Interfaces:**
- No prop/type changes — `SafetyNumberScreenProps` unchanged.

- [ ] **Step 1: Write `SafetyNumberScreen.css`**

```css
/* client/src/screens/SafetyNumberScreen.css */
.safety-number-screen {
  background: transparent;
  color: #E8EAF2;
}
```

Once this screen sits inside `HandshakeJourney` (Task 7), its default browser background is already transparent — nothing today paints an opaque color behind it, so `HandshakeJourney`'s gradient will show through on its own. The one real change needed is legible text: this screen's plain `h1`/`p`/`code`/`button` currently render in default (near-black) text color, which would be unreadable against the new dark backdrop. `background: transparent` is set explicitly anyway so this stays self-documenting rather than relying on browser defaults.

- [ ] **Step 2: Wire the class onto the root element**

Modify `client/src/screens/SafetyNumberScreen.tsx`:

```tsx
import "./SafetyNumberScreen.css";

interface SafetyNumberScreenProps {
  safetyNumber: string;
  onVerified: () => void;
}

export function SafetyNumberScreen({ safetyNumber, onVerified }: SafetyNumberScreenProps) {
  return (
    <div className="safety-number-screen">
      <h1>Verify safety number</h1>
      <p>Compare this number with your friend, out loud or on a separate channel:</p>
      <code>{safetyNumber}</code>
      <button onClick={onVerified}>Verified</button>
    </div>
  );
}
```

(Only the `import` line and the root `<div>`'s `className` are new — the rest of the markup is untouched.)

- [ ] **Step 3: Typecheck and run existing tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```powershell
git add client/src/screens/SafetyNumberScreen.tsx client/src/screens/SafetyNumberScreen.css
git commit -m "Style safety-number screen for the dark backdrop"
```

---

### Task 7: Wire `HandshakeJourney` into `App.tsx`

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `HandshakeJourney` from Task 3.

- [ ] **Step 1: Import `HandshakeJourney` and `ReactNode`**

In `client/src/App.tsx`, update the imports:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
```

(was `import { useEffect, useRef, useState } from "react";` — only `type ReactNode` is new)

and add, alongside the other screen imports:

```tsx
import { HandshakeJourney } from "./screens/HandshakeJourney";
```

- [ ] **Step 2: Wrap the dev screen-override previews**

Replace the two dev-override blocks near the top of the component's `return`:

```tsx
  if (devOverride?.screen === "loading") {
    return <LoadingScreen roomCode="K7F-2QX" />;
  }
  if (devOverride?.screen === "chat") {
    return (
      <ChatScreen
        roomCode="K7F-2QX"
        safetyNumber="21934 07741 66012"
        messages={[
          { id: "1", from: "peer", kind: "text", text: "did you check the safety number?" },
          { id: "2", from: "me", kind: "text", text: "yep — 21934 07741 66012 — matches on my end" },
          { id: "3", from: "me", kind: "text", text: "got it — nothing between us but ciphertext." },
        ]}
        onSend={() => {}}
        onSendVoice={() => {}}
        onLeave={() => {}}
      />
    );
  }
```

with:

```tsx
  if (devOverride?.screen === "loading") {
    return (
      <HandshakeJourney activeKey="handshake">
        <LoadingScreen roomCode="K7F-2QX" />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "chat") {
    return (
      <HandshakeJourney activeKey="chat">
        <ChatScreen
          roomCode="K7F-2QX"
          safetyNumber="21934 07741 66012"
          messages={[
            { id: "1", from: "peer", kind: "text", text: "did you check the safety number?" },
            { id: "2", from: "me", kind: "text", text: "yep — 21934 07741 66012 — matches on my end" },
            { id: "3", from: "me", kind: "text", text: "got it — nothing between us but ciphertext." },
          ]}
          onSend={() => {}}
          onSendVoice={() => {}}
          onLeave={() => {}}
        />
      </HandshakeJourney>
    );
  }
```

Without this, the `?screen=loading` / `?screen=chat` dev preview URLs would silently lose their orb backdrop after Tasks 4-5 (since `LoadingScreen`/`ChatScreen` no longer render `AmbientOrbs` themselves) — worth getting right since these are the exact URLs used to manually check this feature.

- [ ] **Step 3: Wrap the three real screen states in one `HandshakeJourney`**

Replace these three blocks:

```tsx
  if (screen.name === "handshake") {
    return <LoadingScreen roomCode={screen.roomCode} />;
  }
  if (screen.name === "safety-number") {
    return (
      <SafetyNumberScreen
        safetyNumber={screen.safetyNumber}
        onVerified={() =>
          setScreen({ name: "chat", roomCode: screen.roomCode, safetyNumber: screen.safetyNumber })
        }
      />
    );
  }
  if (screen.name === "chat") {
    return (
      <ChatScreen
        roomCode={screen.roomCode}
        safetyNumber={screen.safetyNumber}
        messages={messages}
        onSend={handleSend}
        onSendVoice={handleSendVoice}
        onLeave={handleLeave}
      />
    );
  }
```

with:

```tsx
  if (screen.name === "handshake" || screen.name === "safety-number" || screen.name === "chat") {
    let content: ReactNode;
    if (screen.name === "handshake") {
      content = <LoadingScreen roomCode={screen.roomCode} />;
    } else if (screen.name === "safety-number") {
      content = (
        <SafetyNumberScreen
          safetyNumber={screen.safetyNumber}
          onVerified={() =>
            setScreen({ name: "chat", roomCode: screen.roomCode, safetyNumber: screen.safetyNumber })
          }
        />
      );
    } else {
      content = (
        <ChatScreen
          roomCode={screen.roomCode}
          safetyNumber={screen.safetyNumber}
          messages={messages}
          onSend={handleSend}
          onSendVoice={handleSendVoice}
          onLeave={handleLeave}
        />
      );
    }
    return <HandshakeJourney activeKey={screen.name}>{content}</HandshakeJourney>;
  }
```

The `screen.name === "error"` fallback block after this stays exactly as-is — an error interruption still exits the journey entirely and shows the plain error view, unchanged.

- [ ] **Step 4: Typecheck and run existing tests**

Run (from `client/`): `npm run typecheck`
Expected: no errors.

Run: `npm run test`
Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```powershell
git add client/src/App.tsx
git commit -m "Wire the handshake journey into the app"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only), plus:
- Modify: `progress.md`

**Interfaces:** none — this task exercises the finished feature, it doesn't produce anything new code consumes.

- [ ] **Step 1: Start both dev servers**

Terminal 1:
```powershell
cd "C:\Users\superCookie\Desktop\Trojan Troy\server"
npm run dev
```

Terminal 2:
```powershell
cd "C:\Users\superCookie\Desktop\Trojan Troy\client"
npm run dev
```

Note the printed client URL (e.g. `http://localhost:5173`).

- [ ] **Step 2: Quick visual check via the dev overrides**

Open `http://localhost:5173/?screen=loading` — confirm the dark Iris backdrop and two drifting orbs render as before.
Open `http://localhost:5173/?screen=chat` — confirm the orbs still render behind the chat UI (this is the regression Task 7 Step 2 exists to prevent — if orbs are missing here, that step was skipped or mis-applied).

- [ ] **Step 3: Write a scratch Playwright script for the full transition**

Following the same pattern used for Phase 4/4.5 verification (no browser-automation tool available in this environment), install Playwright in the scratchpad:

```powershell
mkdir "$env:TEMP\claude-scratch-handshake-transition"
cd "$env:TEMP\claude-scratch-handshake-transition"
npm init -y
npm install playwright
```

Write `verify.js`:

```js
const { chromium } = require("playwright");

const CLIENT_URL = "http://localhost:5173";

async function runPairedFlow(browser, { storedTheme, screenshotPrefix }) {
  const initiatorCtx = await browser.newContext();
  const joinerCtx = await browser.newContext();
  if (storedTheme) {
    const setTheme = (theme) => localStorage.setItem("trojan-troy-theme", theme);
    await initiatorCtx.addInitScript(setTheme, storedTheme);
    await joinerCtx.addInitScript(setTheme, storedTheme);
  }
  const initiator = await initiatorCtx.newPage();
  const joiner = await joinerCtx.newPage();

  const errors = [];
  for (const [label, page] of [["initiator", initiator], ["joiner", joiner]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[${label}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[${label}] ${err.message}`));
  }

  await initiator.goto(CLIENT_URL);
  await initiator.click("text=Start a chat");
  await initiator.waitForSelector("code");
  const roomCode = await initiator.locator("code").innerText();

  await joiner.goto(CLIENT_URL);
  await joiner.fill("input[name=roomCode]", roomCode);
  await joiner.click("text=Join a chat");

  await initiator.waitForSelector('.handshake-journey[data-active-screen="handshake"]');
  await joiner.waitForSelector('.handshake-journey[data-active-screen="handshake"]');
  const orbDurationDuringHandshake = await initiator
    .locator(".ambient-orbs__orb--one")
    .evaluate((el) => getComputedStyle(el).animationDuration);

  await initiator.waitForSelector("text=Verify safety number");
  await joiner.waitForSelector("text=Verify safety number");
  await initiator.screenshot({ path: `${screenshotPrefix}-safety-number-fade.png` });

  await initiator.click("text=Verified");
  await joiner.click("text=Verified");

  // Screenshot partway through the safety-number -> chat cross-fade (350ms transition).
  await initiator.waitForTimeout(180);
  await initiator.screenshot({ path: `${screenshotPrefix}-chat-fade.png` });

  await initiator.waitForSelector(".chat-screen");
  await joiner.waitForSelector(".chat-screen");
  const orbCountAfterChat = await initiator.locator(".ambient-orbs__orb--one").count();
  const orbDisplayAfterChat = orbCountAfterChat
    ? await initiator.locator(".ambient-orbs__orb--one").evaluate((el) => getComputedStyle(el).display)
    : "not present";

  await initiator.close();
  await joiner.close();

  return {
    storedTheme: storedTheme ?? "iris (default)",
    orbDurationDuringHandshake,
    orbDisplayAfterChat,
    errors,
  };
}

(async () => {
  const browser = await chromium.launch();
  const irisResult = await runPairedFlow(browser, { screenshotPrefix: "iris" });
  const appleResult = await runPairedFlow(browser, { storedTheme: "apple", screenshotPrefix: "apple" });
  await browser.close();

  console.log(JSON.stringify({ irisResult, appleResult }, null, 2));

  if (irisResult.errors.length || appleResult.errors.length) {
    console.error("Console/page errors detected — see output above.");
    process.exit(1);
  }
  if (irisResult.orbDisplayAfterChat !== "block") {
    console.error("Expected orbs visible (display: block) in chat under the Iris default theme.");
    process.exit(1);
  }
  if (appleResult.orbDisplayAfterChat !== "none") {
    console.error("Expected orbs hidden (display: none) in chat under the Apple theme.");
    process.exit(1);
  }
  console.log("All checks passed.");
})();
```

This exercises the real end-to-end flow (real relay, real crypto, two browser contexts) and checks: zero console/page errors across both runs, orbs present and animating (`animation-duration: 9s`, matching `AmbientOrbs.css`) throughout the handshake screen, orbs still visible (`display: block`) once chat renders under the Iris default (the "never resets" goal), and orbs correctly hidden (`display: none`) once chat renders under Apple (the accepted discontinuity case from the spec). The two screenshots per run (`*-safety-number-fade.png`, `*-chat-fade.png`) are for a human to glance at and visually confirm a cross-fade is actually happening rather than a hard cut.

- [ ] **Step 4: Run the script and review output**

Run: `node verify.js` (from `$env:TEMP\claude-scratch-handshake-transition`, with both dev servers from Step 1 still running)
Expected: `All checks passed.` printed at the end, exit code 0. Open the four generated screenshots (`iris-safety-number-fade.png`, `iris-chat-fade.png`, `apple-safety-number-fade.png`, `apple-chat-fade.png`) and visually confirm each shows two screens' content overlapping mid-fade, not a single hard-edged screen. If anything fails, fix the relevant task's code (not this verification task) and re-run.

- [ ] **Step 5: Update `progress.md`**

Add a dated entry under the existing log (following the format of the `2026-07-20` Phase 4.5 entry already there) describing: the `HandshakeJourney`/`Crossfade` addition, the orb-continuity behavior across all three screens, the accepted Apple/Pulse discontinuity case, and how it was verified.

- [ ] **Step 6: Commit**

```powershell
git add progress.md
git commit -m "Verify the handshake-to-chat transition end to end"
```
