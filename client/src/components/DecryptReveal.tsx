import { useState, type AnimationEvent } from "react";
import "./DecryptReveal.css";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface DecryptRevealProps {
  text: string;
}

// Reveals an incoming message as if it were being decrypted: the text arrives
// blurred and dim, then a glowing edge sweeps left-to-right and brings it into
// sharp focus. The sweep is a fixed-duration CSS animation driven off the
// bubble's width (a mask on the sharp copy), so it reads identically for a
// two-letter "hi" and a full paragraph — there's no per-character scramble to
// fall apart on short messages, and because every glyph is the real one from the
// first frame, nothing wobbles and the bubble never reflows.
//
// A blurred copy sits in normal flow to reserve the real (wrapped) box; the
// sharp copy is overlaid and masked in on top; a screen-reader-only copy carries
// the real text while the two visual layers are aria-hidden. Once the sweep
// finishes we drop the scaffolding and render plain, fully accessible text at the
// exact same position.
export function DecryptReveal({ text }: DecryptRevealProps) {
  const [done, setDone] = useState(() => prefersReducedMotion() || text.length === 0);

  function handleAnimationEnd(event: AnimationEvent<HTMLSpanElement>) {
    if (event.animationName === "decryptWipe") setDone(true);
  }

  if (done) return <>{text}</>;

  return (
    <span className="decrypt-reveal">
      <span className="decrypt-reveal__base" aria-hidden="true">
        {text}
      </span>
      <span className="decrypt-reveal__sharp" aria-hidden="true" onAnimationEnd={handleAnimationEnd}>
        {text}
      </span>
      <span className="decrypt-reveal__edge" aria-hidden="true" />
      <span className="decrypt-reveal__sr">{text}</span>
    </span>
  );
}
