// Design tokens for the NAVI PWA prototype — every screen element reads
// sizing/type/color from here instead of hardcoded numbers scattered
// per component. Two layers:
//   1. Primitives (spacing/radius/type/icon/blur/control size) — flat,
//      mode-independent scales.
//   2. MODE_THEME — the one semantic/color layer that changes per chat
//      mode (Normal/Research/Brainstorm), driving canvas particles,
//      bubbles, and button glow from a single source of truth. This is
//      "content" per the chrome-vs-content split; neutral below is
//      "chrome" — the stuff that stays stable across modes.

export type Mode = "ambient" | "vortex";
export type ChatMode = "normal" | "research" | "brainstorm";

export const fontFamily = "system-ui, sans-serif";

export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  xs: 6,   // tiny controls (pin button)
  sm: 10,  // toolbar/mode-selector pills
  md: 12,  // attach/send buttons
  lg: 16,  // message bubbles
  xl: 18,  // input bar container
} as const;

// Bumped 2026-08-29 for readability across a wide user age range
// (25-65) — 12px labels and 11px meta text are genuinely hard to read
// for anyone with reduced near-vision (common past ~50), and the old
// 14.5 body size wasn't much better. 14px is a deliberate floor, not
// just a bump — JuanJo's explicit call, "at least 14px" anywhere in
// the UI, holds on mobile too (smaller screens don't mean better
// eyesight). Desktop's sm started at 17, came down to 15.5 after
// living with it. Actual values live in index.css now, not here — this
// scale is CSS custom properties (--font-size-*) instead of plain
// numbers — a media query redefines them below the persistent-sidebar
// breakpoint, and since every usage here is `fontSize: fontSize.xs`
// inline, referencing a CSS var string means the actual rendered size
// still updates with viewport width even though it's set inline
// (inline styles can't read a media query directly, but they CAN read
// a var() that a media query redefines elsewhere — same trick used for
// .chat-column's position/inset earlier, applied to typography here).
export const fontSize = {
  xxs: "var(--font-size-xxs)", // popover meta text (timestamps, secondary labels) — floor, doesn't shrink further on mobile
  xs: "var(--font-size-xs)",   // button/pill labels, menu/panel content
  sm: "var(--font-size-sm)",   // body copy — chat text, input
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
} as const;

export const lineHeight = {
  tight: 1.2,
  base: 1.45,
} as const;

export const iconSize = {
  sm: 14,
  md: 16,
} as const;

// Tappable control box sizes (not the glyph inside — see iconSize).
export const controlSize = {
  sm: 22, // pin button
  md: 38, // attach / send buttons
} as const;

export const blur = {
  sm: 14,
  md: 16,
  lg: 24,
} as const;

// V3 sidebar shell — persistent on desktop/tablet, an off-canvas drawer
// below the breakpoint. 1024 matches Material 3's persistent-vs-drawer
// guidance (~840–1024dp is where a phone-style layout stops making
// sense). JuanJo's explicit call (2026-08-29): .chat-column shifts to
// make room for the sidebar + a real gap, rather than the earlier
// approach of raising the breakpoint so the sidebar only ever sat in
// pre-existing empty margin — so there's no "avoid shifting" math
// driving this breakpoint anymore, just the standard guidance. Mirrored
// into index.css's media queries — inline styles can't express a
// breakpoint, same reasoning as .chat-column there.
export const layout = {
  // The sidebar's minimum width, not a fixed one — at/above
  // sidebarBreakpoint it's actually fluid (see .sidebar in index.css),
  // growing to fill whatever space .chat-column's own centering leaves
  // empty, capped at sidebarMaxWidth. This is its floor at the tight
  // end (right at the breakpoint) and also what .chat-column's own
  // shift floor (sidebarWidth + sidebarChatGap) is computed against —
  // if this changes, that computed value in index.css needs to change
  // with it, they're not read from the same source today (inline
  // styles can't read a CSS clamp()/calc() result back out).
  sidebarWidth: 280,
  sidebarMaxWidth: 480,
  sidebarBreakpoint: 1024,
  // Minimum breathing room between the sidebar and .chat-column at/above
  // the breakpoint — JuanJo's explicit spec, matches spacing.xxl (24).
  sidebarChatGap: 24,
} as const;

