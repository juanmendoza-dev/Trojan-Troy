import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import "./DataMonitor.css";

// The chat sidebar's live "data monitor": five crypto visualizers stacked under
// the "VIZUALIZE UR DATA" label, flexing to fill the column. Each is a tiny
// self-contained instrument that writes straight to the DOM (no per-frame React
// render) and honors reduced-motion. Hovering a row shows a cursor-following
// tooltip.

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*<>/\\{}[]";
const rc = (s: string) => s[(Math.random() * s.length) | 0];
const rb = () => ("0" + ((Math.random() * 256) | 0).toString(16)).slice(-2);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 1 · plaintext → ciphertext morph, fed by the messages the user actually sends.
// Each new send jumps in and visibly encrypts; between sends it cycles the
// history (or a sample set before anything's been sent). Built with real DOM
// nodes (textContent) so untrusted message text can never inject markup.
function MorphViz({ messages }: { messages: string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const msgsRef = useRef(messages);
  msgsRef.current = messages;
  const seenLenRef = useRef(messages.length);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const FALLBACK = ["hey you around", "the drop is at 9", "meet me there", "got the keys"];
    const list = () => (msgsRef.current.length ? msgsRef.current : FALLBACK);
    const clip = (s: string) => s.slice(0, 24);
    let idx = 0, word = clip(list()[0] ?? ""), lock = 0, mode = "plain", t = 0;
    const draw = () => {
      el.textContent = "";
      for (let i = 0; i < word.length; i++) {
        if (i < lock) {
          const g = document.createElement("i");
          g.textContent = rc(GLYPHS);
          el.appendChild(g);
        } else {
          el.appendChild(document.createTextNode(word[i]));
        }
      }
    };
    draw();
    if (reduced()) return;
    const id = window.setInterval(() => {
      // A freshly sent message jumps the display straight to encrypting it.
      if (msgsRef.current.length > seenLenRef.current) {
        seenLenRef.current = msgsRef.current.length;
        idx = msgsRef.current.length - 1;
        word = clip(msgsRef.current[idx]); lock = 0; mode = "plain"; t = 0; draw(); return;
      }
      if (mode === "plain") { draw(); if (++t > 15) { mode = "enc"; t = 0; lock = 0; } return; }
      if (mode === "enc") { if (++t % 2 === 0) lock++; draw(); if (lock >= word.length) { mode = "hold"; t = 0; } return; }
      draw();
      if (++t > 22) { const l = list(); idx = (idx + 1) % l.length; word = clip(l[idx]); mode = "plain"; t = 0; lock = 0; }
    }, 45);
    return () => window.clearInterval(id);
  }, []);
  return <span ref={ref} className="viz-morph" aria-hidden="true" />;
}

// 2 · live ciphertext hex stream (hex digits only — safe to set as innerHTML)
function HexStreamViz() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bytes = Array.from({ length: 16 }, rb);
    const draw = () => {
      el.innerHTML = bytes.map((b, i) => (i < 2 ? `<b>${b}</b>` : b)).join(" ") + ' <span class="viz-hex__cur">▊</span>';
    };
    draw();
    if (reduced()) return;
    const id = window.setInterval(() => { bytes.unshift(rb()); bytes.pop(); draw(); }, 110);
    return () => window.clearInterval(id);
  }, []);
  return <span ref={ref} className="viz-hex" aria-hidden="true" />;
}

