import { useEffect, useRef } from "react";
import { avatarSrc } from "../profiles/avatar";
import type { PeerProfile } from "../profiles/profileModel";
import "./ProfileCard.css";

interface ProfileCardProps {
  card: PeerProfile;
  /** On-screen box of the avatar that was clicked. */
  anchor: DOMRect;
  onClose: () => void;
}

const CARD_WIDTH = 220;
const REVEAL_MS = 720;

interface Particle {
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  delay: number;
  color: string;
}

export function ProfileCard({ card, anchor, onClose }: ProfileCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // "Coalesce" reveal: the card materializes from a scatter of glowing dots that
  // rush inward and lock into its footprint, then hand off to the crisp card
  // (particles never look sharp on their own — the cross-fade is what sells it).
  useEffect(() => {
    // Guard on the refs first, then bind non-null locals: TS widens control-flow
    // narrowing back to nullable inside the rAF closure, so these bindings must
    // carry a non-null *declared* type of their own.
    if (!cardRef.current || !canvasRef.current) return;
    const cardEl = cardRef.current;
    const canvas = canvasRef.current;

    // Respect reduced-motion: no particles, just let the CSS fade bring it in.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cardEl.style.opacity = "1";
      return;
    }
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) {
      cardEl.style.opacity = "1";
      return;
    }
    const ctx = maybeCtx;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    // Pull dot colors from the active theme so it fits Iris/Pulse/Apple alike.
    const styles = getComputedStyle(cardEl);
    const accent = styles.getPropertyValue("--accent").trim() || "#8FA6FF";
    const accent2 = styles.getPropertyValue("--accent-2").trim();
    const verified = styles.getPropertyValue("--verified").trim() || "#7ED9B7";
    const lightScheme = document.documentElement.dataset.scheme === "light";
    const palette = lightScheme ? [accent] : [accent, verified, accent2 || "#B7A6FF"];

    // Targets = a grid of points spanning the card's on-screen footprint; each
    // dot starts flung out along a random ray and eases back to its target.
    const rect = cardEl.getBoundingClientRect();
    const parts: Particle[] = [];
    for (let y = rect.top + 4; y < rect.bottom - 4; y += 15) {
      for (let x = rect.left + 4; x < rect.right - 4; x += 15) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 180;
        parts.push({
          tx: x,
          ty: y,
          ox: Math.cos(angle) * dist,
          oy: Math.sin(angle) * dist,
          delay: Math.random() * 0.32,
          color: palette[Math.floor(Math.random() * palette.length)],
        });
      }
    }

    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf = 0;
    let start = 0;

    function tick(now: number) {
      if (!start) start = now;
      const p = Math.min((now - start) / REVEAL_MS, 1);
      // Fade the whole dot field out over the last stretch as the card takes over.
      const fieldFade = 1 - Math.max(0, (p - 0.82) / 0.18);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalCompositeOperation = lightScheme ? "source-over" : "lighter";
      for (const q of parts) {
        const lt = Math.max(0, Math.min((p - q.delay) / (1 - q.delay), 1));
        const k = 1 - easeOut(lt);
        ctx.globalAlpha = Math.max(0, 0.25 + 0.6 * Math.sin(lt * Math.PI)) * fieldFade;
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(q.tx + q.ox * k, q.ty + q.oy * k, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      // Cross-fade + settle the real card in as the dots arrive.
      const reveal = Math.max(0, Math.min((p - 0.42) / 0.5, 1));
      cardEl.style.opacity = String(reveal);
      cardEl.style.transform = `scale(${0.955 + 0.045 * reveal})`;

      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        cardEl.style.opacity = "1";
        cardEl.style.transform = "scale(1)";
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchor]);

  // Sit the card just above the clicked avatar, clamped to the viewport.
  const left = Math.min(Math.max(anchor.left - 8, 8), window.innerWidth - CARD_WIDTH - 8);
  const bottom = window.innerHeight - anchor.top + 8;

  return (
    <div className="profile-card__backdrop" onClick={onClose}>
      <div
        ref={cardRef}
        className="profile-card"
        style={{ left, bottom, width: CARD_WIDTH }}
        onClick={(event) => event.stopPropagation()}
      >
        <img className="profile-card__avatar" src={avatarSrc(card.avatar)} alt="" />
        <div className="profile-card__name">{card.name}</div>
        {card.device && (
          <div className="profile-card__device">
            <span className="profile-card__device-icon" aria-hidden="true">
              {card.device === "phone" ? "📱" : "🖥️"}
            </span>
            On {card.device === "phone" ? "phone" : "computer"}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="profile-card__fx" aria-hidden="true" />
    </div>
  );
}
