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
