import { useRef, useEffect, useState, useCallback } from "react";
import {
  PaperAirplaneIcon,
  PaperclipIcon,
  GitBranchIcon,
  PlusIcon,
  HistoryIcon,
  CpuIcon,
  GraphIcon,
  PinIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  BellIcon,
  BellFillIcon,
  // Reserved for the future step-log UI (not built yet — no host for
  // these until the fairy-animation research mode exists to pair with):
  // SearchIcon, GlobeIcon, SyncIcon
} from "@primer/octicons-react";
import {
  type Mode, type ChatMode, MODE_THEME,
  spacing, radius, fontSize, fontWeight, lineHeight, iconSize, controlSize, blur,
  fontFamily, neutral,
} from "./tokens";
import { loadMessages, saveMessages } from "./storage";
import { type PushStatus, getPushStatus, subscribeToPush } from "./push";

const DOT_SIZE = 8;

// "Best at" taxonomy borrowed from OpenRouter's benchmark categories
// (Intelligence/Coding/Agentic composite indices) — not live-fetched
// scores, since NAVI's actual roster is mostly Groq/Cloudflare/Ollama
// Cloud/OVHcloud, and OpenRouter's benchmark set only covers models
// that route through OpenRouter itself. Using their taxonomy as a
// shared vocabulary while the tags themselves stay editorial for now.
type ModelTag = "Intelligence" | "Coding" | "Agentic";
const TAG_COLOR: Record<ModelTag, { bg: string; text: string }> = {
  Intelligence: { bg: "rgba(150, 140, 255, 0.16)", text: "rgba(190, 180, 255, 0.95)" },
  Coding: { bg: "rgba(90, 180, 255, 0.16)", text: "rgba(140, 200, 255, 0.95)" },
  Agentic: { bg: "rgba(255, 170, 90, 0.16)", text: "rgba(255, 195, 130, 0.95)" },
};

// "Today's models" — a provider catalog (every model NAVI has access
// to per provider), not a per-task assignment table. That's what
// Routing & Fallbacks is for; the two panels showed the same
// information before this split. `note` stands in for a tag row on
// models the Intelligence/Coding/Agentic taxonomy doesn't fit (image
// generation, mainly).
const PROVIDER_MODELS: { provider: string; models: { name: string; tags: ModelTag[]; note?: string }[] }[] = [
  {
    provider: "Groq", models: [
      { name: "gpt-oss-20b", tags: ["Intelligence"] },
      { name: "gpt-oss-120b", tags: ["Intelligence", "Agentic"] },
      { name: "compound", tags: ["Agentic"] },
      { name: "compound-mini", tags: ["Agentic"] },
      { name: "llama-3.1-8b-instant", tags: ["Intelligence"] },
    ],
  },
  {
    provider: "Cloudflare", models: [
      { name: "qwen2.5-coder-32b-instruct", tags: ["Coding"] },
    ],
  },
  {
    provider: "Ollama Cloud", models: [
      { name: "minimax-m3:cloud", tags: ["Intelligence", "Agentic"] },
      { name: "deepseek-v4-flash:cloud", tags: ["Intelligence"] },
    ],
  },
  {
    provider: "OpenRouter", models: [
      { name: "meta-llama/llama-3.3-70b-instruct:free", tags: ["Intelligence"] },
      { name: "deepseek/deepseek-r1:free", tags: ["Intelligence", "Agentic"] },
      { name: "google/gemini-2.0-flash-exp:free", tags: ["Intelligence", "Coding"] },
      { name: "qwen/qwen-2.5-72b-instruct:free", tags: ["Coding"] },
    ],
  },
  {
    provider: "OVHcloud", models: [
      { name: "stable-diffusion-xl", tags: [], note: "Image generation" },
    ],
  },
];

// What each mode uses when nothing's been manually picked (see
// modelOverride state) — the per-mode auto-routing default.
const DEFAULT_MODEL: Record<ChatMode, { provider: string; model: string }> = {
  normal: { provider: "Groq", model: "gpt-oss-20b" },
  research: { provider: "Groq", model: "compound" },
  brainstorm: { provider: "Ollama Cloud", model: "minimax-m3:cloud" },
};

const ROUTING_CHAINS: { label: string; chain: string[]; dotColor?: string }[] = [
  { label: "Normal Chat", chain: ["Groq · gpt-oss-20b", "Groq · gpt-oss-120b"], dotColor: MODE_THEME.normal.dot },
  { label: "Research", chain: ["Groq · compound", "Groq · compound-mini"], dotColor: MODE_THEME.research.dot },
  { label: "Brainstorm", chain: ["Ollama Cloud · minimax-m3:cloud"], dotColor: MODE_THEME.brainstorm.dot },
  { label: "Code", chain: ["Cloudflare · qwen2.5-coder-32b-instruct"] },
  { label: "Images", chain: ["OVHcloud · stable-diffusion-xl"] },
];

const USAGE_COUNTERS: { provider: string; used: number; quota: number; unit: string; period: string }[] = [
  { provider: "Groq", used: 640, quota: 1000, unit: "requests", period: "today" },
  { provider: "Cloudflare", used: 3200, quota: 10000, unit: "Neurons", period: "this week" },
  { provider: "OpenRouter", used: 12, quota: 50, unit: "requests", period: "today" },
  { provider: "OVHcloud", used: 4, quota: 0, unit: "requests", period: "today" }, // 0 quota = untracked anonymous tier
];

const MOCK_HISTORY: { title: string; timestamp: string; mode: ChatMode }[] = [
  { title: "Junior UX portfolio feedback", timestamp: "Yesterday, 14:32", mode: "brainstorm" },
  { title: "AEMET alert integration research", timestamp: "2 days ago", mode: "research" },
  { title: "Just checking in", timestamp: "4 days ago", mode: "normal" },
];

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  alpha: number;
  hue: number;
  life: number;
  maxLife: number;
}

interface Orb {
  x: number; y: number;
  radius: number;
  alpha: number;
  hue: number;
  dx: number; dy: number;
}

// Edge swirl node — a point that travels along the screen perimeter
interface SwirlNode {
  t: number;       // 0–1 normalized perimeter position
  speed: number;
  hue: number;
  alpha: number;
  size: number;
}

