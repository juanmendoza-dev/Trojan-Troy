import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { FLAG_ICONS } from "../assets/flags";
import { setHovered, tick, type RotationState } from "./rotatingTaglineState";
import { TAGLINE_LANGS } from "./taglineLangs";
import "./RotatingTagline.css";

const CYCLE_MS = 3000;

interface RotatingTaglineProps {
  className?: string;
}

// Cycles the home-screen tagline through translations (Motion 4: blur
// focus-pull, from the disposable tagline-preview.html). The rotating line
// is aria-hidden so screen readers aren't re-announced every 3s; a visually
// hidden English line stands in as the static fallback for assistive tech.
// Hovering pauses the rotation and shows the language name + flag in a
// cursor-following tooltip (same portaled-tooltip idiom as DataMonitor).
export function RotatingTagline({ className }: RotatingTaglineProps) {
  const [state, setState] = useState<RotationState>({ index: 0, hovered: false });
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setState((s) => tick(s)), CYCLE_MS);
    return () => window.clearInterval(id);
  }, []);

  const lang = TAGLINE_LANGS[state.index];

  const showTip = () => {
    setState((s) => setHovered(s, true));
    tip.current?.classList.add("is-visible");
  };
  const moveTip = (event: ReactMouseEvent<HTMLParagraphElement>) => {
    const t = tip.current;
    if (t) {
      t.style.left = `${event.clientX}px`;
      t.style.top = `${event.clientY}px`;
    }
  };
  const hideTip = () => {
    setState((s) => setHovered(s, false));
    tip.current?.classList.remove("is-visible");
  };

  return (
    <p
      className={`rotating-tagline${className ? ` ${className}` : ""}`}
      onMouseEnter={showTip}
      onMouseMove={moveTip}
      onMouseLeave={hideTip}
    >
      <span className="rotating-tagline__sr-only">{TAGLINE_LANGS[0].text}</span>
      <span
        key={state.index}
        className="rotating-tagline__line"
        dir={lang.rtl ? "rtl" : "ltr"}
        aria-hidden="true"
      >
        {lang.text}
      </span>
      {createPortal(
        <div ref={tip} className="rotating-tagline__tip" aria-hidden="true">
          <img className="rotating-tagline__tip-flag" src={FLAG_ICONS[lang.flagCode]} alt="" />
          <span>{lang.name}</span>
          {lang.native !== lang.name && (
            <span className="rotating-tagline__tip-native">{lang.native}</span>
          )}
        </div>,
        document.body
      )}
    </p>
  );
}