// Neutral (mode-independent) surface/text tokens.
export const neutral = {
  // Indigo Ink palette (UI overhaul) — cool near-white text on a deep
  // indigo-tinted near-black, replacing the flat #F6F6F6-on-#000 default
  // so the app reads as a designed instrument, not a default dark mode.
  // textFaint was lifted out of the sub-4.5:1 contrast hole the old
  // 0.48 alpha produced against near-black.
  textPrimary: "var(--text-primary)",
  textMuted: "var(--text-secondary)",
  textFaint: "var(--text-tertiary)",
  textInactive: "var(--text-disabled)",
  // Embedded panels (input bar, search, sidebar containers) — translucent
  // indigo so the canvas still breathes through them.
  surface: "var(--surface-panel-a)",
  // Floating/modal panels — near-solid so a dimmed scrim never bleeds
  // through a panel that should read authoritative.
  surfaceSolid: "var(--surface-raised-a)",
  userBubbleBg: "var(--user-bubble-bg)",
  userBubbleBorder: "var(--user-bubble-border)",
  userBubbleGlow: "var(--user-bubble-glow)",
  dotNeutral: "var(--dot-neutral)",
  statusAwake: "var(--status-success)",
  statusWaking: "var(--status-warning)",
  statusUnreachable: "var(--status-danger)",
} as const;

// Unified semantic status — ONE green/amber/red, replacing the scattered
// hardcoded literals that had drifted into 3 greens / 3 ambers / 2 reds
// across surfaces. Each badge is color + tinted bg + border so it reads
// as one consistent component everywhere.
export const status = {
  success: { color: "var(--status-success)", bg: "var(--status-success-bg)", border: "var(--status-success-border)" },
  warning: { color: "var(--status-warning)", bg: "var(--status-warning-bg)", border: "var(--status-warning-border)" },
  danger: { color: "var(--status-danger)", bg: "var(--status-danger-bg)", border: "var(--status-danger-border)" },
} as const;

// Elevation ramp (Indigo Ink) — root/rail through raised/floating.
// Replaces the four hand-written near-blacks (#161616 / #111318 /
// #0e0e10 / #0b0b0c) that had drifted across Agent Work / Dev Slate /
// Connections panels.
export const surface = {
  root: "var(--surface-root)",
  canvas: "var(--surface-canvas)",
  panel: "var(--surface-panel)",
  raised: "var(--surface-raised)",
  field: "var(--surface-field)",
} as const;

// Chrome lines + interactive fills — one vocabulary for every border and
// hover/selected state instead of hand-written rgba(255,255,255,.XX).
export const border = {
  subtle: "var(--border-subtle)",
  default: "var(--border-default)",
  strong: "var(--border-strong)",
} as const;

export const hoverBg = "var(--hover-bg)";
export const selectedBg = "var(--selected-bg)";
// Ink for text/icons sitting on a full-accent action fill (dark ink on
// bright accents in night mode, white on deep accents in day mode).
export const actionInk = "var(--ink)";

// Canvas-level accent colors — Chat / Agent Work / Dev Slate, not to be
// confused with MODE_THEME below (Chat's own three internal modes).
// Built with the "lock lightness + chroma, only rotate hue" OKLCH
// method (2026-08-31) specifically so none of the three visually
// outweighs another — same brightness, same intensity, just a
// different hue angle each. Chosen to sit clear of MODE_THEME's own
// hues (Research=green ~140-150°, Brainstorm=purple ~290-300°) so an
// accent color never means two different things depending on context.
export const CANVAS_ACCENT: Record<"chat" | "agentWork" | "devSlate", { hue: number; color: string; glow: string }> = {
  chat: { hue: 250, color: "oklch(65% 0.12 250)", glow: "oklch(65% 0.12 250 / 0.16)" }, // blue — matches Normal mode, reinforces rather than competes
  agentWork: { hue: 70, color: "oklch(65% 0.12 70)", glow: "oklch(65% 0.12 70 / 0.16)" }, // amber
  devSlate: { hue: 200, color: "oklch(65% 0.12 200)", glow: "oklch(65% 0.12 200 / 0.16)" }, // teal
} as const;

// Sidebar chrome background — near-black, hue-following. Same "lock
// lightness + chroma, only rotate hue" method as CANVAS_ACCENT above,
// just at a far lower chroma (0.02 vs 0.12) so the tint stays a hint,
// not a visible color panel — this is what stops it from turning into
// the too-cool navy-blue background JuanJo rejected earlier (2026-08-31):
// that was a fixed hue at real chroma, this is barely-there chroma that
// only reads as "a slightly warmer/cooler near-black" regardless of
// which hue it's following. Pass one of the OKLCH_HUE constants below,
// never MODE_THEME[chatMode].hueBase directly — that value is calibrated
// for the old hsla()-based particle system, a completely different hue
// mapping than OKLCH's. Reusing it here is what produced a yellow-
// tinted green instead of true green (caught live, 2026-08-31): HSL 130
// and OKLCH 130 are not the same color, despite sharing a 0-360 scale.
export function tintedSurface(hue: number, lightness = 9, chroma = 0.015): string {
  return `oklch(${lightness}% ${chroma} ${hue})`;
}

