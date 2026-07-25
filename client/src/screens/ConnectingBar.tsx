import { useEffect, useRef, useState } from "react";
import {
  barHeightPx,
  barVisual,
  COMPLETE_MS,
  SETTLE_MS,
  SURGE_MS,
  type BarPhase,
  type BarVariant,
} from "./barPhases";
import "./ConnectingBar.css";

export type ConnectStatus = "idle" | "connecting" | "connected";

interface ConnectingBarProps {
  status: ConnectStatus;
  variant?: BarVariant;
}

/**
 * The grassy-green "connecting / waking the relay" bar from the home handoff.
 * It's driven by the real connection lifecycle via `status` (App owns the
 * completion signal): it surges then holds "alive" while the relay wakes, and
 * only snaps to 100% when `status` flips to "connected". The alive motion
 * (sheen + breathing glow) is a layer separate from the fill %, so even a ~60s
 * cold start never looks frozen. See connectingBar.ts for the phase timings.
 */
export function ConnectingBar({ status, variant = "thin" }: ConnectingBarProps) {
  const [phase, setPhase] = useState<BarPhase>("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    };
    const after = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    clear();
    if (status === "connecting") {
      setPhase("surge");
      // Once the fast surge lands, hold "alive" near the top until the real event.
      after(SURGE_MS + 50, () => setPhase((p) => (p === "surge" ? "hold" : p)));
    } else if (status === "connected") {
      setPhase("complete");
      after(COMPLETE_MS, () => setPhase("settle"));
      after(COMPLETE_MS + SETTLE_MS, () => setPhase("exit"));
    } else {
      setPhase("idle");
    }
    return clear;
  }, [status]);

  const v = barVisual(phase);
  const busy = status !== "idle";
  const height = barHeightPx(variant);

  const fillClass = [
    "connecting-bar__fill",
    v.breathe ? "connecting-bar__fill--breathe" : "",
    v.settle ? "connecting-bar__fill--settle" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="connecting-bar"
      // Fades in on tap, fades out on exit (opacity transition lives in the CSS).
      style={{ opacity: busy && phase !== "exit" ? 1 : 0 }}
      aria-hidden={!busy}
    >
      <div className="connecting-bar__track" style={{ height }}>
        <div
          className={fillClass}
          style={{ width: `${v.widthPct}%`, transition: `width ${v.transitionMs}ms ${v.easing}` }}
        >
          {v.sheen && <span className="connecting-bar__sheen" />}
        </div>
      </div>
    </div>
  );
}
