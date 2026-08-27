import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  PaperAirplaneIcon,
  CommandPaletteIcon,
  GitBranchIcon,
  PlusIcon,
  HistoryIcon,
  CpuIcon,
  GraphIcon,
  PinIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  FileIcon,
  DownloadIcon,
  GlobeIcon,
  // Reserved for the future step-log UI (not built yet — no host for
  // these until the fairy-animation research mode exists to pair with):
  // SearchIcon, SyncIcon
} from "@primer/octicons-react";
import {
  type Mode, type ChatMode, MODE_THEME,
  spacing, radius, fontSize, fontWeight, lineHeight, iconSize, controlSize, blur,
  fontFamily, neutral,
} from "./tokens";
import {
  type StoredMessage, type Conversation,
  getActiveConversationId, loadConversation, saveConversation,
  createConversation, listConversations, switchActiveConversation, deriveTitle,
} from "./storage";
import { NAVI_BACKEND_URL } from "./config";

const DOT_SIZE = 8;

// Render's free tier spins the server down after ~15min idle; a cold
// start can take anywhere from a few seconds to over a minute. Without
// this, the first fetch after a spin-down just fails outright and the
// message is effectively lost (the user has to notice the error and
// retype it) — so on failure, poll this cheap health check until the
// server answers instead of giving up immediately.
const WAKE_POLL_INTERVAL_MS = 5000;
const WAKE_MAX_WAIT_MS = 90000;

async function waitForServer(onStatus: (msg: string) => void): Promise<boolean> {
  const deadline = Date.now() + WAKE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(NAVI_BACKEND_URL, { method: "GET" });
      if (res.ok) return true;
    } catch {
      // still asleep/booting — keep polling
    }
    onStatus("Waking up NAVI…");
    await new Promise(r => setTimeout(r, WAKE_POLL_INTERVAL_MS));
  }
  return false;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// "Today" / "Yesterday" / a real date — the day divider inserted
// between messages that cross midnight. Compares calendar days, not
// 24h windows, so a message at 00:05 correctly gets its own divider
// even though it's minutes after one at 23:58.
function formatDayLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "long", day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

// Real provider/model data, fetched from NAVI's own config at
// /config/routing (see server.py) instead of hardcoded here — this used
// to be a static mock that silently drifted from whatever NAVI was
// actually configured to use. See RoutingConfig/useEffect fetch below.
type ModelEntry = { provider: string; model: string };
interface RoutingConfig {
  roles: { dispatcher_chat: ModelEntry | null; dispatcher_autonomous: ModelEntry | null };
  task_routing: Record<string, { primary: ModelEntry | null; fallback: ModelEntry[] } | null>;
  enabled_providers: string[];
}

// Display label + (for /research, which maps to a chat mode) the dot
// color carried over from that mode's theme — /code, /graph-data, and
// /create-image aren't chat modes, so they get no dot. No "brainstorm"
// entry — the /brainstorm command was retired in favor of Brainstorm
// mode's own conversational chat, which does its job better.
const COMMAND_ROUTING_LABEL: Record<string, { label: string; dotColor?: string }> = {
  research: { label: "Research", dotColor: MODE_THEME.research.dot },
  code: { label: "Code" },
  "graph-data": { label: "Graphs" },
  "create-image": { label: "Images" },
};

// USAGE_COUNTERS stays a mock on purpose — NAVI doesn't track real usage
// anywhere yet (no persisted counters), so wiring this panel to real data
// means building actual instrumentation, not just reading existing state.
// Deliberately left as-is rather than silently pretending it's live.
const USAGE_COUNTERS: { provider: string; used: number; quota: number; unit: string; period: string }[] = [
  { provider: "Groq", used: 640, quota: 1000, unit: "requests", period: "today" },
  { provider: "Cloudflare", used: 3200, quota: 10000, unit: "Neurons", period: "this week" },
  { provider: "OpenRouter", used: 12, quota: 50, unit: "requests", period: "today" },
  { provider: "OVHcloud", used: 4, quota: 0, unit: "requests", period: "today" }, // 0 quota = untracked anonymous tier
];

