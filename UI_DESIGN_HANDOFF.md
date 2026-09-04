# NAVI PWA — UI overhaul handoff

You're being brought in to fix real, specific problems with this app's UI —
not to redesign it from a blank page. Read this whole file before touching
anything. It exists because a previous session (Claude, working directly in
this repo) built most of what's here and knows exactly where the bodies are
buried — this is that context, handed to you so you don't have to
rediscover it the hard way.

**Work on a branch.** The person running this has explicitly set that up as
the safety net — don't push to `main` directly.

## What NAVI actually is

A whole-company AI work harness — not a personal assistant, not a chatbot
demo. The product philosophy, in the owner's own words: "I want something
that can be used easily, by anyone, to make their lives easy, that saves
tokens as much as it can for a company." Token/request economy is core to
the product's identity, not an implementation detail. The target user
ranges from a non-technical employee using Chat, to a data analyst building
Agent Work workflows, to a developer using Dev Slate — the UI has to serve
all three without collapsing into either "too simple to be useful" or "too
technical to approach."

## The six real surfaces — do not collapse or generalize these away

The app is not one chat window. It's six distinct canvases, each with a
different job:

1. **Normal Chat** — plain conversational chat, `/chat/send`, real
   multi-turn server-side memory.
2. **Research Chat** — same chat mechanism, different system brief; does
   real web research (web_search/fetch_page tool calls), returns cited
   findings.
3. **Brainstorm Chat** — same mechanism again, different brief; iterative
   ideation, not one-shot.
4. **Agent Work** — a node-graph visual workflow builder (React Flow-based
   canvas). Users build multi-step automations (search → summarize → post
   to Slack, etc.), with branching, scheduling, and run history. This is
   the most functionally complex surface in the app — treat its canvas
   interactions (pan/zoom/node-drag) as sacred, don't reflow them.
5. **Dev Slate** — a real coding canvas: chat pane + code editor pane +
   live preview pane, dockable/resizable (dockview). Talks to the backend
   over a persistent WebSocket, not plain REST, because it relays
   read_file/write_file/grep calls to the browser's local File System
   Access API. This is NOT a general code editor — scope is light
   HTML/CSS/JS, not a competitor to VS Code.
6. **Agent Vault** — starred/reusable Agent Work workflows, shown as
   cards; "Open in canvas" forks a saved agent back into an editable
   workflow.

A **Connections** overlay (Profile → Connections) lets users link
third-party services (GitHub, Slack, Google Workspace, etc.) via MCP —
built and working as of this handoff, real OAuth flows for some services.
Don't break this; it was just finished and hasn't shipped long.

Left sidebar: navigation between these canvases + branch/conversation
history. Right sidebar: per-canvas contextual panels (Sources, Activity,
etc.) — currently thin, several tabs are placeholders (that's a known,
already-tracked gap, not something you need to invent content for unless
asked).

## The actual problem — from a real design audit, not a guess

