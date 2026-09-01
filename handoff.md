# Handoff — navi-pwa, 2026-09-01

Written to close out this session. Read this instead of re-deriving context from scratch. Repo: `JuanJoRamBach/navi-ui`, working dir `C:\Users\juanj\Proyectos IA\navi-pwa`, branch `v3-ui` (main stays untouched — standing rule).

This session's navi-pwa work was small relative to the NAVI backend work covered in the sibling repo's own `HANDOFF.md` — one focused pass on shared design tokens, not a new feature. `git pull`/`checkout` isn't needed if you're already on `v3-ui`; the commit is `7c0a20d`.

## What shipped this session (committed + pushed to `v3-ui`, `tsc --noEmit` clean)

All changes are in `src/tokens.ts`, `src/sidebar-tokens.ts`, and incidental global-token consumers in `src/App.tsx` — no canvas-specific logic (Chat/Agent Work/Dev Slate) was touched.

### 1. Neutral near-white text tokens (was a real accessibility bug)
- `neutral.textPrimary/textMuted/textFaint/textInactive` rebased from a warm-cream tint to a genuinely neutral `#F6F6F6` (R=G=B, zero hue bias) so text never fights whichever zone/mode accent color happens to be nearby.
- **Real bug caught, not a style preference**: `textFaint` was failing WCAG AA contrast (~3:1, under the 4.5:1 floor for body text) against the near-black background. The background had gone through several rounds of getting darker across earlier sessions (warm gray → neutral gray → pure black → `#0F0F0F`) without these text alphas ever being rechecked against the new darkness. All four tokens now derive from the same `#F6F6F6` base at different alphas (0.95/0.62/0.48/0.55).

### 2. Sidebar tab active-state restored as a fill (not a bug — a design iteration that overcorrected)
- History: original colored pill-fill → dropped for reading "cartoon"/goofy → text-contrast-only turned out too quiet on its own (caught live, same session it was tried) → restored as a fill, but **neutral** this time (`rgba(255,255,255,0.06)`), not zone-colored — same subtle "raised" treatment as sidebar card backgrounds (Knowledge items, source rows), not a bright colored pill.
- `sidebar-tokens.ts`: `ACCENT_BG` and the underline (`underlineColor`/`underlineThickness`) were removed entirely — the fill replaces both.

### 3. OKLCH hue system as the single calibrated source (fixes a real color bug)
- New `tokens.ts` exports: `tintedSurface(hue, lightness=9, chroma=0.015)`, `tintedGlow(hue, alpha=0.16)`, and `OKLCH_HUE: Record<ChatMode, number>` (normal=250 blue, research=145 green, brainstorm=305 purple — these are OKLCH-space landmark values, calibrated separately from the pre-existing `MODE_THEME[...].hueBase`).
- **Real bug this fixes**: `MODE_THEME`'s `hueBase` values (e.g. 130 for research) are tuned for the *old* HSL-based particle system — a completely different hue mapping than OKLCH. Reusing `hueBase` directly inside an `oklch(...)` string produced a yellow-tinted green instead of true green (caught live). `OKLCH_HUE` is the correct, separately-calibrated set to use inside any `oklch(...)` call from now on — never pass `MODE_THEME[mode].hueBase` into `tintedSurface`/`tintedGlow`.
- `CANVAS_ACCENT` (Chat/Agent Work/Dev Slate's outer-rail accent colors) gained an explicit `hue` field per entry and its glow alpha was cut from 0.35 to 0.16 — a toned-down accent, not full removal.
- Chat's three mode bubble backgrounds (`MODE_THEME[mode].bubbleBg`) switched from translucent `rgba(...)` to solid `oklch(...)` built from `OKLCH_HUE` — the translucency existed to let an animated particle background show through; that background is gone (removed in an earlier session), so the rgba blend wasn't doing anything but risking a washed-out look. Lightness/chroma bumped from 11%/0.03 to 15%/0.04, glow alpha from 0.16 to 0.24, per a later "more glowy" request in the same session — text contrast re-checked (`textPrimary` at 0.95 alpha against 15% lightness stays comfortably >4.5:1).

## Design decisions agreed, not yet built

Carried forward unchanged from the prior handoff (2026-08-30) — nothing below was touched or decided this session, listed here only so a fresh session doesn't have to dig up the older file to find it:

- **Project** as the real top-level container (sits above the whole canvas switcher, team-shared, multi-user DB) — not built, no multi-project data model exists yet.
- Entry flow: dedicated Project Selector screen + persistent compact project-switcher pinned above the canvas switcher. Neither built.
- **Left sidebar = project-wide tools, right sidebar = canvas-dependent tools.** Files' placement (currently right, likely wants to move left) still unconfirmed.
- Outer rail's full intended order: project switcher (not built) → canvas switcher (Chat/Agent Work/Dev Slate/Dashboard) → contextual middle zone → account-stuff bottom zone.
- **Correction, added after this was originally written**: this session's NAVI-backend thread mistakenly concluded Dev Slate and Agent Work had no backend at all. That was true *at the time* it was said, but a parallel Claude Code session (working on the NAVI repo directly, not through this frontend session) built real backends for both the same day — Agent Work's workflow/run/step data model + graph executor, and a real Dev Slate chat loop with its own `/devslate/*` routes. This navi-pwa repo's `App.tsx` still renders both as placeholder shells — that part is still accurate, the frontend hasn't been wired to either backend yet. See NAVI's own `HANDOFF.md`/`IDEAS.md` for the authoritative backend state.

## Not in scope right now (explicitly deferred)

- Same list as before — Project Selector, real multi-user sharing, Agent Work/Dev Slate real functionality. Nothing added or removed from this list this session.

## Process notes for whoever picks this up

- **Ask before code changes** — propose the edit, wait for go-ahead, even for small/safe changes.
- **Don't run browser verification loops** — JuanJo tests in-browser himself. `tsc --noEmit` clean is the bar for "done" from this side (no `npm run build` run this session, unlike the prior handoff's session — worth running before the next commit if build-time errors are a concern).
- **Route all V3 colors/spacing through `tokens.ts`, never hardcode.** This session's whole point was fixing places where that rule had already quietly been violated (HSL hue reused in OKLCH context, alpha values never rechecked after a background color change) — a good reminder that "route through tokens" alone doesn't prevent drift; the *values inside* the token file still need periodic re-verification against what they're actually rendering next to.
- When touching hue-based color anywhere, use `OKLCH_HUE`, never `MODE_THEME[...].hueBase` — they are not interchangeable despite both being 0–360 numbers.
