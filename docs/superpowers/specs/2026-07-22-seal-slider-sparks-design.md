# Seal-Slider Sparks Design

The safety-number screen's "Confirm Key" slider is a slide-to-seal: you drag
the glass knob left→right along the rainbow-trail track and, past the
threshold, the channel seals and the room opens. This adds a live spark
effect to that gesture — as you drag rightward, rainbow embers spray off the
leading edge of the knob, their intensity rising with both *how fast* you
drag and *how far* along you are, and the instant it seals a radial shower
bursts across the track. The goal is to make the single most important
confirmation gesture in the app feel physical, rich, and rewarding — without
changing anything about what the gesture does.

Builds on the existing `SafetyNumberScreen` (`screens/SafetyNumberScreen.tsx`
/ `.css`) — its rainbow trail, near-the-end shake, seal threshold, and
`requestAnimationFrame` shake loop are all **unchanged in behavior**. Sparks
render on a `<canvas>` overlay using the 2D context available in every
browser — **no new dependency**, no WebGL, no particle library. Nothing about
the crypto, relay, envelope protocol, or the verification/seal decision
changes; this is a purely additive visual layer. The screen is
**theme-independent** today (one hardcoded Iris-Glass palette inside
`HandshakeJourney`, like `LoadingScreen`), so there is a single spark palette
and no per-theme variant work. Respects `prefers-reduced-motion`. Touches only
`SafetyNumberScreen`, one new component (`components/SealSparks.tsx`), and one
new pure module (`screens/sparkModel.ts`).

## 1. Rendering substrate — a canvas overlay

A single `<canvas>` (`SealSparks`) is placed as a child of
`.confirm-key__seal` (`SafetyNumberScreen.css:122-131`), **outside** the
`phase === "verify"` conditional that holds the track markup
(`SafetyNumberScreen.tsx:243-285`). Rendering it outside that conditional is
deliberate: on seal, `phase` flips to `"sealed"` and the whole verify block
(track + knob) unmounts immediately, so a canvas nested inside it would
disappear before the burst could draw. As a persistent sibling it survives
the phase change and paints the seal burst over the "Channel sealed" box
during the existing `OPENING_HOLD_MS` (950ms) hold.

- **Position.** `.confirm-key__seal` gains `position: relative`. The canvas is
  absolutely positioned to cover the track's footprint and **overhang ~48px
  above it** (`top: -48px; left: 0; right: 0; height: 56px + 48px`), so embers
  can leap up off the rail rather than being clipped inside the track's
  `overflow: hidden` (`SafetyNumberScreen.css:138`). `pointer-events: none` —
  it never intercepts the drag.
- **Layering.** The canvas sits above the fill and knob in paint order.
  Sparks drawn with additive blending over the glass knob simply brighten it,
  reading as "the knob is throwing them" — the transient, small embers don't
  obscure the knob's arrow or glass.
- **Glow.** The loop draws with `ctx.globalCompositeOperation = "lighter"`
  (additive), so overlapping embers bloom into brighter hot spots — this is
  the primary ingredient of the "rich" look. Each ember is a small radial
  gradient (soft core → transparent edge), not a hard-edged circle.
- **Crispness.** The backing store is sized to `clientWidth/Height ×
  devicePixelRatio` and the context scaled by DPR, measured on `pointerdown`
  (reusing the existing measure-on-drag-start pattern from `measureRange()`,
  `SafetyNumberScreen.tsx:61-64`) and on window `resize`.
- The screen's shake transform is applied to the `.confirm-key` root
  (`SafetyNumberScreen.tsx:173`), so the canvas shakes together with the whole
  card — sparks stay visually glued to the knob, no conflict.

## 2. Emission model — velocity × progress

Emission is driven by two inputs together, which is what makes it feel
physical rather than decorative:

- **Velocity** — how fast the pointer is moving right. Fast flick = dense
  spray; slow creep = a trickle; stationary = nothing.
- **Progress** — how close to the seal. Emission scales up toward the
  threshold so intensity peaks exactly as the shake peaks and the channel
  seals.

The per-frame count is a pure function (Section 6, `sparkModel.ts`):

