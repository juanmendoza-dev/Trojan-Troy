import { useMemo } from "react";
import "./CipherWord.css";

const CIPHER_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomChar(): string {
  return CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
}

function measureWidth(letter: string, font: string): number {
  const canvas = measureWidth.canvas ?? (measureWidth.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  return Math.ceil(ctx.measureText(letter).width);
}
measureWidth.canvas = undefined as HTMLCanvasElement | undefined;

interface CipherWordProps {
  text: string;
  fontSizePx: number;
  startDelayS: number;
  staggerS: number;
  windowHeightPx?: number;
}

export function CipherWord({ text, fontSizePx, startDelayS, staggerS, windowHeightPx = 132 }: CipherWordProps) {
  const font = `600 ${fontSizePx}px var(--font-display)`;
  const letters = useMemo(
    () =>
      text.split("").map((letter) => ({
        letter,
        width: measureWidth(letter, font),
        glyphs: [randomChar(), randomChar(), randomChar(), letter],
      })),
    [text, font]
  );

  return (
    <div className="cipher-word" style={{ height: windowHeightPx }}>
      {letters.map((column, index) => (
        <span
          key={index}
          className="cipher-word__column"
          style={{ width: column.width, height: windowHeightPx }}
        >
          <span
            className="cipher-word__reel"
            style={{
              animationDelay: `${startDelayS + index * staggerS}s`,
              height: windowHeightPx * column.glyphs.length,
            }}
          >
            {column.glyphs.map((glyph, glyphIndex) => (
              <span key={glyphIndex} className="cipher-word__glyph" style={{ height: windowHeightPx }}>
                {glyph}
              </span>
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}
