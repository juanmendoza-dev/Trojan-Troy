# Phase 4 — UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the externally-designed (Fable) high-fidelity UI — a kinetic-cipher loading screen and three chat-layout themes (Apple, Iris Glass, Pulse Slate) — inside the existing React/Vite client, wired to the app's real state machine and crypto events instead of the design mockup's looping demo animations.

**Architecture:** A theme system (`apple` | `iris` | `pulse`, Apple auto-following system light/dark) drives CSS custom properties set on `<html>`. A new `handshake` screen state sits between "waiting for peer" and "safety number", showing the loading screen while the real key exchange runs. Chat screen is decomposed into small themed components (TitleBar, Sidebar, MessageBubble, VoiceMessageBubble, Composer) that read the active theme's CSS variables — one set of components serves all three visual themes.

**Tech Stack:** Existing stack only — React 18 + Vite + TypeScript + Vitest. Plain CSS files (no CSS-in-JS, no Tailwind, no new dependencies). Google Fonts `<link>` for Schibsted Grotesk / JetBrains Mono (Iris/Pulse themes); Apple theme uses system font stacks only.

## Global Constraints

- Design source of truth: `ui/Trojan Troy Desktop Redesign/design_handoff_trojan_troy/Trojan Troy Directions.dc.html` (exact markup/CSS for every screen) and the sibling `README.md` (tokens, copy, motion spec). Cite exact line ranges from the `.dc.html` file in every task below — read them directly, don't retype from memory.
- Scope for this plan: **Loading screen (5a/5b)** and **Chat screen (4b/4d Apple, 2b Iris Glass, 2c Pulse Slate)** only. `StartJoinScreen`, `WaitingScreen`, and `SafetyNumberScreen` are explicitly out of scope — leave them as-is (confirmed with user 2026-07-19).
- All three chat themes must be implemented behind a runtime switcher (confirmed with user 2026-07-19) — this is not "pick one," build all three.
- Never touch `client/src/crypto/*`, `client/src/net/*`, or `client/src/audio/recorder.ts` — this is a pure UI/presentation task, the crypto and networking are done (Phases 1–3) and out of scope.
- No new npm dependencies. No CSS framework, no component library.
- Commits: short, plain-language, human-voiced, one per task (see `AGENTS.md`). Never `--no-verify`, never an AI co-author trailer.

### Design deviations from the handoff (decided while planning — flag to user if any should be reconsidered)

1. **No fixed 1180×740 "desktop window" frame, no macOS traffic-light dots.** The handoff renders every screen inside a mock window because it's a design-tool artifact; the real app is a resizable browser tab with its own real window chrome, not Electron/Tauri. The chat title bar and loading screen become the actual top-level layout (`100vw`/`100dvh`), not a centered box. This is the single biggest layout deviation — flag to the user after implementation in case a fixed/faux-window look was actually wanted.
2. **Typing indicator is not wired to real data.** The design shows a peer-is-typing bubble, but the relay protocol (Phases 2–3) has no "peer is typing" event — adding one is a protocol change, out of scope for a UI-only phase. The `TypingIndicator` component is not built in this plan; revisit if/when a typing-signal is added to the relay (Phase 5 territory).
3. **Loading screen always uses the Apple visual language (5a/5b), regardless of which chat theme is selected.** The README calls 5a/5b "the final loading screen" (singular), not theme-specific. When the selected chat theme is `iris` or `pulse`, the loading screen still renders — but forced to the **dark** variant (5b), never the white 5a, so it doesn't flash white before dropping into a near-black chat window.
4. **Percent counter and checklist are driven by a JS timer plus real crypto completion, not the CSS `@property`/`counter()` infinite loop in the mockup.** The mockup's checklist/counter timings are explicitly called "demo stand-ins" in the README. Real approach: the loading screen always plays its full choreography once (checklist rows on the exact fixed delays from the mockup — realistic since keypair generation and pubkey exchange over a relay complete in well under a second in every normal case), and the screen transitions to the safety-number screen only once **both** the real key exchange has finished **and** at least 2.6s have elapsed (so the animation always reads, and never gets cut off if a slow network makes the real exchange take longer).
5. **Kinetic-cipher wordmark column widths are measured at runtime, not hardcoded.** The mockup hardcodes per-letter pixel widths (e.g. `T=60, r=40, o=56…`) tuned to SF Pro Display, which only renders on macOS/iOS/Safari. On Windows/Linux/Chrome the fallback font (`system-ui`) has different glyph metrics, so hardcoded widths would clip or misalign letters. Instead, `CipherWord` measures each letter's actual rendered width via `canvas.measureText()` with the real computed font, so it's correct on any platform/font.

---

## File Structure

```
client/src/
  theme/
    theme.ts              -- pure resolver functions + types (tested)
    theme.test.ts
    ThemeContext.tsx       -- provider: holds selection, system-scheme listener, sets <html> data attrs, localStorage persistence
    ThemeSwitcher.tsx      -- small floating control to pick apple/iris/pulse
    ThemeSwitcher.css
  styles/
    keyframes.css          -- all shared @keyframes from the handoff
    tokens.css             -- CSS custom properties per [data-theme][data-scheme]
  dev/
    screenOverride.ts      -- parses ?screen=&theme= query params (dev-only escape hatch)
    screenOverride.test.ts
  screens/
    loading/
      percent.ts           -- percentAt(elapsedMs, totalMs) pure function (tested)
      percent.test.ts
      CipherWord.tsx        -- kinetic slot-reel wordmark
      CipherWord.css
      LoadingScreen.tsx     -- composes CipherWord + checklist + counter + marquee + progress bar
      LoadingScreen.css
    ChatScreen.tsx (rewrite)
    VoiceRecorder.tsx (modify — restyle render only, logic untouched)
  components/
    TitleBar.tsx / TitleBar.css
    Sidebar.tsx / Sidebar.css
    MessageBubble.tsx / MessageBubble.css
    VoiceMessageBubble.tsx / VoiceMessageBubble.css
    Composer.tsx / Composer.css
  App.tsx (modify)
  main.tsx (modify)
client/index.html (modify)
```

---

### Task 1: Global keyframes, design tokens, and font loading

**Files:**
- Create: `client/src/styles/keyframes.css`
- Create: `client/src/styles/tokens.css`
- Modify: `client/index.html`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Produces: CSS custom properties consumed by every later component: `--accent`, `--accent-hover`, `--bg`, `--bg-elevated`, `--bg-sidebar`, `--bg-card`, `--bg-card-alt`, `--border`, `--border-soft`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--bubble-incoming-bg`, `--bubble-outgoing-bg`, `--bubble-outgoing-text`, `--ticker-color`, `--font-ui`, `--font-display`, `--font-mono`, `--radius-bubble`, `--radius-card`, `--radius-pill`. Also produces global `@keyframes`: `msgIn`, `waveBar`, `typingDot`, `caretBlink`, `bluePulse`, `bluePulseDark`, `statusPulse`, `sheen`, `gradShift`, `floatOrb`, `glowPulse`, `fillLoop`, `slotDrop`, `lineRise`, `checkPop`, `marqueeX`, `rowIn`.

- [ ] **Step 1: Add Google Fonts link for the Iris/Pulse font pairing**

In `client/index.html`, inside `<head>`, add (Apple theme uses only system fonts, no link needed for it):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Write `keyframes.css`**

Read `ui/Trojan Troy Desktop Redesign/design_handoff_trojan_troy/Trojan Troy Directions.dc.html` lines 18–43 (the `<style>` block) and copy every `@keyframes` block **except**: `spin`, `spinRev`, `orbit`, `ripple`, `phaseCycle`, `wordIn`, `breathe`, `countUp`, `@property --p` (unused leftovers from other mockup turns / superseded by Task-7's JS-driven counter). Keep: `msgIn`, `waveBar`, `typingDot`, `caretBlink`, `bluePulse`, `bluePulseDark`, `statusPulse`, `sheen`, `gradShift`, `floatOrb`, `glowPulse`, `fillLoop`, `slotDrop`, `lineRise`, `checkPop`, `marqueeX`, `rowIn`.

- [ ] **Step 3: Write `tokens.css`**

Define one block per theme/scheme combination, selected via attributes on `<html>`. Use these exact values (source: README "Design Tokens" section + the `.dc.html` per-screen inline styles):

```css
:root[data-theme="apple"][data-scheme="light"] {
  --accent: #0066cc;
  --accent-hover: #0071e3;
  --bg: #ffffff;
  --bg-elevated: rgba(245,245,247,0.8);
  --bg-sidebar: #f5f5f7;
  --bg-card: #ffffff;
  --bg-card-alt: #fafafc;
  --border: #e0e0e0;
  --border-soft: #f0f0f0;
  --text-primary: #1d1d1f;
  --text-secondary: #7a7a7a;
  --text-tertiary: #7a7a7a;
  --bubble-incoming-bg: #f5f5f7;
  --bubble-outgoing-bg: #0066cc;
  --bubble-outgoing-text: #ffffff;
  --ticker-color: #d2d2d7;
  --progress-track: #f0f0f0;
  --font-ui: 'SF Pro Text', system-ui, -apple-system, sans-serif;
  --font-display: 'SF Pro Display', system-ui, -apple-system, sans-serif;
  --font-mono: 'SF Mono', ui-monospace, monospace;
  --radius-bubble: 18px;
  --radius-card: 11px;
  --radius-pill: 9999px;
}