```ts
sparkCountForFrame({ velocity, progress, poolSize }): number
// velocity <= 0            → 0        (rightward motion only)
// velocityFactor = min(velocity / V_MAX, 1)
// raw   = EMIT_BASE * velocityFactor * (0.4 + progress)
// count = clamp(round(raw), 0, MAX_PARTICLES - poolSize)
```

Emitting only on **rightward** (`velocity > 0`) motion honors the feature
literally ("sparks when you move it to the right") and means dragging back to
cancel goes quiet.

**Velocity tracking.** `SafetyNumberScreen` gains a `velocityRef` (px/ms).
`handlePointerMove` (`SafetyNumberScreen.tsx:106-115`) computes the
instantaneous `(clientX - lastX) / (t - lastT)` and folds it into `velocityRef`
via an exponential moving average (so it isn't jittery), tracking `lastMoveRef
= { x, t }` alongside. **Key subtlety:** `pointermove` stops firing when the
finger holds still, so the `SealSparks` loop also **decays `velocityRef`
toward 0 each frame** — otherwise a held-still knob would keep spraying at the
last speed. A continuing drag keeps overwriting the decayed value, so it stays
lively while moving and fades when you stop.

## 3. Per-particle life

Each ember: `{ x, y, vx, vy, life, maxLife, size, hue, heat }`.

- **Spawn** at the knob's leading edge (`knobPx + KNOB_SIZE`, from
  `SafetyNumberScreen.tsx:164` / `:14`) plus small random jitter, in a
  rightward-and-upward **cone**: `vx` biased positive (direction of travel),
  `vy` an upward kick (≈ −3 to −6 px/frame), both randomized for a natural
  fan.
- **Physics per frame:** `x += vx; y += vy; vy += GRAVITY; vx *= DRAG;
  life--`. Gravity (≈ +0.35 px/frame) arcs them back down; drag (≈ ×0.96)
  bleeds horizontal speed; `maxLife` ≈ 350–700ms so they're short and snappy.
- **Fade.** Alpha and `size` scale with `life / maxLife`, so embers shrink and
  dim as they die. Fast embers (high speed this frame) are drawn as a short
  **streak** (a line from previous→current position) instead of a dot, for
  motion blur that sells speed.

## 4. Color model — embers born from the trail

Ember color is sampled from the **exact** trail gradient the track already
paints (`.confirm-key__fill`, `SafetyNumberScreen.css:162-185`):
`#FF6B6B → #FFC46E → #7ED9B7 → #8FA6FF → #C48FFF`. A pure
`sampleTrailColor(fraction)` (Section 6) interpolates those five stops.

- Each ember's `hue` is sampled at its **birth fraction** — the knob's current
  position along the track (≈ `progress`) — so a spark born at 70% is
  periwinkle because that's the trail color directly beneath it. The embers
  look literally flung off the rainbow rather than pasted on.
- `heat = velocityFactor` blends the ember's core toward white: a fast drag
  throws white-hot sparks, a slow one throws cooler embers the color of the
  rail. Combined with additive blending, dense fast bursts read as bright and
  hot, sparse slow ones as soft and colored.

Because the screen renders a single fixed palette (theme-independent, per the
`HandshakeJourney` context), this one gradient is all that's needed — there is
no Apple/Pulse spark variant to build.

## 5. The seal burst

The `SealSparks` loop keeps a local `wasSealed` flag and watches `sealedRef`
(already mirrored in `SafetyNumberScreen.tsx:50-52`, extended to be passed
down). The frame `sealedRef` flips true, it fires a one-shot **burst**:

- **~70 embers, radial** (360°, not just rightward), higher initial speed
  (≈ 4–9 px/frame) and slightly longer life, colors sampled across the **full**
  0→1 spectrum for a rainbow pop rather than a single hue.
- Simultaneously, a **one-shot light sweep** runs across the fill, reusing the
  existing `sheen` keyframe (`styles/keyframes.css:6`) played once — the same
  "reuse `sheen` as a one-shot arrival flourish" trick the chat-polish work
  already established for Iris bubbles.
- The burst plays out over the 950ms `OPENING_HOLD_MS` window, showering over
  the "Channel sealed" box before `onVerified` swaps in the chat screen. If
  the component unmounts first, cleanup (Section 9) cancels the loop cleanly.

The burst fires on **any** seal path, including keyboard (Section 7), so the
payoff is never gesture-only.

## 6. Component structure & integration

Three layers, matching this codebase's convention of splitting pure logic from
DOM/canvas wiring (`readAckDecision.ts` / `crossfadeState.ts` / `barPhases.ts`
are all pure-and-tested next to their imperative callers):

**`screens/sparkModel.ts` (new, pure, tested).** The deterministic tunables
and math only — no canvas, no DOM, no randomness:

```ts
export const TRAIL_STOPS = [[255,107,107],[255,196,110],[126,217,183],
  [143,166,255],[196,143,255]] as const;   // == .confirm-key__fill stops
export const MAX_PARTICLES = 160;
export const EMIT_BASE = 6;     // embers/frame at full intensity
export const V_MAX = 1.2;       // px/ms drag speed → full intensity

export function sampleTrailColor(fraction: number): { r: number; g: number; b: number };
export function sparkCountForFrame(input: {
  velocity: number; progress: number; poolSize: number;
}): number;
```

**`components/SealSparks.tsx` + `.css` (new, imperative canvas).** Owns the
canvas element, the particle pool, the single rAF loop, DPR/resize handling,
and reduced-motion gating. It reads live state through **refs passed as
props** — the identical pattern the shake loop already uses
(`SafetyNumberScreen.tsx:72-83`):

```tsx
<SealSparks
  progressRef={progressRef}
  holdingRef={holdingRef}
  sealedRef={sealedRef}
  velocityRef={velocityRef}   // new
  reduced={reduced.current}
/>
```

The loop each frame: decay `velocityRef`; if `!reduced` and rightward, spawn
`sparkCountForFrame(...)` embers (color via `sampleTrailColor` at the knob
fraction); detect the `sealedRef` rising edge → burst; integrate + cull the
pool; clear and redraw. It **self-parks** — when the pool empties and the knob
is idle (`!holdingRef.current`, velocity ≈ 0, not sealed), it cancels its own
rAF and restarts on the next `pointerdown`/drag — mirroring `tickShake`'s
start/stop gating (`SafetyNumberScreen.tsx:66-83`).

**`SafetyNumberScreen.tsx` changes (small).**
- Add `velocityRef` and `lastMoveRef`; add the `sealedRef` to the props passed
  to `SealSparks` (it already exists at `:50-52`).
- In `handlePointerMove` (`:106-115`): compute + EMA-smooth velocity into
  `velocityRef`, update `lastMoveRef`. (Progress/threshold logic unchanged.)
- In `handleKeyDown` (`:126-142`): `ArrowRight` sets `velocityRef` to a small
  synthetic impulse (≈ 0.6) so the loop naturally emits a puff for that step,
  then it decays; `ArrowLeft` leaves it 0 (no leftward sparks). Enter/Space is
  unchanged — it seals, and the burst follows from the `sealedRef` edge.
- Render `<SealSparks .../>` inside `.confirm-key__seal`, outside the phase
  conditional.
- Extend the existing cleanup `useEffect` (`:54-59`) — `SealSparks` cancels its
  own rAF on unmount, so nothing new is needed in the parent beyond passing
  stable refs.

## 7. Keyboard & accessibility parity

The slider is already keyboard-operable (`role="slider"`, arrow keys, Enter,
`SafetyNumberScreen.tsx:248-254`, `:126-142`) and that is untouched. Parity for
sparks: `ArrowRight` emits a puff via the synthetic velocity impulse (Section
6); `Enter`/`Space`/`ArrowRight`-to-100% all reach `seal()`, so the burst
fires on every seal path, not just pointer drags. ARIA attributes and the
label are unchanged — the canvas is `aria-hidden` decoration.

## 8. Reduced motion

Under `prefers-reduced-motion: reduce`, `SealSparks` emits **no** embers and
**no** burst — the loop never spawns. This matches how the shake already
degrades (`shakeTransform()` returns `"none"`, `SafetyNumberScreen.tsx:156`)
and the screen's existing reduced-motion CSS block
(`SafetyNumberScreen.css:368-374`). To keep the gesture from feeling dead, the
knob instead gets a soft static periwinkle glow (a CSS `box-shadow` bloom that
strengthens with progress via the inline style already driving the knob), so
there is still "you're getting close" feedback without motion. `SealSparks`
receives `reduced` as a prop (computed once from the existing `reduced` ref,
`:44`) rather than re-querying `matchMedia`.

## 9. Performance & guardrails

- **One canvas, one rAF, zero per-spark DOM** — the whole effect is a single
  compositor-friendly element.
- **Hard cap** `MAX_PARTICLES = 160`; `sparkCountForFrame` never returns more
  than the remaining headroom, so a frantic drag can't unbounded-spawn.
- **Self-parking loop** (Section 6) means no rAF runs while the screen is idle
  — it only spins during active dragging and the post-seal burst decay.
- **DPR + resize**: backing store re-measured on `pointerdown` and window
  `resize`; the responsive track (`width: min(680px, 90vw)`) stays crisp.
- **Cleanup**: the loop is cancelled on unmount (the component swaps out ~950ms
  after seal), so no leaked frames after `onVerified`.

## 10. Error handling & edge cases

- **Canvas 2D unavailable** (`getContext("2d")` returns null) — `SealSparks`
  no-ops entirely; the slider works exactly as it does today, sparkless. Same
  defensive posture as the rest of the app's optional-visual code.
- **Resize mid-drag** — the pool is in canvas pixel space; a resize re-measures
  the backing store, and any in-flight embers simply finish their short life in
  the new frame. Acceptable, momentary, and unlikely mid-gesture.
- **Cancel drag (release before threshold)** — progress resets to 0
  (`:122-124`), velocity decays, the loop drains its pool and parks. No burst
  (sealed never flips).
- **Mismatch path** (`goMismatch`, `:143-148`) — never seals, emits nothing
  new; the canvas is present but idle.
- **Tab blurred mid-drag** — rAF throttles/pauses per the browser; embers
  resume or expire harmlessly on return. No state to reconcile.

## Testing

- **`sparkModel.ts` (pure) — unit tests**, the same way `advanceStatus` /
  `percentAt` / `barVisual` are tested in isolation:
  - `sparkCountForFrame`: returns 0 for zero/leftward velocity; scales with
    velocity and progress; never exceeds `MAX_PARTICLES - poolSize`; returns 0
    when the pool is full.
  - `sampleTrailColor`: endpoints (`0` → red `#FF6B6B`, `1` → violet
    `#C48FFF`), the midpoint (`0.5` → green `#7ED9B7`), and clamping outside
    `[0,1]`.
- **Canvas rendering, burst, streaks, reduced-motion fallback** — visual, no
  unit tests, matching the project's standing convention (no jsdom/RTL setup;
  CSS/canvas work is verified manually and via the scratch two-browser
  Playwright pattern used for every prior visual feature). Verify: embers spray
  on rightward drag and stop when the knob is held still or dragged back;
  intensity rises toward the threshold; the seal burst fires over the "Channel
  sealed" box; keyboard `ArrowRight`/`Enter` produce puffs/burst; and with
  `prefers-reduced-motion` forced on, no embers spawn while the knob still
  shows its static glow — all with zero console errors.

## Deferred (not in this pass)

- **Audio / haptic feedback** on seal (a click or a short vibration) — the app
  has no sound design elsewhere; out of scope here.
- **Per-theme spark palettes** — not needed while this screen is
  theme-independent (single Iris-Glass palette). If the safety-number screen
  ever gains Apple/Pulse styling, the ember palette would branch off
  `data-theme` the way chat bubbles already do; noted only so a future themer
  knows where it would hook in.
- **A true "sparks trailing the knob's whole path"** ribbon or richer fluid
  simulation — the leading-edge ember model ships instead; heavier physics is a
  later polish item, not warranted for one confirmation gesture.
