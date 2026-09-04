// Design tokens for the sidebar TOOLS specifically — Menu/Activity/
// Knowledge (left), Sources/Files (right), and whatever gets added
// later. Separate from tokens.ts on purpose: the sidebar is chrome
// (stays stable regardless of active chat mode — see the chrome-vs-
// content split noted elsewhere in App.tsx), while tokens.ts's
// MODE_THEME colors are explicitly content that shifts per mode. A tab
// or breadcrumb link tinting itself blue in Research mode and purple in
// Brainstorm would read as inconsistent between one sidebar tool and
// the next, which is exactly what these tokens exist to prevent —
// every sidebar tool pulls from this ONE fixed palette, never theme.*.
//
// Layout primitives (spacing/radius/fontSize/fontWeight) are NOT
// duplicated here — they're imported from tokens.ts, which already
// owns that scale. This file only adds the semantic layer on top:
// what color/weight/indicator a tab, breadcrumb, or list row gets in
// its active/inactive/hover states.

import { spacing, radius, fontSize, fontWeight, neutral } from "./tokens";

// A single fixed accent for every "this is interactive / this is
// active" signal across all sidebar tools — active tab underline,
// breadcrumb ancestor links, focused states. Deliberately NOT read from
// MODE_THEME; picking one mode's color (even one that reads as a
// neutral calm blue) would still make it that mode's color structurally.
const ACCENT = "rgb(93, 139, 255)";
const ACCENT_HOVER = "rgb(150, 180, 255)";
const ACCENT_BORDER = "rgba(93, 139, 255, 0.4)";

export const sidebarTab = {
  // 32px, down from an already-close 30px — JuanJo, 2026-09-01: "as of
  // now they use a lot of space. looks ugly."
  height: 32,
  gap: spacing.xs,
  paddingV: spacing.xs,
  paddingH: spacing.sm + 2,
  radius: radius.xs + 2,
  fontSize: fontSize.xs,
  fontWeight: fontWeight.medium,
  // Active state needs BOTH stronger contrast and a real indicator
  // (research: color alone isn't enough — NN/g's tab guidance calls
  // for contrast + an underline/connection cue). Inactive tabs stay
  // legible (textMuted, not textFaint) — a tab strip where the
  // inactive options are barely visible fails "recognition over
  // recall": the user shouldn't have to remember Files exists.
  // The original *colored* pill-fill got dropped 2026-08-31 for reading
  // "cartoon"/goofy — but text-contrast alone then turned out to be too
  // quiet on its own (caught live, same session). Restored as a fill,
  // just neutral this time, not zone-colored — same lift as the sidebar
  // "card" backgrounds (Knowledge items, source rows), so an active tab
  // reads as a consistent, restrained "raised" surface, not a bright pill.
  activeColor: neutral.textPrimary,
  activeBg: "rgba(255,255,255,0.06)",
  activeBorder: ACCENT_BORDER,
  inactiveColor: neutral.textMuted,
} as const;

export const sidebarBreadcrumb = {
  fontSize: 11.5,
  gap: 4,
  // Ancestors (Home, and any intermediate folder) are clickable — they
  // need a real link affordance, not just gray text, or the user has
  // no visual reason to know they can click back. Underline appears on
  // hover, matching how links behave everywhere else rather than being
  // permanently underlined chrome.
  ancestorColor: ACCENT,
  ancestorHoverColor: ACCENT_HOVER,
  // The CURRENT segment is the opposite: de-emphasized as a target
  // (never a link — clicking your own current location does nothing
  // useful) but still the most visually prominent word in the row,
  // since it answers "where am I" at a glance. Bold + full-brightness
  // text, no link styling at all.
  currentColor: neutral.textPrimary,
  currentWeight: fontWeight.medium,
  separatorColor: neutral.textFaint,
} as const;

// Shared by every list row across every sidebar tool — Sources' source
// rows, Files' folder/file rows, Activity's items, Knowledge's items —
// so they read as one consistent list component instead of four
// independently-styled ones.
export const sidebarRow = {
  paddingV: spacing.xs + 1,
  paddingH: spacing.sm,
  radius: radius.xs,
  gap: spacing.sm,
  iconSize: 14,
  hoverBg: "rgba(255,255,255,0.05)",
} as const;
