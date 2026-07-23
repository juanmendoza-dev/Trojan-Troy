import { useEffect, useRef } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*<>/\\{}[]";

interface ScrambleTextProps {
  text: string;
  className?: string;
  /** ms per frame */
  frameMs?: number;
  /** frames to fully reveal left-to-right, then frames to hold before repeating */
  revealFrames?: number;
  holdFrames?: number;
}

// Continuously "decrypts" text: glyphs flicker and resolve left-to-right, hold,
// then re-scramble on a loop. Heights/chars are written straight to the DOM (no
// per-frame React render). Honors reduced-motion by rendering the plain text.
export function ScrambleText({
  text,
  className,
  frameMs = 45,
  revealFrames = 55,
  holdFrames = 34,
}: ScrambleTextProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = text;
      return;
    }
    let f = 0;
    const period = revealFrames + holdFrames;
    const draw = () => {
      const shown = Math.floor((f / revealFrames) * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") out += " ";
        else if (i < shown || f >= revealFrames) out += text[i];
        else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
    };
    draw();
    const id = window.setInterval(() => {
      f = (f + 1) % period;
      draw();
    }, frameMs);
    return () => window.clearInterval(id);
  }, [text, frameMs, revealFrames, holdFrames]);

  return <span ref={ref} className={className} aria-label={text} />;
}
