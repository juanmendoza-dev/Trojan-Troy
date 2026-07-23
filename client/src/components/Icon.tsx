import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "settings"
  | "x"
  | "check"
  | "plus"
  | "mic"
  | "arrow-up"
  | "play"
  | "pause"
  | "chevron-left"
  | "eye"
  | "eye-off";

interface IconProps {
  name: IconName;
  /** Rendered pixel box (square). The art is authored on a 24×24 grid. */
  size?: number;
  /** Stroke weight in 24-grid units (ignored by the solid play/pause glyphs). */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

// Feather/Lucide-style line icons (MIT), matching the app's existing inline-SVG
// convention (fill:none, stroke:currentColor, round caps — see ErrorScreen /
// PresenceIndicator). Everything inherits `currentColor`, so an icon takes the
// color of whatever button or label it sits in. `play`/`pause` are the two
// solid glyphs; the rest are strokes.
export function Icon({ name, size = 18, strokeWidth = 2, className, style }: IconProps) {
  const solid = name === "play" || name === "pause";
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={solid ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph(name)}
    </svg>
  );
}

function glyph(name: IconName): ReactNode {
  switch (name) {
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </>
      );
    case "x":
      return <path d="M18 6 6 18M6 6l12 12" />;
    case "check":
      return <path d="M20 6 9 17l-5-5" />;
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "mic":
      return (
        <>
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
          <path d="M12 18v4M8 22h8" />
        </>
      );
    case "arrow-up":
      return <path d="M12 19V5M5 12l7-7 7 7" />;
    case "chevron-left":
      return <path d="M15 18l-6-6 6-6" />;
    case "eye":
      return (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case "eye-off":
      return (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <path d="M1 1 23 23" />
        </>
      );
    case "play":
      return <path d="M8 5v14l11-7z" />;
    case "pause":
      return <path d="M9 4h2.2v16H9zM12.8 4H15v16h-2.2z" />;
  }
}
