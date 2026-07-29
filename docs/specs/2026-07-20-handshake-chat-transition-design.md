# Continuous Handshake-to-Chat Transition Design

Today the app hard-cuts between the loading/handshake screen, the
safety-number screen, and the chat screen — three separate top-level
renders in `App.tsx` with no transition between them. This makes the
`floatOrb` ambient-orb backdrop (added in Phase 4.5) remount and reset each
time, and the swap between screens feels abrupt. This phase makes that
whole stretch — loading → safety-number → chat — read as one continuous
space with a persistent, never-resetting orb backdrop and a cross-fade
between each screen's foreground content, instead of a hard cut.

Builds on top of Phase 4.5's `AmbientOrbs` component and theme system
unchanged. Does not touch `StartJoinScreen` or `WaitingScreen` — those stay
out of scope, as before. Does not change the underlying screen state
machine or the safety-number verification step itself, only how the
transitions between the three screens are rendered.

## 1. `Crossfade` component (new, generic)

`client/src/components/Crossfade.tsx` + `.css`. A small reusable wrapper:
takes an `activeKey: string` and `children: ReactNode`. When `activeKey`
changes, it keeps rendering the previous children (stacked absolutely,
fading out via opacity + a small `translateY`) for a fixed duration while
the new children fade in on top, then unmounts the old one. Not specific
to this feature — it's a generic crossfade-on-key-change primitive that
could be reused elsewhere later, but only built now for this use.

The timing/state-machine logic is extracted into a pure hook,
`useCrossfade(activeKey: string, durationMs: number)`, returning
`{ current: string; exiting: string | null }` — kept separate from the
DOM/CSS so it can be unit-tested in isolation without rendering anything,
the same way `percent.ts` is tested independently of `LoadingScreen`.

Transition duration: **350ms**, opacity + `translateY(8px)` easing
(`cubic-bezier(0.2, 0.9, 0.3, 1)`, already used elsewhere in
`LoadingScreen.css` for consistency).

## 2. `HandshakeJourney` wrapper (new)

`client/src/screens/HandshakeJourney.tsx` + `.css`. Wraps the three
screens that make up the paired session: `handshake` (loading), 
`safety-number`, and `chat`. Owns exactly one `<AmbientOrbs />`, mounted
once for the lifetime of this wrapper, and wraps a `<Crossfade>` around
whichever screen's foreground content is currently active.

```tsx
<div className="handshake-journey">
  <AmbientOrbs />
  <Crossfade activeKey={screen.name}>
    {/* current screen's foreground content */}
  </Crossfade>
</div>
```

`App.tsx`'s `Screen` union and its `handshake` → `safety-number` → `chat`
transition logic are unchanged. Only the render layer changes: instead of
three separate early `return`s for these three screen names, `App.tsx`
renders one `<HandshakeJourney>` covering all three, passing the current
screen's content in as children keyed by `screen.name`.

## 3. Screen background changes

- `LoadingScreen` and `ChatScreen` drop their own internal
  `<AmbientOrbs />` render (now supplied once by `HandshakeJourney`) and
  change their background from opaque to transparent, so the shared orb
  layer behind them shows through.
- `SafetyNumberScreen` gets a new `.css` file adding a transparent
  background wrapper only. Its existing unstyled markup, copy, and
  "Verified" button stay exactly as they are today — no redesign, per the
  Phase 4 scope cut that left this screen unstyled.

## 4. Orb visibility rule across the journey

Loading and safety-number both always show the orbs, matching loading's
existing theme-independence (it's hardcoded Iris Glass styling regardless
of the user's selected chat theme, per the Phase 4.5 decision). Once
`chat` becomes the active screen, chat's own CSS continues to apply its
existing Iris-only rule (`:root[data-theme="iris"] .chat-screen
.ambient-orbs__orb { display: block }`, orbs hidden otherwise) — this
phase does not change that rule.

Net effect: Iris Glass users (the default for new visitors since Phase
4.5) get one unbroken orb backdrop across all three screens. Users who've
switched to Apple or Pulse Slate in Settings will see the orbs fade out as
the chat screen's foreground fades in — an accepted, known discontinuity
for that case, not something this phase tries to solve. Still strictly
smoother than today's hard cut for every theme.

## 5. Error handling

If `screen.name` becomes `"error"` (peer disconnect, key-exchange failure)
while inside the journey, `HandshakeJourney` unmounts entirely and
`App.tsx` falls back to its existing plain error view, unchanged. No
crossfade applies there — an error interruption is deliberately abrupt,
not part of the smooth path this phase is building.

## Testing

- `useCrossfade`: unit tests with fake timers (same pattern as
  `percent.test.ts`) — verify it reports the correct `current`/`exiting`
  pair across a sequence of key changes, and that pending timers are
  cleaned up on unmount so no state updates leak after unmount.
- No new unit tests for `Crossfade`'s CSS or `HandshakeJourney`'s visual
  behavior — matches the project's existing convention of manual/
  Playwright verification for visual work, not unit tests for CSS.
- Manual verification: extend the scratch-Playwright pattern already used
  for Phase 4/4.5 — confirm the `AmbientOrbs` DOM node is never remounted
  (same node reference) across a full loading → safety-number → chat
  transition, and run the real two-browser paired flow end to end with
  zero console errors, in both the Iris Glass default and after manually
  switching to Apple/Pulse Slate beforehand (to confirm the accepted
  discontinuity case looks acceptable rather than broken).
