import { useEffect, useState } from "react";
import { CipherWord } from "./CipherWord";
import { percentAt } from "./percent";
import "./LoadingScreen.css";

interface LoadingScreenProps {
  roomCode: string;
  durationMs?: number;
}

const TICKER_TEXT =
  "END-TO-END ENCRYPTED · ZERO KNOWLEDGE RELAY · KEYS STAY ON DEVICE · NO ACCOUNTS · NO METADATA · ";
const WORDMARK_FONT_FAMILY = "'Schibsted Grotesk', sans-serif";

export function LoadingScreen({ roomCode, durationMs = 2600 }: LoadingScreenProps) {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let frame: number;
    function tick(now: number) {
      setPercent(percentAt(now - start, durationMs));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs]);

  return (
    <div className="loading-screen">
      <div className="loading-screen__top-row">
        <div className="loading-screen__status">
          <span className="loading-screen__status-dot" />
          ESTABLISHING SECURE CHANNEL
        </div>
        <div className="loading-screen__room-code">Room {roomCode}</div>
      </div>

      <div className="loading-screen__center">
        <div className="loading-screen__wordmark">
          <div className="loading-screen__wordmark-line">
            <CipherWord
              text="Trojan"
              fontSizePx={96}
              startDelayS={0.2}
              staggerS={0.08}
              fontFamily={WORDMARK_FONT_FAMILY}
            />
          </div>
          <div className="loading-screen__wordmark-line loading-screen__wordmark-line--second">
            <CipherWord
              text="Troy"
              fontSizePx={96}
              startDelayS={0.68}
              staggerS={0.08}
              fontFamily={WORDMARK_FONT_FAMILY}
            />
            <span className="loading-screen__period">.</span>
          </div>
        </div>

        <div className="loading-screen__checklist">
          <div className="loading-screen__row" style={{ animationDelay: "1.3s" }}>
            <span className="loading-screen__check" style={{ animationDelay: "1.6s" }}>
              ✓
            </span>
            <span>Keypair generated on this device</span>
          </div>
          <div className="loading-screen__row" style={{ animationDelay: "1.7s" }}>
            <span className="loading-screen__check" style={{ animationDelay: "2.2s" }}>
              ✓
            </span>
            <span>Keys exchanged through the relay</span>
          </div>
          <div className="loading-screen__row" style={{ animationDelay: "2.1s" }}>
            <span className="loading-screen__pending" />
            <span className="loading-screen__row-label--pending">Sealing the channel…</span>
          </div>
        </div>
      </div>

      <div className="loading-screen__bottom-row">
        <div className="loading-screen__reassurance">
          The relay only ever sees ciphertext. Your keys never leave this device.
        </div>
        <div className="loading-screen__percent">
          {percent}
          <span className="loading-screen__percent-suffix">%</span>
        </div>
      </div>

      <div className="loading-screen__marquee">
        <div className="loading-screen__marquee-track">
          <span>{TICKER_TEXT.repeat(2)}</span>
          <span>{TICKER_TEXT.repeat(2)}</span>
        </div>
      </div>

      <div className="loading-screen__progress-track">
        <div className="loading-screen__progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
