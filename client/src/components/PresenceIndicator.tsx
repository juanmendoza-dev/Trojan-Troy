import { useEffect, useRef, useState } from "react";
import type { PresenceState } from "../protocol/presenceState";
import "./PresenceIndicator.css";

// How long the bubble lingers (fading out) after presence returns to idle, so it
// reads as handing off to the arriving message rather than hard-cutting. Its
// timer is cleared on change/unmount, matching Crossfade/Composer.
const EXIT_MS = 180;

interface PresenceIndicatorProps {
  state: PresenceState;
}

// A transient incoming bubble showing the peer's live composition activity: a
// three-dot "typing…" or a mic + dots "recording audio…". Themed via the global
// [data-theme] attribute like every other surface; the orbs/gradient come from
// the chat screen, so this paints only the bubble.
export function PresenceIndicator({ state }: PresenceIndicatorProps) {
  const [rendered, setRendered] = useState(state !== "idle");
  const [exiting, setExiting] = useState(false);
  // Remember the last active kind so the bubble keeps its label/icon while it
  // fades out — by then `state` is already "idle".
  const activeKind = useRef<"typing" | "recording">("typing");
  const exitTimer = useRef<ReturnType<typeof setTimeout>>();

  if (state !== "idle") activeKind.current = state;

  useEffect(() => {
    if (state !== "idle") {
      clearTimeout(exitTimer.current);
      setExiting(false);
      setRendered(true);
      return;
    }
    if (!rendered) return;
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      setRendered(false);
      setExiting(false);
    }, EXIT_MS);
    return () => clearTimeout(exitTimer.current);
  }, [state, rendered]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  if (!rendered) return null;

  const kind = activeKind.current;
  const label = kind === "recording" ? "recording audio" : "typing";

  return (
    <div className="message-row message-row--incoming">
      <div
        className="presence-indicator"
        data-exiting={exiting || undefined}
        role="status"
        aria-label={`Your friend is ${label}`}
      >
        {kind === "recording" && (
          <svg
            className="presence-indicator__mic"
            width="12"
            height="16"
            viewBox="0 0 12 16"
            aria-hidden="true"
          >
            <rect x="4" y="1" width="4" height="8" rx="2" fill="currentColor" />
            <path d="M2 7 a4 4 0 0 0 8 0" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <line x1="6" y1="11" x2="6" y2="14.5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        )}
        <span className="presence-indicator__dots" aria-hidden="true">
          <span className="presence-indicator__dot" />
          <span className="presence-indicator__dot" />
          <span className="presence-indicator__dot" />
        </span>
      </div>
    </div>
  );
}
