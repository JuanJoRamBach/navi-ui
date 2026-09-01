import { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from "react";
import {
  PaperAirplaneIcon,
  CommandPaletteIcon,
  GitBranchIcon,
  PlusIcon,
  CpuIcon,
  GraphIcon,
  PinIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  FileIcon,
  DownloadIcon,
  GlobeIcon,
  BellIcon,
  BellFillIcon,
  ThreeBarsIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  XIcon,
  GearIcon,
  SearchIcon,
  BookIcon,
  AlertIcon,
  FileDirectoryIcon,
  ChevronLeftIcon,
  UploadIcon,
  CommentDiscussionIcon,
  RocketIcon,
  CodeIcon,
  PulseIcon,
  HomeIcon,
  CalendarIcon,
  HistoryIcon,
  LinkIcon,
  // Reserved for the future step-log UI (not built yet — no host for
  // these until the fairy-animation research mode exists to pair with):
  // SearchIcon, SyncIcon
} from "@primer/octicons-react";
import {
  type Mode, type ChatMode, MODE_THEME, CANVAS_ACCENT, OKLCH_HUE,
  spacing, radius, fontSize, fontWeight, lineHeight, iconSize, controlSize,
  fontFamily, neutral, layout,
} from "./tokens";
import {
  type StoredMessage, type Conversation, type MessageAttachment, type BranchListItem, type Project,
  getActiveConversationId, loadConversation, saveConversation,
  createConversation, listBranches, getMainConversationId, switchActiveConversation, deriveTitle,
  parseAttachments, parseCommand,
  listProjects, createProject, switchActiveProject, getActiveProjectId,
} from "./storage";
import { Group, Panel, Separator, type LayoutChangedMeta } from "react-resizable-panels";
import { sidebarTab, sidebarBreadcrumb, sidebarRow } from "./sidebar-tokens";
import { isTextLike } from "./fileFormats";
// pdf.js/docx-preview are heavy (real PDF/DOCX rendering) — lazy so
// they only load once someone actually opens a document, not on every
// app load. isTextLike/extensionOf stay a normal import since they're
// tiny and needed synchronously (openFile, above).
const DocumentViewer = lazy(() => import("./DocumentViewer").then(m => ({ default: m.DocumentViewer })));
import { NAVI_BACKEND_URL } from "./config";
import { getPushStatus, subscribeToPush, type PushStatus } from "./push";
import { DevSlateDockview } from "./DevSlateDockview";
import { useDevSlateState } from "./devslateStore";

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
  roles: { normal_chat: ModelEntry | null; dispatcher_autonomous: ModelEntry | null };
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

// The list-building half of this (which filenames/URLs exist) now lives
// in storage.ts as parseAttachments — shared with sw.ts's push handler
// and the Activity panel, neither of which render anything. Only the
// body-stripping (removing the 📎/🌐 lines from displayed text) stays
// here, since that's genuinely rendering-only.
function splitMessageAttachments(text: string): { body: string; attachments: MessageAttachment[] } {
  const attachments = parseAttachments(text);
  const body = text.replace(DOWNLOAD_LINE_RE, "").replace(VIEW_LINE_RE, "").trim();
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
      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, w, h);

      /* Light effects (orbs, swirl, drifting particles, Research-mode
         fairies) — disabled 2026-08-31, JuanJo's call moving toward a
         soberer visual direction. Commented out, not deleted: the
         canvas still clears to a flat background color every frame
         (see fillRect above) so layout is unaffected, this block is
         just never reached. Re-enable by removing this comment wrap. */
      /*
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
      */

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
  // Activity panel's data — derived from `messages`, not its own stored
  // list, since command/attachments already live on the messages
  // themselves (parseCommand/parseAttachments in sendMessage and sw.ts).
  // Pairs each command-bearing user message with whatever files the very
  // next message (the navi reply to it) produced — correct for the
  // synchronous case; for /research's async push delivery, the "next"
  // message chronologically. is that same reply once it lands, so this
  // still holds. Newest first, matching Past conversations' ordering.
  const activityItems = useMemo(() => {
    const items: { command: string; timestamp: number; attachments: MessageAttachment[] }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "user" || !m.command) continue;
      const next = messages[i + 1];
      items.push({
        command: m.command,
        timestamp: m.timestamp,
        attachments: (next?.role === "navi" && next.attachments) || [],
      });
    }
    return items.reverse();
  }, [messages]);
  // Which conversation `messages` belongs to — a ref, not state, since
  // writing it should never itself trigger a re-render (only `messages`
  // changing should). Read by the save effect and by loadConversation
  // when switching.
  const activeConversationIdRef = useRef<string | null>(null);
  // Mirrors the active conversation's own parentId (undefined for a
  // normal top-level chat) — needed in a ref, not just state, so the
  // messages-changed save effect below can include it on every save
  // without the effect depending on it (parentId never changes for a
  // conversation's lifetime once created, only messages do).
  const activeConversationParentIdRef = useRef<string | undefined>(undefined);
  // Mirrors the active conversation's own projectId — same reasoning as
  // parentIdRef above: the save effect needs it on every save without
  // depending on it, since a conversation's project never changes once
  // created.
  const activeConversationProjectIdRef = useRef<string>("");
  // Drives the in-chat "Branched from X" pill — id kept alongside the
  // title so clicking it can jump straight to the parent without a
  // second lookup.
  const [currentParentChat, setCurrentParentChat] = useState<{ id: string; title: string } | null>(null);
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
      activeConversationParentIdRef.current = conversation.parentId;
      activeConversationProjectIdRef.current = conversation.projectId;
      setMessages(conversation.messages);
      hydratedCountRef.current = conversation.messages.length;
      selectChatMode(conversation.mode);
      loadedFromStorage.current = true;
      if (conversation.parentId) {
        const parent = await loadConversation(conversation.parentId);
        if (parent) setCurrentParentChat({ id: parent.id, title: parent.title });
      }
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
      projectId: activeConversationProjectIdRef.current,
      ...(activeConversationParentIdRef.current ? { parentId: activeConversationParentIdRef.current } : {}),
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
    add(routingConfig.roles.normal_chat, "Normal chat");
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
  // configured — plus Normal Chat, which comes from the normal_chat
  // role rather than task_routing.
  const routingChains = useMemo(() => {
    if (!routingConfig) return [];
    const chains: { label: string; chain: string[]; dotColor?: string }[] = [];
    const chat = routingConfig.roles.normal_chat;
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
  const [openPanel, setOpenPanel] = useState<"branches" | "models" | "routing" | "usage" | "settings" | "commands" | "projects" | "builds" | "agents" | "connections" | null>(null);
  // V3 sidebar (menu drawer on mobile/tablet, persistent column on
  // desktop — see .sidebar in index.css). Only meaningful below
  // layout.sidebarBreakpoint; CSS forces the sidebar visible above it
  // regardless of this value, so no need to reset it on resize.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Mirrors the same breakpoint CSS uses (layout.sidebarBreakpoint) —
  // needed in JS because Past conversations/Routing & fallbacks/Usage
  // counters render as an inline master-detail panel within the sidebar
  // at this width and up, but stay the old floating popover below it
  // (tablet keeps the popover — JuanJo's explicit call, 2026-08-29).
  // matchMedia + a change listener rather than a resize listener, since
  // it only needs to know when the true/false answer flips, not every
  // pixel of resize.
  const [isDesktopSidebar, setIsDesktopSidebar] = useState(
    () => window.matchMedia(`(min-width: ${layout.sidebarBreakpoint}px)`).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${layout.sidebarBreakpoint}px)`);
    const onChange = () => setIsDesktopSidebar(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  // Which of the master-detail items (history/routing/usage) is
  // "selected" for the desktop inline panel — separate from openPanel
  // since that also drives newConvo/models/commands' popovers, which
  // stay popovers regardless of width.
  const MASTER_DETAIL_KEYS = ["branches", "routing", "usage", "settings"] as const;

  // Outer rail — the app-level canvas switcher (Chat/Agent Work/Dev Slate/
  // Dashboard), sitting outside .sidebar entirely, to its left. One
  // resizable panel, same mechanic as the left/right sidebars, that
  // snaps to icon-only past a minimum rather than a separate fixed
  // strip — three rounds of research this session (professional dev
  // tools, general enterprise software, marketing-automation platforms
  // specifically) converged on this exact pattern over VS Code's actual
  // two-part fixed-rail-plus-panel system. Only "chat" is real for
  // now — the other three canvases don't exist yet, shown disabled.
  type CanvasKey = "chat" | "agentWork" | "devSlate" | "dashboard";
  const [activeCanvas, setActiveCanvas] = useState<CanvasKey>("chat");
  // Dev Slate's right sidebar (Task State / Change History, built below)
  // reads straight off the same shared store its own panes already use
  // — real data, not placeholder content, so no separate fetch/state
  // duplicated here.
  const devSlateState = useDevSlateState();
  // Three-tier fixed elevation stack, JuanJo's final call 2026-08-31 —
  // no zone-hue-following anywhere in chrome, full stop. Darkest for
  // rail/left sidebar (receding, peripheral), mid for the canvas itself
  // (where the actual work happens), right sidebar fused to the canvas
  // tier rather than getting its own color (matches how every source
  // reviewed tonight agreed it should work — right sidebar is
  // canvas-local, not a separate zone). A third, lighter tier exists
  // for genuinely interactive surfaces (inputs, popovers) — not wired
  // in everywhere yet, applied where it clearly fits.
  const railBg = "#020202";
  const canvasBg = "#080808";
  const sidebarBg = railBg;
  // Neutral now, not zone-hue-following — the one piece of tonight's
  // original color system that's gone from chrome entirely. Content
  // (NAVI's own reply bubbles) keeps its per-mode color via theme.glow
  // below; this is only for generic UI chrome (hamburger, panel
  // open-triggers), which should never have carried mode/zone color.
  const neutralGlow = "rgba(255, 255, 255, 0.14)";
  // Compact chat popup, Agent Work canvas only — bottom-right, matches
  // the near-universal convention for an ambient assistant widget
  // (researched: "90% of chatbots sit bottom-right"). Deliberately NOT
  // the same widget as per-node chat, which stays a contextual trigger
  // on selecting a node instead — canvas tools diverge from the bottom-
  // right convention specifically for anything object-scoped, so it
  // doesn't interrupt the canvas work the way a fixed panel would.
  // Shell/mock content for now — this canvas has no real backend yet.
  const [agentWorkChatOpen, setAgentWorkChatOpen] = useState(false);
  // Dev Slate's placeholder pane content — every zone in its shell (see
  // the devSlate canvas render below) uses this same shape so adding a
  // new pane later, or swapping a placeholder for real content, doesn't
  // need new styling invented each time.
  const devSlatePane = (icon: React.ReactNode, label: string, description: string) => (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: spacing.lg, textAlign: "center",
      color: neutral.textFaint, gap: spacing.xs,
    }}>
      {icon}
      <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, fontWeight: fontWeight.medium }}>{label}</div>
      <div style={{ fontSize: fontSize.xxs, lineHeight: lineHeight.base, maxWidth: 220 }}>{description}</div>
    </div>
  );
  // Locked row height for every rail button, icon + label padding —
  // found live: without an explicit height, a button's rendered height
  // depends on whether its label <span> is present (its line-height
  // taller than the icon alone), so collapsing (label -> display:none)
  // silently shrank each row and shifted every icon below it upward.
  // Fixed height + border-box makes the row identical either way.
  const OUTER_RAIL_ROW_HEIGHT = iconSize.sm + spacing.sm * 2;
  // Mobile/tablet bottom bar — the outer rail's real replacement below
  // the desktop breakpoint (not the rail folded into a drawer, a
  // genuinely different surface: 5 icon-only destinations — Project,
  // Chat, Agent Work, Dev Slate, Account — always visible and always on
  // top of whatever canvas is showing, so Agent Work/Dev Slate's
  // full-screen takeovers always have a way out. Tapping the ALREADY-
  // active canvas's icon again reveals that canvas's own middle-zone
  // actions as an upward sheet, instead of a whole rail; Account's icon
  // does the same for Usage/Routing/Models/Settings, each of which
  // still opens through the existing togglePanel popover mechanism —
  // this bar only adds the entry point, not a second copy of that UI.
  const MOBILE_BAR_HEIGHT = 56;
  const [mobileCanvasMenuOpen, setMobileCanvasMenuOpen] = useState(false);
  const [mobileAccountMenuOpen, setMobileAccountMenuOpen] = useState(false);
  const mobileSheetRowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: spacing.sm,
    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box", padding: `0 ${spacing.sm}px`,
    borderRadius: radius.sm, border: "none", background: "transparent",
    color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium, width: "100%",
  };
  const OUTER_RAIL_MIN_WIDTH = 56;
  const OUTER_RAIL_MAX_WIDTH = 220;
  const OUTER_RAIL_WIDTH_STORAGE_KEY = "navi-outer-rail-width";
  const [outerRailWidth, setOuterRailWidth] = useState(OUTER_RAIL_MIN_WIDTH);
  const outerRailCollapsed = outerRailWidth <= OUTER_RAIL_MIN_WIDTH + 4;
  const outerRailResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    if (!isDesktopSidebar) return;
    const saved = localStorage.getItem(OUTER_RAIL_WIDTH_STORAGE_KEY);
    if (saved) setOuterRailWidth(Math.max(OUTER_RAIL_MIN_WIDTH, Math.min(OUTER_RAIL_MAX_WIDTH, Number(saved))));
  }, [isDesktopSidebar]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--outer-rail-width", isDesktopSidebar ? `${outerRailWidth}px` : "0px"
    );
  }, [outerRailWidth, isDesktopSidebar]);
  const handleOuterRailResizeStart = useCallback((e: React.PointerEvent) => {
    outerRailResizeRef.current = { startX: e.clientX, startWidth: outerRailWidth };
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      if (!outerRailResizeRef.current) return;
      const delta = moveEvent.clientX - outerRailResizeRef.current.startX;
      const next = Math.min(
        OUTER_RAIL_MAX_WIDTH,
        Math.max(OUTER_RAIL_MIN_WIDTH, outerRailResizeRef.current.startWidth + delta)
      );
      setOuterRailWidth(next);
    };
    const onUp = () => {
      setOuterRailWidth(current => {
        localStorage.setItem(OUTER_RAIL_WIDTH_STORAGE_KEY, String(Math.round(current)));
        return current;
      });
      outerRailResizeRef.current = null;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [outerRailWidth]);

  // Right sidebar — mirrors the left sidebar's structure (fixed panel,
  // desktop-only per isDesktopSidebar) but tabbed rather than a docked
  // master-detail list: only one tool (Sources/Knowledge) is visible at
  // a time, each getting the panel's full height, instead of splitting
  // height between simultaneously-open sections (the VS Code sidebar's
  // own accordion-view pain point — panels competing for height,
  // forcing manual resize — is exactly what tabs avoid here). UI only
  // for now, no dispatcher wired up yet — chips/ticks/expand are local
  // mock state.
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // Left sidebar's own open/closed state, desktop only — mirrors
  // rightPanelOpen, but defaults to true (the panel starts visible,
  // same as it always was before this existed) rather than false.
  // JuanJo, 2026-08-30: sidebars never auto-hide themselves (see the
  // Agent Work canvas decision, same session), but the user should
  // still be able to close one by hand when they want the width back.
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--left-panel-width", isDesktopSidebar && leftPanelOpen ? "var(--sidebar-width)" : "0px"
    );
  }, [isDesktopSidebar, leftPanelOpen]);
  // Reversal of the 2026-08-30 call above ("sidebars never auto-hide
  // themselves") — JuanJo, 2026-09-01: switching canvases now closes
  // both. Scoped to the canvas-switch action specifically, not a
  // standing "always closed" rule — the user can still reopen either
  // one by hand and it stays open until the next switch. Skips its
  // first run (the mount itself isn't a "switch") so the app doesn't
  // start with both forced closed regardless of leftPanelOpen's own
  // default-true.
  const skipFirstCanvasEffectRef = useRef(true);
  useEffect(() => {
    if (skipFirstCanvasEffectRef.current) {
      skipFirstCanvasEffectRef.current = false;
      return;
    }
    setLeftPanelOpen(false);
    setRightPanelOpen(false);
  }, [activeCanvas]);
  // Local file placement (Windows-Explorer-style drag/place, not the
  // deferred cross-user transfer — see the file-transfer memory).
  // Vertical drill-in instead of a horizontal column browser or an
  // indented tree: a narrow sidebar column can't afford either without
  // squeezing names into a sliver, so clicking a folder swaps the
  // whole view to that folder's contents at full width instead,
  // reusing the same drill-in shape as the left sidebar's docked
  // master-detail panels. Mock tree for now — real file access is
  // dispatcher/backend work, deferred with everything else backend.
  // `file` carries the real browser File object for anything actually
  // dragged/imported in — that's what lets DocumentViewer render real
  // PDF/DOCX/Markdown instead of a placeholder. Mock entries (the seed
  // list below) simply don't have one.
  type FileNode = { name: string; type: "file" | "folder"; children?: FileNode[]; file?: File };
  const [fileTree, setFileTree] = useState<FileNode[]>([
    { name: "Sources", type: "folder", children: [
      { name: "local-first-sync.pdf", type: "file" },
      { name: "crdts-hard-parts.mp4", type: "file" },
      { name: "convergent-replicated.pdf", type: "file" },
    ] },
    { name: "Research", type: "folder", children: [
      { name: "competitor-pricing.xlsx", type: "file" },
      { name: "market-notes.md", type: "file" },
    ] },
    { name: "Deliverables", type: "folder", children: [
      { name: "onboarding-flow-v2.png", type: "file" },
    ] },
    { name: "scratch-notes.txt", type: "file" },
  ]);
  const [filePath, setFilePath] = useState<string[]>([]);
  const currentFolder = useMemo(() => {
    let node: FileNode[] = fileTree;
    for (const segment of filePath) {
      const match = node.find(n => n.name === segment && n.type === "folder");
      node = match?.children ?? [];
    }
    return node;
  }, [fileTree, filePath]);
  // Adds a new folder into whatever node currentFolder currently points
  // at, by walking the same path again — client-side only, no
  // dispatcher yet, but a real state mutation rather than a decorative
  // button (matches the "build it real, let it be felt" pattern this
  // session has followed throughout).
  const addDirectory = useCallback((name: string) => {
    if (!name.trim()) return;
    setFileTree(tree => {
      const next = structuredClone(tree);
      let node = next;
      for (const segment of filePath) {
        const match = node.find(n => n.name === segment && n.type === "folder");
        if (!match) return tree;
        if (!match.children) match.children = [];
        node = match.children;
      }
      if (node.some(n => n.name === name)) return tree;
      node.push({ name: name.trim(), type: "folder", children: [] });
      return next;
    });
  }, [filePath]);
  // Removes a top-level (root) directory only — unmounting a root is a
  // distinct action from deleting a regular subfolder (not built; out
  // of scope here), so this only ever touches fileTree's own array.
  const removeRootDirectory = useCallback((name: string) => {
    setFileTree(tree => tree.filter(n => n.name !== name));
  }, []);
  const [addingDirectory, setAddingDirectory] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState("");
  // Search is always-rendered now (JuanJo, 2026-08-31 — the toggle
  // version meant an extra click before every search, and closing it
  // threw the query away). Scope toggle replaces the open/close
  // affordance: "this folder" (default, matches prior behavior) vs.
  // "all directories" (recursive, across every mounted root).
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchScope, setFileSearchScope] = useState<"folder" | "all">("folder");
  const flattenTree = useCallback((nodes: FileNode[], path: string[] = []): { node: FileNode; path: string[] }[] => {
    let out: { node: FileNode; path: string[] }[] = [];
    for (const n of nodes) {
      out.push({ node: n, path });
      if (n.type === "folder" && n.children) out = out.concat(flattenTree(n.children, [...path, n.name]));
    }
    return out;
  }, []);
  const visibleFolderContents = useMemo(() => {
    const q = fileSearchQuery.trim().toLowerCase();
    if (!q) return currentFolder.map(node => ({ node, path: filePath }));
    if (fileSearchScope === "folder") {
      return currentFolder.filter(n => n.name.toLowerCase().includes(q)).map(node => ({ node, path: filePath }));
    }
    return flattenTree(fileTree).filter(({ node }) => node.name.toLowerCase().includes(q));
  }, [currentFolder, fileSearchQuery, fileSearchScope, fileTree, flattenTree, filePath]);

  // Document viewer — lives at the right-PANEL level, not inside the
  // Files tab: it's the one "window" that coexists alongside whatever
  // tab is active (switch from Files to Sources with a doc open, the
  // viewer stays put underneath). Split view by default (reuses the
  // left sidebar's vertical Group/Panel/Separator mechanic); "expand"
  // reuses the collapse-the-rest-of-the-sidebar idea from the earlier
  // accordion design of this panel, just applied here instead.
  const [openDocument, setOpenDocument] = useState<{ name: string; file?: File; content: string } | null>(null);
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const openFile = useCallback((node: FileNode) => {
    setOpenDocument({
      name: node.name,
      file: node.file,
      content: node.file
        ? "" // real files load their own content inside DocumentViewer (async — pdf.js/docx-preview/file.text())
        : isTextLike(node.name)
          ? `Mock content for ${node.name} — this is a seed entry with no real file behind it. Import a real file (drag it into Files) to see actual content. Editable in memory only either way; nothing persists past a reload.`
          : "",
    });
  }, []);
  // Real file import — drag a file from the OS onto the Files tab, or
  // click Import. Gives the browser a real File object client-side, no
  // backend/upload needed at all — that's what lets DocumentViewer
  // render real PDF/DOCX/Markdown instead of a placeholder.
  const [fileDragOver, setFileDragOver] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const addRealFiles = useCallback((files: FileList | File[]) => {
    setFileTree(tree => {
      const next = structuredClone(tree);
      let node = next;
      for (const segment of filePath) {
        const match = node.find(n => n.name === segment && n.type === "folder");
        if (!match) return tree;
        if (!match.children) match.children = [];
        node = match.children;
      }
      for (const file of Array.from(files)) {
        if (node.some(n => n.name === file.name)) continue;
        node.push({ name: file.name, type: "file", file });
      }
      return next;
    });
  }, [filePath]);
  const [sourceChips, setSourceChips] = useState<string[]>(["offline-first sync", "conflict resolution"]);
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceTerm1Open, setSourceTerm1Open] = useState(true);
  const [sourceTicks, setSourceTicks] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: false, 3: false });
  // One-time review warning — pure UI for now, in-memory only (no
  // persistence layer yet; that's backend work, deliberately deferred
  // until after V3 UI). The first tick attempt in a session opens the
  // warning instead of ticking; acknowledging it just dismisses the
  // overlay — the user then ticks again themselves. Once wired to a
  // real dispatcher, this same gate is where per-source tick
  // enforcement will actually connect (see the not-yet-built
  // enforcement item).
  const [sourceWarningAcknowledged, setSourceWarningAcknowledged] = useState(false);
  const [sourceWarningOpen, setSourceWarningOpen] = useState(false);
  const handleSourceTickAttempt = useCallback((index: number, currentlyChecked: boolean) => {
    if (!sourceWarningAcknowledged) {
      setSourceWarningOpen(true);
      return;
    }
    setSourceTicks(t => ({ ...t, [index]: !currentlyChecked }));
  }, [sourceWarningAcknowledged]);
  const MOCK_SOURCES = [
    { title: "Local-first software — Ink & Switch", domain: "inkandswitch.com", tier: "good" as const },
    { title: "CRDTs: The Hard Parts", domain: "youtube.com", tier: "good" as const },
    { title: "A comprehensive study of Convergent...", domain: "hal.inria.fr", tier: "good" as const },
    { title: "Building offline-first apps, a field guide", domain: "medium.com", tier: "less" as const },
  ];
  const SOURCE_TIER_META = {
    good: { label: "Good", color: "rgb(96,210,140)", bg: "rgba(96,210,140,0.12)" },
    likely: { label: "Likely good", color: "rgb(230,180,80)", bg: "rgba(230,180,80,0.12)" },
    less: { label: "Less likely", color: "rgb(220,100,100)", bg: "rgba(220,100,100,0.12)" },
  } as const;
  // Knowledge lives alongside Activity in the left sidebar (moved out
  // of the right Sources panel, JuanJo 2026-08-29) — both are records
  // of past work rather than a live tool. Each entry is tagged with
  // where it came from, reusing the same /command flag convention
  // Activity already uses (parseCommand/StoredMessage.command) rather
  // than inventing a separate labeling scheme.
  const [leftPanelTab, setLeftPanelTab] = useState<"activity" | "knowledge" | "files">("activity");
  const MOCK_KNOWLEDGE = [
    { title: "Local-first sync — synthesis", note: "from 3 accepted sources", origin: "search" as const },
    { title: "CRDT tradeoffs — synthesis", note: "from 2 accepted sources", origin: "search" as const },
    { title: "Competitor pricing notes", note: "from research summary", origin: "research" as const },
    { title: "Brainstorm: onboarding flow ideas", note: "saved from chat", origin: "brainstorm" as const },
  ];
  // Drives the .chat-column/.centered-col right-floor in index.css —
  // only shift the chat left of center while the panel is actually
  // open, not permanently once isDesktopSidebar is true.
  useEffect(() => {
    document.body.classList.toggle("right-panel-open", isDesktopSidebar && rightPanelOpen);
    return () => document.body.classList.remove("right-panel-open");
  }, [isDesktopSidebar, rightPanelOpen]);

  // Horizontal resize for the right panel — same drag mechanics as the
  // left sidebar's handleSidebarResizeStart, mirrored: the handle sits
  // on the panel's LEFT edge (it's anchored to the viewport's right
  // edge, so dragging left grows it, the opposite sign from the left
  // sidebar's own handle). Reuses layout.sidebarWidth/sidebarMaxWidth
  // as the same 280-480 bounds the CSS clamp() already uses, so a drag
  // can't push the value outside what the fluid default would allow
  // anyway.
  const RIGHT_PANEL_WIDTH_STORAGE_KEY = "navi-right-panel-width";
  const rightPanelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    if (!isDesktopSidebar) return;
    const saved = localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    if (saved) {
      document.documentElement.style.setProperty("--right-panel-width", `${saved}px`);
    }
  }, [isDesktopSidebar]);
  const handleRightPanelResizeStart = useCallback((e: React.PointerEvent) => {
    const currentWidth = document.querySelector(".right-panel")?.getBoundingClientRect().width ?? layout.sidebarWidth;
    rightPanelResizeRef.current = { startX: e.clientX, startWidth: currentWidth };
    // Dragging over text content (menu labels, panel content) was
    // triggering the browser's native text-selection instead of just
    // resizing — found live. Suppressing selection for the drag's
    // duration, not permanently, since it's only a drag-time problem.
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      if (!rightPanelResizeRef.current) return;
      const delta = moveEvent.clientX - rightPanelResizeRef.current.startX;
      const next = Math.min(
        layout.sidebarMaxWidth,
        Math.max(layout.sidebarWidth, rightPanelResizeRef.current.startWidth - delta)
      );
      document.documentElement.style.setProperty("--right-panel-width", `${next}px`);
    };
    const onUp = () => {
      rightPanelResizeRef.current = null;
      const finalWidth = document.querySelector(".right-panel")?.getBoundingClientRect().width;
      if (finalWidth) localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(Math.round(finalWidth)));
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Horizontal sidebar resize (desktop only) — a manual drag beats the
  // fluid clamp() default. Deliberately NOT built on react-resizable-
  // panels like the vertical Menu/Activity split below: the sidebar is
  // position:fixed overlaying the rest of the app rather than a normal
  // flex sibling of the main content, so fitting it into the library's
  // panel-group model would mean restructuring how .chat-column finds
  // its own position — a much bigger change than a plain drag handle
  // needs. --sidebar-width (index.css) is the single CSS variable every
  // formula that cares about the sidebar's width reads; setting it
  // directly on documentElement here overrides the CSS-authored
  // default the same way any inline style beats an external rule.
  const SIDEBAR_WIDTH_STORAGE_KEY = "navi-sidebar-width";
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    if (!isDesktopSidebar) return;
    const saved = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (saved) {
      document.documentElement.style.setProperty("--sidebar-width", `${saved}px`);
    }
  }, [isDesktopSidebar]);
  const handleSidebarResizeStart = useCallback((e: React.PointerEvent) => {
    const currentWidth = document.querySelector(".sidebar")?.getBoundingClientRect().width ?? layout.sidebarWidth;
    sidebarResizeRef.current = { startX: e.clientX, startWidth: currentWidth };
    // Same drag-time text-selection fix as the right panel's handle —
    // dragging over the Menu list's labels was selecting their text
    // instead of just resizing.
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      if (!sidebarResizeRef.current) return;
      const delta = moveEvent.clientX - sidebarResizeRef.current.startX;
      const next = Math.min(
        layout.sidebarMaxWidth,
        Math.max(layout.sidebarWidth, sidebarResizeRef.current.startWidth + delta)
      );
      document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
    };
    const onUp = () => {
      sidebarResizeRef.current = null;
      const finalWidth = document.querySelector(".sidebar")?.getBoundingClientRect().width;
      if (finalWidth) localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(finalWidth)));
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Vertical Menu/Activity split, resizable via react-resizable-panels —
  // unlike the sidebar's own horizontal resize above, this pair genuinely
  // are normal stacked flex children (not position:fixed overlaying
  // anything), so the library's own Group/Panel/Separator model fits
  // cleanly without needing a custom drag handle. Layout persisted
  // manually (read once on mount, saved only on real user drags —
  // meta.isUserInteraction — not on every programmatic/initial layout
  // event) rather than via the library's storage helpers, to keep the
  // persistence mechanism identical to the sidebar-width one above.
  const SIDEBAR_LAYOUT_STORAGE_KEY = "navi-sidebar-vertical-layout";
  const [initialSidebarLayout] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY);
      return saved ? JSON.parse(saved) : undefined;
    } catch {
      return undefined;
    }
  });
  const handleSidebarLayoutChanged = useCallback((panelLayout: Record<string, number>, meta: LayoutChangedMeta) => {
    // Param deliberately not named `layout` — that'd shadow the
    // imported tokens.layout used throughout this component.
    if (!meta.isUserInteraction) return;
    try {
      localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(panelLayout));
    } catch {
      // best-effort — a failed save just means the layout resets next visit
    }
  }, []);

  // The docked detail panel (see isDockedDetail below) should match the
  // Menu section's own height, not the full sidebar/viewport — JuanJo's
  // call, 2026-08-29, also setting up for Menu/Activity becoming
  // independently resizable later (once that exists, this measured
  // height just tracks whatever the resize state says instead). Measured
  // via ResizeObserver rather than assumed, since the Menu section's
  // real height depends on runtime content (e.g. the notifications
  // button only renders when push is supported).
  const menuSectionRef = useRef<HTMLDivElement>(null);
  const [menuSectionHeight, setMenuSectionHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = menuSectionRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setMenuSectionHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Master-detail (two-column: collapsed icon list + docked panel)
  // vs. floating popover — below a width threshold, two columns get
  // too cramped to be worth it and it should fall back to the popover
  // instead (flagged a while back, never built). The threshold has to
  // be a fixed px value, not a percentage of the sidebar or the page:
  // the actual constraint is whether the detail column (sidebar width
  // minus the 56px collapsed icon rail) has enough width to render its
  // real content — conversation titles, routing chains, usage rows —
  // legibly. That's a fixed-size-content problem, it doesn't scale
  // with viewport, so a percentage-based threshold wouldn't track the
  // real failure mode. 340px is the right panel's own original default
  // width (before it became fluid) — already validated as comfortable
  // for a similar docked-panel content column, so it's the concrete
  // reference point rather than an arbitrary guess. Below that, the
  // detail column would be under ~284px (340-56) — reused as the floor
  // here too. Tracked via ResizeObserver (not just the drag handlers)
  // since the sidebar's width also changes from the CSS fluid clamp()
  // on plain viewport resize, not only a manual drag.
  const MASTER_DETAIL_MIN_SIDEBAR_WIDTH = 340;
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number>(layout.sidebarWidth);
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setSidebarWidthPx(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Push notification subscribe state — not a popover, a direct action
  // button. Re-checked on mount since subscriptions are per-origin: a
  // browser that was subscribed under a previous domain (e.g. GitHub
  // Pages before the getnavi.online migration) shows "unsubscribed"
  // here even though the user remembers having enabled it before.
  const [pushStatus, setPushStatus] = useState<PushStatus | "loading">("unsubscribed");
  useEffect(() => {
    getPushStatus().then(setPushStatus);
  }, []);
  const handleEnablePush = useCallback(async () => {
    if (pushStatus === "subscribed" || pushStatus === "loading") return;
    setPushStatus("loading");
    const res = await subscribeToPush();
    setPushStatus(res.ok ? "subscribed" : await getPushStatus());
    if (!res.ok) alert(res.error || "Couldn't enable notifications.");
  }, [pushStatus]);
  // Real saved conversations for the "Past conversations" panel —
  // refreshed each time that panel opens (see the effect below) rather
  // than kept live at all times, since it's the only place this list is
  // shown.
  const [branches, setBranches] = useState<BranchListItem[]>([]);
  useEffect(() => {
    if (openPanel !== "branches") return;
    listBranches().then(setBranches);
  }, [openPanel]);
  // The project's one Main Chat — loaded once on mount, never
  // reassigned (see getMainConversationId in storage.ts).
  const [mainChatId, setMainChatId] = useState<string | null>(null);

  // Loads a saved conversation into view, replacing whatever's currently
  // showing. Switches the active-conversation pointer in storage too, so
  // a push arriving afterward (or the next launch) lands here, not back
  // on the conversation this replaced.
  const openConversation = useCallback(async (conversation: Conversation) => {
    await switchActiveConversation(conversation.id);
    activeConversationIdRef.current = conversation.id;
    activeConversationParentIdRef.current = conversation.parentId;
    activeConversationProjectIdRef.current = conversation.projectId;
    setMessages(conversation.messages);
    hydratedCountRef.current = conversation.messages.length;
    selectChatMode(conversation.mode);
    setOpenPanel(null);
    if (conversation.parentId) {
      const parent = await loadConversation(conversation.parentId);
      setCurrentParentChat(parent ? { id: parent.id, title: parent.title } : null);
    } else {
      setCurrentParentChat(null);
    }
  }, [selectChatMode]);

  // Branches off the CURRENT chat — the rail's "New Branch Chat" calls
  // this directly (no separate top-level "New Chat" exists any more —
  // there is exactly one Main Chat per project, see mainChatId below).
  // Inherits
  // the parent's messages at creation (the actual token-economy win —
  // seeded with what's relevant so far, then diverges independently),
  // prompts for a meaningful name up front rather than defaulting to
  // "New conversation," per the naming convention research (name the
  // choice being tested, not "sub-chat 1").
  const branchConversation = useCallback(async () => {
    const parentId = activeConversationIdRef.current;
    if (!parentId) return;
    const name = window.prompt("Name this branch (what are you exploring?)");
    if (!name || !name.trim()) return;
    const branch = await createConversation(chatModeRef.current, parentId);
    await saveConversation({ ...branch, title: name.trim(), messages });
    activeConversationIdRef.current = branch.id;
    activeConversationParentIdRef.current = parentId;
    setCurrentParentChat({ id: parentId, title: deriveTitle(messages) });
    setOpenPanel(null);
  }, [messages]);

  useEffect(() => {
    getMainConversationId().then(setMainChatId);
  }, []);

  // Project — the real top-level container, sitting above the canvas
  // switcher (Chat/Agent Work/Dev Slate/Dashboard). Local/IndexedDB-only for
  // now, no team sharing yet (see storage.ts's Project doc comment).
  // activeProject is loaded once on mount, alongside the chat itself.
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  useEffect(() => {
    getActiveProjectId().then(id => {
      setActiveProjectIdState(id);
      listProjects().then(setProjects);
    });
  }, []);
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null;

  // Reloads the whole chat surface for a newly-current project — same
  // steps as the initial mount effect above (resolve/create that
  // project's active conversation, restore its Main Chat pointer), just
  // triggered by a project switch instead of app launch.
  const loadChatForActiveProject = useCallback(async () => {
    const activeId = await getActiveConversationId();
    const conversation = (activeId && await loadConversation(activeId)) || await createConversation(chatModeRef.current);
    activeConversationIdRef.current = conversation.id;
    activeConversationParentIdRef.current = conversation.parentId;
    activeConversationProjectIdRef.current = conversation.projectId;
    setMessages(conversation.messages);
    hydratedCountRef.current = conversation.messages.length;
    selectChatMode(conversation.mode);
    if (conversation.parentId) {
      const parent = await loadConversation(conversation.parentId);
      setCurrentParentChat(parent ? { id: parent.id, title: parent.title } : null);
    } else {
      setCurrentParentChat(null);
    }
    setBranches([]); // stale — reloads next time the Branches panel opens (see the openPanel effect above)
    await getMainConversationId().then(setMainChatId);
  }, [selectChatMode]);

  const switchProject = useCallback(async (id: string) => {
    if (id === activeProjectId) { setOpenPanel(null); return; }
    await switchActiveProject(id);
    setActiveProjectIdState(id);
    setOpenPanel(null);
    await loadChatForActiveProject();
  }, [activeProjectId, loadChatForActiveProject]);

  const createProjectAndSwitch = useCallback(async () => {
    const name = window.prompt("Name this project");
    if (!name || !name.trim()) return;
    const project = await createProject(name.trim());
    setProjects(await listProjects());
    setActiveProjectIdState(project.id);
    setOpenPanel(null);
    await loadChatForActiveProject();
  }, [loadChatForActiveProject]);

  // Jumps straight to the project's one Main Chat from anywhere — the
  // in-chat "Branched from X" pill only ever shows the immediate
  // parent, so a branch nested several levels deep has no other one-
  // click path back to the true root.
  const jumpToMainChat = useCallback(async () => {
    if (!mainChatId) return;
    const conversation = await loadConversation(mainChatId);
    if (conversation) await openConversation(conversation);
  }, [mainChatId, openConversation]);
  // Which provider row is expanded in the "Today's models" catalog.
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  // Manual model pick per mode — null means "use the auto-routed
  // default". Scoped per-mode rather than one global override, since
  // each mode already has its own task/model role.
  const [modelOverride, setModelOverride] = useState<Record<ChatMode, { provider: string; model: string } | null>>({
    normal: null, research: null, brainstorm: null,
  });
  // The real auto-routed default — the same normal_chat model answers
  // every mode's free-form chat; only the system prompt and allowed
  // tools change per mode (see dispatcher/modes/ + dispatcher/chat.py in
  // NAVI). A typed /research command still uses its own task_routing
  // model — this pill is about what answers your actual chat messages,
  // not the slash commands.
  const autoModelFor = useCallback((_mode: ChatMode): ModelEntry | null => {
    return routingConfig?.roles.normal_chat ?? null;
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
    setMessages(m => [...m, { role: "user", text, timestamp: Date.now(), command: parseCommand(text) }]);
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
      const replyText = data.reply ?? data.error ?? "(empty reply)";
      const attachments = parseAttachments(replyText);
      setMessages(m => [...m, {
        role: "navi",
        text: replyText,
        timestamp: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {}),
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

  // Docked master-detail retired for now, not redesigned — it was
  // positioned relative to the old Menu column (.sidebar-detail-panel's
  // left:56px fixed offset), which no longer means anything now that
  // the outer rail sits to .sidebar's left and Menu's buttons live
  // there instead. Floating popovers (anchorRect-based) work regardless
  // of where the trigger button physically is, so that's the honest
  // fallback rather than fixing positioning math for a structure that's
  // still mid-change. Revisit docking against the new rail later.
  const isDockedDetail = false;
  void sidebarWidthPx; void MASTER_DETAIL_MIN_SIDEBAR_WIDTH; void MASTER_DETAIL_KEYS;

  // Document viewer content — persists across right-panel tab switches
  // (rendered once, at the panel level, not per-tab — see openDocument
  // above). Text-like formats get a real editable textarea (in-memory
  // only, no save/persistence yet); everything else is an honest
  // placeholder rather than faking a preview with nothing real behind
  // it (the mock file tree has no actual bytes for pdf/docx/pptx).
  const viewerPane = openDocument && (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
        padding: `${spacing.xs}px ${spacing.lg}px`, borderTop: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, minWidth: 0 }}>
          <FileIcon size={13} fill={neutral.textMuted} />
          <span style={{
            fontSize: fontSize.xs, color: neutral.textPrimary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {openDocument.name}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button
            onClick={() => setViewerExpanded(e => !e)}
            title={viewerExpanded ? "Restore split view" : "Expand viewer"}
            style={{
              border: "none", background: "transparent", cursor: "pointer",
              fontSize: fontSize.xxs, color: neutral.textMuted, fontFamily, padding: "3px 6px",
            }}
          >
            {viewerExpanded ? "Restore" : "Expand"}
          </button>
          <button
            aria-label="Close viewer"
            onClick={() => { setOpenDocument(null); setViewerExpanded(false); }}
            style={{
              width: 20, height: 20, borderRadius: radius.xs, border: "none", background: "transparent",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: neutral.textMuted,
            }}
          >
            <XIcon size={13} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: spacing.sm }}>
        <Suspense fallback={
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: neutral.textFaint, fontSize: 12 }}>
            Loading viewer…
          </div>
        }>
          <DocumentViewer
            name={openDocument.name}
            file={openDocument.file}
            content={openDocument.content}
            onContentChange={text => setOpenDocument(d => d && { ...d, content: text })}
          />
        </Suspense>
      </div>
    </div>
  );

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "#080808" }}>
      {/* Wraps everything the app already had — the mobile bottom bar
          below is a normal flex sibling to this, not a fixed overlay,
          so flexbox reserves its height automatically (this wrapper
          gets exactly "100% minus the bar" for free) instead of every
          piece of content needing its own manual bottom padding to
          avoid sitting behind it. `position: relative` is what it used
          to be on the root itself — every absolute/fixed child inside
          still anchors to this, unchanged. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      {/* Sidebar backdrop — mobile/tablet drawer only, see .sidebar-backdrop
          in index.css (auto-hidden at the persistent-sidebar breakpoint). */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Outer rail — app-level canvas switcher, desktop only. Sits
          outside .sidebar, to its left; everything else shifts right
          by --outer-rail-width (see index.css). */}
      {isDesktopSidebar && (
        <div className={`outer-rail hide-scrollbar${outerRailCollapsed ? " collapsed" : ""}`} style={{
          // Rail tier — same value as sidebarBg/railBg above, just
          // written literally here (this div renders before that const
          // is declared in the component body; safe either way since
          // it's a fixed value, but kept explicit for clarity).
          background: "#020202",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          width: outerRailWidth,
        }}>
          <div
            className="sidebar-resize-handle"
            onPointerDown={handleOuterRailResizeStart}
            title="Drag to resize"
            style={{ position: "absolute", top: 0, bottom: 0, right: -6, width: 12, zIndex: 31 }}
          >
            <div className="sidebar-resize-handle-line" />
          </div>

          {/* project masthead — the real top-level container, parent of
              everything below it in this rail (canvas switcher, Chat's
              branch actions, all of it lives inside whichever project is
              current). Deliberately NOT styled as another row in the
              list: edge-to-edge (no side inset/rounded corners the way
              every button below it has), its own solid-er background,
              and a full-width bottom border to read as a header this
              rail hangs off of, not a peer of what it contains. Clicking
              opens the full project list via the "projects" panel, same
              togglePanel mechanism as Branches etc. below.
              TODO: FileDirectoryIcon/ChevronDownIcon are placeholders —
              JuanJo flagged both icons (folder + chevron) for a swap,
              no replacement chosen yet. */}
          <button
            title={activeProject ? `Project: ${activeProject.name}` : "Select project"}
            onClick={e => togglePanel("projects", e.currentTarget)}
            style={{
              display: "flex", alignItems: "center", gap: spacing.sm, width: "100%",
              // 48px — matches the sidebars' own header-row height so
              // this masthead lines up with them (JuanJo, 2026-09-01).
              height: 48, boxSizing: "border-box",
              padding: `0 ${spacing.md}px`, flexShrink: 0,
              border: "none", borderBottom: "1px solid rgba(255,255,255,0.14)",
              background: openPanel === "projects" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.055)",
              color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
              fontFamily,
            }}
          >
            <FileDirectoryIcon size={iconSize.md} />
            <span className="sidebar-menu-btn-label" style={{
              flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontSize: fontSize.sm, fontWeight: fontWeight.medium,
            }}>
              {activeProject?.name ?? "Project"}
            </span>
            <ChevronDownIcon size={iconSize.sm} className="sidebar-menu-btn-label" />
          </button>

          {/* top zone — canvas switcher, highest-frequency action */}
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.xxs, padding: spacing.sm, flexShrink: 0 }}>
            {([
              { key: "chat", icon: <CommentDiscussionIcon size={iconSize.sm} />, label: "Chat", available: true },
              { key: "agentWork", icon: <RocketIcon size={iconSize.sm} />, label: "Agent Work", available: true },
              { key: "devSlate", icon: <CodeIcon size={iconSize.sm} />, label: "Dev Slate", available: true },
              { key: "dashboard", icon: <PulseIcon size={iconSize.sm} />, label: "Dashboard", available: false },
            ] as const).map(({ key, icon, label, available }) => {
              const accent = key in CANVAS_ACCENT ? CANVAS_ACCENT[key as keyof typeof CANVAS_ACCENT] : null;
              const active = activeCanvas === key;
              return (
              <button
                key={key}
                title={available ? label : `${label} — coming soon`}
                disabled={!available}
                onClick={() => available && setActiveCanvas(key)}
                className="sidebar-menu-btn"
                style={{
                  display: "flex", alignItems: "center", gap: spacing.sm,
                  height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                  padding: `0 ${spacing.sm}px`,
                  borderRadius: radius.sm,
                  border: active && accent ? `1px solid ${accent.glow}` : "1px solid transparent",
                  background: active ? (accent ? accent.glow : "rgba(255,255,255,0.06)") : "transparent",
                  color: !available ? neutral.textFaint : active && accent ? accent.color : neutral.textPrimary,
                  cursor: available ? "pointer" : "default",
                  fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  textAlign: "left", opacity: available ? 1 : 0.5,
                }}
              >
                {icon}
                <span className="sidebar-menu-btn-label">{label}</span>
              </button>
              );
            })}
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: `${spacing.sm}px ${spacing.sm}px ${spacing.md}px` }} />

          {/* middle zone — canvas-dependent contextual actions. Only
              Chat's are real for now: Root Chat (jump to the project's
              one true root from anywhere — named to keep the branch/
              tree metaphor "Branches" already uses, JuanJo's call
              2026-08-31: bare "Root" risked reading as a settings/
              account destination for first-time users, "Root Chat"
              keeps it unambiguous), New Branch Chat (branch off
              whatever's active), Branches (flat browse list). The other
              canvases' equivalents don't exist yet. */}
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.xxs, padding: spacing.sm, flex: 1, minHeight: 0, overflowY: "auto" }}>
            {activeCanvas === "chat" && (
              <>
                <button
                  className="sidebar-menu-btn"
                  title="Root Chat"
                  disabled={!mainChatId}
                  onClick={jumpToMainChat}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm,
                    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                    padding: `0 ${spacing.sm}px`,
                    borderRadius: radius.sm, border: "none",
                    background: activeConversationIdRef.current === mainChatId ? "rgba(255,255,255,0.06)" : "transparent",
                    color: mainChatId ? neutral.textPrimary : neutral.textFaint,
                    cursor: mainChatId ? "pointer" : "default", textAlign: "left",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  <HomeIcon size={iconSize.sm} />
                  <span className="sidebar-menu-btn-label">Root Chat</span>
                </button>
                <button
                  className="sidebar-menu-btn"
                  title="New Branch Chat"
                  onClick={branchConversation}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm,
                    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                    padding: `0 ${spacing.sm}px`,
                    borderRadius: radius.sm, border: "none",
                    background: "transparent",
                    color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  <PlusIcon size={iconSize.sm} />
                  <span className="sidebar-menu-btn-label">New Branch Chat</span>
                </button>
                <button
                  className="sidebar-menu-btn"
                  title="Branches"
                  onClick={e => togglePanel("branches", e.currentTarget)}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm,
                    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                    padding: `0 ${spacing.sm}px`,
                    borderRadius: radius.sm, border: "none",
                    background: openPanel === "branches" ? "rgba(255,255,255,0.06)" : "transparent",
                    color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  <GitBranchIcon size={iconSize.sm} />
                  <span className="sidebar-menu-btn-label" style={{ flex: 1 }}>Branches</span>
                  <ChevronDownIcon size={12} className="sidebar-menu-btn-label" />
                </button>
              </>
            )}
            {/* Dev Slate's own middle zone — New Build / Builds, not a
                reskin of Chat's Main Chat/New Branch Chat/Branches.
                Deliberately no "Main Build" equivalent: unlike Chat's
                one-trunk model, a project can hold several independent
                builds (a homepage, a pricing page, a signup app) with
                no forced canonical one to jump back to. Templates
                folds into New Build as a step, not a third button —
                same "don't pad the rail" call as the mobile-nav
                discussion. Both placeholder for now — Dev Slate has no
                backend yet, so both just surface the same honest
                "nothing wired up" panel rather than pretending to
                create something real. */}
            {activeCanvas === "devSlate" && (
              <>
                <button
                  className="sidebar-menu-btn"
                  title="New Build"
                  onClick={e => togglePanel("builds", e.currentTarget)}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm,
                    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                    padding: `0 ${spacing.sm}px`,
                    borderRadius: radius.sm, border: "none",
                    background: "transparent",
                    color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  <PlusIcon size={iconSize.sm} />
                  <span className="sidebar-menu-btn-label">New Build</span>
                </button>
                <button
                  className="sidebar-menu-btn"
                  title="Builds"
                  onClick={e => togglePanel("builds", e.currentTarget)}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm,
                    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                    padding: `0 ${spacing.sm}px`,
                    borderRadius: radius.sm, border: "none",
                    background: openPanel === "builds" ? "rgba(255,255,255,0.06)" : "transparent",
                    color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  <FileDirectoryIcon size={iconSize.sm} />
                  <span className="sidebar-menu-btn-label" style={{ flex: 1 }}>Builds</span>
                  <ChevronDownIcon size={12} className="sidebar-menu-btn-label" />
                </button>
              </>
            )}
            {/* Agent Work's own middle zone — New Workflow / Agents,
                same New-X/browse-X shape as Chat and Dev Slate. */}
            {activeCanvas === "agentWork" && (
              <>
                <button
                  className="sidebar-menu-btn"
                  title="New Workflow"
                  onClick={e => togglePanel("agents", e.currentTarget)}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm,
                    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                    padding: `0 ${spacing.sm}px`,
                    borderRadius: radius.sm, border: "none",
                    background: "transparent",
                    color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  <PlusIcon size={iconSize.sm} />
                  <span className="sidebar-menu-btn-label">New Workflow</span>
                </button>
                <button
                  className="sidebar-menu-btn"
                  title="Agents"
                  onClick={e => togglePanel("agents", e.currentTarget)}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm,
                    height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                    padding: `0 ${spacing.sm}px`,
                    borderRadius: radius.sm, border: "none",
                    background: openPanel === "agents" ? "rgba(255,255,255,0.06)" : "transparent",
                    color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  <RocketIcon size={iconSize.sm} />
                  <span className="sidebar-menu-btn-label" style={{ flex: 1 }}>Agents</span>
                  <ChevronDownIcon size={12} className="sidebar-menu-btn-label" />
                </button>
              </>
            )}

            {/* Sidebar toggles — canvas-independent, always the last
                thing in the middle zone regardless of which canvas is
                active. Replaces the old floating "open sidebar"/"open
                sources panel" buttons entirely: those were positioned at
                a fixed screen coordinate that inevitably collided with
                some canvas's own content (found live in Dev Slate,
                2026-09-01). Researched before building this — VS Code's
                own answer to "where do multiple panel toggles live" is
                a small grouped cluster in persistent chrome (its title
                bar's Layout Controls), not floating over content or
                pinned to each panel's own edge; the outer rail is
                NAVI's equivalent of that persistent chrome. JuanJo's
                refinement: two separate one-click toggles here, not a
                combined cluster/popover — even collapsed to icon-only,
                each stays a single tap. */}
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: spacing.xxs, paddingTop: spacing.sm }}>
              {/* Pressed-state color follows whichever canvas is
                  currently active (same accent.color/accent.glow
                  treatment the canvas-switcher buttons above already
                  use) rather than a flat neutral highlight — JuanJo,
                  2026-09-01. Dashboard has no accent yet (not
                  `available` in the switcher above either), so this
                  falls back to the same neutral highlight only in that
                  one case. */}
              {(() => {
                const railAccent = activeCanvas in CANVAS_ACCENT ? CANVAS_ACCENT[activeCanvas as keyof typeof CANVAS_ACCENT] : null;
                return (
              <>
              <button
                className="sidebar-menu-btn"
                title={leftPanelOpen ? "Close left sidebar" : "Open left sidebar"}
                onClick={() => setLeftPanelOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.sm,
                  height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                  padding: `0 ${spacing.sm}px`,
                  borderRadius: radius.sm,
                  border: leftPanelOpen && railAccent ? `1px solid ${railAccent.glow}` : "1px solid transparent",
                  background: leftPanelOpen ? (railAccent ? railAccent.glow : "rgba(255,255,255,0.06)") : "transparent",
                  color: leftPanelOpen && railAccent ? railAccent.color : neutral.textPrimary,
                  cursor: "pointer", textAlign: "left",
                  fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                }}
              >
                {/* Real "toggle sidebar" glyphs (SidebarCollapse/
                    SidebarExpand), not borrowed icons that already mean
                    something else in this app — a hamburger means "open
                    a menu," a magnifying glass means "search," neither
                    actually says "sidebar" (JuanJo, 2026-09-01). Icon
                    shows the action a click will take, not the current
                    state — open shows the collapse glyph, closed shows
                    expand. */}
                {leftPanelOpen ? <SidebarCollapseIcon size={iconSize.sm} /> : <SidebarExpandIcon size={iconSize.sm} />}
                <span className="sidebar-menu-btn-label">{leftPanelOpen ? "Close left sidebar" : "Open left sidebar"}</span>
              </button>
              <button
                className="sidebar-menu-btn"
                title={rightPanelOpen ? "Close right sidebar" : "Open right sidebar"}
                onClick={() => setRightPanelOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.sm,
                  height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                  padding: `0 ${spacing.sm}px`,
                  borderRadius: radius.sm,
                  border: rightPanelOpen && railAccent ? `1px solid ${railAccent.glow}` : "1px solid transparent",
                  background: rightPanelOpen ? (railAccent ? railAccent.glow : "rgba(255,255,255,0.06)") : "transparent",
                  color: rightPanelOpen && railAccent ? railAccent.color : neutral.textPrimary,
                  cursor: "pointer", textAlign: "left",
                  fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                }}
              >
                {/* Same glyph, mirrored (scaleX(-1)) — Octicons only
                    ships one sidebar-collapse/-expand pair, drawn for a
                    left-side panel; flipping it reads as the right side
                    instead of reusing an icon that visually contradicts
                    which panel this button actually controls. */}
                <span style={{ display: "flex", transform: "scaleX(-1)" }}>
                  {rightPanelOpen ? <SidebarCollapseIcon size={iconSize.sm} /> : <SidebarExpandIcon size={iconSize.sm} />}
                </span>
                <span className="sidebar-menu-btn-label">{rightPanelOpen ? "Close right sidebar" : "Open right sidebar"}</span>
              </button>
              </>
                );
              })()}
            </div>
          </div>

          {/* bottom zone — "account stuff": genuinely global regardless
              of canvas, Settings anchored last (universal convention). */}
          <div style={{
            display: "flex", flexDirection: "column", gap: spacing.xxs, padding: spacing.sm,
            borderTop: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
          }}>
            {([
              { key: "usage", icon: <GraphIcon size={iconSize.sm} />, label: "Usage counters" },
              { key: "routing", icon: <GitBranchIcon size={iconSize.sm} />, label: "Routing & fallbacks" },
              { key: "models", icon: <CpuIcon size={iconSize.sm} />, label: "Today's models" },
              { key: "settings", icon: <GearIcon size={iconSize.sm} />, label: "Settings" },
            ] as const).map(({ key, icon, label }) => (
              <button
                key={key}
                className="sidebar-menu-btn"
                title={label}
                onClick={e => togglePanel(key, e.currentTarget)}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.sm,
                  height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                  padding: `0 ${spacing.sm}px`,
                  borderRadius: radius.sm, border: "none",
                  background: openPanel === key ? "rgba(255,255,255,0.06)" : "transparent",
                  color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                  fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                }}
              >
                {icon}
                <span className="sidebar-menu-btn-label">{label}</span>
              </button>
            ))}
            {pushStatus !== "unsupported" && (
              <button
                className="sidebar-menu-btn"
                title={
                  pushStatus === "subscribed" ? "Notifications on"
                  : pushStatus === "denied" ? "Notifications blocked"
                  : "Enable notifications"
                }
                onClick={handleEnablePush}
                disabled={pushStatus === "subscribed" || pushStatus === "loading" || pushStatus === "denied"}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.sm,
                  height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                  padding: `0 ${spacing.sm}px`,
                  borderRadius: radius.sm, border: "none", background: "transparent",
                  color: neutral.textPrimary,
                  cursor: pushStatus === "subscribed" || pushStatus === "denied" ? "default" : "pointer",
                  opacity: pushStatus === "denied" ? 0.5 : 1,
                  fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  textAlign: "left",
                }}
              >
                {pushStatus === "subscribed" ? <BellFillIcon size={iconSize.sm} /> : <BellIcon size={iconSize.sm} />}
                <span className="sidebar-menu-btn-label">
                  {pushStatus === "loading" ? "Enabling…"
                    : pushStatus === "subscribed" ? "Notifications on"
                    : pushStatus === "denied" ? "Notifications blocked"
                    : "Enable notifications"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sidebar — see .sidebar in index.css for the drawer/persistent
          responsive behavior. Now just Activity/Knowledge — Menu
          (conversation/routing/usage/notification actions) moved to
          the outer rail above. Desktop: not rendered at all while
          leftPanelOpen is false (see the open trigger button below,
          mirrors the right panel's own open/close pattern). Mobile:
          always rendered, drawer-slide handled by the .open class/CSS
          transform, same as before — leftPanelOpen doesn't apply there. */}
      {(!isDesktopSidebar || leftPanelOpen) && (
      <div ref={sidebarRef} className={`sidebar${sidebarOpen ? " open" : ""}`} style={{
        display: "flex", flexDirection: "column",
        background: sidebarBg,
        // Same color as the project masthead's own bottom border in the
        // outer rail (JuanJo, 2026-09-01) — this is the edge that faces
        // the canvas, so it gets the rail's separator color, not the
        // dimmer default border.
        borderRight: "1px solid rgba(255,255,255,0.14)",
        fontFamily,
      }}>
        {/* Horizontal resize handle — desktop only (see .sidebar-toggle-
            style display-in-CSS reasoning elsewhere; here it's simpler
            since this element just doesn't need to exist on mobile at
            all, no hiding trick required). Widened invisible hit area
            (12px) around a thin 1px visible line, same "small hit
            target inside a small dead-simple button/handle" pattern as
            everything else in this sidebar. */}
        {isDesktopSidebar && (
          <div
            className="sidebar-resize-handle"
            onPointerDown={handleSidebarResizeStart}
            title="Drag to resize"
            style={{ position: "absolute", top: 0, bottom: 0, right: -6, width: 12, zIndex: 31 }}
          >
            <div className="sidebar-resize-handle-line" />
          </div>
        )}
        {/* Just Activity/Knowledge now — Menu (conversation/routing/
            usage/settings/notifications) relocated to the outer rail.
            Close button lives here on both mobile (closes the drawer)
            and desktop (hides the panel entirely — see leftPanelOpen).
            Tabs share this same row now (2026-08-31, JuanJo's call) —
            they used to sit in their own padded content div below,
            which left a dead empty gap between the close button and the
            tabs above the actual content. One row, tabs left/close right. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          // Fixed-height row (JuanJo, 2026-09-01: "the tabs part still
          // has too much height... where activity and sources top bar
          // titles are" — the earlier sidebarTab.height fix only
          // shrunk the tab BUTTONS, this outer row's own generous
          // padding was the real source of the extra height. First
          // tried 32px, bumped to 48px live to compare). Tighter
          // horizontal padding too, not just vertical.
          height: 48, boxSizing: "border-box", padding: `0 ${spacing.sm}px 0 ${spacing.md}px`,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          {/* minWidth:0 lets this row actually shrink below its content
              size instead of pushing the close button off-screen when
              the sidebar is narrowed — the failure mode JuanJo hit
              (2026-08-31) once a 3rd tab (Files) made the strip wider.
              Inactive tabs collapse to icon-only (title attr = hover
              tooltip) for the same reason: text labels don't shrink
              gracefully, icons do, and a 3+ tab strip needs real room
              to breathe at narrow widths regardless of how many tools
              get added later. */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: sidebarTab.gap, minWidth: 0, overflow: "hidden" }}>
            {(["activity", "knowledge", "files"] as const).map(tab => {
              const active = leftPanelTab === tab;
              const label = tab === "activity" ? "ACTIVITY" : tab === "knowledge" ? "KNOWLEDGE" : "FILES";
              const Icon = tab === "activity" ? PulseIcon : tab === "knowledge" ? BookIcon : FileDirectoryIcon;
              // Active tab glows with whichever canvas is currently
              // active — same accent.color/accent.glow the left rail's
              // own canvas-switcher buttons use (JuanJo, 2026-09-01:
              // "glow with the color of the Canvas, like the left
              // rail"), replacing the earlier deliberately-neutral fill.
              const tabAccent = activeCanvas in CANVAS_ACCENT ? CANVAS_ACCENT[activeCanvas as keyof typeof CANVAS_ACCENT] : null;
              return (
                <button
                  key={tab}
                  onClick={() => setLeftPanelTab(tab)}
                  title={label}
                  aria-label={label}
                  className={`sidebar-tab${active ? " sidebar-tab-active" : ""}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                    padding: active ? `${sidebarTab.paddingV}px ${sidebarTab.paddingH}px` : 0,
                    width: active ? undefined : sidebarTab.height, justifyContent: "center",
                    height: sidebarTab.height, boxSizing: "border-box",
                    borderRadius: `${sidebarTab.radius}px`,
                    cursor: "pointer",
                    fontSize: sidebarTab.fontSize, fontWeight: sidebarTab.fontWeight, fontFamily,
                    letterSpacing: "0.04em",
                    color: active ? (tabAccent?.color ?? sidebarTab.activeColor) : sidebarTab.inactiveColor,
                    background: active ? (tabAccent?.glow ?? sidebarTab.activeBg) : "transparent",
                    boxShadow: active && tabAccent ? `0 0 12px ${tabAccent.glow}` : "none",
                    border: "none",
                    // Same spring-like easing the Chat mode-tabs use for
                    // their own press animation (JuanJo, 2026-09-01:
                    // "that animation is beautiful") — this tab strip
                    // had no transition at all before.
                    transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                >
                  <Icon size={13} />
                  {active && label}
                </button>
              );
            })}
          </div>
          <button
            className={isDesktopSidebar ? undefined : "sidebar-toggle"}
            aria-label="Close sidebar"
            onClick={() => (isDesktopSidebar ? setLeftPanelOpen(false) : setSidebarOpen(false))}
            style={{
              display: "flex", flexShrink: 0,
              alignItems: "center", justifyContent: "center",
              width: controlSize.sm, height: controlSize.sm,
              borderRadius: radius.xs, border: "none", background: "transparent",
              color: neutral.textMuted, cursor: "pointer",
            }}
          >
            <XIcon size={iconSize.sm} />
          </button>
        </div>
        {leftPanelTab === "files" ? (
        <div
          onDragOver={e => { e.preventDefault(); setFileDragOver(true); }}
          onDragLeave={() => setFileDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setFileDragOver(false);
            if (e.dataTransfer.files.length) addRealFiles(e.dataTransfer.files);
          }}
          style={{
            display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
            outline: fileDragOver ? `2px dashed ${sidebarBreadcrumb.ancestorColor}` : "none",
            outlineOffset: -2,
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
            padding: `${spacing.sm}px ${spacing.lg}px`, flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", minWidth: 0 }}>
              <button
                onClick={() => setFilePath(p => p.slice(0, -1))}
                disabled={filePath.length === 0}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 20, height: 20, borderRadius: radius.xs, border: "none",
                  background: "transparent", cursor: filePath.length ? "pointer" : "default",
                  color: filePath.length ? sidebarBreadcrumb.ancestorColor : neutral.textFaint,
                  marginRight: 2,
                }}
              >
                <ChevronLeftIcon size={12} />
              </button>
              <span
                onClick={() => setFilePath([])}
                className={filePath.length ? "sidebar-breadcrumb-link" : undefined}
                style={{
                  fontSize: sidebarBreadcrumb.fontSize,
                  fontWeight: filePath.length ? fontWeight.regular : sidebarBreadcrumb.currentWeight,
                  color: filePath.length ? sidebarBreadcrumb.ancestorColor : sidebarBreadcrumb.currentColor,
                  cursor: filePath.length ? "pointer" : "default",
                }}
              >
                Home
              </span>
              {filePath.map((segment, i) => {
                const isCurrent = i === filePath.length - 1;
                return (
                  <span key={i} style={{ display: "flex", alignItems: "center", gap: sidebarBreadcrumb.gap }}>
                    <span style={{ fontSize: sidebarBreadcrumb.fontSize, color: sidebarBreadcrumb.separatorColor }}>/</span>
                    <span
                      onClick={() => !isCurrent && setFilePath(filePath.slice(0, i + 1))}
                      className={isCurrent ? undefined : "sidebar-breadcrumb-link"}
                      style={{
                        fontSize: sidebarBreadcrumb.fontSize,
                        cursor: isCurrent ? "default" : "pointer",
                        fontWeight: isCurrent ? sidebarBreadcrumb.currentWeight : fontWeight.regular,
                        color: isCurrent ? sidebarBreadcrumb.currentColor : sidebarBreadcrumb.ancestorColor,
                      }}
                    >
                      {segment}
                    </span>
                  </span>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
              <button
                aria-label={filePath.length === 0 ? "Add directory" : "New folder"}
                title={filePath.length === 0 ? "Add directory (new root)" : "New folder"}
                onClick={() => { setAddingDirectory(o => !o); setNewDirectoryName(""); }}
                style={{
                  width: 22, height: 22, borderRadius: radius.xs,
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: addingDirectory ? sidebarTab.activeBg : "transparent",
                  color: addingDirectory ? sidebarBreadcrumb.ancestorColor : neutral.textMuted,
                }}
              >
                <PlusIcon size={13} />
              </button>
              <button
                aria-label="Import a real file"
                title="Import a real file"
                onClick={() => importFileInputRef.current?.click()}
                style={{
                  width: 22, height: 22, borderRadius: radius.xs,
                  border: "none", cursor: "pointer", background: "transparent", color: neutral.textMuted,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <UploadIcon size={13} />
              </button>
              <input
                ref={importFileInputRef}
                type="file"
                multiple
                onChange={e => { if (e.target.files?.length) addRealFiles(e.target.files); e.target.value = ""; }}
                style={{ display: "none" }}
              />
            </div>
          </div>

          {/* Always-open search — replaces the old toggle (JuanJo,
              2026-08-31: an extra click before every search, and closing
              it discarded the query, was the exact complaint). Scope
              chips pick "this folder" (default) vs. "all directories" —
              the latter walks every mounted root recursively, needed now
              that Files supports more than one root. */}
          <div style={{ padding: `0 ${spacing.lg}px ${spacing.sm}px`, display: "flex", flexDirection: "column", gap: spacing.xs, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <input
                placeholder="Search files…"
                value={fileSearchQuery}
                onChange={e => setFileSearchQuery(e.target.value)}
                style={{
                  width: "100%", background: neutral.surface, border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: radius.xs + 2, outline: "none", color: neutral.textPrimary,
                  fontSize: 12.5, padding: "5px 8px 5px 26px", fontFamily,
                }}
              />
              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "flex" }}>
                <SearchIcon size={12} fill={neutral.textFaint} />
              </span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["folder", "all"] as const).map(scope => {
                const active = fileSearchScope === scope;
                return (
                  <button
                    key={scope}
                    onClick={() => setFileSearchScope(scope)}
                    style={{
                      padding: "2px 7px", borderRadius: radius.xs, border: "none", cursor: "pointer",
                      fontSize: 10.5, fontFamily, letterSpacing: "0.03em",
                      color: active ? sidebarTab.activeColor : sidebarTab.inactiveColor,
                      background: active ? sidebarTab.activeBg : "transparent",
                    }}
                  >
                    {scope === "folder" ? "THIS FOLDER" : "ALL DIRECTORIES"}
                  </button>
                );
              })}
            </div>
          </div>

          {addingDirectory && (
            <div style={{ padding: `0 ${spacing.lg}px ${spacing.sm}px`, display: "flex", gap: spacing.xs, flexShrink: 0 }}>
              <input
                autoFocus
                placeholder={filePath.length === 0 ? "New root directory name…" : "New folder name…"}
                value={newDirectoryName}
                onChange={e => setNewDirectoryName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newDirectoryName.trim()) {
                    addDirectory(newDirectoryName);
                    setAddingDirectory(false);
                  }
                  if (e.key === "Escape") setAddingDirectory(false);
                }}
                style={{
                  flex: 1, background: neutral.surface, border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: radius.xs + 2, outline: "none", color: neutral.textPrimary,
                  fontSize: 12.5, padding: "5px 8px", fontFamily,
                }}
              />
            </div>
          )}

          <div className="hide-scrollbar" style={{
            flex: 1, overflowY: "auto", padding: `0 ${spacing.sm}px ${spacing.sm}px`,
            display: "flex", flexDirection: "column", gap: 1,
          }}>
            {visibleFolderContents.length === 0 ? (
              <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, padding: `${spacing.sm}px ${spacing.sm}px` }}>
                {fileSearchQuery ? "No matches." : "Empty folder."}
              </div>
            ) : visibleFolderContents.map(({ node, path }) => {
              const isRoot = path.length === 0 && !fileSearchQuery;
              const showPathHint = fileSearchScope === "all" && fileSearchQuery && path.length > 0;
              return (
                <div
                  key={`${path.join("/")}/${node.name}`}
                  onClick={() => {
                    if (node.type === "folder") { setFilePath([...path, node.name]); setFileSearchQuery(""); }
                    else openFile(node);
                  }}
                  className="sidebar-row"
                  style={{
                    display: "flex", alignItems: "center", gap: sidebarRow.gap,
                    padding: `${sidebarRow.paddingV}px ${sidebarRow.paddingH}px`, borderRadius: sidebarRow.radius,
                    cursor: "pointer",
                  }}
                >
                  {node.type === "folder"
                    ? isRoot
                      ? <PinIcon size={sidebarRow.iconSize} fill={neutral.textMuted} />
                      : <FileDirectoryIcon size={sidebarRow.iconSize} fill={neutral.textMuted} />
                    : <FileIcon size={sidebarRow.iconSize} fill={neutral.textFaint} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12.5, color: node.type === "folder" ? neutral.textPrimary : neutral.textMuted,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {node.name}
                    </div>
                    {showPathHint && (
                      <div style={{ fontSize: 10, color: neutral.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Home/{path.join("/")}
                      </div>
                    )}
                  </div>
                  {isRoot && (
                    <button
                      aria-label={`Remove ${node.name} directory`}
                      title="Remove directory"
                      onClick={e => { e.stopPropagation(); removeRootDirectory(node.name); }}
                      className="sidebar-row-remove"
                      style={{
                        width: 18, height: 18, borderRadius: radius.xs, border: "none",
                        background: "transparent", color: neutral.textFaint, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}
                    >
                      <XIcon size={11} />
                    </button>
                  )}
                  {node.type === "folder" && <ChevronRightIcon size={12} />}
                </div>
              );
            })}
          </div>
        </div>
        ) : (
        <div style={{
          padding: `0 ${spacing.lg}px ${spacing.lg}px`,
          flex: 1, minHeight: 0, overflowY: "auto",
        }}>
          {leftPanelTab === "knowledge" ? (
            MOCK_KNOWLEDGE.length === 0 ? (
              <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginTop: spacing.sm }}>
                Nothing saved yet — accepted sources and research get synthesized here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm, marginTop: spacing.sm }}>
                {MOCK_KNOWLEDGE.map(item => (
                  <div key={item.title} style={{ padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.sm, background: "rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs }}>
                      <span style={{ fontSize: fontSize.xs, color: neutral.textPrimary }}>{item.title}</span>
                      <span style={{
                        fontSize: fontSize.xxs, color: neutral.textMuted, flexShrink: 0,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                      }}>
                        /{item.origin}
                      </span>
                    </div>
                    <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, marginTop: 2 }}>{item.note}</div>
                  </div>
                ))}
              </div>
            )
          ) : activityItems.length === 0 ? (
            <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginTop: spacing.sm }}>
              No commands run yet in this conversation.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: spacing.md, marginTop: spacing.sm }}>
              {activityItems.map((item, i) => (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs }}>
                    <span style={{ fontSize: fontSize.sm, color: neutral.textPrimary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
                      /{item.command}
                    </span>
                    <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted, flexShrink: 0 }}>
                      {formatDayLabel(item.timestamp)}, {formatTime(item.timestamp)}
                    </span>
                  </div>
                  {item.attachments.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs, marginTop: spacing.xs }}>
                      {item.attachments.map(a => (
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
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
      )}

      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />

      {/* Sidebar toggle — top-left, same row as the mode selector.
          Hidden at the persistent-sidebar breakpoint (see .sidebar-toggle
          in index.css) since there's nothing to toggle there. */}
      <button
        className="sidebar-toggle"
        aria-label="Open menu"
        onClick={() => setSidebarOpen(true)}
        style={{
          // zIndex 11, not 10 — the mode-selector row below renders
          // later in the DOM at zIndex 10 too, and its .centered-col
          // div spans the FULL width (needed for the centering math),
          // not just the visible buttons. Same z-index + later DOM
          // order meant it won the stacking tie and sat on top,
          // swallowing almost all of the hamburger's clickable area —
          // found live, "only clickable in the bottom ~4px."
          position: "absolute", top: spacing.xl, left: spacing.xl, zIndex: 11,
          // display intentionally NOT set here — same reasoning as the
          // close button above.
          alignItems: "center", justifyContent: "center",
          width: controlSize.md, height: controlSize.md,
          borderRadius: radius.sm,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.06)",
          color: neutral.textPrimary,
          cursor: "pointer",
          boxShadow: `0 2px 14px rgba(0,0,0,0.35), 0 0 10px ${neutralGlow}`,
        }}
      >
        <ThreeBarsIcon size={iconSize.sm} />
      </button>

      {/* Left sidebar's OPEN trigger moved into the outer rail's middle
          zone (2026-09-01) — a floating button pinned to a fixed screen
          coordinate inevitably collided with some canvas's own content
          (found live in Dev Slate). Desktop-only concern entirely (the
          rail itself is desktop-only), so nothing needed for mobile
          here — mobile already has its own separate hamburger→drawer
          flow (sidebarOpen, above) untouched by this. */}

      {/* Right sidebar OPEN trigger — mobile only now (desktop's moved
          into the outer rail's middle zone alongside the left sidebar's,
          same reasoning: a fixed-position floating button collides with
          canvas content eventually). Still needed here for mobile,
          where the panel renders as an overlay drawer with no
          rail-equivalent chrome to live in instead (see .right-panel
          below). */}
      {!isDesktopSidebar && !rightPanelOpen && (
        <button
          aria-label="Open sources panel"
          onClick={() => setRightPanelOpen(true)}
          style={{
            position: "absolute", top: spacing.xl, right: spacing.xl, zIndex: 31,
            display: "flex", alignItems: "center", justifyContent: "center",
            width: controlSize.md, height: controlSize.md,
            borderRadius: radius.sm,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            color: neutral.textPrimary,
            cursor: "pointer",
            boxShadow: `0 2px 14px rgba(0,0,0,0.35), 0 0 10px ${neutralGlow}`,
          }}
        >
          <SearchIcon size={iconSize.sm} />
        </button>
      )}

      {/* Mobile backdrop for the right panel — same tap-outside-to-close
          convention as .sidebar-backdrop. Desktop doesn't need this:
          there the panel is docked (shifts .chat-column, see the
          right-panel-open body class) rather than overlaying it. */}
      {!isDesktopSidebar && rightPanelOpen && (
        <div className="sidebar-backdrop" onClick={() => setRightPanelOpen(false)} />
      )}

      {/* Right sidebar panel — mirrors .sidebar's fixed/full-height
          structure (see .right-panel in index.css). Single-purpose
          (Sources) now — Knowledge moved to sit alongside Activity in
          the left sidebar instead, since both are records of past
          work rather than a live tool like Sources. Background/border
          colors set inline, same split as .sidebar itself, since they
          depend on the active mode's theme. No longer desktop-only —
          on mobile this renders the same way, just as an overlay
          drawer instead of a docked panel (the right-panel-open body
          class that shifts .chat-column only ever gets added on
          desktop, so mobile naturally gets drawer behavior for free). */}
      {rightPanelOpen && (
        <div className="right-panel hide-scrollbar" style={{
          // Canvas tier, not rail tier — the right sidebar fuses with
          // the canvas rather than getting its own color (JuanJo's call
          // 2026-08-31, matching what every source reviewed tonight
          // agreed on: right sidebar is canvas-local, not a separate zone).
          background: canvasBg,
          // Same color as the project masthead's own bottom border in
          // the outer rail (JuanJo, 2026-09-01) — matches the Left
          // Sidebar's own canvas-facing edge above.
          borderLeft: "1px solid rgba(255,255,255,0.14)",
          fontFamily,
        }}>
          {/* Horizontal resize — same mechanics as the left sidebar's
              handle, mirrored to the panel's left edge (this panel
              grows leftward, anchored to the viewport's right edge). */}
          <div
            className="sidebar-resize-handle"
            onPointerDown={handleRightPanelResizeStart}
            title="Drag to resize"
            style={{ position: "absolute", top: 0, bottom: 0, left: -6, width: 12, zIndex: 31 }}
          >
            <div className="sidebar-resize-handle-line" />
          </div>
          {/* header — tab strip (Sources / Files), same shape as before
              Knowledge moved out, just repurposed for the new Files
              tool instead. Close button lives here, in normal flex flow
              (justify-content:space-between) — not a separately-
              positioned floating element — so it always aligns with
              this row's own content regardless of the panel's (fluid)
              width. */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
            // Same fixed-height treatment as the left sidebar's tab
            // row — JuanJo, 2026-09-01.
            height: 48, boxSizing: "border-box", padding: `0 ${spacing.md}px`,
            borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
          }}>
            {activeCanvas === "agentWork" ? (
              /* Agent Work's right panel isn't tabbed like Chat's —
                 just a label plus the small Connections trigger (a
                 button opening a popover, not its own sidebar section
                 — deliberately small per JuanJo's spec, since it's
                 status, not a catalog). */
              <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
                <span style={{ fontSize: sidebarTab.fontSize, fontWeight: sidebarTab.fontWeight, color: sidebarTab.activeColor, fontFamily }}>
                  Agent Work
                </span>
                <button
                  onClick={e => togglePanel("connections", e.currentTarget)}
                  title="Connections"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: `4px ${spacing.xs}px`, borderRadius: radius.xs,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: openPanel === "connections" ? "rgba(255,255,255,0.06)" : "transparent",
                    color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
                  }}
                >
                  <LinkIcon size={12} />
                  Connections
                </button>
              </div>
            ) : activeCanvas === "devSlate" ? (
              // Same plain-label shape as Agent Work above — Task
              // State/Change History are two stacked sections (like
              // Schedule/Run History), not tabs, so there's nothing to
              // switch between up here.
              <span style={{ fontSize: sidebarTab.fontSize, fontWeight: sidebarTab.fontWeight, color: sidebarTab.activeColor, fontFamily }}>
                Dev Slate
              </span>
            ) : (
            // Files moved to the left sidebar (2026-08-31) — Sources is
            // now the right panel's only tool, so this is a plain label
            // like Agent Work's above, not a tab strip with one tab.
            <span style={{
              padding: `${sidebarTab.paddingV}px ${sidebarTab.paddingH}px`,
              fontSize: sidebarTab.fontSize, fontWeight: sidebarTab.fontWeight, fontFamily,
              letterSpacing: "0.04em", color: sidebarTab.activeColor,
            }}>
              SOURCES
            </span>
            )}
            <button
              aria-label="Close sources panel"
              onClick={() => setRightPanelOpen(false)}
              style={{
                width: 22, height: 22, borderRadius: radius.xs,
                border: "none", background: "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: neutral.textMuted,
              }}
            >
              <XIcon size={14} />
            </button>
          </div>

          {activeCanvas === "agentWork" ? (
            /* Calendar (primary — "what's going to fire when" across
               every workflow in this project) over Run History
               (secondary, smaller — JuanJo's explicitly experimental
               inclusion, "sounds okayish, we can see how it goes", not
               a locked decision the way the calendar is). Plain flex
               split, not a resizable Group — doesn't need drag-resize
               the way Dev Slate's code column does. */
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 7, minHeight: 0 }}>
                {devSlatePane(<CalendarIcon size={22} fill={CANVAS_ACCENT.agentWork.color} />, "Schedule", "When every workflow in this project is set to fire — across all of them, not one at a time. Not wired up yet.")}
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
              <div style={{ flex: 3, minHeight: 0 }}>
                {devSlatePane(<HistoryIcon size={18} fill={CANVAS_ACCENT.agentWork.color} />, "Run History", "Recent runs across this project's workflows. Experimental inclusion — not wired up yet.")}
              </div>
            </div>
          ) : activeCanvas === "devSlate" ? (
            /* Task State (primary) over Change History (secondary) —
               same shape as Agent Work's Schedule/Run History split
               above, but real content, not devSlatePane placeholders:
               task_state is the model's own running summary
               (update_task_state, dispatcher/devslate_chat.py), Change
               History is every write_file that's actually landed on
               disk this session (devslateStore.ts's changeHistory,
               appended in notifyFileWritten — the one place every
               accepted write funnels through regardless of review-vs-
               auto-accept). */
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 7, minHeight: 0, padding: spacing.lg, overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm }}>
                  <BookIcon size={16} fill={CANVAS_ACCENT.devSlate.color} />
                  <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>Task State</span>
                </div>
                {!devSlateState.taskState?.goal ? (
                  <div style={{ fontSize: fontSize.xs, color: neutral.textFaint, lineHeight: lineHeight.base }}>
                    Nothing yet — this fills in once the model calls update_task_state for this Slate.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
                    <div>
                      <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Goal</div>
                      <div style={{ fontSize: fontSize.xs, color: neutral.textPrimary, lineHeight: lineHeight.base }}>{devSlateState.taskState.goal}</div>
                    </div>
                    {devSlateState.taskState.decisions.length > 0 && (
                      <div>
                        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Decisions</div>
                        <ul style={{ margin: 0, paddingLeft: spacing.md, display: "flex", flexDirection: "column", gap: 4 }}>
                          {devSlateState.taskState.decisions.map((d, i) => (
                            <li key={i} style={{ fontSize: fontSize.xs, color: neutral.textMuted, lineHeight: lineHeight.base }}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {devSlateState.taskState.built.length > 0 && (
                      <div>
                        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Built so far</div>
                        <ul style={{ margin: 0, paddingLeft: spacing.md, display: "flex", flexDirection: "column", gap: 4 }}>
                          {devSlateState.taskState.built.map((b, i) => (
                            <li key={i} style={{ fontSize: fontSize.xs, color: neutral.textMuted, lineHeight: lineHeight.base }}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
              <div style={{ flex: 3, minHeight: 0, padding: spacing.lg, overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm }}>
                  <HistoryIcon size={16} fill={CANVAS_ACCENT.devSlate.color} />
                  <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>Change History</span>
                </div>
                {devSlateState.changeHistory.length === 0 ? (
                  <div style={{ fontSize: fontSize.xs, color: neutral.textFaint, lineHeight: lineHeight.base }}>
                    No accepted changes yet this session.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {[...devSlateState.changeHistory].reverse().map((entry, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "baseline", gap: spacing.xs, fontSize: fontSize.xxs }}>
                        <span style={{ color: neutral.textFaint, flexShrink: 0 }}>{formatTime(entry.timestamp)}</span>
                        <span style={{ color: neutral.textMuted, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.path}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : viewerExpanded && openDocument ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {viewerPane}
            </div>
          ) : (
          <Group orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
          <Panel id="right-tab-content" defaultSize={260} minSize={100}>
          <div className="hide-scrollbar" style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div style={{ padding: `${spacing.md}px ${spacing.lg}px 0` }}>
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center",
                  padding: 6, borderRadius: radius.lg + 2,
                  background: neutral.surface, border: "1px solid rgba(255,255,255,0.12)",
                }}>
                  {sourceChips.map((chip, i) => (
                    <div key={chip} style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "3px 5px 3px 8px", borderRadius: radius.xs + 3,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                      color: neutral.textPrimary, fontSize: 12,
                    }}>
                      {chip}
                      <span
                        onClick={() => setSourceChips(cs => cs.filter((_, j) => j !== i))}
                        style={{ cursor: "pointer", display: "flex" }}
                      >
                        <XIcon size={12} />
                      </span>
                    </div>
                  ))}
                  <input
                    placeholder={sourceChips.length ? "Add another term…" : "e.g. offline-first sync"}
                    value={sourceDraft}
                    onChange={e => setSourceDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && sourceDraft.trim()) {
                        setSourceChips(cs => [...cs, sourceDraft.trim()]);
                        setSourceDraft("");
                      }
                    }}
                    style={{
                      flex: 1, minWidth: 80, background: "transparent", border: "none", outline: "none",
                      color: neutral.textPrimary, fontSize: 12, padding: "4px 3px", fontFamily,
                    }}
                  />
                </div>
              </div>

              <div style={{ padding: `${spacing.sm + 2}px ${spacing.lg}px ${spacing.md}px`, flexShrink: 0 }}>
                <button
                  disabled={!sourceChips.length}
                  style={{
                    width: "100%", padding: 8, borderRadius: radius.xs + 2, fontSize: 12.5,
                    fontWeight: fontWeight.medium, fontFamily,
                    cursor: sourceChips.length ? "pointer" : "not-allowed",
                    color: sourceChips.length ? neutral.textPrimary : neutral.textFaint,
                    background: sourceChips.length ? "rgba(255,255,255,0.1)" : "rgba(4,8,18,0.3)",
                    border: sourceChips.length ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "none",
                  }}
                >
                  Batch Dispatch
                </button>
              </div>

              <div className="hide-scrollbar" style={{
                flex: 1, overflowY: "auto", padding: `0 ${spacing.lg}px ${spacing.sm}px`,
                display: "flex", flexDirection: "column", gap: spacing.sm,
                maskImage: "linear-gradient(to bottom, black calc(100% - 20px), transparent)",
              }}>
                {/* term 1: done, expandable */}
                <div>
                  <div
                    onClick={() => setSourceTerm1Open(o => !o)}
                    style={{ display: "flex", alignItems: "center", gap: spacing.sm, padding: "6px 0", cursor: "pointer" }}
                  >
                    {sourceTerm1Open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                    <span style={{ flex: 1, fontSize: 13, color: neutral.textPrimary }}>offline-first sync</span>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: neutral.statusAwake }} />
                    <span style={{ fontSize: 11, color: neutral.textMuted }}>4 sources</span>
                  </div>
                  {sourceTerm1Open && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {MOCK_SOURCES.map((s, i) => {
                        const t = SOURCE_TIER_META[s.tier];
                        const checked = !!sourceTicks[i];
                        return (
                          <div key={s.title} style={{
                            display: "flex", alignItems: "center", gap: spacing.sm,
                            padding: "7px 8px", borderRadius: radius.xs + 1, background: "rgba(255,255,255,0.06)",
                          }}>
                            <div
                              onClick={() => handleSourceTickAttempt(i, checked)}
                              style={{
                                flexShrink: 0, width: 15, height: 15, borderRadius: 4, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                background: checked ? neutral.dotNeutral : "transparent",
                                border: checked ? `1px solid ${neutral.dotNeutral}` : "1px solid rgba(255,255,255,0.3)",
                              }}
                            >
                              {checked && <CheckIcon size={9} fill="#080608" />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: 12.5, color: neutral.textPrimary,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>{s.title}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                                <span style={{ fontSize: 10.5, color: neutral.textFaint }}>{s.domain}</span>
                                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 100, color: t.color, background: t.bg }}>{t.label}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* term 2: searching */}
                <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, padding: "6px 0" }}>
                  <ChevronRightIcon size={12} />
                  <span className="step-pulse" style={{ flex: 1, fontSize: 13, color: neutral.textMuted }}>conflict resolution</span>
                  <span style={{ fontSize: 11, color: neutral.textMuted }}>searching…</span>
                </div>

                {/* term 3: needs input */}
                <div style={{
                  display: "flex", alignItems: "center", gap: spacing.sm, padding: "6px 8px",
                  borderRadius: radius.xs + 1, background: "rgba(230,180,80,0.06)",
                }}>
                  <ChevronRightIcon size={12} />
                  <span style={{ flex: 1, fontSize: 13, color: neutral.textPrimary }}>CRDT algorithms</span>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgb(230,180,80)" }} />
                  <span style={{ fontSize: 11, color: "rgb(230,180,80)" }}>needs input</span>
                </div>
              </div>
            </div>

          </div>
          </Panel>
          {openDocument && (
            <>
              <Separator className="sidebar-vertical-separator" />
              <Panel id="right-viewer" minSize={100}>
                {viewerPane}
              </Panel>
            </>
          )}
          </Group>
          )}

          {/* persistent footer disclaimer — Sources-specific. Right
              panel only ever shows Sources now (Files moved to the left
              sidebar), so this just needs the activeCanvas check —
              Agent Work's panel doesn't render Sources at all. */}
          {activeCanvas === "chat" && !viewerExpanded && (
            <div style={{
              padding: `${spacing.sm + 2}px ${spacing.lg}px`, borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex", gap: 7, alignItems: "flex-start", flexShrink: 0,
            }}>
              <AlertIcon size={13} fill="rgba(230,180,80,0.9)" />
              <span style={{ fontSize: 11, color: neutral.textMuted, lineHeight: 1.4 }}>
                Not personally reviewed sources can harm output in chat.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Sources review warning — one-time acknowledgment gate before a
          source can be ticked. Anchored over the chat at the right
          panel's height (not inside the panel itself — it's warning
          about trusting chat output, so it sits where the chat is).
          Scrim blocks the rest of the app so it has to be acknowledged,
          not dismissed by clicking away. Logic-only for now: no real
          enforcement is wired up yet (see the deferred tick-enforcement
          item) — this just gets the UI in place ahead of that wiring. */}
      {sourceWarningOpen && (
        <>
          <div
            onClick={() => {}}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 39 }}
          />
          <div style={{
            position: "fixed", top: 96,
            right: `calc(var(--right-panel-width, 280px) + ${spacing.xxl * 2}px)`,
            width: 420, zIndex: 40,
            background: "rgba(4,8,18,0.92)",
            border: "1px solid rgba(230,180,80,0.4)",
            borderRadius: radius.lg,
            boxShadow: "0 8px 30px rgba(0,0,0,0.5), 0 0 20px rgba(230,180,80,0.18)",
            padding: spacing.xl,
            fontFamily,
          }}>
            <div style={{ display: "flex", gap: spacing.md, alignItems: "flex-start" }}>
              <div style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: radius.sm,
                background: "rgba(230,180,80,0.14)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <AlertIcon size={18} fill="rgb(230,180,80)" />
              </div>
              <div>
                <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, marginBottom: spacing.xs }}>
                  Review sources before use
                </div>
                <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, lineHeight: lineHeight.base }}>
                  A source has to be ticked before NAVI can use it in this chat. Sources that haven't been
                  personally reviewed can lead to wrong or misleading conclusions — ticking one means you've
                  looked at it and accepted it. This shows once; after this, it's on you to review what you tick.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: spacing.lg }}>
              <button
                onClick={() => { setSourceWarningAcknowledged(true); setSourceWarningOpen(false); }}
                style={{
                  padding: `${spacing.sm + 1}px ${spacing.lg}px`, borderRadius: radius.sm,
                  fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily, cursor: "pointer",
                  color: neutral.textPrimary,
                  background: "rgba(230,180,80,0.14)",
                  border: "1px solid rgba(230,180,80,0.5)",
                }}
              >
                I understand
              </button>
            </div>
          </div>
        </>
      )}

      {/* Agent Work canvas — full-screen takeover, not a sidebar tool:
          a real node-graph workflow builder needs canvas width no
          sidebar can give (that's why this exists as its own canvas at
          all, not another right-panel tab). Shell/placeholder only —
          the real content is an embedded Activepieces instance, which
          needs backend infra (Postgres + Redis + its own server) not
          built yet. Sits above the chat UI (still fully mounted and
          usable underneath — sidebars stay exactly as the user left
          them, no automatic fade/hide; if they want the space back,
          that's their call via the existing manual resize/close
          controls, not something this canvas does for them), below
          the outer rail so canvas-switching stays reachable. */}
      {activeCanvas === "agentWork" && (
        <div style={{
          position: "absolute", inset: 0, left: "var(--outer-rail-width, 0px)",
          zIndex: 20, background: "#080808",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ textAlign: "center", color: neutral.textFaint, maxWidth: 360 }}>
            <RocketIcon size={28} fill={CANVAS_ACCENT.agentWork.color} />
            <div style={{ fontSize: fontSize.sm, color: neutral.textMuted, marginTop: spacing.md, fontWeight: fontWeight.medium }}>
              Agent Work canvas
            </div>
            <div style={{ fontSize: fontSize.xs, marginTop: spacing.xs, lineHeight: lineHeight.base }}>
              The visual workflow builder lives here — real content (an embedded Activepieces
              instance) needs backend work that hasn't started yet.
            </div>
          </div>

          {/* Compact chat popup — bottom-right, collapsed by default. */}
          <div style={{ position: "absolute", bottom: spacing.xl, right: spacing.xl, zIndex: 21 }}>
            {agentWorkChatOpen ? (
              <div style={{
                width: 320, height: 400, display: "flex", flexDirection: "column",
                background: "rgba(10,12,18,0.95)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: radius.lg, boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                overflow: "hidden",
              }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: `${spacing.sm}px ${spacing.md}px`, borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}>
                  <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
                    Canvas chat
                  </span>
                  <button
                    aria-label="Collapse chat"
                    onClick={() => setAgentWorkChatOpen(false)}
                    style={{
                      width: 22, height: 22, borderRadius: radius.xs, border: "none", background: "transparent",
                      color: neutral.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <ChevronDownIcon size={14} />
                  </button>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: spacing.lg }}>
                  <span style={{ fontSize: fontSize.xxs, color: neutral.textFaint, textAlign: "center" }}>
                    Not wired up yet — context will be this canvas's state plus a
                    summary of a linked chat.
                  </span>
                </div>
              </div>
            ) : (
              <button
                aria-label="Open canvas chat"
                onClick={() => setAgentWorkChatOpen(true)}
                style={{
                  width: controlSize.md + 6, height: controlSize.md + 6, borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)",
                  color: neutral.textPrimary, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 4px 18px rgba(0,0,0,0.4)",
                }}
              >
                <CommentDiscussionIcon size={iconSize.md} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Dev Slate canvas — same full-screen-takeover convention as
          Agent Work above (sits above chat, left/right sidebars stay
          exactly as the user left them, reachable the whole time —
          that's where Files/Activity/version-history live for this
          canvas too, reused as-is, not rebuilt here). Layout is a real
          movable canvas now (dockview, 2026-09-01) — the earlier fixed
          Group/Panel tree only resized within a set structure; this
          drags to any edge, docks, tabs, collapses. See
          DevSlateDockview.tsx for the panel registration/default
          layout/persistence. */}
      {activeCanvas === "devSlate" && (
        <div style={{
          position: "absolute", inset: 0, left: "var(--outer-rail-width, 0px)",
          zIndex: 20, background: "#080808",
        }}>
          <DevSlateDockview />
        </div>
      )}

      {/* Mode selector — top-center. No shared container anymore: each
          label just sits with even spacing; only the active one gets
          real button chrome (background + glow), the others are plain
          text. Reads as "pick one" rather than a boxed segmented control.
          zIndex is required here: .chat-column below is a full-screen
          inset:0 div that renders after this in the DOM, so without an
          explicit stacking order its invisible hit-box (padding doesn't
          exempt it from capturing clicks) sits on top and swallows
          clicks on Research/Brainstorm before they reach these buttons. */}
      <div className="centered-col mode-tabs-row" style={{
        position: "absolute", top: spacing.xl,
        display: "flex", alignItems: "center",
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
                // Active tab's horizontal padding is a CSS var, not a
                // plain spacing token — narrow phones need it smaller
                // (see --mode-tab-active-padding-h in index.css) to
                // keep the whole row from extending under the
                // hamburger/status icons at the edges.
                padding: active ? `${spacing.sm}px var(--mode-tab-active-padding-h)` : `${spacing.sm}px ${spacing.xxs}px`,
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
                boxShadow: active ? `0 2px 14px rgba(0,0,0,0.35), 0 0 20px ${t.glow}` : "none",
                transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Model picker moved below the input (2026-09-01) — see the
          compact button next to the input pill further down, matching
          Dev Slate's own ModelBadge position/size. This row now only
          ever holds the "Branched from X" pill. */}
      <div className="centered-col" style={{ position: "absolute", top: 64, zIndex: 10 }}>
        {/* "Branched from X" — the branch-awareness piece that's the
            actual gap in Claude's own product (real branches exist
            there, but stay invisible behind tiny pagination arrows).
            Only ever one level, so a single pill suffices — no tree
            view needed for that. Click jumps straight to the parent. */}
        {currentParentChat && (
          <button
            onClick={() => {
              loadConversation(currentParentChat.id).then(c => c && openConversation(c));
            }}
            title={`Branched from "${currentParentChat.title}" — click to open it`}
            style={{
              display: "flex", alignItems: "center", gap: spacing.xs,
              padding: `${spacing.xs}px ${spacing.md}px`, marginLeft: spacing.xs,
              borderRadius: radius.sm, border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent", color: neutral.textMuted, cursor: "pointer",
              fontSize: fontSize.xxs, fontFamily, whiteSpace: "nowrap",
              maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            <GitBranchIcon size={12} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Branched from {currentParentChat.title}</span>
          </button>
        )}

      </div>

      {/* Chat surface — glassy bubbles over the animated background.
          Top padding clears the mode selector above; position/inset,
          max-width/centering, and the sidebar-gap shift for wider
          screens all live in index.css (.chat-column) — position/inset
          moved there too (not just the media-query parts) so the
          persistent-sidebar breakpoint's left/right override actually
          takes effect; an inline style here would always win over any
          external stylesheet rule regardless of media query. */}
      <div className="chat-column" style={{
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
              background: theme.bubbleBg,
              border: `1px solid ${theme.bubbleBorder}`,
              boxShadow: `0 4px 18px rgba(0,0,0,0.35), 0 0 20px ${theme.glow}`,
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
                // NAVI's bubble fully carries the active mode's tint — that's
                // the "content" layer, meant to feel immersive. Your own
                // messages stay neutral on purpose (see the button-color
                // discussion: chrome stays stable, content shifts).
                background: m.role === "navi" ? theme.bubbleBg : neutral.userBubbleBg,
                border: m.role === "navi"
                  ? `1px solid ${theme.bubbleBorder}`
                  : `1px solid ${neutral.userBubbleBorder}`,
                boxShadow: m.role === "navi"
                  ? `0 4px 18px rgba(0,0,0,0.35), 0 0 20px ${theme.glow}`
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
          {/* Just "Today's models" now — New conversation/Past conversations/
              Routing & fallbacks/Usage counters relocated to the sidebar
              (see MENU section above); this one stays on the chat screen
              per JuanJo's call, since it's about the current conversation's
              model, not app-wide navigation. */}
          {([
            { key: "models", icon: <CpuIcon size={10} />, label: "Today's models" },
            { key: "commands", icon: <CommandPaletteIcon size={10} />, label: "Commands" },
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
                  // Neutral now (2026-08-31) — a control/trigger, not
                  // content; mode-color stays on the tabs and NAVI's
                  // own reply bubbles only.
                  // Trimmed 2026-09-01 from the original 8px/12px
                  // padding, 6px gap, 14px icon — a straight 50% cut
                  // ("halved") went too far the other way, so this
                  // lands roughly 3/4 of the original size instead.
                  display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  padding: "6px 9px",
                  borderRadius: radius.sm, // squared-with-rounded-corners, matches bubbles/input
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: panelActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.06)",
                  color: neutral.textPrimary,
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  whiteSpace: "nowrap",
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

        {openPanel && (isDockedDetail || anchorRect) && (
          <>
            {/* Click-outside-to-close overlay — skipped entirely for the
                docked desktop panel, which behaves like a selected list
                item showing its detail (stays open until another item's
                clicked or the same one toggled again), not a dismiss-on-
                outside-click popover. zIndex above the sidebar's (30, see
                .sidebar in index.css) — these popovers can be triggered
                from menu buttons that live inside the sidebar itself. */}
            {!isDockedDetail && (
              <div onClick={() => setOpenPanel(null)} style={{ position: "fixed", inset: 0, zIndex: 35 }} />
            )}

            {/* Popover (mobile/tablet, or newConvo/models/commands
                regardless of width) — position:fixed relative to the
                viewport, floating near the clicked button. No connector
                arm — tried it, looked bad, dropped it. maxHeight+scroll
                is a safety net: the flip heuristic picks whichever side
                has more room, but doesn't guarantee the content actually
                fits. Docked mode (desktop, history/routing/usage) is the
                exact same element, just positioned to sit flush against
                the sidebar's menu-list column instead — see
                .sidebar-detail-panel in index.css for why that's a CSS
                class rather than inline math: its width has to track the
                sidebar's own fluid clamp() formula, which inline styles
                can't read back out. */}
            <div className={isDockedDetail ? "hide-scrollbar sidebar-detail-panel" : "hide-scrollbar"} style={isDockedDetail ? {
              // height mirrors the Menu section's own measured height
              // (menuSectionRef/menuSectionHeight) instead of spanning
              // the full sidebar — matches "inherit the height of the
              // menu" and sets up correctly for Menu/Activity becoming
              // independently resizable later. Falls back to a fixed
              // guess only for the one frame before ResizeObserver's
              // first measurement lands.
              height: menuSectionHeight ?? 280,
              background: neutral.surface,
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              // No glow here — that's the right call for a floating
              // popover drawing attention to itself, but this is
              // structural sidebar furniture now, not a transient
              // overlay. A plain shadow (no color) reads calmer.
              boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
              // padding lives on .sidebar-detail-content (the inner
              // scrollable div) now, not here — see that class.
              color: neutral.textPrimary,
              fontFamily,
            } : {
              position: "fixed", left: anchorRect?.popoverLeft,
              ...(anchorRect?.top !== undefined ? { top: anchorRect.top } : { bottom: anchorRect?.bottom }),
              width: Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_MARGIN * 2), // same width for all five panels
              maxHeight: "70vh", overflowY: "auto",
              zIndex: 36, // above the sidebar (30) and its own overlay (35) above
              background: "rgba(10,12,18,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: radius.lg,
              boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
              padding: spacing.md,
              color: neutral.textPrimary,
              fontFamily,
            }}>
              {isDockedDetail && (
                <button
                  className="sidebar-detail-close"
                  aria-label="Close"
                  title="Close"
                  onClick={() => setOpenPanel(null)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: controlSize.sm, height: controlSize.sm,
                    borderRadius: radius.xs, border: "none", background: "transparent",
                    color: neutral.textMuted, cursor: "pointer",
                  }}
                >
                  <XIcon size={iconSize.sm} />
                </button>
              )}
              {/* Separate from the outer panel div specifically so the
                  bottom fade mask (docked mode only) only affects the
                  scrollable content, not the panel's own background/
                  border — found live: masking the whole outer element
                  faded the left border out too, which looked wrong
                  since that border is part of the panel's static chrome,
                  not something that should fade with the content. A
                  no-op wrapper (no class/style) in floating-popover mode. */}
              <div
                className={isDockedDetail ? "hide-scrollbar sidebar-detail-content" : undefined}
                style={isDockedDetail ? { height: "100%" } : undefined}
              >
              {openPanel === "projects" && (
                <div>
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Projects
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs, marginBottom: spacing.md }}>
                    {projects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => switchProject(p.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: spacing.xs,
                          padding: spacing.xs, borderRadius: radius.sm, border: "none",
                          background: p.id === activeProjectId ? "rgba(255,255,255,0.06)" : "transparent",
                          cursor: "pointer", textAlign: "left",
                          width: "100%",
                        }}
                      >
                        <FileDirectoryIcon size={iconSize.sm} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: fontSize.sm, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name}
                        </span>
                        {p.id === activeProjectId && <CheckIcon size={iconSize.sm} />}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={createProjectAndSwitch}
                    style={{
                      display: "flex", alignItems: "center", gap: spacing.sm, width: "100%",
                      height: OUTER_RAIL_ROW_HEIGHT, boxSizing: "border-box",
                      padding: `0 ${spacing.sm}px`,
                      borderRadius: radius.sm, border: `1px dashed rgba(255,255,255,0.18)`,
                      background: "transparent", color: neutral.textPrimary, cursor: "pointer", textAlign: "left",
                      fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                    }}
                  >
                    <PlusIcon size={iconSize.sm} />
                    New Project
                  </button>
                </div>
              )}

              {openPanel === "builds" && (
                <div>
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Builds
                  </div>
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted }}>
                    Nothing wired up yet — Dev Slate's execution engine and storage aren't built, so there's
                    nowhere for a build to actually come from yet. This panel is here so the shape's already
                    in place once that lands.
                  </div>
                </div>
              )}

              {openPanel === "agents" && (
                <div>
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Agents
                  </div>
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted }}>
                    Nothing wired up yet — Agent Work's real content (an embedded Activepieces instance)
                    needs backend infra that hasn't been built. This panel is here so the shape's already
                    in place once that lands.
                  </div>
                </div>
              )}

              {openPanel === "connections" && (
                <div>
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Connections
                  </div>
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted }}>
                    Live status of this project's connected accounts (Slack, Gmail, HubSpot, etc.) will
                    show here — read from Activepieces' own Connections API, not a separate NAVI credential
                    store. Not wired up yet.
                  </div>
                </div>
              )}

              {openPanel === "branches" && (
                <div>
                  {/* sm/xs here, not the panel-wide default xs/xxs —
                      JuanJo found this panel's content still read small
                      even with the accessibility-scale bump, separate
                      from the mobile/tablet responsive sizing. */}
                  <div style={{ fontSize: fontSize.sm, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Branches
                  </div>
                  {branches.length === 0 && (
                    <div style={{ fontSize: fontSize.sm, color: neutral.textMuted }}>
                      No branches yet — use "New Branch Chat" to scope off a topic from Root Chat.
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {branches.map(c => (
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
                        <GitBranchIcon size={iconSize.sm} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: fontSize.sm, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.title}
                          </div>
                          {/* Direct parent, not full path — with only one
                              true root (Main Chat), "branched from X"
                              already answers "where did this come from"
                              without needing indentation depth to show
                              multi-level nesting. */}
                          <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            from {c.parentTitle} · {formatDayLabel(c.updatedAt)}, {formatTime(c.updatedAt)}
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
                          {/* Stacked (provider / stats / bar), not side-by-side
                              — the docked desktop panel is narrow enough that
                              "Provider" and its stats line were wrapping and
                              crowding each other. Stats line stays fontSize.xxs
                              (smaller is fine here, JuanJo's call) even though
                              it's no longer competing for horizontal space. */}
                          <div style={{ fontSize: fontSize.sm, marginBottom: 2 }}>{u.provider}</div>
                          <div style={{ color: neutral.textMuted, fontSize: fontSize.xxs, marginBottom: spacing.xs }}>
                            {u.quota > 0 ? `${u.used.toLocaleString()} / ${u.quota.toLocaleString()} ${u.unit} · ${u.period}` : "no quota tracked"}
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

              {openPanel === "settings" && (
                <div>
                  <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, marginBottom: spacing.sm }}>
                    Settings
                  </div>
                  <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
                    Coming soon.
                  </div>
                </div>
              )}
              </div>
            </div>
          </>
        )}

        <div style={{
          // Neutral now (2026-08-31) — the input bar is a tool, not
          // content; it shouldn't repeat the mode-identity the tabs
          // above it already carry.
          display: "flex", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.lg,
          padding: spacing.sm, borderRadius: radius.xl,
          background: neutral.surface,
          border: "1px solid rgba(255,255,255,0.12)",
        }}>
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
              borderRadius: radius.md,
              // Glows with the current mode's own color — a step
              // brighter than the mode's base accent (75%/0.14 vs the
              // mode tabs' 65%/0.12), not just a re-use of it (JuanJo,
              // 2026-09-01: "glow with the same color as the Chat mode
              // in here, but a bit brighter than the selected mode
              // color"). Reverses the 2026-08-31 "neutral, not
              // mode-colored" call for this specific button.
              border: `1px solid oklch(75% 0.14 ${OKLCH_HUE[chatMode]} / 0.5)`,
              cursor: "pointer",
              background: `oklch(75% 0.14 ${OKLCH_HUE[chatMode]} / 0.18)`,
              color: `oklch(75% 0.14 ${OKLCH_HUE[chatMode]})`,
              boxShadow: `0 0 14px oklch(75% 0.14 ${OKLCH_HUE[chatMode]} / 0.35)`,
              transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <PaperAirplaneIcon size={iconSize.md} />
          </button>
        </div>

        {/* Model picker — moved here from a floating position near the
            mode tabs (2026-09-01), restyled small to match Dev Slate's
            own ModelBadge shape/size/position (below the input) rather
            than the app's separate earlier treatment for this control. */}
        <div style={{ marginTop: spacing.xs, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={e => togglePanel("models", e.currentTarget)}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              // Shrunk further (JuanJo, 2026-09-01: "the buttons over
              // the chat's input, make them smaller too") — text itself
              // is already at fontSize.xxs, the app's accessibility
              // floor (14px minimum), so padding/icon/max-width are the
              // only room left to trim without going below that floor.
              padding: `1px ${spacing.xxs}px`, borderRadius: radius.sm,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: neutral.textMuted,
              cursor: "pointer",
              fontSize: fontSize.xxs,
              fontFamily,
              whiteSpace: "nowrap",
              maxWidth: 180, overflow: "hidden",
            }}
          >
            <CpuIcon size={10} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: neutral.textFaint }}>{effectiveModel.provider} · </span>
              {effectiveModel.model}
              {!modelOverride[chatMode] && <span style={{ color: neutral.textFaint }}> (auto)</span>}
            </span>
            <ChevronDownIcon size={10} />
          </button>
        </div>
      </div>
      </div>

      {/* Mobile/tablet bottom bar — see MOBILE_BAR_HEIGHT above for the
          full reasoning. A normal flex child now, not a fixed overlay
          (see the wrapper div right after the root open) — its height
          is reserved automatically, nothing above it needs manual
          bottom padding to avoid sitting behind it. The two sheets
          below stay position:fixed on purpose, since they're meant to
          float over content, not push it. zIndex 40 on the bar itself
          still matters for one thing: staying above the click-outside overlay any
          togglePanel popover opens (zIndex 35), so tapping a different
          bar button while a popover's open switches/toggles correctly
          instead of the tap just closing the popover. */}
      {!isDesktopSidebar && (
        <>
          {mobileCanvasMenuOpen && (activeCanvas === "chat" || activeCanvas === "devSlate" || activeCanvas === "agentWork") && (
            <div style={{
              position: "fixed", left: spacing.md, right: spacing.md, bottom: MOBILE_BAR_HEIGHT + spacing.sm,
              zIndex: 41, background: "rgba(10,12,18,0.95)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: radius.lg, boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
              display: "flex", flexDirection: "column", gap: spacing.xxs,
            }}>
              {activeCanvas === "chat" && (
                <>
                  <button
                    disabled={!mainChatId}
                    onClick={() => { jumpToMainChat(); setMobileCanvasMenuOpen(false); }}
                    style={{ ...mobileSheetRowStyle, color: mainChatId ? neutral.textPrimary : neutral.textFaint, cursor: mainChatId ? "pointer" : "default" }}
                  >
                    <HomeIcon size={iconSize.sm} />
                    Root Chat
                  </button>
                  <button
                    onClick={() => { branchConversation(); setMobileCanvasMenuOpen(false); }}
                    style={mobileSheetRowStyle}
                  >
                    <PlusIcon size={iconSize.sm} />
                    New Branch Chat
                  </button>
                  <button
                    onClick={e => { togglePanel("branches", e.currentTarget); setMobileCanvasMenuOpen(false); }}
                    style={mobileSheetRowStyle}
                  >
                    <GitBranchIcon size={iconSize.sm} />
                    Branches
                  </button>
                </>
              )}
              {activeCanvas === "devSlate" && (
                <>
                  <button
                    onClick={e => { togglePanel("builds", e.currentTarget); setMobileCanvasMenuOpen(false); }}
                    style={mobileSheetRowStyle}
                  >
                    <PlusIcon size={iconSize.sm} />
                    New Build
                  </button>
                  <button
                    onClick={e => { togglePanel("builds", e.currentTarget); setMobileCanvasMenuOpen(false); }}
                    style={mobileSheetRowStyle}
                  >
                    <FileDirectoryIcon size={iconSize.sm} />
                    Builds
                  </button>
                </>
              )}
              {activeCanvas === "agentWork" && (
                <>
                  <button
                    onClick={e => { togglePanel("agents", e.currentTarget); setMobileCanvasMenuOpen(false); }}
                    style={mobileSheetRowStyle}
                  >
                    <PlusIcon size={iconSize.sm} />
                    New Workflow
                  </button>
                  <button
                    onClick={e => { togglePanel("agents", e.currentTarget); setMobileCanvasMenuOpen(false); }}
                    style={mobileSheetRowStyle}
                  >
                    <RocketIcon size={iconSize.sm} />
                    Agents
                  </button>
                </>
              )}
            </div>
          )}

          {mobileAccountMenuOpen && (
            <div style={{
              position: "fixed", left: spacing.md, right: spacing.md, bottom: MOBILE_BAR_HEIGHT + spacing.sm,
              zIndex: 41, background: "rgba(10,12,18,0.95)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: radius.lg, boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
              display: "flex", flexDirection: "column", gap: spacing.xxs,
            }}>
              {([
                { key: "usage", icon: <GraphIcon size={iconSize.sm} />, label: "Usage counters" },
                { key: "routing", icon: <GitBranchIcon size={iconSize.sm} />, label: "Routing & fallbacks" },
                { key: "models", icon: <CpuIcon size={iconSize.sm} />, label: "Today's models" },
                { key: "settings", icon: <GearIcon size={iconSize.sm} />, label: "Settings" },
              ] as const).map(({ key, icon, label }) => (
                <button
                  key={key}
                  onClick={e => { togglePanel(key, e.currentTarget); setMobileAccountMenuOpen(false); }}
                  style={mobileSheetRowStyle}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          )}

          <div style={{
            flexShrink: 0, height: MOBILE_BAR_HEIGHT, position: "relative",
            zIndex: 40, display: "flex", alignItems: "center", justifyContent: "space-around",
            background: sidebarBg, borderTop: "1px solid rgba(255,255,255,0.08)",
          }}>
            <button
              title="Project"
              onClick={e => { setMobileCanvasMenuOpen(false); setMobileAccountMenuOpen(false); togglePanel("projects", e.currentTarget); }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, border: "none", background: "transparent", color: neutral.textMuted, cursor: "pointer" }}
            >
              <FileDirectoryIcon size={iconSize.md} />
            </button>
            {([
              { key: "chat", icon: <CommentDiscussionIcon size={iconSize.md} /> },
              { key: "agentWork", icon: <RocketIcon size={iconSize.md} /> },
              { key: "devSlate", icon: <CodeIcon size={iconSize.md} /> },
            ] as const).map(({ key, icon }) => (
              <button
                key={key}
                title={key}
                onClick={() => {
                  setMobileAccountMenuOpen(false);
                  if (activeCanvas === key) setMobileCanvasMenuOpen(o => !o);
                  else { setActiveCanvas(key); setMobileCanvasMenuOpen(false); }
                }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44,
                  border: "none", background: "transparent", cursor: "pointer",
                  color: activeCanvas === key ? neutral.textPrimary : neutral.textMuted,
                }}
              >
                {icon}
              </button>
            ))}
            <button
              title="Account"
              onClick={() => { setMobileCanvasMenuOpen(false); setMobileAccountMenuOpen(o => !o); }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, border: "none", background: "transparent", color: neutral.textMuted, cursor: "pointer" }}
            >
              <GearIcon size={iconSize.md} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
