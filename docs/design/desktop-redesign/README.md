# Handoff: Trojan Troy — Desktop Chat App (Loading Screens + Chat Layouts)

## Overview
Desktop UI for **Trojan Troy**, an end-to-end-encrypted, zero-knowledge ephemeral chat app (no accounts, room-code based, keys never leave the device). This bundle contains the six approved designs:

- **5a / 5b** — Final loading screen, light + dark ("kinetic cipher" wordmark, live percent counter, key-exchange checklist, marquee ticker)
- **4b / 4d** — Apple-design-language chat layout, light + dark
- **2b** — "Iris Glass" chat layout (frosted glass over floating light orbs, periwinkle accent)
- **2c** — "Pulse Slate" chat layout (violet→magenta gradient energy on near-black)

## About the Design Files
The file in this bundle (`Trojan Troy Directions.dc.html`) is a **design reference created in HTML** — a prototype showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (React, Electron, Tauri, SwiftUI, etc.) using its established patterns and libraries — or, if no environment exists yet, choose the most appropriate framework and implement them there. Open the HTML file in a browser to see every screen live with all animations running.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and animation timing are final. Recreate pixel-perfectly.

All screens render inside a 1180×740 window mock (rounded 12px — 16px for Iris Glass — with macOS traffic lights at top-left: #FF5F57, #FEBC2E, #28C840, 12px circles, 8px gap).

---

## Screens

### 5a — Loading screen, Light (final direction)
**Purpose:** shown while the secure channel is established (keypair generation → key exchange → sealing). No spinner; the brand itself is the loader.

**Canvas:** #ffffff, color #1d1d1f, font `SF Pro Text` (display sizes use `SF Pro Display`). Content column padding: 72px 80px 96px, `justify-content: space-between`.

**Top row:**
- Left: status label "ESTABLISHING SECURE CHANNEL" — 12px, 600, letter-spacing 0.14em, #7a7a7a, preceded by a 7px Action Blue (#0066cc) dot pulsing (`bluePulse`: box-shadow ring 0→6px rgba(0,102,204,0.4)→0, 2.4s infinite).
- Right: "Room K7F-2QX" — 12px #7a7a7a.

**Kinetic cipher wordmark ("Trojan Troy" slot-machine):**
- Two lines ("Trojan" / "Troy") of per-letter slot reels. 96px / 600 / letter-spacing −2px / line-height 132px, SF Pro Display.
- Each letter is a 132px-tall clipping window (`overflow: hidden`, fixed per-letter width, e.g. T=60, r=40, o=56, j=36, a=53, n=55px). Inside, a vertical stack of 4 glyphs (132px each) — 3 random cipher characters and the real letter last.
- Animation `slotDrop`: translateY(0 → −396px), 0.9s `cubic-bezier(0.85, 0, 0.15, 1)`, `both`. Staggered left→right, +0.08s per letter, starting 0.20s (line 1) through 0.92s (last letter of line 2).
- Line 2 has `margin-top: -16px` to tighten leading.
- A terminal period "." in Action Blue after "Troy" (margin-left 28px) rises in with `lineRise` (translateY(110%)→0 + fade, 0.7s, cubic-bezier(0.2, 0.9, 0.3, 1), delay 1.15s).
- ⚠️ The 132px window height (vs 96px font size) is deliberate — smaller windows clip the J hook and the y descender. Keep window height = line-height ≥ ~1.35× font size.

**Key-exchange checklist** (below wordmark, gap 40px from it; rows gap 14px):
- Rows slide in with `rowIn` (translateX(−14px) + fade, 0.6s, delays 1.3s / 1.7s / 2.1s).
- Done rows: 18px Action Blue circle with white ✓ (10px), popping in with `checkPop` (scale 0→1.25→1, 0.4s, delays 1.6s / 2.2s); label 15px #1d1d1f, letter-spacing −0.224px.
  1. "Keypair generated on this device"
  2. "Keys exchanged through the relay"
- Pending row: 18px circle, 1.5px #0066cc border, `bluePulse` infinite; label #7a7a7a: "Sealing the channel…"

**Bottom row:**
- Left: reassurance copy, 13px #7a7a7a, max-width 380px, line-height 1.5: "The relay only ever sees ciphertext. Your keys never leave this device."
- Right: live percent counter — 120px, weight 300, SF Pro Display, letter-spacing −2px. Implemented with a CSS `@property --p` integer + `counter-reset` and `countUp` keyframes (0→62% at 45%, →88% at 70%, →100% at 92%, 6.5s ease-in-out infinite). In production drive this from real key-exchange progress. "%" suffix 40px #7a7a7a.

**Marquee ticker** (absolute, bottom 14px, full width, pointer-events none):
- 11px / 600 / letter-spacing 0.18em, #d2d2d7. Text repeats: "END-TO-END ENCRYPTED · ZERO KNOWLEDGE RELAY · KEYS STAY ON DEVICE · NO ACCOUNTS · NO METADATA · …"
- Two identical spans in an inline-flex track animated `translateX(0 → −50%)` linear 22s infinite for a seamless loop.

**Progress bar** (absolute bottom, 3px tall): track #f0f0f0, fill #0066cc animated by `fillLoop` (width 3%→62%→88%→100%, 6.5s, synced with the counter).

### 5b — Loading screen, Dark
Identical structure, choreography, and timings to 5a. Substitutions only:
- Canvas #000000; primary text #ffffff; secondary #cccccc; tertiary #7a7a7a.
- Accent: Sky Blue **#2997ff** everywhere 5a uses #0066cc (dot, check circles — with black ✓ glyph color #000000 — pending ring, period, progress fill). Pulse uses rgba(41,151,255,0.45).
- Ticker text #333333; progress track #1d1d1f.

---

### 4b — Apple Light chat layout
**Purpose:** the main chat window (final Apple-design-language direction, light mode). Single accent: Action Blue #0066cc; links/secondary accent in dark mode only. No gradients.

**Title bar** (46px, background rgba(245,245,247,0.8) + `backdrop-filter: saturate(180%) blur(20px)`, bottom border #e0e0e0):
- Traffic lights; app name "Trojan Troy" 14px/600 SF Pro Display; centered "Room K7F-2QX" 13px #7a7a7a (room code in SF Mono #1d1d1f); right pill "Verified · End-to-end encrypted" — 12px, white bg, #e0e0e0 border, 9999px radius, 5px 14px padding, with pulsing 7px #0066cc dot.

**Sidebar** (256px, #f5f5f7, right border #e0e0e0, padding 16px 12px, gap 8px):
- "New chat" button: full-width, #0066cc bg, white text 14px, 9999px radius, 11px padding; active state scale(0.95), transition 0.12s.
- Section labels 12px/600 #7a7a7a ("Active", "Contacts").
- Active room card: white bg, #e0e0e0 border, 11px radius, 10px 12px padding — room code SF Mono 13px/600 + "Verified" 11px #0066cc; subline "Voice message · 0:23" 12px #7a7a7a. Active: scale(0.98).
- Contacts placeholder card: #fafafc bg, #f0f0f0 border, 11px radius: "Persistent contacts arrive with long-term identity keys. Coming soon."
- Footer (pinned bottom, top border): "Your keys never leave this device." 12px #7a7a7a.

**Message area** (white; padding 28px 32px; column, gap 14px, bottom-anchored):
- Day divider "Today" centered, 12px/600 #7a7a7a.
- Bubbles: max-width 420px, 15px text, line-height 1.47, letter-spacing −0.224px, padding 11px 16px.
  - Incoming: #f5f5f7, radius 18px 18px 18px 5px.
  - Outgoing: #0066cc, white text, radius 18px 18px 5px 18px. Safety number in SF Mono 14px.
- Entrance animation `msgIn` per message: translateY(14px) scale(0.98) + fade → none, 0.5s cubic-bezier(0.2, 0.9, 0.3, 1), staggered 0.1/0.25/0.4/0.55/0.7s.
- Voice message (incoming bubble): 34px round #0066cc play button (▶, white); 10 waveform bars (3px wide, 2px radius, heights 9–24px, #0066cc) animating `waveBar` (scaleY 0.35→1, 1.4s alternate infinite, +0.15s stagger); duration "0:23" SF Mono 12px #7a7a7a.
- Typing indicator: incoming bubble with three 6px #7a7a7a dots, `typingDot` (opacity + 3px bounce, 1.3s, +0.18s stagger).
- Message copy: "did you check the safety number?" / "yep — 21934 07741 66012 — matches on my end" / voice / "got it — nothing between us but ciphertext."

**Composer** (top border #f0f0f0, padding 16px 24px 20px, gap 10px):
- Input pill: white, border rgba(0,0,0,0.08), 9999px radius, padding 12px 20px, placeholder "Message — encrypted end-to-end" 15px #7a7a7a, with a blinking 1.5px #0066cc caret (`caretBlink` 1.1s step-end). Hover: border #0071e3.
- 42px round mic button (rgba(210,210,215,0.64), #1d1d1f glyph) and 42px round send button (#0066cc, white ↑). Active: scale(0.95).

### 4d — Apple Dark chat layout
Same structure/timings as 4b. Substitutions:
- Micro-stepped near-black surfaces: window #272729, title bar #000000, sidebar #252527, cards/bubbles #2a2a2c. Borders rgba(255,255,255,0.06–0.12).
- Text: primary #ffffff, secondary #cccccc.
- **Action Blue #0066cc stays on actions** (New chat, send, play, outgoing bubbles); **Sky Blue #2997ff for links/indicators** (Verified label, status dot with `bluePulseDark`, waveform bars, caret, input hover border).
- Verified pill: #1d1d1f bg, rgba(255,255,255,0.12) border. Mic button rgba(210,210,215,0.24), white glyph. Typing dots #cccccc.

---

### 2b — Iris Glass chat layout
**Purpose:** alternate visual direction — frosted-glass layers over floating light.

- Window: 1180×740, radius 16px, background `linear-gradient(160deg, #0D0F18 0%, #101223 100%)`, border rgba(255,255,255,0.09), shadow 0 30px 80px rgba(0,0,0,0.65). Text #E8EAF2, font `Schibsted Grotesk` (UI) + `JetBrains Mono` (code/labels — both on Google Fonts).
- Two ambient orbs (340px and 300px radial gradients, periwinkle rgba(143,166,255,0.14) and violet rgba(196,160,255,0.11), blur(24px)) drifting with `floatOrb` (translateY ±22px, 9s/12s).
- Accent: periwinkle **#8FA6FF**; success/verified: mint **#7ED9B7** (`statusPulse` ring).
- Wordmark "TROJAN·TROY" — JetBrains Mono 12px/700, letter-spacing 0.16em, #A9BBFF.
- All chrome is translucent glass: rgba(255,255,255,0.03–0.055) fills + rgba(255,255,255,0.07–0.1) borders + `backdrop-filter: blur(12–24px)`.
- "New chat" button: rgba(143,166,255,0.9) bg, dark text #0B0C14, 12px radius, with a `sheen` sweep (skewed white gradient crossing every 3.8s). Hover: lift −1px + periwinkle glow shadow.
- Section labels: JetBrains Mono 11px, letter-spacing 0.14em, #5E6478. Contacts placeholder uses a **dashed** border.
- Bubbles: radius 16/5px corners; incoming glass (rgba(255,255,255,0.055) + border), outgoing periwinkle glass (rgba(143,166,255,0.14) fill, rgba(143,166,255,0.3) border). Hover: translateY(−2px) (+glow on outgoing). 14px text, line-height 1.5.
- Voice: solid #8FA6FF play button (dark glyph), periwinkle waveform. Composer: glass input 14px radius, #8FA6FF caret, square-ish 14px-radius buttons; send is solid #8FA6FF.
- Same `msgIn` stagger and copy as 4b.

### 2c — Pulse Slate chat layout
**Purpose:** alternate visual direction — violet→magenta energy, glow-forward.

- Window: #0A0A10, radius 12px, border rgba(167,139,250,0.16), shadow 0 30px 80px rgba(0,0,0,0.7). Text #E9E7F2, same font pairing as 2b.
- Accent gradient: **#A78BFA → #F472B6** (violet→magenta). Wordmark "TROJAN·TROY" uses the gradient as animated text fill (`gradShift`, background-position sweep, 4.5s). Verified: mint #7ED9B7.
- Central ambient glow: 560px radial rgba(167,139,250,0.07), blur(20px), `glowPulse` (opacity 0.4↔1, 6s).
- "New chat" + send buttons: animated 135° gradient (#A78BFA → #D46CD0 → #F472B6, `gradShift` 5s), dark text, 8–10px radius, `sheen` sweep on New chat; hover lift + magenta glow.
- Active room card: violet glass with an extra pulsing magenta outline ring (`glowPulse` on an absolutely-positioned inset −1px border, rgba(244,114,182,0.35)).
- Bubbles: radius 14/4px corners; incoming rgba(233,231,242,0.05); outgoing `linear-gradient(135deg, rgba(167,139,250,0.18), rgba(244,114,182,0.1))` + violet border. Hover lift + violet glow.
- Waveform bars and typing dots color-ramp across the gradient (#A78BFA → #B584F0 → #C47DE4 → #DC77CD → #F472B6). Caret #F472B6.
- Same layout skeleton, `msgIn` stagger, and copy as the other chat layouts.

---

## Interactions & Behavior
- **Loading → chat:** loading screen (5a/5b) plays while the handshake runs, then resolves into the chat layout. Checklist steps and the percent counter should be driven by real handshake events (keypair → exchange → seal); the looping CSS timings here are demo stand-ins.
- **Buttons:** press feedback `scale(0.95–0.98)`, 0.12s ease (Apple); hover lift −1px + glow shadow (Iris/Pulse).
- **Input:** hover/focus brightens border to the accent; caret blinks 1.1s step-end.
- **Messages:** each new message animates in with `msgIn` (0.5s, cubic-bezier(0.2, 0.9, 0.3, 1)).
- **Voice playback:** waveform bars animate while playing (`waveBar`).
- **Typing indicator** shows while the peer composes.
- Theme follows system light/dark (4b ↔ 4d, 5a ↔ 5b).

## State Management
- Handshake state machine: `generating-keys → exchanging → sealing → ready` (drives checklist, counter, progress bar, and the transition to chat).
- Chat state: message list (text | voice), typing indicator flag, verification status, room code, active-room selection.
- No persistence — sessions are ephemeral by design.

## Design Tokens

**Apple direction (5a/5b, 4b/4d)**
- Action Blue #0066cc (sole light-mode accent; hover #0071e3) · Sky Blue #2997ff (dark-mode links/indicators)
- Light surfaces: #ffffff / #f5f5f7 / #fafafc; borders #e0e0e0, #f0f0f0; text #1d1d1f / #7a7a7a; ticker #d2d2d7
- Dark surfaces: #000000 / #252527 / #272729 / #2a2a2c; borders rgba(255,255,255,0.06–0.12); text #ffffff / #cccccc
- Type: SF Pro Display (display/titles), SF Pro Text (UI), SF Mono (codes). Sizes: 120/96/40/15/14/13/12/11px. Letter-spacing: −2px display, −0.224px body, −0.12px captions
- Radii: 18px bubbles (5px tucked corner), 11px cards, 12px window, 9999px pills/buttons
- Motion: 0.12s button press; 0.5s message-in; 0.9s slot drop; 2.4s status pulse; 6.5s handshake loop. Signature easings: `cubic-bezier(0.85, 0, 0.15, 1)` (slot), `cubic-bezier(0.2, 0.9, 0.3, 1)` (entrances)

**Iris Glass (2b)** — #8FA6FF accent, #7ED9B7 verified, bg gradient #0D0F18→#101223, text #E8EAF2/#9BA1B5/#5E6478, glass fills rgba(255,255,255,0.03–0.055), radii 16/14/12px, blur 12–24px

**Pulse Slate (2c)** — gradient #A78BFA→#F472B6 (mid #D46CD0), #7ED9B7 verified, bg #0A0A10, text #E9E7F2/#9C99AD/#5E5B70, violet-tinted borders rgba(167,139,250,0.08–0.32), radii 14/10/8px

**Fonts:** SF Pro / SF Mono are system fonts on Apple platforms (fall back to `system-ui` / `ui-monospace`). Schibsted Grotesk and JetBrains Mono load from Google Fonts.

## Assets
None — no images or icon files. All visuals are CSS. Glyphs used inline: ✓ ▶ ↑ 🎙 · ● (replace 🎙 with a proper mic icon from the codebase's icon set).

## Files
- `Trojan Troy Directions.dc.html` — all six designs, live with animations (open in a browser; `support.js` must sit alongside it)
- `support.js` — runtime for the prototype file only; not part of the design