A structured audit (Nielsen's 10 heuristics, screenshot-based) scored the
Chat surface **15/40 — "poor, major overhaul required."** This is the real
brief. Full report is reproduced below so you have the exact findings, not
a paraphrase.

<details>
<summary>Full audit report (click to expand)</summary>

Method: dual-agent (design director review + detector/browser evidence,
screenshots only, no live browser access). Nielsen's 10 heuristics, 0-4
each, max 40 (this is an "Operate" surface — a tool you use, not a page
you admire — so all 10 apply).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Unlabeled timestamps, passive "searching…" with no spinner, no streaming cue |
| 2 | Match system / real world | 1 | Renders internal parser tokens: raw `<br>`, `**bold**`, `[CNBC](url)`, pipe tables |
| 3 | User control & freedom | 2 | No undo for filter changes; sidebar toggle rows operate their own container |
| 4 | Consistency & standards | 1 | Same saturated blue means both "selected" and "primary action"; badge colors/casing vary |
| 5 | Error prevention | 2 | "Needs help"/"needs input" warn but give no remediation control |
| 6 | Recognition rather than recall | 1 | Badge meanings must be memorized; no tooltips; unlabeled rail clusters |
| 7 | Flexibility & efficiency | 2 | "Batch Dispatch" is a real accelerator, but nav duplicates concepts (e.g. "Today's models"/"Commands" in two places) |
| 8 | Aesthetic & minimalist | 2 | Clean dark surface, but reading pane flooded by raw markdown |
| 9 | Diagnose & recover from errors | 1 | States symptoms ("needs input") never cause or fix |
| 10 | Help & documentation | 1 | Alarming warning text with no link, no onboarding |
| **Total** | | **15/40** | **Poor — major overhaul required** |

**Design-specificity verdict**: the visual language (dark surface, left
rail, center tabs, right panel, one blue accent) is indistinguishable from
a generic CRM or support-ticket tool — nothing about it signals "developer
agent harness" except text strings. The most "developer-y" moment
(literal unrendered markdown) is a bug, not a style choice.

**What's working — keep these**:
- Dark, low-glare, long-session-friendly reading surface.
- "Batch Dispatch" + filter chips + scannable source rows — a real,
  confident power-user pattern.
- Status conveyed via text+color together, not color alone (one accent
  hue, not a rainbow of unrelated colors) — good baseline accessibility
  habit, don't regress it.

**Priority issues, in order**:

- **[P0] Unrendered markdown floods the reading pane.** Raw `<br>`,
  `**bold**`, `[text](url)`, and `| pipe | tables |` render as literal
  text in a mono face instead of being parsed. This is flagged as *the
  single biggest defect* — it reads as broken, not as a style choice.
  **Fix: pipe assistant message content through a real markdown renderer**
  (tables, line breaks, links, bold/italic all need to actually render).
  This is the highest-impact, lowest-risk fix in this whole list — do it
  first.
- **[P0] Left rail is a flat, unlabeled list.** Primary nav, branch
  management, and system settings are one flat monochrome list, no group
  labels, no indentation. The sidebar's own close/toggle rows are
  self-referential and styled like an active nav item. Fix: real group
  headers (NAVIGATION / BRANCHES / SETTINGS), indent children, move
  settings toggles into panel-header chrome instead of the flat list.
- **[P0] One blue does two jobs.** The same saturated blue fill marks
  "you are here" (active nav item, active tab) AND "click me to act"
  (primary buttons, checked boxes, send button). Users can't visually
  tell selection from action. Fix: reserve the accent color for actual
  calls-to-action; show selection state via border/underline/toned-back
  fill instead of the identical solid fill.
- **[P1] Source-status badges are inconsistent and anxiety-inducing.**
  "Good" (green) / "Less likely" (low-contrast amber) / "needs input"
  (red, lowercase) with no consistent ramp, plus an alarming unlinked
  warning line ("Not personally reviewed sources can harm output in
  chat."). "needs input" implies an action exists but gives no control to
  take it. Fix: normalize to a clear success → neutral → attention badge
  ramp, give "needs input" a real affordance, soften the warning copy.
- **[P1] Primary CTA and secondary text are under-contrasted.** "Batch
  Dispatch" (the actual most-important action) is a dark neutral slab on
  a dark background — visually weak despite being functionally primary.
  Muted metadata text sits near-floor contrast. Fix: raise the CTA's
  contrast/fill; lift secondary text toward WCAG AA.

**Persona-specific flags** (worth keeping in mind while fixing the above,
not separate work items):
- Power users: badge jargon has no tooltips; no visible keyboard
  shortcuts; raw markdown adds reading noise.
- Accessibility: selected vs. active differ ONLY by identical color fill
  (fails color-only distinction); several elements are close to
  color-only status signals; small hit targets on close/×; no visible
  focus states.
- Newcomers: no onboarding cue anywhere; the only empty-state guidance is
  "No commands ran yet in this conversation."

</details>

## Real, hard-won constraints — read before you touch layout CSS

This app's layout has already caused real, subtle bugs that took genuine
CSS-spec-level debugging to root-cause. Two concrete lessons, so you don't
reintroduce the same class of problem:

1. **Never give an absolutely-positioned element `left`, `right`, AND an
   explicit `width`/`max-width` at the same time**, even with `margin: 0`
   set. That's a textbook CSS over-constraint (CSS2.1 §10.3.7) — the
   browser is *required* to silently discard `left` and recompute it from
   `right`+`width` instead, meaning any "smart" `left` formula you write
   (sidebar-aware, responsive, whatever) will just never apply, with no
   error, no warning, nothing in devtools to flag it. If you need a box to
   respond to some dynamic offset (e.g. a sidebar's width) AND have a
   capped/responsive width, pick exactly one of `right` or `width` as the
   *derived* value, never pin both alongside `left`. This bit the Chat
   canvas specifically (`.chat-column` in `index.css`) — it's fixed now,
   but this constraint applies to it everywhere you touch absolute
   positioning in this codebase.
2. **React state defaults can silently disagree with what's visually
   rendered.** `leftPanelOpen` defaults to `true` in `App.tsx` regardless
   of whether the labeled sidebar is actually shown at the current
   viewport/rail state — meaning a CSS variable derived from it
   (`--left-panel-width`) can claim space that visually isn't occupied.
   If you introduce new state-driven layout variables, verify the
   variable's value against what's *actually on screen*, not just what
   the state variable name implies.
3. **This is a PWA with an aggressive service-worker precache.** A
   deployed change does not always show up on a normal reload — a full
   close-and-reopen (or hard refresh) is sometimes required to see your
   own change take effect. If a fix looks like it didn't work, rule this
   out before assuming the code is wrong.

## What must keep working — don't touch, or touch very carefully

- All six canvases' actual functionality: sending messages, Agent Work's
  node graph (create/connect/run/schedule nodes), Dev Slate's WebSocket
  chat + file relay, Agent Vault's star/fork flow.
- The Connections overlay's MCP OAuth flow (GitHub is fully wired; Slack
  and Google Workspace are verified-but-not-yet-wired) — this is brand
  new, don't refactor its state management as a side effect of a visual
  pass.
- Mobile/tablet responsive behavior — the breakpoint at 1024px
  (`layout.sidebarBreakpoint` in `tokens.ts`) deliberately keeps the full
  mobile treatment through tablet widths, not just smaller fonts. Don't
  "fix" this into a three-tier responsive system without understanding
  why it's binary today.
- Existing design tokens in `src/tokens.ts` (`spacing`, `radius`,
  `fontSize`, `fontWeight`, `neutral`, `CANVAS_ACCENT`, `MODE_THEME`,
  `layout`) — these are the real source of truth for the current visual
  system. You're explicitly allowed (encouraged, given the audit) to
  *revise* the color/contrast tokens — that's exactly what P0 #3 and P1 #2
  above call for — but do it by editing these central token files, not by
  scattering new hardcoded hex values through component files the way a
  few older parts of this codebase unfortunately already do.

## Suggested order of attack

1. Markdown rendering fix (P0, highest impact, lowest risk, fully
   self-contained to the message-rendering component).
2. Color system pass: separate "selected" from "action" in the tokens,
   propagate to nav/tabs/buttons (P0 + P1 contrast issue, same underlying
   token change).
3. Left rail grouping/labeling (P0, scoped to the sidebar component).
4. Source-status badge normalization (P1, scoped to the Sources panel).
5. Only after 1-4 are verified working: revisit whatever the audit's
   "minor observations" section flags, if time allows.

Verify each step by actually clicking through the app (all six canvases,
not just the one you're editing), not just by eyeballing a screenshot —
this codebase's history is full of "looked right in isolation, broke
something else" bugs.