// Research-mode fairy — idle/breathing only. Lives entirely in
// normalized 0–1 coordinates (band position + vertical fraction) rather
// than absolute pixels, same fix as the orb-teleport-on-resize bug:
// position is recomputed from current w/h every frame, so resizing
// never snaps them anywhere. Confined to a left/right margin band —
// they don't roam the center over the chat, unlike the ambient
// orbs/dust. An "investigate on send/reply" mechanic (converge on the
// message, float, drift to a new spot) was tried across several
// iterations and dropped — too fast, and inherently distracting from
// the chat itself.
interface Fairy {
  side: "left" | "right";
  bandT: number;   // 0–1 across the margin band's width
  bandDx: number;  // signed drift speed, reverses at the band edges
  yT: number;      // 0–1 down the screen height
  yDx: number;
  radius: number;
  alphaBase: number;
  hueJitter: number;
  bobPhase: number;
  flickerSeed: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<Mode>("ambient");
  // Separate from modeRef ("ambient"/"vortex", which Normal and Research
  // both share) — fairies are a Research-only layer on top of the shared
  // ambient orbs/dust, so the draw loop needs the actual chat mode, not
  // just which canvas engine is active.
  const chatModeRef = useRef<ChatMode>("normal");
  const [chatMode, setChatModeState] = useState<ChatMode>("normal");
  const themeRef = useRef(MODE_THEME.normal);
  const particlesRef = useRef<Particle[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  const swirlRef = useRef<SwirlNode[]>([]);
  const fairiesRef = useRef<Fairy[]>([]);
  const rafRef = useRef(0);
  const tickRef = useRef(0);
  // Free-running, never reset by selectChatMode (unlike tickRef, which
  // resets to 0 on every mode switch for the orbs/vortex timing) — the
  // fairies' bob/breathe/flicker sines use this instead, so switching
  // modes and back doesn't jump their phase mid-cycle.
  const fairyTickRef = useRef(0);
  // "Celebrate" window on NAVI's reply landing — simpler than a full
  // dance/choreography stage: fairies just drift slower and breathe
  // more deeply for 10s. Timestamped against fairyTickRef since that's
  // never reset by mode switches.
  const celebrateUntilRef = useRef(0);
  // Logical (CSS) pixel size — shared between the draw loop and selectChatMode(),
  // since canvas.width/height are now physical DPR-scaled dimensions.
  const logicalSizeRef = useRef({ w: 0, h: 0 });

  const initOrbs = useCallback((w: number, h: number) => {
    const theme = themeRef.current;
    orbsRef.current = Array.from({ length: 7 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      radius: 70 + Math.random() * 130,
      alpha: 0.18 + Math.random() * 0.16, // much brighter — should read as the dominant background glow now
      hue: theme.hueBase + Math.random() * theme.hueRange,
      dx: (Math.random() - 0.5) * 0.3,
      dy: (Math.random() - 0.5) * 0.3,
    }));
  }, []);

  // 10 fairies, split evenly left/right. Positions are stored as 0–1
  // fractions (band position + vertical), not absolute pixels, so they
  // never need re-seeding on resize (same fix as the orb-teleport bug).
  // bandDx/yDx are the drift speed — 4x the original read as too fast;
  // settled at ~1.8x, between imperceptible and rushed.
  const initFairies = useCallback(() => {
    fairiesRef.current = Array.from({ length: 10 }, (_, i) => ({
      side: i % 2 === 0 ? "left" : "right",
      bandT: Math.random(),
      bandDx: (Math.random() - 0.5) * 0.0045,
      yT: Math.random(),
      yDx: (Math.random() - 0.5) * 0.0027,
      radius: 8 + Math.random() * 12, // grown a bit; the white core stays the same absolute size, the color fade around it gets the extra room
      alphaBase: 0.6 + Math.random() * 0.3,
      hueJitter: (Math.random() - 0.5) * 16,
      bobPhase: Math.random() * Math.PI * 2,
      flickerSeed: Math.random() * Math.PI * 2,
    }));
  }, []);

  const initSwirl = useCallback(() => {
    swirlRef.current = Array.from({ length: 18 }, (_, i) => ({
      t: i / 18,
      speed: 0.0006 + Math.random() * 0.0008,
      hue: 240 + Math.random() * 60, // blue → purple
      alpha: 0.18 + Math.random() * 0.28,
      size: 8 + Math.random() * 14,
    }));
  }, []);

