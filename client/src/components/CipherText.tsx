import { useEffect, useState } from "react";
import { lockedCharCount, CIPHER_REVEAL_MS } from "./cipherReveal";
import "./CipherText.css";

// Same alphabet as the loading screen's CipherWord, so the two effects feel
// like one family.
const CIPHER_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomChar(): string {
  return CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
}

// Scramble every not-yet-locked, non-whitespace character. Whitespace is kept
// so the scrambled text wraps at the same points as the final text.
function scramble(text: string, locked: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += i < locked || ch === " " || ch === "\n" || ch === "\t" ? ch : randomChar();
  }
  return out;
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
// left-to-right over `durationMs`, re-randomizing the unlocked tail each frame.
// A hidden copy of the final text reserves the real (wrapped) layout so the
// bubble never reflows while the cipher resolves.
export function CipherText({ text, durationMs = CIPHER_REVEAL_MS }: CipherTextProps) {
  const [locked, setLocked] = useState(() => (prefersReducedMotion() ? text.length : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setLocked(text.length);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const count = lockedCharCount(now - start, text.length, durationMs);
      setLocked(count);
      if (count < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, durationMs]);

  // Once fully resolved, drop the overlay scaffolding and render plain,
  // fully-accessible text at the exact same position.
  if (locked >= text.length) return <>{text}</>;

  return (
    <span className="cipher-text">
      <span className="cipher-text__sizer" aria-hidden="true">
        {text}
      </span>
      <span className="cipher-text__ink" aria-hidden="true">
        {scramble(text, locked)}
      </span>
      <span className="cipher-text__sr">{text}</span>
    </span>
  );
}
