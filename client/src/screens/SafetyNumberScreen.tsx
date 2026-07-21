import { useEffect, useRef, useState } from "react";
import "./SafetyNumberScreen.css";

interface SafetyNumberScreenProps {
  roomCode: string;
  safetyNumber: string;
  onVerified: () => void;
}

const TICKER_TEXT =
  "END-TO-END ENCRYPTED · ZERO KNOWLEDGE RELAY · KEYS STAY ON DEVICE · NO ACCOUNTS · NO METADATA · ";
const SEAL_THRESHOLD = 0.97;
const OPENING_HOLD_MS = 900;

type Phase = "verify" | "sealed" | "mismatch";

// "Confirm Key" — compare the shared safety number, then drag to seal the
// channel. Ported from ui/Confirm Key.html into the Iris Glass language.
export function SafetyNumberScreen({ roomCode, safetyNumber, onVerified }: SafetyNumberScreenProps) {
  const groups = safetyNumber.trim().split(/\s+/).filter(Boolean);
  const [phase, setPhase] = useState<Phase>("verify");
  const [progress, setProgress] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const holdingRef = useRef(false);
  const sealTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (sealTimerRef.current !== null) window.clearTimeout(sealTimerRef.current);
    };
  }, []);

  function seal() {
    holdingRef.current = false;
    setProgress(1);
    setPhase("sealed");
    sealTimerRef.current = window.setTimeout(onVerified, OPENING_HOLD_MS);
  }

  function updateFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const clamped = Math.min(1, Math.max(0, ratio));
    if (clamped >= SEAL_THRESHOLD) seal();
    else setProgress(clamped);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (phase !== "verify") return;
    holdingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  }
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!holdingRef.current || phase !== "verify") return;
    updateFromClientX(event.clientX);
  }
  function handlePointerUp() {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    if (phase === "verify") setProgress(0); // snap back if not sealed
  }
  function handleKeyDown(event: React.KeyboardEvent) {
    if (phase !== "verify") return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      seal();
    } else if (event.key === "ArrowRight") {
      setProgress((p) => Math.min(1, p + 0.15));
    } else if (event.key === "ArrowLeft") {
      setProgress((p) => Math.max(0, p - 0.15));
    }
  }

  const statusLabel =
    phase === "sealed"
      ? "CHANNEL SEALED"
      : phase === "mismatch"
        ? "NUMBERS DON'T MATCH"
        : "VERIFY IDENTITY";

  return (
    <div className="confirm-key" data-phase={phase}>
      <div className="confirm-key__top">
        <div className="confirm-key__status">
          <span className="confirm-key__status-dot" />
          {statusLabel}
        </div>
        <div className="confirm-key__room">Room {roomCode}</div>
      </div>

      <div className="confirm-key__center">
        <h1 className="confirm-key__title">Your shared safety number</h1>
        <p className="confirm-key__subtitle">
          Derived from both keys — it should match theirs exactly.
        </p>

        <div className="confirm-key__grid" aria-label={`Safety number ${safetyNumber}`}>
          {groups.map((group, index) => (
            <span key={index} className="confirm-key__group">
              {group}
            </span>
          ))}
        </div>

        {phase === "mismatch" ? (
          <div className="confirm-key__warning" role="alert">
            <div className="confirm-key__warning-title">Don't share anything sensitive</div>
            <p className="confirm-key__warning-body">
              Rejoin the room to generate fresh keys, then compare again.
            </p>
            <button
              type="button"
              className="confirm-key__back"
              onClick={() => {
                setProgress(0);
                setPhase("verify");
              }}
            >
              ← I mistyped, compare again
            </button>
          </div>
        ) : (
          <>
            <div
              ref={trackRef}
              className="confirm-key__slider"
              data-sealed={phase === "sealed" || undefined}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <div className="confirm-key__slider-fill" style={{ width: `${progress * 100}%` }} />
              <span className="confirm-key__slider-label">
                {phase === "sealed" ? "Channel sealed" : "Drag to seal the channel"}
              </span>
              <button
                type="button"
                className="confirm-key__knob"
                style={{ left: `calc(${progress} * (100% - var(--knob-size)))` }}
                onKeyDown={handleKeyDown}
                aria-label="Slide to confirm the safety number matches, then seal the channel"
              >
                {phase === "sealed" ? "✓" : "→"}
              </button>
            </div>

            {phase === "sealed" ? (
              <div className="confirm-key__opening">Opening the room…</div>
            ) : (
              <button
                type="button"
                className="confirm-key__mismatch-link"
                onClick={() => setPhase("mismatch")}
              >
                the numbers don't match →
              </button>
            )}
          </>
        )}

        <div className="confirm-key__reassurance">This number never leaves your device.</div>
      </div>

      <div className="confirm-key__marquee" aria-hidden="true">
        <div className="confirm-key__marquee-track">
          <span>{TICKER_TEXT.repeat(2)}</span>
          <span>{TICKER_TEXT.repeat(2)}</span>
        </div>
      </div>
    </div>
  );
}