  const spawnVortexRing = useCallback((cx: number, cy: number, w: number, h: number) => {
    const count = 18 + Math.floor(Math.random() * 12);
    const spawnR = Math.max(w, h) * (0.42 + Math.random() * 0.38);
    const hueBase = 220 + Math.random() * 60; // blue(220) → purple(280)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.35;
      const ox = (Math.random() - 0.5) * 50;
      const oy = (Math.random() - 0.5) * 50;
      const sx = cx + Math.cos(angle) * spawnR + ox;
      const sy = cy + Math.sin(angle) * spawnR + oy;
      const dist = Math.hypot(cx - sx, cy - sy) || 1;
      const speed = 0.6 + Math.random() * 1.2; // slow
      const maxLife = 130 + Math.floor(Math.random() * 90); // longer life = slower feel
      particlesRef.current.push({
        x: sx, y: sy,
        vx: ((cx - sx) / dist) * speed,
        vy: ((cy - sy) / dist) * speed,
        radius: 3 + Math.random() * 10,
        alpha: 0.14 + Math.random() * 0.18, // halfway between original (0.18-0.40) and first pass (0.10-0.24)
        hue: hueBase + Math.random() * 55,
        life: maxLife, maxLife,
      });
    }
  }, []);

  // Convert perimeter t (0–1) to {x, y} — travels clockwise.
  // useCallback with no deps keeps this reference stable across renders —
  // without it, every render (e.g. every keystroke in the chat input)
  // handed the animation effect a "new" function, which tore down and
  // restarted the whole draw loop, re-randomizing every position.
  const perimeterPoint = useCallback((t: number, w: number, h: number) => {
    const perim = 2 * (w + h);
    const d = t * perim;
    if (d < w) return { x: d, y: 0 };
    if (d < w + h) return { x: w, y: d - w };
    if (d < 2 * w + h) return { x: w - (d - w - h), y: h };
    return { x: 0, y: h - (d - 2 * w - h) };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      logicalSizeRef.current = { w, h };
      // Backing buffer at full device resolution, CSS size stays logical,
      // context scaled so every draw call below stays in logical-pixel
      // coordinates — this is what fixes the pixelation on any display
      // with devicePixelRatio > 1 (most laptops/phones/monitors now).
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    // Orbs/swirl only need to be seeded once — they already wrap using
    // the current logical w/h every frame in the draw loop below, so
    // re-seeding them on every resize just teleported everything to new
    // random spots each time the window changed size.
    initOrbs(logicalSizeRef.current.w, logicalSizeRef.current.h);
    initSwirl();
    initFairies();
    window.addEventListener("resize", resize);

    const draw = () => {
      const { w, h } = logicalSizeRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const cur = modeRef.current;
      tickRef.current += 1;
      const t = tickRef.current;
      fairyTickRef.current += 1;
      const ft = fairyTickRef.current;

      // Fully opaque clear — no trailing/ghosting from previous frames.
      ctx.fillStyle = "#06050a";
      ctx.fillRect(0, 0, w, h);

      // ── Edge swirl — vortex mode only, paused (not rendered) in ambient ──────
      if (cur === "vortex") {
        for (const node of swirlRef.current) {
          node.t = (node.t + node.speed) % 1;
          const pt = perimeterPoint(node.t, w, h);

          // Clamp render within 20px of edge
          const ex = Math.max(0, Math.min(w, pt.x));
          const ey = Math.max(0, Math.min(h, pt.y));

          // Pulse alpha
          const pulseMod = 0.6 + 0.4 * Math.sin(t * 0.04 + node.t * Math.PI * 6);
          const a = node.alpha * pulseMod;

          const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, node.size);
          g.addColorStop(0, `hsla(${node.hue}, 80%, 65%, ${a})`);
          g.addColorStop(0.5, `hsla(${node.hue + 18}, 75%, 45%, ${a * 0.45})`);
          g.addColorStop(1, `hsla(${node.hue + 36}, 70%, 35%, 0)`);
          ctx.beginPath();
          ctx.arc(ex, ey, node.size, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }
      }

      // ── Ambient mode ────────────────────────────────────────────────────────
      if (cur === "ambient") {
        for (const orb of orbsRef.current) {
          orb.x += orb.dx; orb.y += orb.dy;
          if (orb.x < -orb.radius) orb.x = w + orb.radius;
          if (orb.x > w + orb.radius) orb.x = -orb.radius;
          if (orb.y < -orb.radius) orb.y = h + orb.radius;
          if (orb.y > h + orb.radius) orb.y = -orb.radius;

          const pulse = 0.5 + 0.5 * Math.sin(t * 0.007 + orb.hue);
          const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius);
          g.addColorStop(0, `hsla(${orb.hue}, 50%, 55%, ${orb.alpha * (0.8 + 0.4 * pulse)})`);
          g.addColorStop(0.5, `hsla(${orb.hue + 20}, 44%, 40%, ${orb.alpha * 0.38})`);
          g.addColorStop(1, `hsla(${orb.hue + 40}, 36%, 25%, 0)`);
          ctx.beginPath();
          ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        // Drifting micro-dust — spawns anywhere on the perimeter, aimed
        // toward center (was bottom-only, straight up). Was every 7
        // frames, now every 3 for a noticeably denser stream.
        if (t % 3 === 0) {
          const spawnPt = perimeterPoint(Math.random(), w, h);
          const ddx = cx - spawnPt.x;
          const ddy = cy - spawnPt.y;
          const ddist = Math.hypot(ddx, ddy) || 1;
          const speed = 0.2 + Math.random() * 0.5; // same magnitude as the old straight-up drift
          const theme = themeRef.current;
          const maxLife = theme.particleLifeBase + theme.particleLifeRange;
          particlesRef.current.push({
            x: spawnPt.x, y: spawnPt.y,
            vx: (ddx / ddist) * speed,
            vy: (ddy / ddist) * speed,
            radius: 1 + Math.random() * 2,
            alpha: theme.particleAlphaBase + Math.random() * theme.particleAlphaRange,
            hue: theme.hueBase + Math.random() * theme.hueRange,
            life: theme.particleLifeBase + Math.floor(Math.random() * theme.particleLifeRange),
            maxLife,
          });
        }

        particlesRef.current = particlesRef.current.filter(p => p.life > 0);
        for (const p of particlesRef.current) {
          p.x += p.vx; p.y += p.vy;
          const a = p.alpha * (p.life / p.maxLife);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${p.hue}, 65%, 72%, ${a})`;
          ctx.fill();
          p.life -= 1;
        }

        // ── Fairies — Research mode only, idle/breathing ─────────────────────
        // Layered on top of the shared orbs/dust above, not a replacement.
        // Confined to a left/right margin band (18% of width each side);
        // position is derived from bandT/yT fractions every frame, so
        // resizing the window never snaps them anywhere.
        if (chatModeRef.current === "research") {
          const marginW = w * 0.18;
          // "Celebrate" window on NAVI's reply landing (no dance
          // choreography — just slower drift and a deeper breathing
          // pulse for 10s) — see celebrateUntilRef.
          const celebrating = ft < celebrateUntilRef.current;
          const speedMul = celebrating ? 0.4 : 1;
          for (const f of fairiesRef.current) {
            f.bandT += f.bandDx * speedMul;
            if (f.bandT < 0 || f.bandT > 1) { f.bandDx *= -1; f.bandT = Math.max(0, Math.min(1, f.bandT)); }
            f.yT += f.yDx * speedMul;
            if (f.yT < 0 || f.yT > 1) { f.yDx *= -1; f.yT = Math.max(0, Math.min(1, f.yT)); }

            const fx = f.side === "left" ? f.bandT * marginW : w - marginW + f.bandT * marginW;
            const fy = f.yT * h + Math.sin(ft * 0.02 + f.bobPhase) * 6;

            // Slow, smooth breathing pulse (was too fast/blinky at 0.15
            // rad/frame with a heavy 0.3 weight — that read as a blink
            // rather than a breath). Flicker is now a subtle shimmer on
            // top, not the dominant motion. Deeper swing (both alpha and
            // radius) while celebrating.
            const breathe = 0.5 + 0.5 * Math.sin(ft * 0.006 + f.bobPhase);
            const flicker = 0.88 + 0.12 * Math.sin(ft * 0.03 + f.flickerSeed);
            const breatheWeight = celebrating ? 0.6 : 0.35;
            const a = f.alphaBase * ((1 - breatheWeight) + breatheWeight * breathe) * flicker;
            const radius = celebrating ? f.radius * (1 + 0.3 * breathe) : f.radius;
            // Own hue base rather than the shared rTheme.hueBase (130,
            // pure green) — a bluer green, between green(120) and
            // cyan(180) on the wheel, so fairies read as a distinct hue
            // from the orbs/bubbles instead of the exact same green.
            const hue = 165 + f.hueJitter;

            const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, radius);
            // Core alpha ignores the breathing/flicker modulation — always
            // near-opaque, so the white center reads as solid regardless
            // of where the pulse cycle is. Only the outer color fade
            // breathes.
            g.addColorStop(0, `hsla(${hue}, 10%, 99%, 0.95)`);
            g.addColorStop(0.13, `hsla(${hue}, 15%, 97%, 0.95)`);
            g.addColorStop(0.55, `hsla(${hue}, 85%, 65%, ${a * 0.85})`);
            g.addColorStop(1, `hsla(${hue}, 80%, 45%, 0)`);
            ctx.beginPath();
            ctx.arc(fx, fy, radius, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
          }
        }

      // ── Vortex mode ─────────────────────────────────────────────────────────
      } else {
        if (t % 22 === 0) spawnVortexRing(cx, cy, w, h);

        particlesRef.current = particlesRef.current.filter(p => p.life > 0);

        for (const p of particlesRef.current) {
          const dist = Math.hypot(cx - p.x, cy - p.y);
          if (dist > 5) {
            // Gentle, smooth acceleration — slowed further, still ramps
            // in but never feels like it's snapping toward center.
            const progress = 1 - p.life / p.maxLife;
            const accel = 1 + progress * 1.0;
            p.vx *= Math.min(accel, 1.018);
            p.vy *= Math.min(accel, 1.018);
            p.x += p.vx;
            p.y += p.vy;
          }
          // Fade out well before reaching center — was dist/60 (particles
          // visibly converged on the core before vanishing), now dist/130
          // so they disappear on the way in, never arriving.
          const fadeProx = Math.min(1, dist / 130);
          const fadeLife = p.life / p.maxLife < 0.14 ? (p.life / p.maxLife) / 0.14 : 1;
          const a = p.alpha * fadeProx * fadeLife;

          const hue = 220 + (p.hue - 220); // keep in blue-purple range
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
          g.addColorStop(0, `hsla(${hue}, 85%, 70%, ${a})`);
          g.addColorStop(0.5, `hsla(${hue + 22}, 80%, 50%, ${a * 0.5})`);
          g.addColorStop(1, `hsla(${hue + 44}, 75%, 32%, 0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
          p.life -= 1;
        }

        // Soft core glow — shrunk and much more transparent than before
        // rather than removed outright, so it's easy to turn back up.
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.06);
        const coreRadius = 10 + pulse * 6;
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
        cg.addColorStop(0, `rgba(140, 80, 255, ${0.12 + pulse * 0.08})`);
        cg.addColorStop(0.45, `rgba(90, 40, 200, ${0.05 * (0.5 + pulse * 0.5)})`);
        cg.addColorStop(1, "rgba(50, 10, 140, 0)");
        ctx.beginPath();
        ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
        ctx.fillStyle = cg;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [initOrbs, initSwirl, initFairies, spawnVortexRing, perimeterPoint]);

  const selectChatMode = useCallback((next: ChatMode) => {
    const theme = MODE_THEME[next];
    themeRef.current = theme;
    modeRef.current = theme.canvasMode;
    chatModeRef.current = next;
    setChatModeState(next);
    particlesRef.current = [];
    tickRef.current = 0;
    const { w, h } = logicalSizeRef.current;
    if (theme.canvasMode === "vortex") {
      for (let i = 0; i < 4; i++) spawnVortexRing(w / 2, h / 2, w, h);
    } else {
      initOrbs(w, h);
    }
  }, [initOrbs, spawnVortexRing]);

  const theme = MODE_THEME[chatMode];

  // Local-only chat state — no backend wiring yet, just enough to test
  // real send-events against (versus fake trigger buttons) once the
  // fairy/leaves animation gets built next. This mock intro is the
  // default for a genuinely first-ever launch; loadedFromStorage below
  // overwrites it with whatever's actually saved, if anything is.
  const [messages, setMessages] = useState<{ role: "user" | "navi"; text: string }[]>([
    { role: "navi", text: "Hey — this is just a mock reply so both bubble styles are visible while we tune the look." },
    { role: "user", text: "Got it, this is what a sent message looks like." },
  ]);
  // Guards the save effect below from firing before the load effect has
  // had a chance to run — without this, mounting would immediately
  // persist the mock intro messages over whatever was actually stored,
  // since both effects fire on the same initial render.
  const loadedFromStorage = useRef(false);

  useEffect(() => {
    loadMessages().then(stored => {
      if (stored !== undefined) setMessages(stored);
      loadedFromStorage.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loadedFromStorage.current) return;
    saveMessages(messages);
  }, [messages]);

  // The service worker's push handler (src/sw.ts) writes an incoming
  // message straight to IndexedDB so it's there on the next launch —
  // but if the app is already open (foreground or just backgrounded,
  // not closed), it loaded its message list once at mount and has no
  // way to know storage changed underneath it. The SW posts the new
  // message directly to every open tab for exactly this case, so a
  // push shows up immediately instead of only after a manual relaunch.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "navi-message") {
        setMessages(m => [...m, event.data.message]);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Push notifications — see src/push.ts for the actual subscribe flow
  // and src/sw.ts for how an incoming push gets shown/persisted.
  const [pushStatus, setPushStatus] = useState<PushStatus>("unsubscribed");
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    getPushStatus().then(setPushStatus);
  }, []);

  const handleTogglePush = useCallback(() => {
    if (pushStatus === "subscribed" || pushStatus === "unsupported") return;
    setPushError(null);
    subscribeToPush().then(result => {
      if (result.ok) {
        setPushStatus("subscribed");
      } else {
        setPushStatus("unsubscribed");
        setPushError(result.error ?? "Something went wrong.");
      }
    });
  }, [pushStatus]);

  const [draft, setDraft] = useState("");
  // Which toolbar popover is open, if any — only one at a time.
  const [openPanel, setOpenPanel] = useState<"newConvo" | "history" | "models" | "routing" | "usage" | null>(null);
  // Which provider row is expanded in the "Today's models" catalog.
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  // Manual model pick per mode — null means "use DEFAULT_MODEL (auto)".
  // Scoped per-mode rather than one global override, since each mode
  // already has its own task/model role.
  const [modelOverride, setModelOverride] = useState<Record<ChatMode, { provider: string; model: string } | null>>({
    normal: null, research: null, brainstorm: null,
  });
  // The model actually in effect for the current mode — a manual pick
  // if one exists, otherwise the auto-routed default.
  const effectiveModel = modelOverride[chatMode] ?? DEFAULT_MODEL[chatMode];
  // The clicked button's on-screen position at open time, in viewport
  // pixels — the popover renders as position:fixed off of this instead
  // of position:absolute nested inside the button. The toolbar row
  // scrolls horizontally (overflow-x:auto), and a scrollable ancestor
  // clips any child that overflows its box vertically too — so a
  // popover positioned relative to a button *inside* that row got
  // silently clipped. Rendering fixed, computed via
  // getBoundingClientRect() at click time, sidesteps that entirely.
  // popoverLeft is clamped to stay on-screen — buttons near the right
  // edge were pushing the popover fully off-viewport before.
  const POPOVER_WIDTH = 320; // uniform across all five panels
  const POPOVER_MARGIN = 12; // minimum clearance from viewport edges
  // Below-the-button open, growing downward — otherwise a button near
  // the top of the screen (the model picker pill, mainly) always had a
  // popover clipped off the top of the viewport, since "grows upward"
  // assumed there was always room above. `top` is set instead of
  // `bottom` when flipped.
  const [anchorRect, setAnchorRect] = useState<{ popoverLeft: number; bottom?: number; top?: number } | null>(null);

  const togglePanel = useCallback((key: NonNullable<typeof openPanel>, el: HTMLButtonElement) => {
    // Scroll the clicked button fully into view first (instant, not
    // smooth — smooth scrolling is async, and computing the button's
    // rect before it finishes would anchor the popover to the
    // pre-scroll position). Only matters when the button was partially
    // cut off at the scrollable row's edge; a no-op otherwise.
    el.scrollIntoView({ behavior: "auto", inline: "nearest", block: "nearest" });
    setOpenPanel(p => {
      if (p === key) return null;
      const rect = el.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_MARGIN * 2);
      let popoverLeft = rect.left;
      if (popoverLeft + width > window.innerWidth - POPOVER_MARGIN) popoverLeft = window.innerWidth - POPOVER_MARGIN - width;
      if (popoverLeft < POPOVER_MARGIN) popoverLeft = POPOVER_MARGIN;
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      // Flip downward only when there's genuinely more room that way —
      // popover height varies with content (expanded providers, etc.),
      // so this is a "more room, not a guarantee it'll fit" heuristic
      // rather than an exact fit check.
      if (spaceAbove < 250 && spaceBelow > spaceAbove) {
        setAnchorRect({ popoverLeft, top: rect.bottom + spacing.sm });
      } else {
        // "bottom" = distance from the viewport's bottom edge up to the
        // button's TOP edge, plus one gap's worth of clearance —
        // matches where the popover's own bottom edge should land,
        // growing upward.
        setAnchorRect({ popoverLeft, bottom: window.innerHeight - rect.top + spacing.sm });
      }
      return key;
    });
  }, []);

  // Stale anchors (from a resize, or scrolling the toolbar row while a
  // popover is open) are cheaper to just close than to keep in sync.
  useEffect(() => {
    const close = () => setOpenPanel(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const INPUT_LINE_HEIGHT = 20;
  const INPUT_MAX_LINES = 6;

  // Grows the input with the text (up to a cap), then lets it scroll
  // internally instead of pushing content further off to the right —
  // re-runs on every keystroke, including the reset to "" after send.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = INPUT_LINE_HEIGHT * INPUT_MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [draft]);

  const sendMessage = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    if (chatModeRef.current === "research") {
      // NAVI's reply is added instantly below (no real backend yet) —
      // this stands in for "research completed" until there's an actual
      // async reply to key off of.
      celebrateUntilRef.current = fairyTickRef.current + 600; // 10s at 60fps
    }
    setMessages(m => [
      ...m,
      { role: "user", text },
      { role: "navi", text: "(mock reply — no backend wired up yet)" },
    ]);
    setDraft("");
  }, [draft]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden", background: "#06050a" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />

      {/* Mode selector — top-center. No shared container anymore: each
          label just sits with even spacing; only the active one gets
          real button chrome (background + glow), the others are plain
          text. Reads as "pick one" rather than a boxed segmented control.
          zIndex is required here: .chat-column below is a full-screen
          inset:0 div that renders after this in the DOM, so without an
          explicit stacking order its invisible hit-box (padding doesn't
          exempt it from capturing clicks) sits on top and swallows
          clicks on Research/Brainstorm before they reach these buttons. */}
      <div style={{
        position: "absolute", top: spacing.xl, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: spacing.xxl - spacing.xxs, alignItems: "center",
        zIndex: 10,
      }}>
        {(Object.keys(MODE_THEME) as ChatMode[]).map(m => {
          const t = MODE_THEME[m];
          const active = m === chatMode;
          return (
            <button
              key={m}
              onClick={() => selectChatMode(m)}
              style={{
                padding: active ? `${spacing.sm}px ${spacing.xl}px` : `${spacing.sm}px ${spacing.xxs}px`,
                borderRadius: radius.sm,
                border: active ? `1px solid ${t.bubbleBorder}` : "none",
                cursor: "pointer",
                fontSize: fontSize.xs,
                fontFamily,
                fontWeight: fontWeight.medium,
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                background: active ? t.bubbleBg : "transparent",
                color: active ? neutral.textPrimary : neutral.textInactive,
                boxShadow: active ? `0 2px 14px rgba(0,0,0,0.35), 0 0 14px ${t.glow}` : "none",
                transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Model picker — shows the model actually in effect for the
          current mode (manual pick, or the auto-routed default), opens
          the same "Today's models" popover but with rows made
          selectable. Same zIndex-over-chat-column reasoning as the mode
          selector above. */}
      <div style={{ position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
        <button
          onClick={e => togglePanel("models", e.currentTarget)}
          style={{
            display: "flex", alignItems: "center", gap: spacing.xs,
            padding: `${spacing.xs}px ${spacing.md}px`,
            borderRadius: radius.sm,
            border: `1px solid ${theme.bubbleBorder}`,
            background: theme.bubbleBg,
            color: neutral.textPrimary,
            cursor: "pointer",
            fontSize: fontSize.xxs,
            fontFamily,
            fontWeight: fontWeight.medium,
            whiteSpace: "nowrap",
            backdropFilter: `blur(${blur.sm}px)`,
            boxShadow: `0 2px 14px rgba(0,0,0,0.35), 0 0 10px ${theme.glow}`,
          }}
        >
          <CpuIcon size={12} />
          <span style={{ color: neutral.textMuted }}>{effectiveModel.provider} · </span>
          {effectiveModel.model}
          {!modelOverride[chatMode] && <span style={{ color: neutral.textMuted }}> (auto)</span>}
          <ChevronDownIcon size={12} />
        </button>
      </div>

      {/* Chat surface — glassy bubbles over the animated background.
          Top padding clears the mode selector above; the max-width/
          centering for wider screens lives in index.css (.chat-column)
          since inline styles can't do media queries. */}
      <div className="chat-column" style={{
        position: "absolute", inset: 0,
        fontFamily,
      }}>
        {/* Bottom-anchored like this chat — flex column-reverse means
            the newest message is the first DOM child and sits pinned at
            the bottom automatically (no scroll-to-bottom JS needed);
            older ones stack upward from there and scroll away.
            hide-scrollbar keeps the bar off, message-fade-top dissolves
            content near the top edge as it scrolls up and out. */}
        <div className="hide-scrollbar message-fade-top" style={{
          flex: 1, overflowY: "auto",
          display: "flex", flexDirection: "column-reverse", gap: spacing.xxl - spacing.xxs,
          paddingRight: spacing.xxs,
        }}>
          {[...messages].map((m, i) => ({ m, i })).reverse().map(({ m, i }) => (
            <div key={i} style={{
              alignSelf: m.role === "navi" ? "flex-start" : "flex-end",
              maxWidth: "78%",
              padding: `${spacing.md - 1}px ${spacing.lg}px`,
              borderRadius: radius.lg,
              fontSize: fontSize.sm,
              lineHeight: lineHeight.base,
              color: neutral.textPrimary,
              // Heavier blur does the legibility work here instead of a
              // solid fill, so the color underneath can go darker/more
              // transparent without the text losing contrast.
              backdropFilter: `blur(${blur.lg}px)`,
              // NAVI's bubble fully carries the active mode's tint — that's
              // the "content" layer, meant to feel immersive. Your own
              // messages stay neutral on purpose (see the button-color
              // discussion: chrome stays stable, content shifts).
              background: m.role === "navi" ? theme.bubbleBg : neutral.userBubbleBg,
              border: m.role === "navi"
                ? `1px solid ${theme.bubbleBorder}`
                : `1px solid ${neutral.userBubbleBorder}`,
              boxShadow: m.role === "navi"
                ? `0 4px 18px rgba(0,0,0,0.35), 0 0 14px ${theme.glow}`
                : `0 4px 18px rgba(0,0,0,0.35), 0 0 14px ${neutral.userBubbleGlow}`,
            }}>
              {m.text}
              {m.role === "navi" && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: spacing.xs }}>
                  <button
                    aria-label="Pin this response"
                    title="Pin this response"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: controlSize.sm, height: controlSize.sm, padding: 0,
                      border: "none", borderRadius: radius.xs, cursor: "pointer",
                      background: "transparent", color: neutral.textFaint,
                    }}
                  >
                    <PinIcon size={iconSize.sm} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Utility toolbar — horizontal row sitting right above the
            input bar, in normal flow (was pinned near the top, then a
            vertical left rail before that — both sat awkwardly apart
            from the thing they actually relate to). Labeled pills so
            the icons don't need to be individually memorized, and each
            icon is unique (Past conversations vs. Usage counters used
            to share HistoryIcon). Scrolls horizontally instead of
            wrapping so it stays one line at any width. onScroll closes
            any open popover — its fixed position is computed once at
            open time and won't track the button if this row scrolls
            underneath it. Scroll-snap (className="snap-row" + each
            button's snap-item) means dragging/flicking the row settles
            on a fully-visible button instead of stopping mid-button;
            togglePanel() above handles the click-on-a-cut-off-button
            case with an explicit scrollIntoView. */}
        <div
          className="hide-scrollbar scroll-fade-x snap-row"
          onScroll={() => setOpenPanel(null)}
          style={{ display: "flex", gap: spacing.sm, marginTop: spacing.lg, overflowX: "auto" }}
        >
          {([
            { key: "newConvo", icon: <PlusIcon size={iconSize.sm} />, label: "New conversation" },
            { key: "history", icon: <HistoryIcon size={iconSize.sm} />, label: "Past conversations" },
            { key: "models", icon: <CpuIcon size={iconSize.sm} />, label: "Today's models" },
            { key: "routing", icon: <GitBranchIcon size={iconSize.sm} />, label: "Routing & fallbacks" },
            { key: "usage", icon: <GraphIcon size={iconSize.sm} />, label: "Usage counters" },
          ] as const).map(({ key, icon, label }) => {
            const panelActive = openPanel === key;
            return (
              <button
                key={key}
                className="snap-item"
                aria-label={label}
                title={label}
                onClick={e => togglePanel(key, e.currentTarget)}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.xs, flexShrink: 0,
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: radius.sm, // squared-with-rounded-corners, matches bubbles/input
                  border: `1px solid ${theme.bubbleBorder}`,
                  background: theme.bubbleBg,
                  color: neutral.textPrimary,
                  cursor: "pointer",
                  fontSize: fontSize.xs,
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  whiteSpace: "nowrap",
                  backdropFilter: `blur(${blur.sm}px)`,
                  boxShadow: panelActive
                    ? `0 2px 20px rgba(0,0,0,0.5), 0 0 16px ${theme.glow}, inset 0 0 12px ${theme.glow}`
                    : `0 2px 20px rgba(0,0,0,0.45), 0 0 10px ${theme.glow}, inset 0 0 8px ${theme.glow}`,
                  outline: panelActive ? `1px solid ${neutral.textPrimary}` : "none",
                  outlineOffset: -1,
                  transition: "all 0.35s ease",
                }}
              >
                {icon}
                {label}
              </button>
            );
          })}

          {/* Not a popover like the other five — a direct toggle, so it
              doesn't fit the togglePanel()/openPanel plumbing above.
              Label and icon reflect actual subscription state (checked
              via getPushStatus on mount) rather than assuming success —
              "Enable notifications" would be a lie once already
              subscribed, or on a browser that doesn't support push at
              all. pushError surfaces via title (hover/long-press) rather
              than a toast — good enough for now, matches how the rest
              of this prototype defers polish on secondary states. */}
          <button
            className="snap-item"
            aria-label={
              pushStatus === "subscribed" ? "Notifications on"
                : pushStatus === "denied" ? "Notifications blocked in browser settings"
                : pushStatus === "unsupported" ? "Notifications not supported in this browser"
                : "Enable notifications"
            }
            title={pushError ?? undefined}
            onClick={handleTogglePush}
            style={{
              display: "flex", alignItems: "center", gap: spacing.xs, flexShrink: 0,
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.sm,
              border: `1px solid ${theme.bubbleBorder}`,
              background: theme.bubbleBg,
              color: pushStatus === "denied" || pushStatus === "unsupported" ? neutral.textMuted : neutral.textPrimary,
              cursor: pushStatus === "subscribed" || pushStatus === "unsupported" ? "default" : "pointer",
              fontSize: fontSize.xs,
              fontFamily,
              fontWeight: fontWeight.medium,
              whiteSpace: "nowrap",
              backdropFilter: `blur(${blur.sm}px)`,
              boxShadow: pushStatus === "subscribed"
                ? `0 2px 20px rgba(0,0,0,0.5), 0 0 16px ${theme.glow}, inset 0 0 12px ${theme.glow}`
                : `0 2px 20px rgba(0,0,0,0.45), 0 0 10px ${theme.glow}, inset 0 0 8px ${theme.glow}`,
              transition: "all 0.35s ease",
            }}
          >
            {pushStatus === "subscribed" ? <BellFillIcon size={iconSize.sm} /> : <BellIcon size={iconSize.sm} />}
            {pushStatus === "subscribed" ? "Notifications on"
              : pushStatus === "denied" ? "Blocked"
              : pushStatus === "unsupported" ? "Unsupported"
              : "Enable notifications"}
          </button>
        </div>

        {openPanel && anchorRect && (
          <>
            {/* Click-outside-to-close overlay — fixed and beneath the
                popover, transparent, just here to catch the click. */}
            <div onClick={() => setOpenPanel(null)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />

            {/* Popover — position:fixed relative to the viewport (see
                anchorRect comment above). No connector arm — tried it,
                looked bad, dropped it; just a floating panel with a
                small gap above (or below, if flipped) the button now.
                maxHeight+scroll is a safety net: the flip heuristic
                picks whichever side has more room, but doesn't
                guarantee the content actually fits — an expanded
                provider list could still be taller than that. */}
            <div className="hide-scrollbar" style={{
              position: "fixed", left: anchorRect.popoverLeft,
              ...(anchorRect.top !== undefined ? { top: anchorRect.top } : { bottom: anchorRect.bottom }),
              width: Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_MARGIN * 2), // same width for all five panels
              maxHeight: "70vh", overflowY: "auto",
              zIndex: 21,
              background: theme.bubbleBg,
              border: `1px solid ${theme.bubbleBorder}`,
              borderRadius: radius.lg,
              boxShadow: `0 8px 30px rgba(0,0,0,0.5), 0 0 16px ${theme.glow}`,
              backdropFilter: `blur(${blur.md}px)`,
              padding: spacing.md,
              color: neutral.textPrimary,
              fontFamily,
            }}>
              {openPanel === "newConvo" && (
                <div>
                  <div style={{ fontSize: fontSize.sm, marginBottom: spacing.sm }}>
                    Start a new conversation? This clears the current chat.
                  </div>
                  <div style={{ display: "flex", gap: spacing.xs, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setOpenPanel(null)}
                      style={{
                        padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm,
                        border: `1px solid ${theme.bubbleBorder}`, background: "transparent",
                        color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xs, fontFamily,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { setMessages([]); setOpenPanel(null); }}
                      style={{
                        padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm,
                        border: `1px solid ${theme.bubbleBorder}`, background: neutral.surface,
                        color: neutral.textPrimary, cursor: "pointer", fontSize: fontSize.xs, fontFamily,
                        fontWeight: fontWeight.medium,
                      }}
                    >
                      Start new
                    </button>
                  </div>
                </div>
              )}

              {openPanel === "history" && (
                <div>
                  <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Past conversations
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {MOCK_HISTORY.map(h => (
                      <button
                        key={h.title}
                        onClick={() => setOpenPanel(null)}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: spacing.xs,
                          padding: spacing.xs, borderRadius: radius.sm, border: "none",
                          background: "transparent", cursor: "pointer", textAlign: "left",
                          width: "100%",
                        }}
                      >
                        {/* marginTop nudges the dot to sit level with the
                            title text specifically — center-aligning
                            against the whole two-line block (title +
                            timestamp) made it look off relative to the
                            title alone. */}
                        <span style={{
                          width: DOT_SIZE, height: DOT_SIZE, borderRadius: 9999, flexShrink: 0,
                          marginTop: 3,
                          background: MODE_THEME[h.mode].dot,
                        }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: fontSize.xs, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {h.title}
                          </div>
                          <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{h.timestamp}</div>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {openPanel === "models" && (
                <div>
                  <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Today's models — pick one for {MODE_THEME[chatMode].label}
                  </div>
                  {/* A provider catalog, not a per-task assignment table
                      — that's what Routing & Fallbacks is for. Each
                      provider expands to its available models, tagged
                      with what it's good at. Every model row (plus the
                      Auto row below) is selectable, scoped to whichever
                      chat mode is active — see modelOverride/
                      effectiveModel and the picker pill under the mode
                      selector. */}
                  <button
                    onClick={() => { setModelOverride(o => ({ ...o, [chatMode]: null })); setOpenPanel(null); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
                      width: "100%", padding: `${spacing.xs}px 0`,
                      border: "none", background: "transparent", cursor: "pointer",
                      color: neutral.textPrimary, fontFamily, fontSize: fontSize.xs,
                      marginBottom: spacing.xs,
                    }}
                  >
                    <span>Auto (recommended)</span>
                    {!modelOverride[chatMode] && <CheckIcon size={12} />}
                  </button>
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {PROVIDER_MODELS.map(p => {
                      const expanded = expandedProvider === p.provider;
                      return (
                        <div key={p.provider}>
                          <button
                            onClick={() => setExpandedProvider(e => (e === p.provider ? null : p.provider))}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              width: "100%", padding: `${spacing.xs}px 0`,
                              border: "none", background: "transparent", cursor: "pointer",
                              color: neutral.textPrimary, fontFamily,
                            }}
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.xs }}>
                              {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                              {p.provider}
                            </span>
                            <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
                              {p.models.length} model{p.models.length === 1 ? "" : "s"}
                            </span>
                          </button>
                          {expanded && (
                            <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm, paddingLeft: 20, paddingBottom: spacing.xs }}>
                              {p.models.map(m => {
                                const isSelected = effectiveModel.provider === p.provider && effectiveModel.model === m.name;
                                return (
                                  <button
                                    key={m.name}
                                    onClick={() => {
                                      setModelOverride(o => ({ ...o, [chatMode]: { provider: p.provider, model: m.name } }));
                                      setOpenPanel(null);
                                    }}
                                    style={{
                                      display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.xs,
                                      width: "100%", border: "none", background: "transparent", cursor: "pointer",
                                      textAlign: "left", padding: 0, fontFamily,
                                    }}
                                  >
                                    <span>
                                      <div style={{ fontSize: fontSize.xs, color: neutral.textPrimary }}>{m.name}</div>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                                        {m.tags.map(t => (
                                          <span key={t} style={{
                                            fontSize: 10, fontWeight: fontWeight.medium, padding: "2px 6px",
                                            borderRadius: 9999, background: TAG_COLOR[t].bg, color: TAG_COLOR[t].text,
                                          }}>
                                            {t}
                                          </span>
                                        ))}
                                        {m.note && (
                                          <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{m.note}</span>
                                        )}
                                      </div>
                                    </span>
                                    {isSelected && <CheckIcon size={12} />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {openPanel === "routing" && (
                <div>
                  <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Routing &amp; fallbacks
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
                    {ROUTING_CHAINS.map(r => (
                      <div key={r.label}>
                        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, marginBottom: 2 }}>
                          <span style={{
                            width: DOT_SIZE, height: DOT_SIZE, borderRadius: 9999, flexShrink: 0,
                            background: r.dotColor ?? neutral.dotNeutral,
                          }} />
                          <span style={{ fontSize: fontSize.xs }}>{r.label}</span>
                        </div>
                        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, paddingLeft: DOT_SIZE + spacing.xs }}>
                          {r.chain.join(" → ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {openPanel === "usage" && (
                <div>
                  <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, marginBottom: spacing.md }}>
                    Usage counters
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
                    {USAGE_COUNTERS.map(u => {
                      const pct = u.quota > 0 ? Math.min(100, (u.used / u.quota) * 100) : 0;
                      const barColor = pct > 90 ? "rgba(230,90,90,0.85)" : pct > 70 ? "rgba(230,180,80,0.85)" : "rgba(120,200,150,0.85)";
                      return (
                        <div key={u.provider}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: fontSize.xs, marginBottom: spacing.xs }}>
                            <span>{u.provider}</span>
                            <span style={{ color: neutral.textMuted, fontSize: fontSize.xxs }}>
                              {u.quota > 0 ? `${u.used.toLocaleString()} / ${u.quota.toLocaleString()} ${u.unit} · ${u.period}` : "no quota tracked"}
                            </span>
                          </div>
                          {u.quota > 0 && (
                            <div style={{ height: 4, borderRadius: 9999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 9999, background: barColor }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div style={{
          display: "flex", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.lg,
          padding: spacing.sm, borderRadius: radius.xl,
          background: neutral.surface,
          border: `1px solid ${theme.bubbleBorder}`,
          boxShadow: `0 0 14px ${theme.glow}`,
          backdropFilter: `blur(${blur.md}px)`,
        }}>
          <button
            aria-label="Attach file"
            title="Attach file"
            style={{
              width: controlSize.md, height: controlSize.md, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: radius.md, border: "none", cursor: "pointer",
              background: "transparent", color: neutral.textMuted,
            }}
          >
            <PaperclipIcon size={iconSize.md} />
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            placeholder="Message NAVI..."
            rows={1}
            className="hide-scrollbar"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none", resize: "none",
              color: neutral.textPrimary, fontSize: fontSize.sm, padding: `${spacing.sm}px ${spacing.md}px`,
              fontFamily, lineHeight: `${INPUT_LINE_HEIGHT}px`,
              maxHeight: INPUT_LINE_HEIGHT * INPUT_MAX_LINES, overflowY: "auto",
            }}
          />
          <button
            onClick={sendMessage}
            aria-label="Send"
            title="Send"
            style={{
              width: controlSize.md, height: controlSize.md, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: radius.md, border: `1px solid ${theme.bubbleBorder}`, cursor: "pointer",
              background: theme.bubbleBg, color: neutral.textPrimary,
              boxShadow: `0 0 12px ${theme.glow}`,
              transition: "all 0.3s ease",
            }}
          >
            <PaperAirplaneIcon size={iconSize.md} />
          </button>
        </div>
      </div>
    </div>
  );
}
