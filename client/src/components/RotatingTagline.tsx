import { useEffect, useState } from "react";
import { TAGLINE_LANGS, nextTaglineIndex } from "./taglineLangs";
import "./RotatingTagline.css";

const CYCLE_MS = 3000;

interface RotatingTaglineProps {
  className?: string;
}

// Cycles the home-screen tagline through translations (Motion 4: blur
// focus-pull, from the disposable tagline-preview.html). The rotating line
// is aria-hidden so screen readers aren't re-announced every 3s; a visually
// hidden English line stands in as the static fallback for assistive tech.
export function RotatingTagline({ className }: RotatingTaglineProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndex((i) => nextTaglineIndex(i)), CYCLE_MS);
    return () => window.clearInterval(id);
  }, []);

  const lang = TAGLINE_LANGS[index];

  return (
    <p className={`rotating-tagline${className ? ` ${className}` : ""}`}>
      <span className="rotating-tagline__sr-only">{TAGLINE_LANGS[0].text}</span>
      <span
        key={index}
        className="rotating-tagline__line"
        dir={lang.rtl ? "rtl" : "ltr"}
        aria-hidden="true"
      >
        {lang.text}
      </span>
    </p>
  );
}
