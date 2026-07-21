import { useEffect, useRef, useState } from "react";
import {
  cipherRevealDuration,
  lockedCharCount,
  CIPHER_SCRAMBLE_INTERVAL_MS,
} from "./cipherReveal";
import "./CipherText.css";

// Same alphabet as the loading screen's CipherWord, so the two effects feel
// like one family.
const CIPHER_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomChar(): string {
  return CIPHER_CHARS[(Math.random() * CIPHER_CHARS.length) | 0];
}

// Whitespace is never scrambled, so the cipher wraps at the same points as the
// final text and the layout never shifts.
function isFixed(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface CipherTextProps {
  text: string;
  durationMs?: number;
}

// Renders `text` as if it were decrypting: starts fully scrambled and locks in
// left-to-right, re-randomizing the unlocked tail on a throttled cadence. A
// hidden copy of the final text reserves the real (wrapped) layout so the bubble
// never reflows.
//
// The animation is driven imperatively: React renders the scaffold exactly once,
// then the loop writes straight to the ink node's textContent — no per-frame
// re-render, and the DOM is only touched when the lock front advances or the
// tail re-scrambles. This keeps a long reveal perfectly smooth even with several
// bubbles resolving at once.
export function CipherText({ text, durationMs }: CipherTextProps) {
  const [done, setDone] = useState(() => prefersReducedMotion() || text.length === 0);
  const inkRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (prefersReducedMotion() || text.length === 0) {
      setDone(true);
      return;
    }

    const chars = Array.from(text);
    const total = chars.length;
    const duration = durationMs ?? cipherRevealDuration(total);
    // The scrambled tail; only refreshed on the throttled cadence below.
    const scrambled = chars.map((ch) => (isFixed(ch) ? ch : randomChar()));

    const paint = (locked: number) => {
      const node = inkRef.current;
      if (!node) return;
      let out = "";
      for (let i = 0; i < total; i++) out += i < locked ? chars[i] : scrambled[i];
      node.textContent = out;
    };

    let raf = 0;
    let lastScramble = -Infinity;
    let lastLocked = -1;
    const start = performance.now();

    const tick = (now: number) => {
      const locked = lockedCharCount(now - start, total, duration);
      const refresh = now - lastScramble >= CIPHER_SCRAMBLE_INTERVAL_MS;
      if (refresh) {
        for (let i = locked; i < total; i++) {
          if (!isFixed(chars[i])) scrambled[i] = randomChar();
        }
        lastScramble = now;
      }
      // Only write to the DOM when something actually changed this frame.
      if (refresh || locked !== lastLocked) {
        paint(locked);
        lastLocked = locked;
      }
      if (locked >= total) {
        paint(total); // ensure the final frame is fully resolved before handoff
        setDone(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    paint(0); // show the fully-scrambled first frame immediately
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, durationMs]);

  // Once resolved, drop the overlay scaffolding and render plain, fully
  // accessible text at the exact same position.
  if (done) return <>{text}</>;

  return (
    <span className="cipher-text">
      <span className="cipher-text__sizer" aria-hidden="true">
        {text}
      </span>
      <span ref={inkRef} className="cipher-text__ink" aria-hidden="true" />
      <span className="cipher-text__sr">{text}</span>
    </span>
  );
}
