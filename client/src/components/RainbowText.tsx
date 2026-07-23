import { Fragment, type CSSProperties } from "react";
import "./RainbowText.css";

interface RainbowTextProps {
  text: string;
  className?: string;
  /** "always" runs on its own; "hover" only animates while hovered. */
  trigger?: "always" | "hover";
}

// Splits text into per-letter spans that cycle the app's spark-gradient palette
// in a staggered wave (letter by letter). Shared by the home badge's cipher tag
// and the chat sidebar footer. Spaces stay real breaking spaces so multi-word
// strings still wrap. Honors reduced-motion (see RainbowText.css).
export function RainbowText({ text, className, trigger = "always" }: RainbowTextProps) {
  return (
    <span className={`rainbow-text rainbow-text--${trigger}${className ? ` ${className}` : ""}`}>
      {[...text].map((ch, i) =>
        ch === " " ? (
          <Fragment key={i}>{" "}</Fragment>
        ) : (
          <span key={i} className="rainbow-text__char" style={{ "--i": i } as CSSProperties}>
            {ch}
          </span>
        )
      )}
    </span>
  );
}
