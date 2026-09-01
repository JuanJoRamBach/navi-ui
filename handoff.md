# Handoff — navi-pwa, 2026-08-30

Written because this chat is about to hit its context-compaction limit. Read this in the new chat instead of re-deriving context from scratch. Repo: `JuanJoRamBach/navi-ui`, working dir `C:\Users\juanj\Proyectos IA\navi-pwa`.

## What just shipped (this session, verified via `tsc --noEmit` + `npm run build`, both clean)

### 1. Sub-chats as "branches" (one Main Chat per project)
- **Model**: exactly one Main Chat per project. Everything else is a *branch* off it (or off another branch) — never a second independent top-level chat, never version control (no diff/merge/rebase).
- `src/storage.ts`:
  - `Conversation.parentId?: string` — set only on a branch, absent on Main Chat.
  - `createConversation(mode, parentId?)` — on the very first parentId-less conversation ever created, writes its id to a new `meta` key `"mainId"`.
  - `getMainConversationId()` — reads that key.
  - `listBranches()` → `BranchListItem[]` — every conversation with a `parentId`, flat (not a nested tree; deliberate — see rationale in the code comment), each carrying its direct parent's title.
- `src/App.tsx`:
  - `branchConversation()` — prompts for a name via `window.prompt`, seeds the new conversation with the current `messages`, switches to it.
  - `jumpToMainChat()` — loads `mainChatId` and opens it. Exists because the in-chat "Branched from X" pill only shows the *immediate* parent — a branch nested several levels deep otherwise has no one-click path back to the true root.
  - `mainChatId` state, loaded once via `getMainConversationId()`.
  - **Outer rail's middle zone (Chat canvas)** now shows exactly three items, in this order, per JuanJo's explicit spec: **Main Chat** → **New Branch Chat** → **Branches** (opens a flat browse-all panel, `openPanel === "branches"`).
  - Removed: the old two-item "New conversation"/"Past conversations" rail buttons, the `newConvo` confirmation popover, `startNewConversation` (dead — the mount-bootstrap effect at ~line 720 already creates Main Chat if none exists).
  - In-chat UI unchanged: "Branched from X" pill + "Branch this chat" icon button, both still live near the model-picker row.

### 2. Left sidebar close/open button (just added, also verified clean)
- JuanJo: *"we also need a button to close the left sidebar."*
- New `leftPanelOpen` state (desktop-only concept, defaults `true`, mirrors the existing `rightPanelOpen` pattern for the right/Sources panel).
- Desktop: the whole `.sidebar` div now only renders when `leftPanelOpen` is true. A close (X) button lives in its header (same button mobile already had, now also wired for desktop — branches its `onClick` between `setLeftPanelOpen(false)` and `setSidebarOpen(false)` depending on `isDesktopSidebar`). A floating open-trigger (hamburger icon) appears top-left, offset past `var(--outer-rail-width)`, when closed on desktop — mirrors the right panel's own open-trigger exactly.
- Mobile behavior is untouched — still the same slide-in drawer via `.sidebar.open` + `sidebarOpen` state, `leftPanelOpen` doesn't apply there.
- `index.css`: new CSS var `--left-panel-width` (defaults to `var(--sidebar-width)`, overridden by a React effect to `"0px"` when the user closes the panel on desktop). `.chat-column`/`.centered-col`'s left-floor calc now reads `--left-panel-width` instead of `--sidebar-width` directly, so the chat re-centers into the freed space when the sidebar is closed — same mechanism that already existed for the right panel via the `right-panel-open` body class, just done as a CSS var instead since the right panel used a body class + hardcoded 0 in the "not open" case implicitly (right panel's floor doesn't need a var since it isn't in the *left* floor calc at all).
- **Not yet browser-verified** — per standing project rule (see `feedback-user-tests.md` in memory: JuanJo tests UI changes himself, I don't run browser verification loops). Typecheck and production build are both clean; visual confirmation is on him.

## Standing architecture decisions (agreed, not all built yet)

Full detail lives in memory (`navi-planner-and-completion-rate.md`, project-type). Highlights relevant to what's next:

- **Project** is the real top-level container — sits *above* the entire canvas switcher (Chat / Agent Work / Codex / Dashboard), team-shared (multi-user DB, shared files). This is a B2B-driving decision, not yet built at all — no multi-project data model exists yet (IndexedDB schema is implicitly single-project).
- Entry flow: **both** a dedicated Project Selector screen on app open, **and** a persistent compact project-switcher pinned above the canvas-switcher at the rail's top. Neither built yet.
- **Left sidebar = project-wide tools, right sidebar = canvas-dependent tools.** Knowledge (left) and Sources (right) already fit this split. **Files' placement is still unconfirmed** — flagged as likely wanting to move left (project-wide), not yet decided by JuanJo.
- **"Codex" needs a rename** (OpenAI trademark/copyright concern) — flagged, no replacement name chosen, still used as the internal key/label everywhere in code.
- Outer rail's full intended order: project switcher (not built) → canvas switcher (Chat/Agent Work/Codex[rename pending]/Dashboard) → contextual middle zone (canvas-dependent; Chat's is now the three-item branch spec above) → account-stuff bottom zone (Usage/Routing/Models/Settings).

## Not in scope right now (explicitly deferred)

- Building the actual Project Selector screen or rail-top project switcher.
- Renaming Codex.
- Rescoping Sources/Knowledge/Files to true project-level shared resources; deciding Files' sidebar side.
- Real multi-user/team database sharing (backend-gated — see "V3 UI before backend" in memory).
- Agent Work canvas and Dashboard canvas are placeholders only; only Chat has real middle-zone rail actions.

## Process notes for whoever picks this up

- **Ask before code changes** — propose the edit, wait for go-ahead, even for small/safe changes. (Got this wrong once earlier this session — jumped into `storage.ts`/`App.tsx` edits mid-*design discussion* before the design was actually agreed; JuanJo corrected it directly.)
- **Don't run browser verification loops** — JuanJo tests in-browser himself. `tsc --noEmit` + `npm run build` clean is the bar for "done" from this side.
- Route all V3 colors/spacing through `tokens.ts`, never hardcode (separate but related standing rule, applies repo-wide not just this feature).