// OKLCH-calibrated hue angles for Chat's three modes — landmark values
// for clean blue/green/purple in OKLCH space specifically (145 is true
// green here; the HSL-tuned hueBase of 130 is NOT interchangeable with
// this, see the caution above). Separate from CANVAS_ACCENT (Agent
// Work/Dev Slate) only because those canvases don't have their own
// internal modes the way Chat does.
export const OKLCH_HUE: Record<ChatMode, number> = {
  normal: 250, // blue — matches CANVAS_ACCENT.chat, deliberate
  research: 145, // green
  brainstorm: 305, // purple
} as const;

// Toned-down glow for buttons/interactive chrome — same hue-follows-zone
// idea as tintedSurface, but bright enough to read as an accent. Cut
// hard from the original glow intensity (2026-08-31, JuanJo's call:
// keep glow as a concept, dial it down rather than strip it, since it's
// not the thing the blur/glass research flagged — a shadow doesn't
// blur content or hurt contrast the way backdrop-filter did).
export function tintedGlow(hue: number, alpha = 0.16): string {
  return `oklch(65% 0.12 ${hue} / ${alpha})`;
}

export const MODE_THEME: Record<ChatMode, {
  canvasMode: Mode;
  hueBase: number; hueRange: number;
  particleAlphaBase: number; particleAlphaRange: number;
  particleLifeBase: number; particleLifeRange: number;
  bubbleBg: string; bubbleBorder: string; glow: string; label: string;
  dot: string; // solid, opaque — for status dots; glow above is translucent, made for shadows not fills
}> = {
  normal: {
    canvasMode: "ambient",
    hueBase: 205, hueRange: 45, // blue
    particleAlphaBase: 0.16, particleAlphaRange: 0.18,
    particleLifeBase: 200, particleLifeRange: 120,
    // Solid now, not translucent (2026-08-31) — the old rgba alpha
    // blend existed to let the animated particle background show
    // through; that background is gone, so translucency wasn't doing
    // anything but risking a washed-out look. Built from OKLCH_HUE
    // above at a real, clearly-identifiable chroma — higher than the
    // old chrome tints, since a message bubble needs to be recognizable
    // by mode at a glance, not just a subtle hint. Lightness/chroma
    // bumped 15%/0.04 (from 11%/0.03) and glow alpha bumped to 0.24
    // (from 0.16) on request, 2026-09-01, for a more "glowy" content
    // feel — still content-only, chrome stays untouched (see
    // neutralGlow in App.tsx). Text contrast checked: textPrimary at
    // 0.95 alpha against 15% lightness is still comfortably >4.5:1.
    bubbleBg: `oklch(15% 0.04 ${OKLCH_HUE.normal})`,
    bubbleBorder: "rgba(90, 140, 220, 0.32)",
    glow: "rgba(90, 140, 220, 0.24)",
    dot: "rgb(120, 165, 235)",
    label: "Normal Chat",
  },
  research: {
    canvasMode: "ambient",
    hueBase: 130, hueRange: 30, // true green, was drifting toward cyan/teal at 150-190
    particleAlphaBase: 0.24, particleAlphaRange: 0.2, // brighter, per request
    particleLifeBase: 280, particleLifeRange: 160, // linger longer before fading
    bubbleBg: `oklch(15% 0.04 ${OKLCH_HUE.research})`,
    bubbleBorder: "rgba(60, 200, 110, 0.32)", // less blue than before — reads green, not teal
    glow: "rgba(60, 200, 110, 0.24)",
    dot: "rgb(90, 210, 140)",
    label: "Research",
  },
  brainstorm: {
    canvasMode: "vortex",
    hueBase: 220, hueRange: 60, // unused for particle spawn (vortex has its own hue logic) — kept for consistency
    particleAlphaBase: 0.14, particleAlphaRange: 0.18,
    particleLifeBase: 200, particleLifeRange: 120,
    bubbleBg: `oklch(15% 0.04 ${OKLCH_HUE.brainstorm})`,
    bubbleBorder: "rgba(160, 100, 255, 0.32)",
    glow: "rgba(160, 100, 255, 0.24)",
    dot: "rgb(180, 130, 255)",
    label: "Brainstorm",
  },
};
