# Mobile Web Support — Design Spec

**Date:** 2026-07-23
**Status:** Approved direction, not yet built
**Owner:** Jay (direction) + Claude (design/implementation calls)
**One-liner:** Make the existing Trojan Troy web client work — and feel — like a real app on a phone browser, without changing the crypto, the relay, or the desktop layout.

This spec is written to be executed by **multiple agents in parallel**. Read §4 (Shared
Conventions) and §9 (Ownership) before touching anything. Each work-package owns a
disjoint set of files; the one shared foundation (WP0) lands first and everything else
rebases on it.

---

## 1. Goal & context

Trojan Troy is a two-person E2E-encrypted chat (text + async voice). Everything works on
desktop. The client is React 18 + Vite 5 + TypeScript, themed via `data-theme`
(iris = default, apple, pulse). We want it usable on iOS Safari and Android Chrome:
fluid layouts, touch-friendly, keyboard-aware, notch-aware.

**This is a new scope addition.** `decisions.md` (2026-07-18) recorded "Mobile is not in
scope for Version A." Jay has now directed mobile web support. See §11 for the required
roadmap/decisions bookkeeping.

## 2. Scope

**Locked decisions (Jay, 2026-07-23):**

- **Chat layout → hamburger drawer.** On mobile the 256px sidebar becomes an off-canvas
  drawer opened from a menu button in the TitleBar; the chat goes full-width. The drawer
  keeps everything the sidebar has today (New chat, room code, ghost toggle, Verified,
  the data-viz). The data-viz animation **pauses while the drawer is closed** (battery).
- **"Responsive + app-like polish" (NOT a PWA).** In scope: fluid layouts, safe-area /
  notch handling (`viewport-fit=cover` + `env(safe-area-inset-*)`), keyboard-aware
  composer, no iOS focus-zoom, ≥44px tap targets, touch-friendly modals. **Out of scope:**
  web app manifest, icons, service worker, add-to-home-screen / standalone launch.

**Non-goals (do not build):**

- No PWA/installability, no native wrapper (Capacitor/RN), no live calling.
- No visual redesign beyond what mobile requires — keep the existing look; add mobile
  behavior behind a breakpoint.
- No tablet-specific tier. Tablets (>640px) keep the current desktop layout.
- No changes to crypto, the ratchet/handshake, the relay, or the wire protocol.
- Do **not** refactor the hardcoded-px values into a global spacing-token system (it would
  cause cross-agent merge conflicts; see §4).

## 3. Current state (why this is needed)

The app is **effectively desktop-only**. Evidence from a full frontend audit:

- Only **3 real `@media` breakpoints** exist in the entire codebase (`StartJoinScreen.css`
  `max-width:560px` + `max-height:760px`; `ErrorScreen.css` `max-width:520px`). The **chat
  surface has zero.** Everything else is fixed px at one desktop size.