:root[data-theme="apple"][data-scheme="dark"] {
  --accent: #0066cc;
  --accent-hover: #0071e3;
  --link-accent: #2997ff;
  --bg: #272729;
  --bg-elevated: #000000;
  --bg-sidebar: #252527;
  --bg-card: #2a2a2c;
  --bg-card-alt: #2a2a2c;
  --border: rgba(255,255,255,0.08);
  --border-soft: rgba(255,255,255,0.08);
  --text-primary: #ffffff;
  --text-secondary: #cccccc;
  --text-tertiary: #7a7a7a;
  --bubble-incoming-bg: #2a2a2c;
  --bubble-outgoing-bg: #0066cc;
  --bubble-outgoing-text: #ffffff;
  --ticker-color: #333333;
  --progress-track: #1d1d1f;
  --font-ui: 'SF Pro Text', system-ui, -apple-system, sans-serif;
  --font-display: 'SF Pro Display', system-ui, -apple-system, sans-serif;
  --font-mono: 'SF Mono', ui-monospace, monospace;
  --radius-bubble: 18px;
  --radius-card: 11px;
  --radius-pill: 9999px;
}

:root[data-theme="iris"] {
  --accent: #8FA6FF;
  --verified: #7ED9B7;
  --bg: linear-gradient(160deg, #0D0F18 0%, #101223 100%);
  --bg-sidebar: rgba(255,255,255,0.025);
  --bg-card: rgba(143,166,255,0.1);
  --border: rgba(255,255,255,0.09);
  --border-soft: rgba(255,255,255,0.07);
  --text-primary: #E8EAF2;
  --text-secondary: #9BA1B5;
  --text-tertiary: #5E6478;
  --bubble-incoming-bg: rgba(255,255,255,0.055);
  --bubble-outgoing-bg: rgba(143,166,255,0.14);
  --bubble-outgoing-text: #E8EAF2;
  --font-ui: 'Schibsted Grotesk', sans-serif;
  --font-display: 'Schibsted Grotesk', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --radius-bubble: 16px;
  --radius-card: 12px;
  --radius-pill: 999px;
}

:root[data-theme="pulse"] {
  --accent: #A78BFA;
  --accent-2: #F472B6;
  --verified: #7ED9B7;
  --bg: #0A0A10;
  --bg-sidebar: rgba(167,139,250,0.02);
  --bg-card: rgba(167,139,250,0.09);
  --border: rgba(167,139,250,0.16);
  --border-soft: rgba(167,139,250,0.1);
  --text-primary: #E9E7F2;
  --text-secondary: #9C99AD;
  --text-tertiary: #5E5B70;
  --bubble-incoming-bg: rgba(233,231,242,0.05);
  --bubble-outgoing-bg: linear-gradient(135deg, rgba(167,139,250,0.18), rgba(244,114,182,0.1));
  --bubble-outgoing-text: #E9E7F2;
  --font-ui: 'Schibsted Grotesk', sans-serif;
  --font-display: 'Schibsted Grotesk', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --radius-bubble: 14px;
  --radius-card: 10px;
  --radius-pill: 999px;
}
```

Note: `iris` and `pulse` ignore `data-scheme` (always dark) — Task 2's resolver never sets `data-scheme` when theme is `iris`/`pulse`, so only the `[data-theme="iris"]`/`[data-theme="pulse"]` selectors (no scheme qualifier) are needed.

- [ ] **Step 4: Import both stylesheets globally**

In `client/src/main.tsx`, add before the `createRoot` call:

```ts
import "./styles/keyframes.css";
import "./styles/tokens.css";
```

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/src/main.tsx client/src/styles
git commit -m "Add design tokens and shared animation keyframes"
```

---

### Task 2: Theme resolver + ThemeContext + ThemeSwitcher

**Files:**
- Create: `client/src/theme/theme.ts`
- Create: `client/src/theme/theme.test.ts`
- Create: `client/src/theme/ThemeContext.tsx`
- Create: `client/src/theme/ThemeSwitcher.tsx`
- Create: `client/src/theme/ThemeSwitcher.css`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: `type ThemeName = "apple" | "iris" | "pulse"`, `type Scheme = "light" | "dark"`, `resolveDomAttrs(theme: ThemeName, systemScheme: Scheme): { theme: ThemeName; scheme?: Scheme }`, `resolveLoadingScheme(theme: ThemeName, systemScheme: Scheme): Scheme`, `ThemeProvider`, `useTheme(): { theme: ThemeName; setTheme: (t: ThemeName) => void; loadingScheme: Scheme }`, `<ThemeSwitcher />`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/theme/theme.test.ts
import { describe, expect, it } from "vitest";
import { resolveDomAttrs, resolveLoadingScheme } from "./theme";

describe("resolveDomAttrs", () => {
  it("passes through system scheme for apple", () => {
    expect(resolveDomAttrs("apple", "dark")).toEqual({ theme: "apple", scheme: "dark" });
    expect(resolveDomAttrs("apple", "light")).toEqual({ theme: "apple", scheme: "light" });
  });

  it("omits scheme for iris and pulse (always dark, single palette)", () => {
    expect(resolveDomAttrs("iris", "light")).toEqual({ theme: "iris" });
    expect(resolveDomAttrs("pulse", "dark")).toEqual({ theme: "pulse" });
  });
});

describe("resolveLoadingScheme", () => {
  it("follows system scheme when the chat theme is apple", () => {
    expect(resolveLoadingScheme("apple", "light")).toBe("light");
    expect(resolveLoadingScheme("apple", "dark")).toBe("dark");
  });

  it("forces dark for iris and pulse regardless of system scheme", () => {
    expect(resolveLoadingScheme("iris", "light")).toBe("dark");
    expect(resolveLoadingScheme("pulse", "light")).toBe("dark");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- theme.test.ts`
Expected: FAIL — `theme.ts` does not exist yet.

- [ ] **Step 3: Write `theme.ts`**

```ts
export type ThemeName = "apple" | "iris" | "pulse";
export type Scheme = "light" | "dark";

export function resolveDomAttrs(
  theme: ThemeName,
  systemScheme: Scheme
): { theme: ThemeName; scheme?: Scheme } {
  if (theme === "apple") return { theme, scheme: systemScheme };
  return { theme };
}

export function resolveLoadingScheme(theme: ThemeName, systemScheme: Scheme): Scheme {
  return theme === "apple" ? systemScheme : "dark";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- theme.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write `ThemeContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveDomAttrs, resolveLoadingScheme, type ThemeName, type Scheme } from "./theme";

const STORAGE_KEY = "trojan-troy-theme";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  loadingScheme: Scheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "apple" || stored === "iris" || stored === "pulse" ? stored : "apple";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(readStoredTheme);
  const [systemScheme, setSystemScheme] = useState<Scheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setSystemScheme(event.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const attrs = resolveDomAttrs(theme, systemScheme);
    document.documentElement.dataset.theme = attrs.theme;
    if (attrs.scheme) {
      document.documentElement.dataset.scheme = attrs.scheme;
    } else {
      delete document.documentElement.dataset.scheme;
    }
  }, [theme, systemScheme]);

  function setTheme(next: ThemeName) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  const value = useMemo(
    () => ({ theme, setTheme, loadingScheme: resolveLoadingScheme(theme, systemScheme) }),
    [theme, systemScheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 6: Write `ThemeSwitcher.tsx` and `ThemeSwitcher.css`**

A small fixed-position control (bottom-right corner) with three buttons cycling `theme`. Visual only, no design-doc precedent — keep it unobtrusive (11px labels, low-contrast until hovered) so it doesn't fight the recreated designs:

```tsx
import { useTheme } from "./ThemeContext";
import "./ThemeSwitcher.css";

const OPTIONS: { value: "apple" | "iris" | "pulse"; label: string }[] = [
  { value: "apple", label: "Apple" },
  { value: "iris", label: "Iris Glass" },
  { value: "pulse", label: "Pulse Slate" },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-switcher">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          className={option.value === theme ? "theme-switcher__option theme-switcher__option--active" : "theme-switcher__option"}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

```css
.theme-switcher {
  position: fixed;
  bottom: 12px;
  right: 12px;
  display: flex;
  gap: 4px;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px;
  border-radius: 8px;
  backdrop-filter: blur(8px);
}
.theme-switcher__option {
  font-size: 11px;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
}
.theme-switcher__option--active {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
```

- [ ] **Step 7: Commit**

```bash
git add client/src/theme
git commit -m "Add theme system with runtime switcher"
```

---

### Task 3: Dev-only screen override for fast visual iteration

**Files:**
- Create: `client/src/dev/screenOverride.ts`
- Create: `client/src/dev/screenOverride.test.ts`

**Interfaces:**
- Produces: `parseScreenOverride(search: string): { screen: "loading" | "chat"; theme?: ThemeName } | null` — pure function so `App.tsx` (Task 12) can mount `LoadingScreen`/`ChatScreen` directly from a URL like `?screen=chat&theme=iris`, without running the full pairing/handshake flow. Only consumed when `import.meta.env.DEV` is true.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/dev/screenOverride.test.ts
import { describe, expect, it } from "vitest";
import { parseScreenOverride } from "./screenOverride";

describe("parseScreenOverride", () => {
  it("returns null when there is no screen param", () => {
    expect(parseScreenOverride("")).toBeNull();
    expect(parseScreenOverride("?theme=iris")).toBeNull();
  });

  it("parses a valid screen and theme", () => {
    expect(parseScreenOverride("?screen=chat&theme=iris")).toEqual({ screen: "chat", theme: "iris" });
    expect(parseScreenOverride("?screen=loading&theme=pulse")).toEqual({ screen: "loading", theme: "pulse" });
  });

  it("omits theme when not given or invalid", () => {
    expect(parseScreenOverride("?screen=chat")).toEqual({ screen: "chat" });
    expect(parseScreenOverride("?screen=chat&theme=nope")).toEqual({ screen: "chat" });
  });

  it("returns null for an invalid screen value", () => {
    expect(parseScreenOverride("?screen=nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- screenOverride.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `screenOverride.ts`**

```ts
import type { ThemeName } from "../theme/theme";

export interface ScreenOverride {
  screen: "loading" | "chat";
  theme?: ThemeName;
}

const VALID_SCREENS = new Set(["loading", "chat"]);
const VALID_THEMES = new Set<ThemeName>(["apple", "iris", "pulse"]);

export function parseScreenOverride(search: string): ScreenOverride | null {
  const params = new URLSearchParams(search);
  const screen = params.get("screen");
  if (!screen || !VALID_SCREENS.has(screen)) return null;
  const theme = params.get("theme");
  const result: ScreenOverride = { screen: screen as ScreenOverride["screen"] };
  if (theme && VALID_THEMES.has(theme as ThemeName)) {
    result.theme = theme as ThemeName;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- screenOverride.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/dev
git commit -m "Add dev-only screen override for iterating on the redesign"
```

---

### Task 4: Percent-counter timing logic

**Files:**
- Create: `client/src/screens/loading/percent.ts`
- Create: `client/src/screens/loading/percent.test.ts`

**Interfaces:**
- Produces: `percentAt(elapsedMs: number, totalMs: number): number` — piecewise-linear interpolation matching the mockup's `countUp` keyframe stops (0% at 0%, 62% at 45%, 88% at 70%, 100% at 92%+ of duration), clamped to `[0, 100]`. Consumed by `LoadingScreen` (Task 6) driven off a `setInterval`/`requestAnimationFrame` tied to real elapsed time, replacing the CSS `@property`/`counter()` infinite-loop trick (dropped in Task 1).

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/screens/loading/percent.test.ts
import { describe, expect, it } from "vitest";
import { percentAt } from "./percent";

describe("percentAt", () => {
  it("is 0 at the start", () => {
    expect(percentAt(0, 2600)).toBe(0);
  });

  it("hits the mockup's keyframe stops", () => {
    expect(percentAt(2600 * 0.45, 2600)).toBeCloseTo(62, 0);
    expect(percentAt(2600 * 0.7, 2600)).toBeCloseTo(88, 0);
    expect(percentAt(2600 * 0.92, 2600)).toBeCloseTo(100, 0);
  });

  it("clamps to 100 past the end and never exceeds it", () => {
    expect(percentAt(2600, 2600)).toBe(100);
    expect(percentAt(5000, 2600)).toBe(100);
  });

  it("clamps to 0 for negative elapsed time", () => {
    expect(percentAt(-10, 2600)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npm test -- percent.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `percent.ts`**

```ts
const STOPS: [fraction: number, percent: number][] = [
  [0, 0],
  [0.45, 62],
  [0.7, 88],
  [0.92, 100],
];

export function percentAt(elapsedMs: number, totalMs: number): number {
  const fraction = Math.max(0, Math.min(1, elapsedMs / totalMs));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [f0, p0] = STOPS[i];
    const [f1, p1] = STOPS[i + 1];
    if (fraction >= f0 && fraction <= f1) {
      const t = (fraction - f0) / (f1 - f0);
      return Math.round(p0 + t * (p1 - p0));
    }
  }
  return 100;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npm test -- percent.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/loading/percent.ts client/src/screens/loading/percent.test.ts
git commit -m "Add percent-counter timing for the loading screen"
```

---

### Task 5: CipherWord — kinetic slot-reel wordmark

**Files:**
- Create: `client/src/screens/loading/CipherWord.tsx`
- Create: `client/src/screens/loading/CipherWord.css`

**Interfaces:**
- Consumes: nothing new (reads `--font-display` from Task 1's tokens, `slotDrop` keyframe from Task 1).
- Produces: `<CipherWord text="Trojan" fontSizePx={96} startDelayS={0.2} staggerS={0.08} />` — renders one clipped column per letter, each a 4-glyph vertical stack (3 random chars + the real letter last) that animates upward once on mount via `slotDrop`. Column width is measured at runtime (Design Deviation 5), not hardcoded. Consumed by `LoadingScreen` (Task 6) for the "Trojan" / "Troy" lines.

**No automated test** — `canvas.measureText` needs a real browser (Vitest here runs in `environment: "node"`, see `client/vitest.config.ts:11`, no DOM/canvas available). Verify visually in the browser per Task 13.

- [ ] **Step 1: Write `CipherWord.tsx`**

Reference markup/timing: `ui/Trojan Troy Desktop Redesign/design_handoff_trojan_troy/Trojan Troy Directions.dc.html` lines 70–86 (structure, `overflow:hidden` column + `slotDrop` per-letter stagger, window height 132px for a 96px font per Design Fidelity note in the README).

```tsx
import { useMemo } from "react";
import "./CipherWord.css";

const CIPHER_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomChar(): string {
  return CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
}

function measureWidth(letter: string, font: string): number {
  const canvas = measureWidth.canvas ?? (measureWidth.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  return Math.ceil(ctx.measureText(letter).width);
}
measureWidth.canvas = undefined as HTMLCanvasElement | undefined;

interface CipherWordProps {
  text: string;
  fontSizePx: number;
  startDelayS: number;
  staggerS: number;
  windowHeightPx?: number;
}

export function CipherWord({ text, fontSizePx, startDelayS, staggerS, windowHeightPx = 132 }: CipherWordProps) {
  const font = `600 ${fontSizePx}px var(--font-display)`;
  const letters = useMemo(
    () =>
      text.split("").map((letter) => ({
        letter,
        width: measureWidth(letter, font),
        glyphs: [randomChar(), randomChar(), randomChar(), letter],
      })),
    [text, font]
  );

  return (
    <div className="cipher-word" style={{ height: windowHeightPx }}>
      {letters.map((column, index) => (
        <span
          key={index}
          className="cipher-word__column"
          style={{ width: column.width, height: windowHeightPx }}
        >
          <span
            className="cipher-word__reel"
            style={{
              animationDelay: `${startDelayS + index * staggerS}s`,
              height: windowHeightPx * column.glyphs.length,
            }}
          >
            {column.glyphs.map((glyph, glyphIndex) => (
              <span key={glyphIndex} className="cipher-word__glyph" style={{ height: windowHeightPx }}>
                {glyph}
              </span>
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `CipherWord.css`**

```css
.cipher-word {
  display: flex;
}
.cipher-word__column {
  display: inline-block;
  overflow: hidden;
  text-align: center;
}
.cipher-word__reel {
  display: block;
  animation: slotDrop 0.9s cubic-bezier(0.85, 0, 0.15, 1) both;
  transform: translateY(-75%);
}
.cipher-word__glyph {
  display: block;
}
```

Note: `slotDrop` (from Task 1's `keyframes.css`) is `translateY(0) -> translateY(-396px)` in the mockup, which is `-3 * 132px` (moving past 3 glyphs to land on the 4th/real letter at a 132px window height). Since `windowHeightPx` and glyph count are now dynamic, override the animation's end transform per-instance isn't possible with a shared `@keyframes` — instead set `.cipher-word__reel` to end at `translateY(-75%)` (3 of 4 glyphs, i.e. `-(glyphs.length - 1) / glyphs.length * 100%`) via an inline `--reel-end` custom property consumed by a local `@keyframes slotDropReel` in this file (do not reuse the global `slotDrop`, which hardcodes `-396px`):

```css
@keyframes slotDropReel {
  from { transform: translateY(0); }
  to { transform: translateY(-75%); }
}
.cipher-word__reel {
  display: block;
  animation: slotDropReel 0.9s cubic-bezier(0.85, 0, 0.15, 1) both;
}
```

(Replace the `slotDrop` reference above with `slotDropReel` — since there are always exactly 4 glyphs per column here, `-75%` is correct for every letter; no per-instance custom property is actually needed. Remove the unused `--reel-end` mention.)

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/loading/CipherWord.tsx client/src/screens/loading/CipherWord.css
git commit -m "Add kinetic cipher wordmark component"
```

---

### Task 6: LoadingScreen

**Files:**
- Create: `client/src/screens/loading/LoadingScreen.tsx`
- Create: `client/src/screens/loading/LoadingScreen.css`

**Interfaces:**
- Consumes: `CipherWord` (Task 5), `percentAt` (Task 4), tokens/keyframes (Task 1: `--bg`, `--text-primary`, `--text-secondary`, `--font-ui`, `--font-display`, `--font-mono`, `bluePulse`/`bluePulseDark`, `rowIn`, `checkPop`, `marqueeX`, `fillLoop`).
- Produces: `<LoadingScreen roomCode={string} scheme={"light"|"dark"} durationMs={number} />` — renders the full 5a/5b choreography once (checklist rows on the mockup's fixed delays — Design Deviation 4), with the percent counter and progress bar driven by a `requestAnimationFrame` loop calling `percentAt(elapsed, durationMs)` instead of the mockup's infinite CSS loop. Consumed by `App.tsx` (Task 12) for the `handshake` screen state, and by the dev screen override (Task 3/12) for direct preview.

- [ ] **Step 1: Write `LoadingScreen.tsx`**

Reference markup: `ui/Trojan Troy Desktop Redesign/design_handoff_trojan_troy/Trojan Troy Directions.dc.html` lines 58–119 (5a, light) and 127–188 (5b, dark) — identical structure, only color substitutions per Design Tokens.

```tsx
import { useEffect, useState } from "react";
import { CipherWord } from "./CipherWord";
import { percentAt } from "./percent";
import "./LoadingScreen.css";

interface LoadingScreenProps {
  roomCode: string;
  scheme: "light" | "dark";
  durationMs?: number;
}

const TICKER_TEXT =
  "END-TO-END ENCRYPTED · ZERO KNOWLEDGE RELAY · KEYS STAY ON DEVICE · NO ACCOUNTS · NO METADATA · ";

export function LoadingScreen({ roomCode, scheme, durationMs = 2600 }: LoadingScreenProps) {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let frame: number;
    function tick(now: number) {
      setPercent(percentAt(now - start, durationMs));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs]);

  return (
    <div className="loading-screen" data-scheme={scheme}>
      <div className="loading-screen__top-row">
        <div className="loading-screen__status">
          <span className="loading-screen__status-dot" />
          ESTABLISHING SECURE CHANNEL
        </div>
        <div className="loading-screen__room-code">Room {roomCode}</div>
      </div>

      <div className="loading-screen__center">
        <div className="loading-screen__wordmark">
          <div className="loading-screen__wordmark-line">
            <CipherWord text="Trojan" fontSizePx={96} startDelayS={0.2} staggerS={0.08} />
          </div>
          <div className="loading-screen__wordmark-line loading-screen__wordmark-line--second">
            <CipherWord text="Troy" fontSizePx={96} startDelayS={0.68} staggerS={0.08} />
            <span className="loading-screen__period">.</span>
          </div>
        </div>

        <div className="loading-screen__checklist">
          <div className="loading-screen__row" style={{ animationDelay: "1.3s" }}>
            <span className="loading-screen__check" style={{ animationDelay: "1.6s" }}>
              ✓
            </span>
            <span>Keypair generated on this device</span>
          </div>
          <div className="loading-screen__row" style={{ animationDelay: "1.7s" }}>
            <span className="loading-screen__check" style={{ animationDelay: "2.2s" }}>
              ✓
            </span>
            <span>Keys exchanged through the relay</span>
          </div>
          <div className="loading-screen__row" style={{ animationDelay: "2.1s" }}>
            <span className="loading-screen__pending" />
            <span className="loading-screen__row-label--pending">Sealing the channel…</span>
          </div>
        </div>
      </div>

      <div className="loading-screen__bottom-row">
        <div className="loading-screen__reassurance">
          The relay only ever sees ciphertext. Your keys never leave this device.
        </div>
        <div className="loading-screen__percent">
          {percent}
          <span className="loading-screen__percent-suffix">%</span>
        </div>
      </div>

      <div className="loading-screen__marquee">
        <div className="loading-screen__marquee-track">
          <span>{TICKER_TEXT.repeat(2)}</span>
          <span>{TICKER_TEXT.repeat(2)}</span>
        </div>
      </div>

      <div className="loading-screen__progress-track">
        <div className="loading-screen__progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `LoadingScreen.css`**

Translate the inline styles at the referenced line ranges into classes, using tokens from Task 1 in place of hardcoded hex values (`--bg`, `--text-primary`, `--text-secondary`, `--font-ui`, `--font-display`, `--font-mono`), and the theme-appropriate accent (`#0066cc` light / `#2997ff` dark — since the loading screen is Apple-only per Design Deviation 3, hardcode these two accent values directly rather than pulling from `--accent`, keyed off `[data-scheme]` selectors on `.loading-screen`). Key structural rules:

```css
.loading-screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 72px 80px 96px;
  font-family: var(--font-ui);
  background: #ffffff;
  color: #1d1d1f;
}
.loading-screen[data-scheme="dark"] {
  background: #000000;
  color: #ffffff;
}

.loading-screen__status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #7a7a7a;
}
.loading-screen__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #0066cc;
  animation: bluePulse 2.4s ease-out infinite;
}
.loading-screen[data-scheme="dark"] .loading-screen__status-dot {
  background: #2997ff;
  animation-name: bluePulseDark;
}

.loading-screen__wordmark {
  font-family: var(--font-display);
  font-size: 96px;
  font-weight: 600;
  letter-spacing: -2px;
  line-height: 132px;
}
.loading-screen__wordmark-line--second {
  margin-top: -16px;
  display: flex;
  align-items: flex-end;
}
.loading-screen__period {
  color: #0066cc;
  margin-left: 28px;
  animation: lineRise 0.7s cubic-bezier(0.2, 0.9, 0.3, 1) 1.15s both;
}
.loading-screen[data-scheme="dark"] .loading-screen__period {
  color: #2997ff;
}

.loading-screen__checklist {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 40px;
}
.loading-screen__row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  letter-spacing: -0.224px;
  animation: rowIn 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.loading-screen__check {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #0066cc;
  color: #ffffff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: checkPop 0.4s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.loading-screen[data-scheme="dark"] .loading-screen__check {
  background: #2997ff;
  color: #000000;
}
.loading-screen__pending {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid #0066cc;
  box-sizing: border-box;
  animation: bluePulse 2.4s ease-out infinite;
}
.loading-screen[data-scheme="dark"] .loading-screen__pending {
  border-color: #2997ff;
  animation-name: bluePulseDark;
}
.loading-screen__row-label--pending {
  color: #7a7a7a;
}

.loading-screen__percent {
  font-family: var(--font-display);
  font-weight: 300;
  font-size: 120px;
  letter-spacing: -2px;
  line-height: 1;
}
.loading-screen__percent-suffix {
  font-size: 40px;
  color: #7a7a7a;
  margin-left: 4px;
}

.loading-screen__marquee {
  position: absolute;
  bottom: 14px;
  left: 0;
  right: 0;
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
}
.loading-screen__marquee-track {
  display: inline-flex;
  width: max-content;
  animation: marqueeX 22s linear infinite;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: #d2d2d7;
}
.loading-screen[data-scheme="dark"] .loading-screen__marquee-track {
  color: #333333;
}
.loading-screen__marquee-track span {
  padding-right: 48px;
}

.loading-screen__progress-track {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #f0f0f0;
}
.loading-screen[data-scheme="dark"] .loading-screen__progress-track {
  background: #1d1d1f;
}
.loading-screen__progress-fill {
  height: 100%;
  background: #0066cc;
  transition: width 0.1s linear;
}
.loading-screen[data-scheme="dark"] .loading-screen__progress-fill {
  background: #2997ff;
}
```

(Also add the small layout rules for `.loading-screen__top-row`, `.loading-screen__bottom-row`, `.loading-screen__center` — `display: flex; justify-content: space-between` per the referenced markup — and `.loading-screen__room-code` at `12px`/`#7a7a7a`.)

- [ ] **Step 3: Manual verification**

Run: `cd client && npm run dev`, visit `http://localhost:5173/?screen=loading&theme=apple` (wired in Task 12). Confirm: wordmark letters resolve top-to-bottom with no clipping, checklist rows appear in sequence, percent counter climbs from 0 to 100 over ~2.6s and stops, progress bar fill matches, marquee scrolls seamlessly. Then check `&theme=iris` and `&theme=pulse` both render the **dark** variant (Design Deviation 3).

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/loading/LoadingScreen.tsx client/src/screens/loading/LoadingScreen.css
git commit -m "Add loading screen with kinetic wordmark and key-exchange checklist"
```

---

### Task 7: TitleBar component

**Files:**
- Create: `client/src/components/TitleBar.tsx`
- Create: `client/src/components/TitleBar.css`

**Interfaces:**
- Consumes: `useTheme()` (Task 2) for the current theme name; tokens from Task 1.
- Produces: `<TitleBar roomCode={string} />` — top chrome bar with app name/wordmark (theme-specific: "Trojan Troy" for Apple, "TROJAN·TROY" mono for Iris/Pulse), centered room code, and a "Verified · End-to-end encrypted" pill. No traffic lights (Design Deviation 1). Consumed by `ChatScreen` (Task 11).

- [ ] **Step 1: Write `TitleBar.tsx`**

Reference markup: lines 208–220 (4b), 294–306 (4d), 389–401 (2b), 475–487 (2c).

```tsx
import { useTheme } from "../theme/ThemeContext";
import "./TitleBar.css";

interface TitleBarProps {
  roomCode: string;
}

export function TitleBar({ roomCode }: TitleBarProps) {
  const { theme } = useTheme();
  const isApple = theme === "apple";

  return (
    <div className="title-bar">
      <div className="title-bar__wordmark">{isApple ? "Trojan Troy" : "TROJAN·TROY"}</div>
      <div className="title-bar__room">
        Room <span className="title-bar__room-code">{roomCode}</span>
      </div>
      <div className="title-bar__verified">
        <span className="title-bar__verified-dot" />
        {isApple ? "Verified · End-to-end encrypted" : "Verified · E2E encrypted"}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `TitleBar.css`**

```css
.title-bar {
  height: 46px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 14px;
  background: var(--bg-elevated, var(--bg-sidebar));
  border-bottom: 1px solid var(--border-soft);
  backdrop-filter: blur(20px) saturate(180%);
}
.title-bar__wordmark {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.224px;
  color: var(--text-primary);
}
:root[data-theme="iris"] .title-bar__wordmark,
:root[data-theme="pulse"] .title-bar__wordmark {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--accent);
}
.title-bar__room {
  flex: 1;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}
.title-bar__room-code {
  font-family: var(--font-mono);
  color: var(--text-primary);
}
.title-bar__verified {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 5px 14px;
  border-radius: var(--radius-pill);
}
:root[data-theme="iris"] .title-bar__verified,
:root[data-theme="pulse"] .title-bar__verified {
  color: var(--verified);
  background: rgba(126, 217, 183, 0.08);
  border-color: rgba(126, 217, 183, 0.2);
}
.title-bar__verified-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: bluePulse 2.4s ease-out infinite;
}
:root[data-scheme="dark"] .title-bar__verified-dot {
  animation-name: bluePulseDark;
}
:root[data-theme="iris"] .title-bar__verified-dot,
:root[data-theme="pulse"] .title-bar__verified-dot {
  background: var(--verified);
  animation-name: statusPulse;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TitleBar.tsx client/src/components/TitleBar.css
git commit -m "Add themed title bar component"
```

---

### Task 8: Sidebar component

**Files:**
- Create: `client/src/components/Sidebar.tsx`
- Create: `client/src/components/Sidebar.css`

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `<Sidebar roomCode={string} onNewChat={() => void} />` — "New chat" button, active-room card (static "Voice message · 0:23" subline per the design — there is no real per-room last-message summary in the current single-room protocol, so this stays as static descriptive chrome, not fabricated live data), Contacts placeholder card, footer reassurance line. Consumed by `ChatScreen` (Task 11).

- [ ] **Step 1: Write `Sidebar.tsx`**

Reference markup: lines 222–235 (4b), 308–321 (4d), 403–416 (2b), 489–503 (2c).

```tsx
import { useTheme } from "../theme/ThemeContext";
import "./Sidebar.css";

interface SidebarProps {
  roomCode: string;
  onNewChat: () => void;
}

export function Sidebar({ roomCode, onNewChat }: SidebarProps) {
  const { theme } = useTheme();
  const sectionLabel = theme === "apple" ? (label: string) => label : (label: string) => label.toUpperCase();

  return (
    <div className="sidebar">
      <button className="sidebar__new-chat" onClick={onNewChat}>
        {theme === "apple" ? "New chat" : "+ New chat"}
        {theme !== "apple" && <span className="sidebar__sheen" />}
      </button>
      <div className="sidebar__label">{sectionLabel("Active")}</div>
      <div className="sidebar__active-card">
        <div className="sidebar__active-card-top">
          <span className="sidebar__room-code">{roomCode}</span>
          <span className="sidebar__verified-label">{theme === "apple" ? "Verified" : "● verified"}</span>
        </div>
        <span className="sidebar__subline">Voice message · 0:23</span>
      </div>
      <div className="sidebar__label">{sectionLabel("Contacts")}</div>
      <div className="sidebar__contacts-placeholder">
        Persistent contacts arrive with long-term identity keys. Coming soon.
      </div>
      <div className="sidebar__footer">Your keys never leave this device.</div>
    </div>
  );
}
```

- [ ] **Step 2: Write `Sidebar.css`**

```css
.sidebar {
  width: 256px;
  flex: none;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  gap: 8px;
}
.sidebar__new-chat {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--accent);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-pill);
  padding: 11px;
  font-family: var(--font-ui);
  font-size: 14px;
  cursor: pointer;
  transition: transform 0.12s ease;
}
.sidebar__new-chat:active {
  transform: scale(0.95);
}
:root[data-theme="iris"] .sidebar__new-chat,
:root[data-theme="pulse"] .sidebar__new-chat {
  color: #0b0c14;
  font-weight: 700;
  border-radius: 12px;
}
:root[data-theme="pulse"] .sidebar__new-chat {
  background: linear-gradient(135deg, #a78bfa, #d46cd0, #f472b6);
  background-size: 200% 200%;
  animation: gradShift 5s ease-in-out infinite;
}
.sidebar__sheen {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
  animation: sheen 3.8s ease-in-out infinite;
}
.sidebar__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 14px 6px 2px;
}
:root[data-theme="iris"] .sidebar__label,
:root[data-theme="pulse"] .sidebar__label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--text-tertiary);
}
.sidebar__active-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 10px 12px;
  cursor: pointer;
}
.sidebar__active-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sidebar__room-code {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.sidebar__verified-label {
  font-size: 11px;
  color: var(--accent);
}
:root[data-theme="iris"] .sidebar__verified-label,
:root[data-theme="pulse"] .sidebar__verified-label {
  color: var(--verified);
  font-size: 10px;
}
.sidebar__subline {
  font-size: 12px;
  color: var(--text-secondary);
}
.sidebar__contacts-placeholder {
  background: var(--bg-card-alt);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-card);
  padding: 14px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
:root[data-theme="iris"] .sidebar__contacts-placeholder,
:root[data-theme="pulse"] .sidebar__contacts-placeholder {
  border-style: dashed;
  color: var(--text-tertiary);
}
.sidebar__footer {
  margin-top: auto;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  padding: 10px 6px 0;
  border-top: 1px solid var(--border-soft);
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Sidebar.tsx client/src/components/Sidebar.css
git commit -m "Add themed sidebar component"
```

---

### Task 9: MessageBubble and VoiceMessageBubble

**Files:**
- Create: `client/src/components/MessageBubble.tsx`
- Create: `client/src/components/MessageBubble.css`
- Create: `client/src/components/VoiceMessageBubble.tsx`
- Create: `client/src/components/VoiceMessageBubble.css`

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `<MessageBubble from={"me"|"peer"} text={string} />`; `<VoiceMessageBubble from={"me"|"peer"} audioUrl={string} durationLabel={string} />` — a real play/pause button wired to an `<audio>` element (waveform bars animate only while `playing`, replacing the current bare native `<audio controls>`). Both consumed by `ChatScreen` (Task 11).

- [ ] **Step 1: Write `MessageBubble.tsx`**

Reference markup: lines 240, 243, 264 (4b) — incoming/outgoing bubble shapes are identical across themes, only radius/color tokens differ (already captured in Task 1).

```tsx
interface MessageBubbleProps {
  from: "me" | "peer";
  text: string;
}

export function MessageBubble({ from, text }: MessageBubbleProps) {
  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div className={from === "me" ? "message-bubble message-bubble--outgoing" : "message-bubble message-bubble--incoming"}>
        {text}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `MessageBubble.css`**

```css
.message-row {
  display: flex;
  animation: msgIn 0.5s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.message-row--incoming {
  justify-content: flex-start;
}
.message-row--outgoing {
  justify-content: flex-end;
}
.message-bubble {
  max-width: 420px;
  padding: 11px 16px;
  font-size: 15px;
  line-height: 1.47;
  letter-spacing: -0.224px;
  border-radius: var(--radius-bubble);
  transition: transform 0.2s ease;
}
.message-bubble--incoming {
  background: var(--bubble-incoming-bg);
  color: var(--text-primary);
  border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 5px;
}
.message-bubble--outgoing {
  background: var(--bubble-outgoing-bg);
  color: var(--bubble-outgoing-text);
  border-radius: var(--radius-bubble) var(--radius-bubble) 5px var(--radius-bubble);
}
:root[data-theme="iris"] .message-bubble,
:root[data-theme="pulse"] .message-bubble {
  border: 1px solid var(--border);
  font-size: 14px;
  line-height: 1.5;
}
:root[data-theme="iris"] .message-bubble:hover,
:root[data-theme="pulse"] .message-bubble:hover {
  transform: translateY(-2px);
}
```

- [ ] **Step 3: Write `VoiceMessageBubble.tsx`**

Reference markup: lines 246–261 (4b waveform bar heights/delays — reuse the same 10 fixed heights `[10,20,14,24,12,22,9,18,13,21]` and `0.15s` stagger for every theme, per lines 249–258/335–344/430–439/518–527, only the bar `background` color differs, and Pulse Slate color-ramps each bar per line 518–527).

```tsx
import { useRef, useState } from "react";
import "./VoiceMessageBubble.css";

interface VoiceMessageBubbleProps {
  from: "me" | "peer";
  audioUrl: string;
  durationLabel: string;
}

const BAR_HEIGHTS = [10, 20, 14, 24, 12, 22, 9, 18, 13, 21];

export function VoiceMessageBubble({ from, audioUrl, durationLabel }: VoiceMessageBubbleProps) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }

  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div className="voice-bubble">
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <button className="voice-bubble__play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="voice-bubble__waveform" data-playing={playing}>
          {BAR_HEIGHTS.map((height, index) => (
            <span
              key={index}
              className="voice-bubble__bar"
              style={{ height, animationDelay: `${index * 0.15}s` }}
            />
          ))}
        </div>
        <span className="voice-bubble__duration">{durationLabel}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `VoiceMessageBubble.css`**

```css
.voice-bubble {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bubble-incoming-bg);
  border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 5px;
  padding: 12px 16px;
}
.voice-bubble__play {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: #ffffff;
  font-size: 12px;
  cursor: pointer;
  flex: none;
  transition: transform 0.12s ease;
}
.voice-bubble__play:active {
  transform: scale(0.95);
}
.voice-bubble__waveform {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 26px;
}
.voice-bubble__bar {
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
  transform: scaleY(0.35);
}
.voice-bubble__waveform[data-playing="true"] .voice-bubble__bar {
  animation: waveBar 1.4s ease-in-out infinite alternate;
}
.voice-bubble__duration {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}
```

(Note: `transform: scaleY(0.35)` as the resting state, with `waveBar` animating between `0.35` and `1` only while `data-playing="true"` — matches "waveform bars animate while playing" from the README's Interactions section, an intentional improvement over the mockup's always-animating demo bars, which loop regardless of playback state.)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MessageBubble.tsx client/src/components/MessageBubble.css client/src/components/VoiceMessageBubble.tsx client/src/components/VoiceMessageBubble.css
git commit -m "Add themed message and voice bubble components"
```

---

### Task 10: Composer (restyle VoiceRecorder + text input)

**Files:**
- Create: `client/src/components/Composer.tsx`
- Create: `client/src/components/Composer.css`
- Modify: `client/src/screens/VoiceRecorder.tsx` (rendering only — logic untouched)

**Interfaces:**
- Consumes: existing `VoiceRecorder` logic (`client/src/screens/VoiceRecorder.tsx:20-111` — `startRecording`/`RecordingHandle` from `client/src/audio/recorder.ts`, untouched).
- Produces: `<Composer onSend={(text: string) => void} onSendVoice={(blob: Blob, mimeType: string) => void} />` — replaces the current bare `<form><input/><button/></form>` in `ChatScreen`.

- [ ] **Step 1: Restyle `VoiceRecorder.tsx`'s render (keep all state/logic identical)**

Only change the four `return` blocks at `client/src/screens/VoiceRecorder.tsx:83-110` to use the classes below instead of bare elements — do not touch `handleStart`, `handleStop`, `handleDiscard`, `handleSend`, or any state/effect logic above line 83:

```tsx
  if (state.status === "idle") {
    return (
      <button className="composer__mic" onClick={handleStart} aria-label="Record voice message">
        🎙
      </button>
    );
  }
  if (state.status === "recording") {
    return (
      <div className="composer__recording">
        <span className="composer__recording-time">
          {Math.floor(elapsedMs / 1000)}s / {MAX_RECORDING_MS / 1000}s
        </span>
        <button className="composer__stop" onClick={handleStop}>
          Stop
        </button>
      </div>
    );
  }
  if (state.status === "preview") {
    return (
      <div className="composer__preview">
        <audio src={state.audioUrl} controls />
        <button className="composer__send" onClick={handleSend}>
          Send
        </button>
        <button className="composer__discard" onClick={handleDiscard}>
          Discard
        </button>
      </div>
    );
  }
  return (
    <div className="composer__error">
      <span>{state.message}</span>
      <button onClick={() => setState({ status: "idle" })}>Dismiss</button>
    </div>
  );
```

- [ ] **Step 2: Write `Composer.tsx`**

Reference markup: lines 274–278 (4b), 360–364 (4d), 455–459 (2b), 543–547 (2c).

```tsx
import { type FormEvent, useState } from "react";
import { VoiceRecorder } from "../screens/VoiceRecorder";
import "./Composer.css";

interface ComposerProps {
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
}

export function Composer({ onSend, onSendVoice }: ComposerProps) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer__input-wrap">
        <input
          className="composer__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Message — encrypted end-to-end"
          autoComplete="off"
        />
        <span className="composer__caret" />
      </div>
      <VoiceRecorder onSend={onSendVoice} />
      <button className="composer__send-button" type="submit" aria-label="Send">
        ↑
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write `Composer.css`**

```css
.composer {
  flex: none;
  padding: 16px 24px 20px;
  display: flex;
  gap: 10px;
  align-items: center;
  border-top: 1px solid var(--border-soft);
}
.composer__input-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 12px 20px;
  font-size: 15px;
  color: var(--text-secondary);
  transition: border-color 0.2s ease;
}
.composer__input-wrap:focus-within {
  border-color: var(--accent-hover, var(--accent));
}
.composer__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--text-primary);
}
.composer__input::placeholder {
  color: var(--text-secondary);
}
.composer__caret {
  width: 1.5px;
  height: 16px;
  background: var(--accent);
  animation: caretBlink 1.1s step-end infinite;
}
.composer__mic,
.composer__send-button {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  font-size: 15px;
  transition: transform 0.12s ease;
}
.composer__mic:active,
.composer__send-button:active {
  transform: scale(0.95);
}
.composer__mic {
  background: rgba(210, 210, 215, 0.64);
  color: var(--text-primary);
}
.composer__send-button {
  background: var(--accent);
  color: #ffffff;
  font-size: 16px;
}
:root[data-theme="iris"] .composer__input-wrap,
:root[data-theme="pulse"] .composer__input-wrap,
:root[data-theme="iris"] .composer__mic,
:root[data-theme="iris"] .composer__send-button,
:root[data-theme="pulse"] .composer__mic,
:root[data-theme="pulse"] .composer__send-button {
  border-radius: 14px;
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Composer.tsx client/src/components/Composer.css client/src/screens/VoiceRecorder.tsx
git commit -m "Restyle composer and voice recorder controls"
```

---

### Task 11: Rewrite ChatScreen

**Files:**
- Modify: `client/src/screens/ChatScreen.tsx` (full rewrite)
- Create: `client/src/screens/ChatScreen.css`

**Interfaces:**
- Consumes: `TitleBar` (Task 7), `Sidebar` (Task 8), `MessageBubble`/`VoiceMessageBubble` (Task 9), `Composer` (Task 10).
- Produces: same public props as today — `ChatScreenProps { messages: ChatMessage[]; onSend: (text: string) => void; onSendVoice: (blob: Blob, mimeType: string) => void }` and `ChatMessage` type — unchanged, so `App.tsx` (Task 12) needs no changes to how it calls `ChatScreen`. Also needs `roomCode: string` (new required prop — `App.tsx` already tracks this in its `waiting`/`handshake` state, thread it through to the `chat` screen state in Task 12).

- [ ] **Step 1: Rewrite `ChatScreen.tsx`**

```tsx
import type { ReactNode } from "react";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { MessageBubble } from "../components/MessageBubble";
import { VoiceMessageBubble } from "../components/VoiceMessageBubble";
import { Composer } from "../components/Composer";
import "./ChatScreen.css";

export type ChatMessage =
  | { id: string; from: "me" | "peer"; kind: "text"; text: string }
  | { id: string; from: "me" | "peer"; kind: "voice"; audioUrl: string }
  | { id: string; kind: "decryption-error" };

interface ChatScreenProps {
  roomCode: string;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
}

function renderMessage(message: ChatMessage): ReactNode {
  if (message.kind === "decryption-error") {
    return (
      <div className="message-row message-row--incoming">
        <div className="message-bubble message-bubble--incoming">[Message could not be decrypted]</div>
      </div>
    );
  }
  if (message.kind === "voice") {
    return <VoiceMessageBubble from={message.from} audioUrl={message.audioUrl} durationLabel="0:23" />;
  }
  return <MessageBubble from={message.from} text={message.text} />;
}

export function ChatScreen({ roomCode, messages, onSend, onSendVoice }: ChatScreenProps) {
  return (
    <div className="chat-screen">
      <TitleBar roomCode={roomCode} />
      <div className="chat-screen__body">
        <Sidebar roomCode={roomCode} onNewChat={() => {}} />
        <div className="chat-screen__main">
          <div className="chat-screen__messages">
            <div className="chat-screen__day-divider">Today</div>
            {messages.map((message) => (
              <div key={message.id}>{renderMessage(message)}</div>
            ))}
          </div>
          <Composer onSend={onSend} onSendVoice={onSendVoice} />
        </div>
      </div>
    </div>
  );
}
```

Note: `onNewChat={() => {}}` — there is no multi-room support in the current protocol (one room per session, Design Decision "pairing is room/invite-link based" in `decisions.md`); the button renders per the design but starting a second concurrent room is out of scope (Phase 5 territory, not Phase 4 UI). Voice message duration is hardcoded to `"0:23"` matching the mockup's copy — the real recorded duration isn't currently threaded through `ChatMessage` (`App.tsx:146-157` only stores `audioUrl`); leave a comment noting this as a known gap rather than plumbing a new field silently.

- [ ] **Step 2: Write `ChatScreen.css`**

```css
.chat-screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-ui);
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

- [ ] **Step 3: Add the comment noted in Step 1**

In `ChatScreen.tsx`, directly above the `renderMessage` voice branch, add: `// duration hardcoded — real clip length isn't threaded through ChatMessage yet`.

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/ChatScreen.tsx client/src/screens/ChatScreen.css
git commit -m "Rewrite chat screen with themed layout components"
```

---

### Task 12: Wire theme provider, handshake screen, and dev override into App

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `ThemeProvider`/`useTheme` (Task 2), `parseScreenOverride` (Task 3), `LoadingScreen` (Task 6), `ThemeSwitcher` (Task 2), `ChatScreen`'s new `roomCode` prop (Task 11).
- Produces: new `Screen` union variant `{ name: "handshake"; roomCode: string }` inserted between `waiting` and `safety-number`; `chat` variant gains `roomCode: string`.

- [ ] **Step 1: Wrap the app in `ThemeProvider` and render `ThemeSwitcher`**

In `client/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeContext";
import { ThemeSwitcher } from "./theme/ThemeSwitcher";
import "./styles/keyframes.css";
import "./styles/tokens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <ThemeSwitcher />
    </ThemeProvider>
  </StrictMode>
);
```

- [ ] **Step 2: Add the `handshake` screen state and thread `roomCode` through to `chat`**

In `client/src/App.tsx`, update the `Screen` union (currently at lines 15–20):

```ts
type Screen =
  | { name: "start" }
  | { name: "waiting"; roomCode: string }
  | { name: "handshake"; roomCode: string }
  | { name: "safety-number"; roomCode: string; safetyNumber: string }
  | { name: "chat"; roomCode: string }
  | { name: "error"; message: string };
```

(`safety-number` also gains `roomCode` so it threads through to `chat` — `SafetyNumberScreen`'s own props are unchanged, this is just carried in the `Screen` state.)

- [ ] **Step 3: Show `handshake` as soon as the peer connects, gated transition to `safety-number`**

Replace the two `client.onMessage` handlers currently calling `exchangeKeys` directly (lines 106 and 130) so they first set the screen to `handshake`, then `exchangeKeys` runs with a minimum-duration gate before moving to `safety-number`. Rewrite `exchangeKeys` (currently `App.tsx:38-90`):

```tsx
  const HANDSHAKE_MIN_MS = 2600;

  async function exchangeKeys(
    client: RelayClient,
    own: Keypair,
    role: "initiator" | "responder",
    roomCode: string
  ) {
    const handshakeStart = performance.now();
    client.onMessage(async (envelope: Envelope) => {
      if (envelope.type === "peer-disconnected") {
        setScreen({ name: "error", message: "Your friend disconnected." });
        return;
      }
      if (envelope.type === "pubkey") {
        try {
          const peerPublicKey = await fromBase64(envelope.payload);
          sessionKeysRef.current = await deriveSessionKeys(own, peerPublicKey, role);
          const safetyNumber = await computeSafetyNumber(own.publicKey, peerPublicKey);
          const elapsed = performance.now() - handshakeStart;
          if (elapsed < HANDSHAKE_MIN_MS) {
            await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_MIN_MS - elapsed));
          }
          setScreen({ name: "safety-number", roomCode, safetyNumber });
        } catch {
          setScreen({ name: "error", message: "Key exchange failed." });
        }
        return;
      }
      if (envelope.type === "ciphertext") {
        const keys = sessionKeysRef.current;
        if (!keys) return;
        try {
          const text = await decryptMessage(keys.rx, envelope.payload);
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), from: "peer", kind: "text", text },
          ]);
        } catch {
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), kind: "decryption-error" }]);
        }
        return;
      }
      if (envelope.type === "voice") {
        const keys = sessionKeysRef.current;
        if (!keys) return;
        try {
          const blob = await decryptVoiceClip(keys.rx, envelope.payload, envelope.mimeType);
          const audioUrl = URL.createObjectURL(blob);
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), from: "peer", kind: "voice", audioUrl },
          ]);
        } catch {
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), kind: "decryption-error" }]);
        }
      }
    });

    client.send({ type: "pubkey", payload: await toBase64(own.publicKey) });
  }
```

Then update both call sites. `handleStart`'s `onMessage` (currently `App.tsx:102-112`). Note: don't read `screen.roomCode` from React state here — the callback closure captures `screen` as it was when `handleStart` ran (still `{ name: "start" }`), so state updates from the same closure's own earlier `setScreen` calls won't be visible through `screen`. Track the room code in a local variable within the closure instead:

```tsx
    let currentRoomCode = "";
    client.onMessage((envelope) => {
      if (envelope.type === "created") {
        currentRoomCode = envelope.roomCode;
        setScreen({ name: "waiting", roomCode: envelope.roomCode });
      }
      if (envelope.type === "peer-connected") {
        setScreen({ name: "handshake", roomCode: currentRoomCode });
        void exchangeKeys(client, own, "initiator", currentRoomCode);
      }
      if (envelope.type === "error") {
        setScreen({ name: "error", message: envelope.message });
      }
    });
```

`handleJoin`'s `onMessage` (currently `App.tsx:126-134`) — here the room code is the one the user typed in, passed into `handleJoin(roomCode: string)`:

```tsx
    client.onMessage((envelope) => {
      if (envelope.type === "error") {
        setScreen({ name: "error", message: envelope.message });
      }
      if (envelope.type === "peer-connected") {
        setScreen({ name: "handshake", roomCode });
        void exchangeKeys(client, own, "responder", roomCode);
      }
    });
```

(`roomCode` is already an in-scope parameter of `handleJoin`, no new plumbing needed there.)

- [ ] **Step 4: Render `handshake` and pass `roomCode` into `chat`**

Update the render branches at the bottom of `App.tsx` (currently lines 159–181):

```tsx
  if (screen.name === "start") {
    return <StartJoinScreen onStart={handleStart} onJoin={handleJoin} />;
  }
  if (screen.name === "waiting") {
    return <WaitingScreen roomCode={screen.roomCode} />;
  }
  if (screen.name === "handshake") {
    return <LoadingScreen roomCode={screen.roomCode} scheme={loadingScheme} />;
  }
  if (screen.name === "safety-number") {
    return (
      <SafetyNumberScreen
        safetyNumber={screen.safetyNumber}
        onVerified={() => setScreen({ name: "chat", roomCode: screen.roomCode })}
      />
    );
  }
  if (screen.name === "chat") {
    return (
      <ChatScreen
        roomCode={screen.roomCode}
        messages={messages}
        onSend={handleSend}
        onSendVoice={handleSendVoice}
      />
    );
  }
  return (
    <div>
      <h1>Something went wrong</h1>
      <p>{screen.message}</p>
    </div>
  );
```

Add near the top of the component, alongside the other hooks: `const { loadingScheme } = useTheme();` and import `useTheme` from `"./theme/ThemeContext"`, `LoadingScreen` from `"./screens/loading/LoadingScreen"`.

- [ ] **Step 5: Wire the dev-only screen override**

At the very top of the `App` function body, before the `screen`/`messages` state declarations:

```tsx
  const devOverride = import.meta.env.DEV ? parseScreenOverride(window.location.search) : null;
```

And right before the final `return` chain (after all the `if (screen.name === ...)` branches, so real state still takes precedence once a real flow starts — but since `devOverride` is only read once at mount and the user is expected to reload with a fresh query string per test, an early return is simpler and sufficient):

```tsx
  if (devOverride?.screen === "loading") {
    return <LoadingScreen roomCode="K7F-2QX" scheme={loadingScheme} />;
  }
  if (devOverride?.screen === "chat") {
    return (
      <ChatScreen
        roomCode="K7F-2QX"
        messages={[
          { id: "1", from: "peer", kind: "text", text: "did you check the safety number?" },
          { id: "2", from: "me", kind: "text", text: "yep — 21934 07741 66012 — matches on my end" },
          { id: "3", from: "me", kind: "text", text: "got it — nothing between us but ciphertext." },
        ]}
        onSend={() => {}}
        onSendVoice={() => {}}
      />
    );
  }
```

Place this block **before** the `screen.name === "start"` check at the top of the render chain — `screen` defaults to `{ name: "start" }`, so if the override check came after that branch it would never be reached. Import `parseScreenOverride` from `"./dev/screenOverride"`. If `devOverride?.theme` is set, call `setTheme` (from `useTheme()`) once via a `useEffect` keyed on mount so the switcher reflects the URL param:

```tsx
  useEffect(() => {
    if (devOverride?.theme) setTheme(devOverride.theme);
  }, []);
```

(`setTheme` also comes from `useTheme()`.)

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `cd client && npm run typecheck && npm test`
Expected: typecheck passes with no errors; all existing + new tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.tsx client/src/main.tsx
git commit -m "Wire theme system and loading screen into the app state machine"
```

---

### Task 13: Manual end-to-end verification across all themes

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `cd client && npm run dev`

- [ ] **Step 2: Check the loading screen in isolation, both schemes**

Visit `http://localhost:5173/?screen=loading` with the OS in light mode, then dark mode (or use browser devtools' "Emulate CSS prefers-color-scheme"). Confirm wordmark, checklist, counter, marquee, and progress bar all match Design Deviation 4/5's behavior with no letter clipping.

- [ ] **Step 3: Check the chat screen in isolation, all three themes**

Visit `?screen=chat&theme=apple` (check both OS schemes), `?screen=chat&theme=iris`, `?screen=chat&theme=pulse`. For each: confirm title bar, sidebar, message bubbles (incoming/outgoing), voice bubble (click play — waveform should animate only while audio is playing, click again to pause and confirm it stops), composer (typing, blinking caret, focus border color), and that the layout fills the viewport responsively (resize the window) rather than clipping at a fixed 1180×740 size.

- [ ] **Step 4: Full real flow with two browser windows**

Follow the same two-window verification procedure already used for Phases 1–3 (see `progress.md`): start a room in one window, join from the other, confirm the loading/handshake screen appears after the peer connects and before the safety-number screen, then verify text and voice messages in the new chat UI.

- [ ] **Step 5: Update `progress.md` and `decisions.md`**

Add a `progress.md` log entry (following the existing format) noting Phase 4 UI complete, and add `decisions.md` entries for: the fixed-window-frame deviation (Design Deviation 1), the typing-indicator scope cut (Design Deviation 2), and the runtime letter-width measurement approach (Design Deviation 5) — these are exactly the kind of non-obvious calls `AGENTS.md` requires logging. Update the Phase 4 row in `progress.md`'s status table from "Not started" to "Complete."

- [ ] **Step 6: Commit**

```bash
git add progress.md decisions.md
git commit -m "Mark Phase 4 UI redesign complete"
```

---

## Self-Review Notes

- **Spec coverage:** 5a/5b (Task 6), 4b/4d (Tasks 7–11 with `data-theme="apple"` + `data-scheme`), 2b (Tasks 7–11 with `data-theme="iris"`), 2c (Tasks 7–11 with `data-theme="pulse"`) — all six approved screens covered. Typing indicator and multi-room "New chat" are explicitly cut with rationale (Design Deviation 2, Task 11 note), not silently dropped.
- **Placeholder scan:** no TBD/TODO left in any step; the one open gap (voice clip duration hardcoded to "0:23") is called out explicitly with a code comment in Task 11, not glossed over.
- **Type consistency:** `Screen` union (Task 12) and `ChatScreenProps`/`ChatMessage` (Task 11) checked against every call site touched in Task 12 — `roomCode` flows `waiting → handshake → safety-number → chat` consistently.
- **Ambiguity check:** the one genuine judgment call with no spec answer (how a variable-latency real handshake interacts with fixed-timing choreography) is resolved explicitly in Design Deviation 4, not left for the implementer to guess.
