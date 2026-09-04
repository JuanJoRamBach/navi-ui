import { useEffect, useRef, useState } from "react";
import { CANVAS_ACCENT, isDayTheme } from "./tokens";

// Adapted from a canvas dot-grid reference component (2026-09-01) — idle
// dots glow white, cursor proximity shifts them toward an accent color
// (teal for Dev Slate, amber for Agent Work — JuanJo, 2026-09-01: "same
// background and same animation, just change the color"). Simplified
// from the original: no light/dark theme toggle (this canvas is
// dark-only), no demo label.
//
// Tracks the pointer via `window` mousemove, not DOM :hover on the
// canvas — this is what makes the glow correctly follow the cursor even
// where real chat content (bubbles, the input) visually sits on top of
// this layer. A hover-driven CSS effect can't reach through overlaying
// content; comparing screen coordinates each frame doesn't care what's
// on top.

const SPACING = 20; // px between dots
const RADIUS = 130; // px of pointer influence
const BASE_A = 0.22; // resting dot opacity
const PEAK_A = 0.95; // fully-lit dot opacity
const BACKGROUND = "var(--dotgrid-bg)"; // theme-aware: near-black in night, light in day

// Converts any CSS color (including oklch(), which canvas fillStyle
// can't reliably per-channel-interpolate frame by frame) to a plain RGB
// triple via the DOM's own color parser — stays exactly in sync with
// tokens.ts's CANVAS_ACCENT.devSlate.color if that value ever changes,
// no hand-guessed hex/rgb approximation to drift out of date.
function cssColorToRgb(css: string): [number, number, number] {
  const probe = document.createElement("div");
  probe.style.color = css;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const match = computed.match(/\d+/g);
  return match ? [Number(match[0]), Number(match[1]), Number(match[2])] : [255, 255, 255];
}

export function DevSlateDotGrid({ accentColor = CANVAS_ACCENT.devSlate.color }: { accentColor?: string } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const onTheme = () => setThemeTick(t => t + 1);
    window.addEventListener("navi-theme-change", onTheme);
    return () => window.removeEventListener("navi-theme-change", onTheme);
  }, []);

  useEffect(() => {
    const updateFromClient = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    };
    const onMouseMove = (e: MouseEvent) => updateFromClient(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) updateFromClient(t.clientX, t.clientY);
    };
    const clearPointer = () => { mouseRef.current = null; };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", clearPointer, { passive: true });
    window.addEventListener("touchcancel", clearPointer, { passive: true });
    document.addEventListener("mouseleave", clearPointer);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", clearPointer);
      window.removeEventListener("touchcancel", clearPointer);
      document.removeEventListener("mouseleave", clearPointer);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const [r0, g0, b0] = isDayTheme() ? [122, 128, 145] : [255, 255, 255]; // idle: dark gray in day, white in night
    const [r1, g1, b1] = cssColorToRgb(accentColor); // lit: resolved via the DOM so it can never drift from whatever token the caller passed

    type Dot = { x: number; y: number; b: number };
    let dots: Dot[] = [];
    let animId = 0;
    let alive = true;
    let cw = 0, ch = 0;

    function build() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
      if (!cw || !ch) return;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      const cols = Math.floor(cw / SPACING) + 2;
      const rows = Math.floor(ch / SPACING) + 2;
      const ox = (cw % SPACING) / 2;
      const oy = (ch % SPACING) / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({ x: ox + c * SPACING, y: oy + r * SPACING, b: 0 });
        }
      }
    }

    function frame() {
      if (!alive) return;
      ctx.clearRect(0, 0, cw, ch);

      const mx = mouseRef.current?.x ?? -99999;
      const my = mouseRef.current?.y ?? -99999;
      const r2 = RADIUS * RADIUS;

      for (const d of dots) {
        const dx = d.x - mx;
        const dy = d.y - my;
        const dist2 = dx * dx + dy * dy;
        const tgt = dist2 < r2 ? Math.pow(1 - Math.sqrt(dist2) / RADIUS, 1.5) : 0;

        d.b += (tgt > d.b ? 0.16 : 0.07) * (tgt - d.b);
        if (d.b < 0.004) d.b = 0;

        const alpha = BASE_A + (PEAK_A - BASE_A) * d.b;
        const sz = 1 + d.b * 1.2;
        const r = Math.round(r0 + (r1 - r0) * d.b);
        const g = Math.round(g0 + (g1 - g0) * d.b);
        const b = Math.round(b0 + (b1 - b0) * d.b);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
        ctx.fillRect(d.x - sz / 2, d.y - sz / 2, sz, sz);
      }

      animId = requestAnimationFrame(frame);
    }

    build();
    frame();

    const ro = new ResizeObserver(build);
    ro.observe(canvas.parentElement!);

    return () => {
      alive = false;
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [accentColor, themeTick]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: BACKGROUND, pointerEvents: "none" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
