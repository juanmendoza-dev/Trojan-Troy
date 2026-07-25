# UI design handoffs

External design-tool (Fable / Claude design) handoffs for Trojan Troy. Each
folder holds one handoff: an `.dc.html` you can open in a browser to see the
screens live (rendered by the sibling `support.js` runtime), plus any spec
notes. These are **reference/provenance only** — the shipped design is the
React implementation under `client/src/`, which is the source of truth.

- **`Trojan Troy Desktop Redesign/design_handoff_trojan_troy/`** — the original
  Phase 4 handoff: the kinetic-cipher loading screen and the three chat themes
  (Apple / Iris Glass / Pulse Slate). `README.md` has the tokens/copy/motion
  spec; `Trojan Troy Directions.dc.html` has the exact markup/CSS per screen.
- **`Trojan Troy Home Screen/`** — the Phase 4.6 home-screen handoff:
  `StartJoinScreen` plus the grassy-green connecting / relay-wake progress bar.
  `Trojan Troy Home.dc.html` includes the bar's states + a tokens/timings sheet.