// The command list shown in the toolbar's "Commands" panel. `available`
// tracks what NAVI's parser actually recognizes today (see COMMANDS in
// dispatcher/parser.py) versus what's agreed for a later version — kept
// visible either way so the panel doubles as a roadmap, but greyed out
// and labeled so tapping a not-yet-real one doesn't look broken.
const COMMANDS: { name: string; description: string; available: boolean }[] = [
  { name: "/research", description: "Deep dive with live web search, source reading, and notes.", available: true },
  { name: "/graph-data", description: "Turns numbers into a real rendered chart instead of a described one.", available: true },
  { name: "/create-image", description: "Generates an image from a text description.", available: true },
  { name: "/code", description: "Routes to a coding-specialist model for code-focused requests.", available: true },
  { name: "/summarize", description: "Condenses a long article, PDF, or posting into a tight digest.", available: true },
  { name: "/remind", description: "Sets a reminder that arrives as a push notification when it's due.", available: true },
  { name: "/tailor", description: "Drafts a tailored cover note and company rundown from a job posting + your CV.", available: true },
  { name: "/design-read", description: "Reads a design screenshot and describes the pattern, plus a ready prompt for Claude Code.", available: false },
  { name: "/recap", description: "Captures findings and decisions from this conversation as a structured summary.", available: true },
  { name: "/note", description: "Lightly captures a passing thought or tangent — no structure forced.", available: true },
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

// Typewriter-reveal for a message that just arrived live (a real send,
// or a push) — history loaded from storage renders instantly instead
// (see hydratedCountRef). Owns its own reveal-progress state rather
// than lifting it to the parent: this way each animating bubble
// re-renders itself every ~18ms, not the whole message list.
// NAVI has no real attachment channel to the PWA the way Telegram gets
// real file uploads — a saved artifact reaches here as plain
// "📎 filename: url" (download) and, for /code's viewable HTML output,
// an additional "🌐 filename: url" (view) line appended to the reply
// text (see server.py's _pwa_download_links). Parsed out at render
// time rather than changing what's stored, so a saved file becomes
// real chip/button(s) below the message instead of a raw URL sitting
// in the middle of the prose.
const DOWNLOAD_LINE_RE = /📎 (.+?): (https?:\/\/\S+)/g;
const VIEW_LINE_RE = /🌐 (.+?): (https?:\/\/\S+)/g;

interface MessageAttachment {
  filename: string;
  downloadUrl: string;
  viewUrl?: string;
}

function splitMessageAttachments(text: string): { body: string; attachments: MessageAttachment[] } {
  const byFilename = new Map<string, MessageAttachment>();
  let body = text.replace(DOWNLOAD_LINE_RE, (_match, filename: string, url: string) => {
    byFilename.set(filename, { filename, downloadUrl: url });
    return "";
  });
  body = body.replace(VIEW_LINE_RE, (_match, filename: string, url: string) => {
    const existing = byFilename.get(filename);
    if (existing) existing.viewUrl = url;
    else byFilename.set(filename, { filename, downloadUrl: url, viewUrl: url });
    return "";
  }).trim();
  const attachments = Array.from(byFilename.values());
  return { body, attachments };
}

// Renders fenced ```lang\n...\n``` blocks (from /code's replies, or any
// message that happens to include one) as real styled code blocks —
// monospace, bordered, horizontally scrollable — instead of plain prose
// with literal backticks sitting in the middle of it. Not full syntax
// highlighting (no new dependency for that), just properly distinguished
// from body text. Works against whatever's been revealed so far, so an
// in-progress fence just renders as plain text until it closes rather
// than needing special partial-block handling.
const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;

function renderMessageBody(text: string) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  CODE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={key++} style={{ whiteSpace: "pre-wrap" }}>{text.slice(lastIndex, match.index)}</span>
      );
    }
    const code = match[2].replace(/\n$/, "");
    nodes.push(
      <pre key={key++} style={{
        margin: `${spacing.xs}px 0`, padding: spacing.sm,
        borderRadius: radius.sm, background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.1)",
        overflowX: "auto", fontSize: fontSize.xs,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      }}>
        <code>{code}</code>
      </pre>
    );
    lastIndex = CODE_BLOCK_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(<span key={key++} style={{ whiteSpace: "pre-wrap" }}>{text.slice(lastIndex)}</span>);
  }
  return nodes;
}

