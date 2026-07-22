import { useEffect, useRef, useState } from "react";
import "./SafetyNumberScreen.css";

interface SafetyNumberScreenProps {
  roomCode: string;
  safetyNumber: string;
  onVerified: () => void;
  onMismatch: () => void;
}

const TICKER_TEXT = "END-TO-END ENCRYPTED · ZERO KNOWLEDGE RELAY · KEYS STAY ON DEVICE · ";
const SEAL_THRESHOLD = 0.92;
const SHAKE_FROM = 0.6;
const OPENING_HOLD_MS = 950;
const KNOB_SIZE = 44;

type Phase = "verify" | "sealed" | "mismatch";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// "Confirm Key" — compare the shared safety number, then drag the knob to seal
// the channel. Ported 1:1 from ui/Confirm Key.html into React (orbs + gradient
// backdrop come from HandshakeJourney, so this paints only the foreground).
export function SafetyNumberScreen({ roomCode, safetyNumber, onVerified, onMismatch }: SafetyNumberScreenProps) {
  const groups = safetyNumber.trim().split(/\s+/).filter(Boolean);

  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [, forceShakeFrame] = useState(0);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragX0 = useRef(0);
  const dragP0 = useRef(0);
  const rangeRef = useRef(500);
  const shakeRaf = useRef<number | null>(null);
  const sealTimer = useRef<number | null>(null);
  const reduced = useRef(prefersReducedMotion());

  // Mirror reactive state into refs so the rAF shake loop reads live values.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const holdingRef = useRef(holding);
  holdingRef.current = holding;
  const sealedRef = useRef(sealed);
  sealedRef.current = sealed;

  useEffect(() => {
    return () => {
      if (shakeRaf.current !== null) cancelAnimationFrame(shakeRaf.current);
      if (sealTimer.current !== null) window.clearTimeout(sealTimer.current);
    };
  }, []);

  function measureRange(): number {
    const el = trackRef.current;
    return el ? el.clientWidth - KNOB_SIZE - 10 : 500;
  }

  function stopShake() {
    if (shakeRaf.current !== null) {
      cancelAnimationFrame(shakeRaf.current);
      shakeRaf.current = null;
    }
  }
  function tickShake() {
    if (shakeRaf.current !== null) return;
    const loop = () => {
      if (!holdingRef.current || sealedRef.current || progressRef.current <= SHAKE_FROM) {
        stopShake();
        return;
      }
      forceShakeFrame((n) => n + 1);
      shakeRaf.current = requestAnimationFrame(loop);
    };
    shakeRaf.current = requestAnimationFrame(loop);
  }

  function seal() {
    stopShake();
    setSealed(true);
    setHolding(false);
    setProgress(1);
    sealTimer.current = window.setTimeout(onVerified, OPENING_HOLD_MS);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (sealed || mismatch) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* setPointerCapture can throw if the pointer is already gone */
    }
    dragX0.current = event.clientX;
    dragP0.current = progress;
    rangeRef.current = measureRange();
    setHolding(true);
  }
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!holding || sealed) return;
    const next = Math.max(
      0,
      Math.min(1, dragP0.current + (event.clientX - dragX0.current) / rangeRef.current)
    );
    setProgress(next);
    if (next > SHAKE_FROM && !reduced.current) tickShake();
    else stopShake();
  }
  function handlePointerUp() {
    stopShake();
    if (sealed || !holding) return;
    if (progress >= SEAL_THRESHOLD) {
      seal();
      return;
    }
    setHolding(false);
    setProgress(0);
  }
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      seal();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = Math.max(0, Math.min(1, progress + (event.key === "ArrowRight" ? 0.1 : -0.1)));
      if (next >= 1) {
        seal();
        return;
      }
      setProgress(next);
      setHolding(false);
    }
  }
  function goMismatch() {
    stopShake();
    setHolding(false);
    setProgress(0);
    setMismatch(true);
  }
  function backToVerify() {
    setMismatch(false);
    setProgress(0);
    setHolding(false);
  }

  function shakeTransform(): string {
    if (!holding || sealed || progress <= SHAKE_FROM || reduced.current) return "none";
    const amp = ((progress - SHAKE_FROM) / 0.4) * 3; // up to ~3px near the finish
    const t = performance.now() / 1000;
    const x = Math.sin(t * 47) * amp;
    const y = Math.cos(t * 53) * amp * 0.6;
    return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  }

  const knobPx = progress * rangeRef.current;
  const fillWidth = `${knobPx + 27}px`;
  const fillTransition = holding ? "none" : "all .6s cubic-bezier(0.22,1,0.36,1)";
  const knobTransition = holding ? "none" : "transform .6s cubic-bezier(0.22,1,0.36,1)";
  const trailOpacity = sealed ? 0 : 1;
  const labelOpacity = Math.max(0, 1 - progress * 2);
  const phase: Phase = sealed ? "sealed" : mismatch ? "mismatch" : "verify";

  return (
    <div className="confirm-key" style={{ transform: shakeTransform() }}>
      <div className="confirm-key__top">
        <div className="confirm-key__status" data-phase={phase}>
          {phase === "verify" && (
            <>
              <span className="confirm-key__dot" />
              <span>VERIFY IDENTITY</span>
            </>
          )}
          {phase === "sealed" && (
            <>
              <span>✓</span>
              <span>CHANNEL SEALED</span>
            </>
          )}
          {phase === "mismatch" && (
            <>
              <span>⚠</span>
              <span>NUMBERS DON'T MATCH</span>
            </>
          )}
        </div>
        <div className="confirm-key__room">Room {roomCode}</div>
      </div>

      <div className="confirm-key__center">
        <h1 className="confirm-key__title">Your shared safety number</h1>
        <p className="confirm-key__subtitle">
          Derived from both keys — it should match theirs exactly.
        </p>

        <div className="confirm-key__card">
          <svg
            className="confirm-key__shield"
            width="26"
            height="30"
            viewBox="0 0 24 28"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 2 L21 6 V13 C21 19.5 17 24.5 12 26 C7 24.5 3 19.5 3 13 V6 Z"
              stroke="#8FA6FF"
              strokeWidth="1.6"
              strokeLinejoin="round"
              fill="rgba(143,166,255,0.08)"
            />
            <path
              d="M8.5 13.5 L11 16 L15.5 10.5"
              stroke="#8FA6FF"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <div className="confirm-key__grid">
            {groups.map((group, index) => (
              <span
                key={index}
                className="confirm-key__group"
                style={{ animationDelay: `${0.55 + index * 0.06}s` }}
              >
                {group}
              </span>
            ))}
          </div>
        </div>

        <div className="confirm-key__seal">
          {phase === "verify" && (
            <>
              <div
                ref={trackRef}
                className="confirm-key__track"
                role="slider"
                tabIndex={0}
                aria-label="Drag right to seal the channel, or press Enter to confirm"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                onKeyDown={handleKeyDown}
              >
                <div
                  className="confirm-key__fill confirm-key__fill--base"
                  style={{ width: fillWidth, opacity: trailOpacity, transition: fillTransition }}
                />
                <div
                  className="confirm-key__fill confirm-key__fill--glow"
                  style={{ width: fillWidth, opacity: trailOpacity, transition: fillTransition }}
                />
                <div
                  className="confirm-key__track-label"
                  style={{ opacity: labelOpacity, transition: fillTransition }}
                >
                  Drag to seal the channel
                </div>
                <div
                  className="confirm-key__knob"
                  style={{ transform: `translateX(${knobPx}px)`, transition: knobTransition }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  <span className="confirm-key__knob-arrow">⟶</span>
                </div>
              </div>
              <button type="button" className="confirm-key__mismatch-link" onClick={goMismatch}>
                the numbers don't match →
              </button>
            </>
          )}

          {phase === "sealed" && (
            <>
              <div className="confirm-key__sealed-box">
                <span>✓</span>
                <span>Channel sealed</span>
              </div>
              <span className="confirm-key__opening">Opening the room…</span>
            </>
          )}

          {phase === "mismatch" && (
            <>
              <div className="confirm-key__warning" role="alert">
                <div className="confirm-key__warning-title">Don't share anything sensitive</div>
                <div className="confirm-key__warning-body">
                  If the numbers don't match, the connection may be intercepted. Close it and start
                  over, or — if you just mistyped — compare again.
                </div>
              </div>
              <button type="button" className="confirm-key__abort" onClick={onMismatch}>
                Close this connection
              </button>
              <button type="button" className="confirm-key__back" onClick={backToVerify}>
                ← I mistyped, compare again
              </button>
            </>
          )}
        </div>

        <p className="confirm-key__reassurance">This number never leaves your device.</p>
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
