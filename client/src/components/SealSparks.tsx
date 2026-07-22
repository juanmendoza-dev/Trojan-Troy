import { memo, useEffect, useRef, type MutableRefObject } from "react";
import { MAX_PARTICLES, sampleTrailColor, sparkCountForFrame } from "../screens/sparkModel";
import "./SealSparks.css";

interface SealSparksProps {
  progressRef: MutableRefObject<number>;
  sealedRef: MutableRefObject<boolean>;
  velocityRef: MutableRefObject<number>;
  reduced: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // remaining, in 60fps-frame units
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

// Geometry mirrors the track/knob in SafetyNumberScreen.css so the canvas
// (positioned top:-OVERHANG over .confirm-key__seal) maps 1:1 to the slider.
const OVERHANG_PX = 48; // canvas overhang above the track — embers escape upward
const KNOB_SIZE = 44; // .confirm-key__knob width/height
const KNOB_INSET = 5; // .confirm-key__knob top/left
const RANGE_TRIM = KNOB_SIZE + 10; // matches measureRange(): clientWidth - KNOB_SIZE - 10
const KNOB_CENTER_Y = OVERHANG_PX + KNOB_INSET + KNOB_SIZE / 2;

// Physics in 60fps-frame units (integration is dt-normalized, so motion speed
// is the same on 60Hz and 120Hz displays; only emission density varies, and
// that's bounded by MAX_PARTICLES).
const GRAVITY = 0.35;
const DRAG = 0.96;
const VELOCITY_DECAY = 0.88;
const FRAME_MS = 1000 / 60;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// A live spark layer over the seal slider: rainbow embers thrown off the
// knob's leading edge as you drag right, and a radial burst on seal. Reads
// live gesture state through refs (the same pattern the shake loop uses) and
// runs one rAF loop for the component's (short) lifetime on the safety-number
// screen. Under reduced motion it renders nothing — a static CSS knob glow
// covers feedback instead.
export const SealSparks = memo(function SealSparks({
  progressRef,
  sealedRef,
  velocityRef,
  reduced,
}: SealSparksProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // canvas unsupported → slider still works, just sparkless

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const particles: Particle[] = [];
    let wasSealed = false;
    let lastTime = performance.now();
    let raf = 0;

    function knobLeadingEdge(): number {
      const range = Math.max(0, width - RANGE_TRIM);
      return KNOB_INSET + progressRef.current * range + KNOB_SIZE;
    }

    function pushEmber(x: number, y: number, vx: number, vy: number, colorFraction: number, heat: number, life: number, size: number) {
      const c = sampleTrailColor(colorFraction);
      const mix = Math.min(0.9, 0.35 + 0.5 * heat); // hotter drag → whiter core
      particles.push({
        x,
        y,
        vx,
        vy,
        life,
        maxLife: life,
        size,
        r: Math.round(c.r + (255 - c.r) * mix),
        g: Math.round(c.g + (255 - c.g) * mix),
        b: Math.round(c.b + (255 - c.b) * mix),
      });
    }

    function emitDrag() {
      const velocity = velocityRef.current;
      const count = sparkCountForFrame({
        velocity,
        progress: progressRef.current,
        poolSize: particles.length,
      });
      if (count === 0) return;
      const heat = Math.min(velocity / 1.2, 1);
      const edge = knobLeadingEdge();
      for (let i = 0; i < count; i++) {
        const angle = rand(-Math.PI * 0.62, -Math.PI * 0.05); // up & to the right (y is down)
        const speed = rand(1.5, 4.5) + heat * 3;
        pushEmber(
          edge + rand(-3, 4),
          KNOB_CENTER_Y + rand(-6, 6),
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          progressRef.current,
          heat,
          rand(22, 42),
          rand(1.1, 2.6)
        );
      }
    }

    function emitBurst() {
      const originX = width * 0.5;
      const capacity = MAX_PARTICLES - particles.length;
      const n = Math.min(70, Math.max(0, capacity));
      for (let i = 0; i < n; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(3, 9);
        pushEmber(
          originX,
          KNOB_CENTER_Y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed - 1.5, // slight upward bias
          Math.random(), // full-spectrum shower
          0.2,
          rand(34, 60),
          rand(1.4, 3.2)
        );
      }
    }

    const frame = (now: number) => {
      const dt = Math.min((now - lastTime) / FRAME_MS, 3); // clamp big gaps (e.g. tab was hidden)
      lastTime = now;

      if (sealedRef.current && !wasSealed) {
        wasSealed = true;
        emitBurst();
      }
      if (!sealedRef.current) emitDrag();

      velocityRef.current *= Math.pow(VELOCITY_DECAY, dt); // held-still knob stops spraying

      const dragF = Math.pow(DRAG, dt);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += GRAVITY * dt;
        p.vx *= dragF;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const a = Math.max(0, p.life / p.maxLife);
        const radius = p.size * (0.6 + 0.4 * a);
        const speedSq = p.vx * p.vx + p.vy * p.vy;
        if (speedSq > 16) {
          const speed = Math.sqrt(speedSq);
          const len = Math.min(speed * 1.5, 14);
          const nx = p.vx / speed;
          const ny = p.vy / speed;
          const grad = ctx.createLinearGradient(p.x, p.y, p.x - nx * len, p.y - ny * len);
          grad.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${(0.9 * a).toFixed(3)})`);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth = radius;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - nx * len, p.y - ny * len);
          ctx.stroke();
        } else {
          const r2 = radius * 2.2;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r2);
          grad.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${(0.95 * a).toFixed(3)})`);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [reduced, progressRef, sealedRef, velocityRef]);

  return <canvas ref={canvasRef} className="confirm-key__sparks" aria-hidden="true" />;
});