function StreamingMessageText({ text, animate }: { text: string; animate: boolean }) {
  const [revealed, setRevealed] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate || revealed >= text.length) return;
    const id = setTimeout(() => setRevealed(r => Math.min(text.length, r + 2)), 18);
    return () => clearTimeout(id);
  }, [animate, revealed, text.length]);

  return <>{renderMessageBody(text.slice(0, revealed))}</>;
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

  // Chat state for whichever conversation is currently active — empty
  // until the load effect below hydrates it (real conversation, or a
  // freshly created one on a genuinely first-ever launch).
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  // Which conversation `messages` belongs to — a ref, not state, since
  // writing it should never itself trigger a re-render (only `messages`
  // changing should). Read by the save effect and by loadConversation
  // when switching.
  const activeConversationIdRef = useRef<string | null>(null);
  // Guards the save effect below from firing before the load effect has
  // had a chance to run — without this, mounting would immediately
  // persist an empty array over whatever was actually stored, since both
  // effects fire on the same initial render.
  const loadedFromStorage = useRef(false);
  // How many messages existed at hydration — anything at or past this
  // index arrived live during the session (a real send, or a push) and
  // gets the streaming-text reveal; anything before it is history and
  // renders instantly. Starts at Infinity so nothing streams before the
  // real baseline is set (hydration is async).
  const hydratedCountRef = useRef(Infinity);

  // Loads whichever conversation was last active, or creates a fresh one
  // on a genuinely first-ever launch (no active id yet, or the id points
  // at a conversation that's somehow gone missing).
  // Guards against StrictMode's double-invoke: without this, both
  // invocations' async getActiveConversationId() calls can resolve null
  // before either commits a newly-created conversation as active, so both
  // branches call createConversation() and two empty conversations get made.
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    (async () => {
      const activeId = await getActiveConversationId();
      const conversation = (activeId && await loadConversation(activeId)) || await createConversation(chatModeRef.current);
      activeConversationIdRef.current = conversation.id;
      setMessages(conversation.messages);
      hydratedCountRef.current = conversation.messages.length;
      selectChatMode(conversation.mode);
      loadedFromStorage.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadedFromStorage.current) return;
    const id = activeConversationIdRef.current;
    if (!id) return;
    saveConversation({
      id,
      title: deriveTitle(messages),
      mode: chatModeRef.current,
      updatedAt: messages.length ? messages[messages.length - 1].timestamp : Date.now(),
      messages,
    });
  }, [messages]);

  // The "working" label shown in place of a reply while one's being
  // generated — declared up here (ahead of where it's first used, below)
  // because the push-listener effect right after this needs
  // stopResearchPoll, and JS's TDZ means a const used inside an earlier
  // effect can't be declared further down in the same component body,
  // even though the effect itself only actually runs later.
  const [pendingStep, setPendingStep] = useState<string | null>(null);
  // Holds the setInterval id while polling /research/status for an
  // in-flight async job — a plain ref since it doesn't drive rendering.
  const researchPollRef = useRef<number | null>(null);
  const stopResearchPoll = useCallback(() => {
    if (researchPollRef.current !== null) {
      clearInterval(researchPollRef.current);
      researchPollRef.current = null;
    }
  }, []);

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
        // A pushed message arriving is also how an async job (currently
        // just /research) signals it's actually done — stop polling for
        // status and clear the pending indicator. Harmless no-op if
        // neither was active (an ordinary Telegram-originated push).
        stopResearchPoll();
        setPendingStep(null);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [stopResearchPoll]);

  // Flattens messages + day dividers into one render list, computed in
  // chronological order (oldest→newest, matching `messages` itself)
  // then reversed for DOM order — same trick as the plain message
  // list below, needed because column-reverse means DOM-first renders
  // visually last. A divider goes in front of the first message of
  // each new calendar day; reversing afterward keeps it directly above
  // that message in the actual visual (oldest-at-top) reading order.
  type RenderItem =
    | { kind: "divider"; key: string; label: string }
    | { kind: "message"; key: string; message: StoredMessage; index: number };
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    let lastDay: string | null = null;
    messages.forEach((m, i) => {
      const day = new Date(m.timestamp).toDateString();
      if (day !== lastDay) {
        items.push({ kind: "divider", key: `divider-${day}`, label: formatDayLabel(m.timestamp) });
        lastDay = day;
      }
      items.push({ kind: "message", key: `msg-${i}`, message: m, index: i });
    });
    return [...items].reverse();
  }, [messages]);

  // Real provider/model roster from NAVI itself — see RoutingConfig above
  // and GET /config/routing in server.py. Null until the fetch resolves;
  // every consumer below has to handle that (loading, or the backend
  // being asleep — Render free tier).
  const [routingConfig, setRoutingConfig] = useState<RoutingConfig | null>(null);
  useEffect(() => {
    fetch(`${NAVI_BACKEND_URL}/config/routing`)
      .then(res => res.json())
      .then(setRoutingConfig)
      .catch(() => {}); // panels just show their loading/empty state
  }, []);

  // Server-awake indicator (top-right dot). A plain fetch can't tell
  // "asleep" apart from "just slow" on its own — Render's cold start is
  // itself just a slow response to the same request — so this races the
  // health check against a short timer: still no answer after 3s reads
  // as "waking up" (cold-starting), a response after that flips it to
  // "awake". The fetch is never aborted on that timer, since we still
  // want it to actually finish waking the server up.
  type ServerStatus = "checking" | "awake" | "waking" | "unreachable";
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  useEffect(() => {
    let cancelled = false;

    const checkStatus = () => {
      const slowTimer = window.setTimeout(() => {
        if (!cancelled) setServerStatus("waking");
      }, 3000);

      fetch(NAVI_BACKEND_URL)
        .then(res => {
          window.clearTimeout(slowTimer);
          if (!cancelled) setServerStatus(res.ok ? "awake" : "unreachable");
        })
        .catch(() => {
          window.clearTimeout(slowTimer);
          if (!cancelled) setServerStatus("unreachable");
        });
    };

    checkStatus();
    const interval = window.setInterval(checkStatus, 60000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  // "Today's models" catalog, grouped by provider, derived from every
  // (provider, model) pair NAVI is actually configured to use — the
  // dispatcher roles plus every command's primary/fallback chain. A model
  // used in more than one place (e.g. a fallback shared across commands)
  // collects all its usage labels rather than appearing twice.
  const providerModels = useMemo(() => {
    if (!routingConfig) return [];
    const byProvider = new Map<string, Map<string, string[]>>();
    const add = (entry: ModelEntry | null | undefined, label: string) => {
      if (!entry) return;
      const models = byProvider.get(entry.provider) ?? new Map<string, string[]>();
      const labels = models.get(entry.model) ?? [];
      labels.push(label);
      models.set(entry.model, labels);
      byProvider.set(entry.provider, models);
    };
    add(routingConfig.roles.dispatcher_chat, "Normal chat");
    add(routingConfig.roles.dispatcher_autonomous, "Autonomous jobs");
    for (const [cmd, routing] of Object.entries(routingConfig.task_routing)) {
      if (!routing?.primary) continue;
      const cmdLabel = COMMAND_ROUTING_LABEL[cmd]?.label ?? cmd;
      add(routing.primary, `/${cmd}`);
      routing.fallback.forEach(fb => add(fb, `${cmdLabel} fallback`));
    }
    return Array.from(byProvider.entries()).map(([provider, models]) => ({
      provider,
      models: Array.from(models.entries()).map(([name, labels]) => ({ name, labels })),
    }));
  }, [routingConfig]);

  // "Routing & fallbacks" chains, one per command that has a primary
  // configured — plus Normal Chat, which comes from the dispatcher_chat
  // role rather than task_routing.
  const routingChains = useMemo(() => {
    if (!routingConfig) return [];
    const chains: { label: string; chain: string[]; dotColor?: string }[] = [];
    const chat = routingConfig.roles.dispatcher_chat;
    if (chat) chains.push({ label: "Normal Chat", chain: [`${chat.provider} · ${chat.model}`], dotColor: MODE_THEME.normal.dot });
    for (const [cmd, routing] of Object.entries(routingConfig.task_routing)) {
      if (!routing?.primary) continue;
      const meta = COMMAND_ROUTING_LABEL[cmd] ?? { label: cmd };
      const chain = [routing.primary, ...routing.fallback].map(e => `${e.provider} · ${e.model}`);
      chains.push({ label: meta.label, chain, dotColor: meta.dotColor });
    }
    return chains;
  }, [routingConfig]);

  const [draft, setDraft] = useState("");
  // Which toolbar popover is open, if any — only one at a time.
  const [openPanel, setOpenPanel] = useState<"newConvo" | "history" | "models" | "routing" | "usage" | "commands" | null>(null);
  // Real saved conversations for the "Past conversations" panel —
  // refreshed each time that panel opens (see the effect below) rather
  // than kept live at all times, since it's the only place this list is
  // shown.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  useEffect(() => {
    if (openPanel !== "history") return;
    listConversations().then(setConversations);
  }, [openPanel]);

  // Loads a saved conversation into view, replacing whatever's currently
  // showing. Switches the active-conversation pointer in storage too, so
  // a push arriving afterward (or the next launch) lands here, not back
  // on the conversation this replaced.
  const openConversation = useCallback(async (conversation: Conversation) => {
    await switchActiveConversation(conversation.id);
    activeConversationIdRef.current = conversation.id;
    setMessages(conversation.messages);
    hydratedCountRef.current = conversation.messages.length;
    selectChatMode(conversation.mode);
    setOpenPanel(null);
  }, [selectChatMode]);

  const startNewConversation = useCallback(async () => {
    const conversation = await createConversation(chatModeRef.current);
    activeConversationIdRef.current = conversation.id;
    setMessages([]);
    hydratedCountRef.current = 0;
    setOpenPanel(null);
  }, []);
  // Which provider row is expanded in the "Today's models" catalog.
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  // Manual model pick per mode — null means "use the auto-routed
  // default". Scoped per-mode rather than one global override, since
  // each mode already has its own task/model role.
  const [modelOverride, setModelOverride] = useState<Record<ChatMode, { provider: string; model: string } | null>>({
    normal: null, research: null, brainstorm: null,
  });
  // The real auto-routed default — the same dispatcher_chat model
  // answers every mode's free-form chat; only the system prompt and
  // allowed tools change per mode (see dispatcher/modes/ + dispatcher/
  // chat.py in NAVI). A typed /research command still uses its own
  // task_routing model — this pill is about what answers your actual
  // chat messages, not the slash commands.
  const autoModelFor = useCallback((_mode: ChatMode): ModelEntry | null => {
    return routingConfig?.roles.dispatcher_chat ?? null;
  }, [routingConfig]);
  // The model actually in effect for the current mode — a manual pick if
  // one exists, otherwise the real auto-routed default (or a loading
  // placeholder while /config/routing hasn't resolved yet).
  const effectiveModel = modelOverride[chatMode] ?? autoModelFor(chatMode) ?? { provider: "—", model: "loading…" };
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

  // Real backend call to NAVI's /chat/send — see server.py. The step
  // label shown while pending is real (a genuine wait, not a fake timed
  // sequence like before). Most replies clear it once the response
  // lands; a /research command is different — the backend acks
  // immediately ({async: true}) and finishes the actual work in the
  // background, so pendingStep instead switches to polling
  // /research/status for live progress until the real result arrives
  // via push (see the "navi-message" listener below, which stops the
  // poll and clears pendingStep once that happens).
  const sendMessage = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setMessages(m => [...m, { role: "user", text, timestamp: Date.now() }]);
    setDraft("");

    // A research poll already tracking an in-flight async job takes
    // priority over this message's own transient status — without this,
    // sending a plain message while /research is still running stomps
    // the live "gathering sources…" status with "Thinking…", then clears
    // it outright once the plain reply lands, even though the research
    // job is still working. The poll interval itself is untouched and
    // does self-correct within ~3s, but that's still a visibly wrong or
    // blank status in the meantime — this avoids the whole window.
    const asyncJobActive = () => researchPollRef.current !== null;

    const firstStep = chatModeRef.current === "research" ? "Searching…"
      : chatModeRef.current === "brainstorm" ? "Exploring ideas…"
      : "Thinking…";
    if (!asyncJobActive()) setPendingStep(firstStep);

    const handleResponse = (data: { reply?: string; error?: string; async?: boolean }) => {
      setMessages(m => [...m, {
        role: "navi",
        text: data.reply ?? data.error ?? "(empty reply)",
        timestamp: Date.now(),
      }]);

      if (data.async) {
        // Keep pendingStep alive — the real result hasn't arrived yet,
        // only an ack that the job started. Poll for progress until
        // the push-delivered result clears it.
        stopResearchPoll();
        researchPollRef.current = window.setInterval(() => {
          fetch(`${NAVI_BACKEND_URL}/research/status`)
            .then(res => res.json())
            .then((s: { status?: string | null }) => {
              if (s.status) setPendingStep(s.status);
            })
            .catch(() => {}); // a missed poll tick just tries again next interval
        }, 3000);
        return;
      }

      if (!asyncJobActive()) setPendingStep(null);
      if (chatModeRef.current === "research") {
        celebrateUntilRef.current = fairyTickRef.current + 600; // 10s at 60fps
      }
    };

    const send = () => fetch(`${NAVI_BACKEND_URL}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode: chatModeRef.current }),
    }).then(res => res.json());

    send()
      .then(handleResponse)
      .catch(async () => {
        // First attempt failing usually means the server was asleep and
        // the cold-start request just errored out instead of waiting —
        // poll the health check until it answers, then retry the real
        // send once, rather than losing the message outright.
        if (!asyncJobActive()) setPendingStep("Waking up NAVI…");
        const awake = await waitForServer(msg => { if (!asyncJobActive()) setPendingStep(msg); });
        if (!awake) {
          if (!asyncJobActive()) setPendingStep(null);
          setMessages(m => [...m, {
            role: "navi",
            text: "Couldn't reach NAVI after a while — it may be down. Try again shortly.",
            timestamp: Date.now(),
          }]);
          return;
        }
        send().then(handleResponse).catch(() => {
          if (!asyncJobActive()) setPendingStep(null);
          setMessages(m => [...m, {
            role: "navi",
            text: "NAVI woke up but the reply itself failed — try sending again.",
            timestamp: Date.now(),
          }]);
        });
      });
  }, [draft, stopResearchPoll]);

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

      {/* Server status — top-right. A glance-able answer to "is NAVI
          asleep right now" (Render free tier spins down after 15min
          idle) without having to send a message and wait to find out. */}
      <div
        title={
          serverStatus === "awake" ? "NAVI is awake"
            : serverStatus === "waking" ? "NAVI is waking up (cold start)…"
            : serverStatus === "unreachable" ? "Can't reach NAVI"
            : "Checking…"
        }
        style={{
          position: "absolute", top: spacing.xl, right: spacing.xl,
          display: "flex", alignItems: "center", gap: spacing.xs,
          zIndex: 10,
        }}
      >
        <span style={{
          width: DOT_SIZE, height: DOT_SIZE, borderRadius: 9999, flexShrink: 0,
          background: serverStatus === "awake" ? neutral.statusAwake
            : serverStatus === "waking" ? neutral.statusWaking
            : serverStatus === "unreachable" ? neutral.statusUnreachable
            : neutral.dotNeutral,
          transition: "background 0.3s ease",
        }} />
        <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
          {serverStatus === "awake" ? "Online"
            : serverStatus === "waking" ? "Waking up…"
            : serverStatus === "unreachable" ? "Unreachable"
            : "Checking…"}
        </span>
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
          {/* Pending-reply indicator — DOM-first (before renderItems, not
              after) so column-reverse places it at the very bottom,
              exactly where the real reply will land once it arrives. */}
          {pendingStep && (
            <div className="step-pulse" style={{
              alignSelf: "flex-start", maxWidth: "78%",
              padding: `${spacing.md - 1}px ${spacing.lg}px`,
              borderRadius: radius.lg,
              fontSize: fontSize.sm,
              color: neutral.textMuted,
              backdropFilter: `blur(${blur.lg}px)`,
              background: theme.bubbleBg,
              border: `1px solid ${theme.bubbleBorder}`,
              boxShadow: `0 4px 18px rgba(0,0,0,0.35), 0 0 14px ${theme.glow}`,
            }}>
              {pendingStep}
            </div>
          )}
          {renderItems.map(item => {
            if (item.kind === "divider") {
              return (
                <div key={item.key} style={{
                  alignSelf: "center", fontSize: fontSize.xxs, color: neutral.textMuted,
                  padding: `${spacing.xxs}px ${spacing.md}px`, borderRadius: radius.sm,
                  background: "rgba(255,255,255,0.06)",
                }}>
                  {item.label}
                </div>
              );
            }
            const m = item.message;
            const { body, attachments } = splitMessageAttachments(m.text);
            return (
              <div key={item.key} style={{
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
                <StreamingMessageText
                  text={body}
                  animate={m.role === "navi" && item.index >= hydratedCountRef.current}
                />
                {attachments.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs, marginTop: spacing.sm }}>
                    {attachments.map(a => (
                      <div
                        key={a.filename}
                        style={{
                          display: "flex", alignItems: "center", gap: spacing.xs,
                          padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.sm,
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          fontSize: fontSize.xs,
                        }}
                      >
                        <FileIcon size={iconSize.sm} />
                        <span style={{
                          flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", color: neutral.textPrimary,
                        }}>
                          {a.filename}
                        </span>
                        {/* View only shows up for /code's bundled-HTML
                            output (viewUrl set) — every other saved file
                            only ever gets a download action. */}
                        {a.viewUrl && (
                          <a
                            href={a.viewUrl} target="_blank" rel="noopener noreferrer"
                            title="View" aria-label="View in browser"
                            style={{ display: "flex", flexShrink: 0, color: neutral.textMuted }}
                          >
                            <GlobeIcon size={iconSize.sm} />
                          </a>
                        )}
                        <a
                          href={a.downloadUrl} target="_blank" rel="noopener noreferrer"
                          title="Download" aria-label="Download"
                          style={{ display: "flex", flexShrink: 0, color: neutral.textMuted }}
                        >
                          <DownloadIcon size={iconSize.sm} />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{
                  display: "flex",
                  justifyContent: m.role === "navi" ? "space-between" : "flex-end",
                  alignItems: "center", marginTop: spacing.xs, gap: spacing.xs,
                }}>
                  <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
                    {formatTime(m.timestamp)}
                  </span>
                  {m.role === "navi" && (
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
                  )}
                </div>
              </div>
            );
          })}
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
                    Start a new conversation? The current one is saved — find it under Past conversations.
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
                      onClick={startNewConversation}
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
                  {conversations.length === 0 && (
                    <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>
                      Nothing saved yet.
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {conversations.map(c => (
                      <button
                        key={c.id}
                        onClick={() => openConversation(c)}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: spacing.xs,
                          padding: spacing.xs, borderRadius: radius.sm, border: "none",
                          background: c.id === activeConversationIdRef.current ? "rgba(255,255,255,0.06)" : "transparent",
                          cursor: "pointer", textAlign: "left",
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
                          background: MODE_THEME[c.mode].dot,
                        }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: fontSize.xs, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.title}
                          </div>
                          <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
                            {formatDayLabel(c.updatedAt)}, {formatTime(c.updatedAt)}
                          </div>
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
                      provider expands to its available models, labeled
                      with where NAVI actually uses each one. Every model
                      row (plus the Auto row below) is selectable, scoped
                      to whichever chat mode is active — see
                      modelOverride/effectiveModel and the picker pill
                      under the mode selector. Data comes from
                      /config/routing (routingConfig) — empty until that
                      fetch resolves. */}
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
                  {!routingConfig && (
                    <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {providerModels.map(p => {
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
                                      <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginTop: 2 }}>
                                        {m.labels.join(" · ")}
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
                  {!routingConfig && (
                    <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
                    {routingChains.map(r => (
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

              {openPanel === "commands" && (
                <div>
                  <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Commands
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
                    {COMMANDS.map(c => (
                      <div key={c.name} style={{ opacity: c.available ? 1 : 0.5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.xs, color: neutral.textPrimary }}>
                          {c.name}
                          {!c.available && (
                            <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>(coming soon)</span>
                          )}
                        </div>
                        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginTop: 2 }}>
                          {c.description}
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
            aria-label="Commands"
            title="Commands"
            onClick={e => togglePanel("commands", e.currentTarget)}
            style={{
              width: controlSize.md, height: controlSize.md, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: radius.md, border: "none", cursor: "pointer",
              background: "transparent", color: neutral.textMuted,
            }}
          >
            <CommandPaletteIcon size={iconSize.md} />
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
