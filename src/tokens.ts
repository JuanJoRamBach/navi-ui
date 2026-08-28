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

export const fontSize = {
  xxs: 11,   // popover meta text (timestamps, secondary labels)
  xs: 12,    // button/pill labels
  sm: 14.5,  // body copy — chat text, input
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
  textPrimary: "rgba(240, 244, 255, 0.95)",
  textMuted: "rgba(255, 255, 255, 0.5)",
  textFaint: "rgba(255, 255, 255, 0.32)",
  textInactive: "rgba(255, 255, 255, 0.42)",
  surface: "rgba(10, 12, 18, 0.6)",
  userBubbleBg: "rgba(6, 6, 8, 0.52)",
  userBubbleBorder: "rgba(255, 255, 255, 0.14)",
  userBubbleGlow: "rgba(255, 255, 255, 0.08)",
  // Solid (not translucent) fallback for status dots that aren't tied
  // to a chat mode — the old rgba(255,255,255,0.28) read as too dim to
  // register as a status indicator.
  dotNeutral: "rgb(190, 196, 210)",
  // Server-awake indicator (see the top-right status dot in App.tsx) —
  // reuses the same solid-dot treatment as dotNeutral, just with
  // meaning attached: green/amber/red rather than neutral gray.
  statusAwake: "rgb(96, 210, 140)",
  statusWaking: "rgb(230, 180, 80)",
  statusUnreachable: "rgb(220, 100, 100)",
} as const;

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
    bubbleBg: "rgba(4, 8, 18, 0.52)",
    bubbleBorder: "rgba(90, 140, 220, 0.32)",
    glow: "rgba(90, 140, 220, 0.35)",
    dot: "rgb(120, 165, 235)",
    label: "Normal Chat",
  },
  research: {
    canvasMode: "ambient",
    hueBase: 130, hueRange: 30, // true green, was drifting toward cyan/teal at 150-190
    particleAlphaBase: 0.24, particleAlphaRange: 0.2, // brighter, per request
    particleLifeBase: 280, particleLifeRange: 160, // linger longer before fading
    bubbleBg: "rgba(4, 16, 10, 0.52)",
    bubbleBorder: "rgba(60, 200, 110, 0.32)", // less blue than before — reads green, not teal
    glow: "rgba(60, 200, 110, 0.35)",
    dot: "rgb(90, 210, 140)",
    label: "Research",
  },
  brainstorm: {
    canvasMode: "vortex",
    hueBase: 220, hueRange: 60, // unused for particle spawn (vortex has its own hue logic) — kept for consistency
    particleAlphaBase: 0.14, particleAlphaRange: 0.18,
    particleLifeBase: 200, particleLifeRange: 120,
    bubbleBg: "rgba(18, 4, 28, 0.52)",
    bubbleBorder: "rgba(160, 100, 255, 0.32)",
    glow: "rgba(160, 100, 255, 0.35)",
    dot: "rgb(180, 130, 255)",
    label: "Brainstorm",
  },
};