// 3 · oscilloscope signal
function ScopeViz() {
  const ref = useRef<SVGPathElement>(null);
  useEffect(() => {
    const path = ref.current;
    if (!path) return;
    const W = 200, mid = 12;
    let phase = 0, raf = 0;
    const draw = () => {
      let d = "M0 " + mid;
      for (let x = 0; x <= W; x += 5) {
        const env = Math.sin(phase * 0.6 + x * 0.012);
        const y = mid + Math.sin(x * 0.07 + phase) * 6.5 * env + (Math.random() - 0.5) * 1.6;
        d += " L" + x + " " + y.toFixed(1);
      }
      path.setAttribute("d", d);
    };
    draw();
    if (reduced()) return;
    const loop = () => { phase += 0.09; draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg className="viz-scope" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true">
      <path ref={ref} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// 4 · cipher rain — canvas, resizes with its row
function RainViz() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const step = 9;
    let W = 0, H = 0, cols = 0, y: number[] = [], raf = 0;
    const setup = () => {
      W = cv.clientWidth || 210; H = cv.clientHeight || 42;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(1, Math.floor(W / step));
      y = Array.from({ length: cols }, (_, i) => y[i] ?? Math.random() * -H);
    };
    const draw = () => {
      ctx.fillStyle = "rgba(19,22,41,0.28)"; ctx.fillRect(0, 0, W, H);
      ctx.font = "10px 'JetBrains Mono', monospace";
      for (let i = 0; i < cols; i++) {
        ctx.fillStyle = y[i] > 0 && y[i] < H ? "#cdd6ff" : "#8fa6ff";
        ctx.fillText(rc(GLYPHS), i * step + 1, y[i]);
        y[i] += 3.4;
        if (y[i] > H && Math.random() > 0.94) y[i] = Math.random() * -14;
      }
    };
    setup();
    const ro = new ResizeObserver(() => { setup(); if (reduced()) for (let k = 0; k < 16; k++) draw(); });
    ro.observe(cv);
    if (reduced()) { for (let k = 0; k < 16; k++) draw(); }
    else { const loop = () => { draw(); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="viz-rain" aria-hidden="true" />;
}

// 5 · packet flow (you ↔ peer) — pure CSS motion
function PacketViz() {
  return (
    <div className="viz-packet" aria-hidden="true">
      <span className="viz-packet__node">you</span>
      <span className="viz-packet__wire">
        <span className="viz-packet__p" />
        <span className="viz-packet__p" />
        <span className="viz-packet__p" />
      </span>
      <span className="viz-packet__node">peer</span>
    </div>
  );
}

export function DataMonitor({ messages }: { messages: string[] }) {
  const tip = useRef<HTMLDivElement>(null);
  const show = (text: string) => {
    const t = tip.current;
    if (t) { t.textContent = text; t.classList.add("is-visible"); }
  };
  const move = (e: ReactMouseEvent) => {
    const t = tip.current;
    if (t) { t.style.left = e.clientX + "px"; t.style.top = e.clientY + "px"; }
  };
  const hide = () => tip.current?.classList.remove("is-visible");

  const rows = [
    { key: "morph", desc: "live visuals of ur data", node: <MorphViz messages={messages} /> },
    { key: "hex", desc: "the raw ciphertext, live", node: <HexStreamViz /> },
    { key: "scope", desc: "ur secure line", node: <ScopeViz /> },
    { key: "rain", desc: "encryption, falling", node: <RainViz /> },
    { key: "packet", desc: "packets flying you ↔ peer", node: <PacketViz /> },
  ];

  return (
    <div className="data-monitor">
      {rows.map((r) => (
        <div
          key={r.key}
          className={`viz-row viz-row--${r.key}`}
          role="img"
          aria-label={r.desc}
          onMouseEnter={() => show(r.desc)}
          onMouseMove={move}
          onMouseLeave={hide}
        >
          {r.node}
        </div>
      ))}
      {createPortal(<div ref={tip} className="viz-tip" aria-hidden="true" />, document.body)}
    </div>
  );
}

// The show/hide switch beside "VIZUALIZE UR DATA". Eye-knob style: the knob's
// eye is open when the monitor is on / closed when off, and blinks on its own
// every few seconds — an ambient blink, independent of toggling.
export function EyeToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="eye-toggle"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Hide visualizers" : "Show visualizers"}
      data-on={on}
      onClick={onToggle}
    >
      <span className="eye-toggle__track" />
      <span className="eye-toggle__knob">
        <Icon name="eye" size={11} strokeWidth={2.2} className="eye-toggle__ic eye-toggle__ic--on" />
        <Icon name="eye-off" size={11} strokeWidth={2.2} className="eye-toggle__ic eye-toggle__ic--off" />
      </span>
    </button>
  );
}