- **No global reset, no global `box-sizing`, no body `margin:0`, no base font-size.**
  Screens fill the viewport via `position: fixed; inset: 0` (this happily sidesteps the
  iOS `100vh` bug, but there's no safe-area or keyboard handling).
- **No spacing/size scale** — every padding/gap/size is hardcoded px per component. Only
  radius is tokenized.
- Viewport meta exists (`width=device-width, initial-scale=1.0`) but **lacks
  `viewport-fit=cover`**, so notch/safe-area insets are off.

**The two structural breaks that dominate everything else:**

1. **`Sidebar.css:2` `width: 256px; flex: none`** — on a 390px phone this starves the
   message column to ~134px (~104px at 360px). The sidebar is not collapsible today.
2. **`position: fixed; inset: 0` root (`HandshakeJourney.css:2`) with no keyboard/safe-area
   handling** — the soft keyboard overlays the composer (it's the `flex:none` bottom child
   of a full-viewport column), `.composer__input` at 15px triggers iOS focus-zoom, and
   fixed top/bottom chrome runs under the notch/home-indicator.

**Everything else is mechanical** (enumerated per work-package in §5–§6): 80px side paddings
on Waiting/Loading, a 96px wordmark + 120px percent counter, a 4-column safety grid,
sub-44px tap targets throughout, a hover-only delete button, the native `<audio>` preview
overflowing the composer, and the 360px Settings modal.

**Already correct — DO NOT "fix":**

- The **drag-to-seal slider** (`SafetyNumberScreen.tsx`) uses Pointer Events +
  `touch-action: none` + live range measurement + a keyboard/aria fallback. It already
  works on touch. Leave the mechanics alone (only the surrounding grid layout changes).
- `Crossfade`/`HandshakeJourney` containers are fluid (`%` / `inset:0`).
- `ProfileModal` panel is already width-safe (`width:100%; max-width:440px` + 24px backdrop
  padding). `ProfileCard` horizontal position is already viewport-clamped.

## 4. Shared conventions — every agent MUST follow

1. **Breakpoint:** `@media (max-width: 640px)` is "mobile." Desktop layout above 640px is
   unchanged. Existing 560/520 blocks may stay; just ensure correct behavior at **360px and
   390px** wide. Add a `@media (max-height: 480px)` guard only where a screen is
   vertically cramped in landscape.
2. **Additive CSS only.** Append a mobile `@media` block at the **end** of each component's
   existing `.css`. Do not rewrite desktop rules. This keeps diffs small and prevents
   conflicts. **Do not introduce global spacing tokens or touch other packages' files.**
3. **Tap targets ≥ 44×44 CSS px** on mobile. Prefer expanding the *hit area* (padding or a
   `::before` overlay) over enlarging the visual glyph.
4. **Safe areas:** use the WP0-provided `env(safe-area-inset-*)` variables for any fixed
   top/bottom chrome or absolutely-positioned corner elements (TitleBar top, Composer
   bottom, StartJoin badge/ProfileButton, WaitingScreen).
5. **No iOS zoom:** any focusable `<input>`/`<textarea>` must be **font-size ≥ 16px** on
   mobile.
6. **Don't break desktop.** Verify the `desktop-chrome` Playwright project is visually
   unchanged after your change.
7. **Do not edit `App.tsx`.** It has in-flight PQ-handshake work (uncommitted on
   `feat/pq-hybrid-handshake`). Mobile is layout/CSS: drawer state lives in `ChatScreen`,
   the viewport hook is wired in `main.tsx`. If you think you need `App.tsx`, STOP and flag.
8. **Entry screens keep their hardcoded Iris palette** (StartJoin/Waiting/Loading/Error
   deliberately don't use theme tokens). Add mobile overrides in the same file; don't
   convert them to tokens.
9. **Verify with the Playwright setup** (`client/playwright.config.ts`, projects
   `iphone-safari` + `android-chrome`). See §8.

## 5. WP0 — Foundation (BLOCKS ALL OTHERS; single agent, land first)

**Owns (new/global files only):** `client/index.html`, new `client/src/styles/base.css`,
new `client/src/hooks/useAppHeight.ts`, `client/src/main.tsx`,
`client/src/screens/HandshakeJourney.css` (the shared full-viewport journey root).

**Changes:**

1. `index.html:5` — add `viewport-fit=cover`:
   `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`.
2. **`styles/base.css` (new), imported first in `main.tsx` (before other global CSS):**
   - `*, *::before, *::after { box-sizing: border-box; }`
   - `html, body, #root { margin: 0; padding: 0; }`
   - `html { -webkit-text-size-adjust: 100%; }` (belt-and-suspenders vs iOS zoom)
   - Safe-area convenience vars on `:root`:
     `--safe-top: env(safe-area-inset-top, 0px);` and `-right/-bottom/-left`.
   - Document the shared mobile breakpoint constant in a top comment (`640px`) — CSS can't
     use a custom property in a media condition, so it's a documented convention, not a var.
3. **`hooks/useAppHeight.ts` (new)** — a hook that tracks the **visual viewport** and writes
   its height to `--app-height` on `document.documentElement`, updating on
   `window.visualViewport` `resize`/`scroll` (fallback `window.innerHeight`; guard SSR/no-VV).
   Wire it once near the top of the tree in `main.tsx` (a tiny mount-only effect component or
   call inside `App` is fine — but per §4.7 prefer `main.tsx` to avoid `App.tsx`). See §7.
4. **`HandshakeJourney.css`** — change the shared root from a height forced by `inset:0` to a
   measured height so the keyboard can shrink it (§7): keep `position: fixed; top/left/right:0`
   but drop `bottom:0` and set `height: var(--app-height, 100dvh);`. Add
   `padding-top: var(--safe-top)` semantics where the journey's chrome needs it (or leave
   safe-area to child screens — document which). This is the **contract** other screen roots
   follow in their own files (§4.2 forbids editing their files here).

**Acceptance:** app boots unchanged on desktop; `--app-height` updates when the Chrome-Android
keyboard opens (and via `visualViewport` on iOS); no global visual regression; typecheck +
unit tests + build green.

## 6. Parallel work-packages (after WP0)

Each package: **Owns** (only these files) → **Do** (with file:line targets) → **Accept** →
**Test** (drive via the `?screen=` dev override in §8; screenshot at both mobile projects).

### WP-A — Entry screens
**Owns:** `StartJoinScreen.tsx/.css`, `WaitingScreen.tsx/.css`, `ProfileButton.tsx/.css`.
**Do:**
- Apply the WP0 root contract (`height: var(--app-height,100dvh)`, safe-area) to
  `.start-join-screen` (`StartJoinScreen.css:8`) and `.waiting-screen` (`WaitingScreen.css:6`).
- **StartJoin:** it already stacks at ≤560px. Fix the absolute **badge** (`.css:19`
  `top:28px;left:32px`) vs **ProfileButton** (`ProfileButton.css:6` `top:24px;right:28px`)
  collision at ≤390px with long profile names — on mobile shrink/hide the badge sub-text or
  reflow; add `--safe-top`/`--safe-*` offsets to both.
- **Waiting (broken):** `.waiting-screen__content` `padding:56px 80px 90px` (`.css:21`) →
  mobile `~40px 20px 64px`. Radar rings `width/height:360px; margin:-180px 0 0 -180px`
  (`.css:87-89`) → `min(360px, 80vw)` sized, centered via `translate(-50%,-50%)` (not fixed
  negative margins). Room code `clamp(40px,10vw,72px)` + `white-space:nowrap` (`.css:98,101`)
  → lower the clamp floor (e.g. `clamp(30px,8vw,72px)`) so a 9-char code fits. Copy pills row
  (`.css:124`) → allow `flex-wrap`. **Cancel button** `padding:6px 4px` (`.css:51`, ~25px
  tall) → ≥44px hit area.
**Accept:** no horizontal overflow at 360/390px; room code + rings + pills fit; Cancel ≥44px;
badge/profile don't overlap. **Test:** `?screen=waiting`; home `/`.

### WP-B — Loading / handshake backdrop
**Owns:** `screens/loading/LoadingScreen.tsx/.css`, `screens/loading/CipherWord.tsx/.css`,
`components/AmbientOrbs.tsx/.css`.
**Do:**
- **Loading (broken):** `.loading-screen` padding `72px 80px 96px` (`.css:1-7`) → mobile
  `48px 20px 64px`. The wordmark size is a **prop**, `fontSizePx={96}`
  (`LoadingScreen.tsx:46,55`) consumed by `CipherWord` (which measures per-letter columns at
  that size). Compute a responsive `fontSizePx` from viewport width (e.g. ~56–64px ≤640px) and
  scale `CipherWord`'s window height (`CipherWord.tsx:33`, default 132) proportionally.
  Percent counter `font-size:120px` (`.css:127`) → mobile ~72px. The bottom
  `space-between` row (`.css:26`) may need to stack on mobile.
- **AmbientOrbs (cosmetic):** orb-one `top:100px;left:340px;width/height:340px`
  (`.css:9-11`) sits off-screen right on a phone → reposition on mobile (e.g.
  `left: min(340px, 30vw)` or negative) so the backdrop composition survives. Low priority.
**Accept:** wordmark + percent fit with no horizontal overflow at 360/390px; reel animation
still lands correctly. **Test:** `?screen=loading`.

### WP-C — Safety-number screen
**Owns:** `screens/SafetyNumberScreen.tsx/.css`, `components/SealSparks.tsx/.css`.
**Do:**
- Grid `grid-template-columns: repeat(4, 1fr)` + `gap: … 34px` (`.css:110-111`) overflows the
  card → mobile `repeat(2, 1fr)` (or 3) with `gap: ~10px 16px`. Card horizontal padding `40px`
  (`.css:97`) → mobile ~20–24px. Card/seal are already `min(680px,90vw)` (fine).
- **Do NOT change the slider drag mechanics.** Optional enhancement (nice on mobile, not
  required): let a tap anywhere on the track begin the drag (currently only the 44px knob has
  handlers) — the keyboard fallback already exists, so this is optional polish.
- Verify SealSparks still renders correctly at narrow widths (geometry is live-measured; no
  change expected).
**Accept:** safety-number groups fit with no overflow at 360/390px; slider still seals by
touch. **Test:** `?screen=safety`.

### WP-D — Chat shell + drawer + composer (critical path, biggest)
**Owns:** `screens/ChatScreen.tsx/.css`, `components/Sidebar.tsx/.css`,
`components/TitleBar.tsx/.css`, `components/Composer.tsx/.css`, `screens/VoiceRecorder.tsx`,
`components/DataMonitor.tsx`.
**Do:**
- **Single column + drawer:** `.chat-screen__body` (`ChatScreen.css:18`) is the
  `sidebar | main` row. On mobile → single column, full-width main. `Sidebar`
  (`Sidebar.css:2-3` `width:256px;flex:none`) → off-canvas drawer on mobile:
  `position:absolute/fixed; width:min(300px,84vw); transform:translateX(-100%)` when closed,
  slide in when open, with a scrim overlay above the chat. Drawer open/close state lives in
  `ChatScreen` (NOT App.tsx). Add a **hamburger button** to `TitleBar` (left) that toggles it.
- **DataMonitor** (`DataMonitor.tsx`, lives in the sidebar) → accept a `paused`/`active` prop
  and stop its rAF/interval animations while the drawer is closed (battery). Sidebar passes
  the drawer-open state down.
- **TitleBar** (`TitleBar.css:1-7`, 5 flex children) → on mobile show hamburger + wordmark +
  settings; hide/relocate the centered room label, Verified pill, and peer name (they live in
  the drawer/Settings now), or collapse peer to avatar-only. Add `--safe-top` padding.
- **Composer:** `.composer__input font-size:15px` (`Composer.css:17`) → 16px on mobile (iOS
  zoom). Mic + send `42×42` (`Composer.css:41-42`) → ≥44px. Add
  `padding-bottom: max(20px, var(--safe-bottom))`. The composer must ride above the keyboard
  via the `--app-height` mechanism (§7) — confirm it's the bottom child of the measured-height
  column.
- **VoiceRecorder preview (worst break after the sidebar):** the native `<audio controls>` +
  Send + Discard (`VoiceRecorder.tsx:116-127`) render inline **next to** the still-present
  input and overflow. On mobile, `.composer__preview` should become a **full-width stacked
  block that replaces the composer row** (column / `flex-wrap`); `.composer__preview audio`
  (`Composer.css:111`) → `width:100%; max-width:100%`. Stop/Send/Discard ≥44px.
- **Auto-scroll to newest:** `ChatScreen` has **no scroll-to-bottom logic** today. Add an
  effect that scrolls `.chat-screen__messages` (`ChatScreen.css:24`) to the bottom on new
  messages (critical once the keyboard shrinks the viewport). `.chat-screen__messages` padding
  `28px 32px` (`.css:27`) → mobile `16px 12px`.
**Accept:** at 360/390px the chat is a full-width single column; drawer opens/closes with a
hamburger + scrim; composer is reachable and 16px (no zoom); voice record→preview→send fits;
new messages scroll into view; data-viz pauses when the drawer is closed; desktop unchanged.
**Test:** `?screen=chat` (renders the chat with sample messages, drawer, composer,
voice-preview via the recorder). Keyboard-riding needs a real-device/manual check (§8).

### WP-E — Message content
**Owns:** `components/MessageBubble.tsx/.css`, `components/VoiceMessageBubble.tsx/.css`,
`components/MessageAvatar.tsx/.css`. (`PresenceIndicator` is already fine — leave it.)
**Do:**
- **MessageAvatar** button/img `28×28` (`.css:2-4,16-18`) is the **only** trigger for the
  ProfileCard popover → keep the 28px visual but expand the hit area to ≥44px (padding /
  `::before`).
- **VoiceMessageBubble** play button `34×34` (`.css:11-12`) → ≥44px hit area.
- Bubbles already wrap (`overflow-wrap/word-break`) and `max-width:420px` never binds on
  mobile — no change needed there. Optionally reduce the 28px avatar-gap reserve
  (`MessageBubble.css:22-25`) on very narrow widths.
**Accept:** avatar + voice-play are ≥44px tappable; bubbles don't overflow at 360/390px.
**Test:** `?screen=chat`.

### WP-F — Modals & popovers
**Owns:** `components/Settings.tsx/.css`, `components/ProfileModal.tsx/.css`,
`components/ProfileCard.tsx/.css`.
**Do:**
- **Settings** `.settings__panel width:360px; max-height:80vh` (`.css:10-14`) →
  `width: min(360px, 100% - 32px)`; give the backdrop padding or the panel a margin so it
  never touches the edge; close button (`~24px`) → ≥44px; toggle switch `40×22` → expand hit
  area; add safe-area padding.
- **ProfileModal** (mostly width-safe already): fix the **delete button**
  `width/height:22px; opacity:0` until `:hover` (`.css:116-135`) — **always visible + ≥44px
  hit area** on touch/coarse-pointer (hover doesn't exist on touch). Back/close `28px` → ≥44px.
- **ProfileCard:** horizontal position is clamped (good). Fix the **vertical** position:
  `bottom = innerHeight - anchor.top + 8` (`ProfileCard.tsx:135`) has no clamp, so tapping an
  avatar near the top of a short mobile list pushes the card off-screen → flip below the
  anchor (or clamp to viewport) when there isn't room above. Optional: skip the full-screen FX
  canvas on coarse-pointer/mobile for battery (it's already `prefers-reduced-motion`-gated).
**Accept:** all three fit within the viewport with gutters at 360/390px; delete is reachable by
touch; ProfileCard never clips off-screen. **Test:** `?screen=profiles` (Settings/ProfileModal);
`?screen=chat` then tap a message avatar (ProfileCard).

## 7. Keyboard & viewport strategy (shared — the tricky part)

The problem: the roots are `position: fixed; inset: 0`, so their height = the *layout*
viewport, which does **not** shrink when the iOS soft keyboard opens — the keyboard overlays
the bottom-anchored composer.

**Approach (implement in WP0, consume in WP-D):**

- `useAppHeight` (WP0) subscribes to `window.visualViewport` `resize`/`scroll` and sets
  `document.documentElement.style.setProperty('--app-height', visualViewport.height + 'px')`
  (fallback `window.innerHeight`). This tracks the *visual* viewport, which **does** shrink
  for the keyboard.
- Screen roots use `height: var(--app-height, 100dvh)` with `position: fixed; top/left/right:0`
  (drop `bottom:0`). `100dvh` is the no-JS fallback.
- The chat column is `display:flex; flex-direction:column` with the composer as the
  `flex:none` last child, so when `--app-height` shrinks, the composer stays pinned to the
  (now-raised) bottom edge, above the keyboard. Pair with
  `padding-bottom: max(<n>px, var(--safe-bottom))` on the composer.
- Combined with WP-D's auto-scroll-to-bottom so the newest message stays visible as the
  viewport shrinks.

**Caveat:** Playwright device emulation does **not** raise a soft keyboard, so this behavior
**cannot be fully verified in Playwright** — it needs a real device or a manual browser check
(Chrome DevTools device mode approximates Android's `resizes-content` but not iOS). Verify
layout/overflow/scroll in Playwright; verify keyboard-riding manually. State this explicitly in
the WP-D report rather than claiming it "passed."

## 8. Testing strategy (use the Playwright setup we just built)

- **Projects:** `client/playwright.config.ts` already defines `iphone-safari` (WebKit,
  iPhone 13) and `android-chrome` (Chromium, Pixel 7) plus `desktop-chrome`. The webServer
  auto-starts Vite on `:5173`.
- **Isolated per-screen testing via dev overrides.** `App.tsx` supports `?screen=` overrides
  (dev only) so a screen can be driven **without a live handshake**:
  `?screen=loading | chat | waiting | safety | connecting | profiles | error`. Each agent
  tests its screen through the matching override — no pairing needed. This is what makes the
  packages independently testable in parallel.
- **No-horizontal-overflow assertion** (add to each package's spec, run at both mobile
  projects):
  `expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)`
- **Screenshots** attached to the report per project (as in `e2e/home.spec.ts`) for a visual
  before/after at phone sizes. Run `npm run test:e2e`; view via `npm run test:e2e:report`;
  eyeball live via `npm run test:e2e:ui`.
- **Tap-target check:** assert the bounding box of key controls is ≥44px in both dimensions.
- **Desktop regression:** the same specs run on `desktop-chrome` — assert no layout change.
- **What Playwright can't cover** (do manually / real device, and say so): the soft-keyboard
  riding (§7), real touch-drag on the seal slider (emulated pointer only), and true iOS
  safe-area insets.
- **Standing bar (unchanged):** `npm run typecheck` clean, `npm test` (Vitest) green,
  `npm run build` green for every package before it merges.

## 9. Execution order & ownership

```
                         WP0  (foundation — MUST land first, blocks all)
                          │
     ┌──────────┬─────────┼─────────┬──────────┬──────────┐
    WP-A       WP-B      WP-C      WP-D       WP-E       WP-F      (parallel)
   entry     loading    safety   chat shell  msg body   modals
```

- **WP0 first**, single agent. Everyone else branches/rebases on it.
- **WP-A…WP-F run in parallel** — file ownership is disjoint (table below), so no conflicts.
- **WP-D is the critical path** (biggest + owns the keyboard consumption). Give it the
  strongest agent; others can finish around it.

**Ownership table (an agent edits ONLY its own rows):**

| Package | Files owned |
|---|---|
| WP0 | `index.html`, `styles/base.css` (new), `hooks/useAppHeight.ts` (new), `main.tsx`, `screens/HandshakeJourney.css` |
| WP-A | `screens/StartJoinScreen.*`, `screens/WaitingScreen.*`, `components/ProfileButton.*` |
| WP-B | `screens/loading/LoadingScreen.*`, `screens/loading/CipherWord.*`, `components/AmbientOrbs.*` |
| WP-C | `screens/SafetyNumberScreen.*`, `components/SealSparks.*` |
| WP-D | `screens/ChatScreen.*`, `components/Sidebar.*`, `components/TitleBar.*`, `components/Composer.*`, `screens/VoiceRecorder.tsx`, `components/DataMonitor.tsx` |
| WP-E | `components/MessageBubble.*`, `components/VoiceMessageBubble.*`, `components/MessageAvatar.*` |
| WP-F | `components/Settings.*`, `components/ProfileModal.*`, `components/ProfileCard.*` |

Shared, do-not-touch by anyone but the listed owner: `App.tsx` (nobody — §4.7),
`HandshakeJourney.css` (WP0 only), `styles/tokens.css`/`keyframes.css`/`fonts.css` (nobody —
no new tokens).

## 10. Definition of done (global)

- No horizontal overflow at **360px and 390px** on every screen (home, waiting, loading,
  safety, chat, error, profiles/modals).
- Chat is single-column with a working hamburger drawer + scrim; composer is reachable,
  16px input (no iOS zoom); voice record→preview→send fits; new messages auto-scroll into
  view; data-viz pauses while the drawer is closed.
- All interactive targets ≥44×44px on mobile; the hover-only ProfileModal delete is reachable
  by touch.
- Safe-area insets respected on notched devices (top chrome + bottom composer + corner
  elements); `viewport-fit=cover` set.
- **Desktop layout visually unchanged** (`desktop-chrome` regression).
- `npm run typecheck` clean, Vitest green, `npm run build` green.
- Keyboard-riding + real-touch verified manually on a real device (documented honestly, not
  claimed via Playwright).

## 11. Process notes

- **Branch:** do this on `feat/mobile-web-support` off **`main`** (not off the in-flight
  `feat/pq-hybrid-handshake`). Recommend committing the Playwright setup (config, `e2e/`,
  scripts, gitignore, Vitest exclude) to `main` first so the mobile branch has it. Confirm the
  exact base with Jay before dispatching agents.
- **Roadmap/decisions bookkeeping (AGENTS.md):** mobile was "not in scope for Version A"
  (`decisions.md` 2026-07-18). Add a `decisions.md` entry recording this new direction (Jay:
  hamburger drawer + responsive/app-like polish, no PWA) and a `roadmap.md` note, before/at
  the start of the build.
- **Commits:** short, human, imperative, signed; no AI authorship/trailers; commit per
  meaningful step (AGENTS.md).
- **When an agent thinks it needs a file it doesn't own** (especially `App.tsx` or
  `HandshakeJourney.css`), STOP and flag rather than reaching across the boundary.
