import { useCallback, useEffect, useRef, useState } from "react";
import {
  DockviewReact, DockviewDefaultTab,
  type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps, type IDockviewPanelHeaderProps,
} from "dockview-react";
import "dockview/dist/styles/dockview.css";
import "./devslate-dockview-theme.css";
import {
  CommentDiscussionIcon, FileDirectoryIcon, CodeIcon, TerminalIcon, GlobeIcon, ChevronDownIcon,
} from "@primer/octicons-react";
import { spacing, radius, fontSize, neutral, fontFamily, CANVAS_ACCENT, tintedGlow, surface } from "./tokens";
import { DevSlateChat } from "./DevSlateChat";
import { DevSlateFiles } from "./DevSlateFiles";
import { DevSlateCode } from "./DevSlateCode";
import { DevSlateTerminal } from "./DevSlateTerminal";
import { DevSlatePreview } from "./DevSlatePreview";

const accent = CANVAS_ACCENT.devSlate.color;

// The movable canvas — replaces the fixed Group/Panel/Separator tree
// (react-resizable-panels only resizes within a fixed layout, it has no
// concept of dragging a panel to a different edge or docking it
// elsewhere) with dockview, chosen over FlexLayout on real signal
// (2026-09-01): ~2.5x the GitHub stars, ~2.4x the weekly npm downloads,
// proportionally fewer open issues relative to its user base.
//
// Every panel's own tab (dockview's built-in chrome) doubles as the
// "topbar so it can be collapsed" ask — dragging a tab to any edge docks
// it there, dragging it onto another group's tab strip tabs it
// together. Building a separate custom per-pane header system on top of
// this would just duplicate what dockview already gives for free.
const LAYOUT_STORAGE_KEY = "navi-devslate-dockview-layout";

// The exact 5 known panel kinds — not an open-ended set (there's no
// "add a new panel type" flow in Dev Slate), which is what makes a
// small fixed reopen menu the right fit rather than something more
// general.
const PANEL_DEFS = [
  { id: "chat", component: "chat", title: "Chat", icon: CommentDiscussionIcon },
  { id: "files", component: "files", title: "Files", icon: FileDirectoryIcon },
  { id: "code", component: "code", title: "Code", icon: CodeIcon },
  { id: "terminal", component: "terminal", title: "Terminal", icon: TerminalIcon },
  { id: "preview", component: "preview", title: "Preview", icon: GlobeIcon },
] as const;

const components: Record<string, React.FC<IDockviewPanelProps>> = {
  chat: () => <DevSlateChat />,
  files: () => <DevSlateFiles />,
  code: () => <DevSlateCode />,
  terminal: () => <DevSlateTerminal />,
  preview: () => <DevSlatePreview />,
};

// Reuses dockview's own default tab rendering (title, drag handle,
// active-state styling) rather than rebuilding it — only two things
// change: our own icon per panel kind (JuanJo, 2026-09-01: "put our
// icons"), and what clicking the close (X) actually does. Dockview's
// real close removes the panel from the layout with no built-in way
// back — "pressing X eliminates the tab and I don't know how to
// reopen it" was a real dead end. closeActionOverride keeps the same
// click, just routes it through onClosePanel below instead of a true
// destructive removal-with-no-recovery.
function makeTabComponent(onClosePanel: (id: string) => void) {
  return function DevSlateTab(props: IDockviewPanelHeaderProps) {
    const def = PANEL_DEFS.find(p => p.id === props.api.id);
    const Icon = def?.icon;
    return (
      <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center" }}>
        {/* DockviewDefaultTab's `children` prop is a dead end — its own
            implementation always renders exactly [pin, title, close
            button] regardless of what's passed as children, so an icon
            passed that way never actually shows up (confirmed reading
            its source, 2026-09-01: "I don't see the icons in the
            tabs"). Overlaying it via CSS instead, and reserving room
            for it with paddingLeft below, keeps every bit of
            DockviewDefaultTab's own drag/pointer/close wiring intact —
            a full custom tab rebuild would risk losing that. */}
        {Icon && (
          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", zIndex: 1, display: "flex", pointerEvents: "none" }}>
            <Icon size={12} />
          </span>
        )}
        <DockviewDefaultTab
          {...props}
          closeActionOverride={() => onClosePanel(props.api.id)}
          style={Icon ? { paddingLeft: 22 } : undefined}
        />
      </div>
    );
  };
}

function addPanelById(api: DockviewApi, id: string): void {
  const def = PANEL_DEFS.find(p => p.id === id);
  if (!def) return;
  // Reopens relative to Chat if it's still around (the one panel
  // unlikely to ever be closed in practice); falls back to no explicit
  // position (dockview picks a sensible default group) if Chat's gone
  // too — better than failing to reopen at all.
  const chatStillOpen = api.getPanel("chat") != null && id !== "chat";
  api.addPanel({
    id: def.id, component: def.component, title: def.title, renderer: "always",
    ...(chatStillOpen ? { position: { direction: "right", referencePanel: "chat" } } : {}),
  });
}

function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: "chat", component: "chat", title: "Chat", renderer: "always" });
  api.addPanel({
    id: "files", component: "files", title: "Files", renderer: "always",
    position: { direction: "right", referencePanel: "chat" },
  });
  api.addPanel({
    id: "code", component: "code", title: "Code", renderer: "always",
    position: { direction: "right", referencePanel: "files" },
  });
  api.addPanel({
    id: "terminal", component: "terminal", title: "Terminal", renderer: "always",
    position: { direction: "below", referencePanel: "code" },
  });
  api.addPanel({
    id: "preview", component: "preview", title: "Preview", renderer: "always",
    position: { direction: "right", referencePanel: "code" },
  });
}

// Small floating "reopen a closed panel" menu — the recovery path for
// whatever closeActionOverride above routed away from a true close.
// Not part of dockview's own chrome on purpose: this is a Dev-Slate-
// specific concept (a fixed 5-panel set), not a general dockview
// feature to bolt onto the library's own header-actions API.
function ReopenMenu({ closedIds, onReopen }: { closedIds: string[]; onReopen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (closedIds.length === 0) return null;

  return (
    <div style={{ position: "absolute", top: spacing.sm, right: spacing.sm, zIndex: 100 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: `${spacing.xxs}px ${spacing.xs}px`, borderRadius: radius.sm,
          border: `1px solid ${tintedGlow(CANVAS_ACCENT.devSlate.hue, 0.4)}`, background: "rgba(8,8,10,0.85)", color: accent,
          cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
        }}
      >
        {closedIds.length} closed panel{closedIds.length > 1 ? "s" : ""} <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: spacing.xxs,
          width: 180, background: surface.raised, border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: radius.sm, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: spacing.xs,
        }}>
          {PANEL_DEFS.filter(p => closedIds.includes(p.id)).map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { onReopen(id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: spacing.xxs, width: "100%", textAlign: "left",
                padding: `${spacing.xxs}px ${spacing.xs}px`, borderRadius: radius.xs, border: "none",
                background: "transparent", color: neutral.textPrimary, cursor: "pointer",
                fontSize: fontSize.xxs, fontFamily,
              }}
            >
              <Icon size={12} /> {title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DevSlateDockview() {
  const apiRef = useRef<DockviewApi | null>(null);
  const [closedIds, setClosedIds] = useState<string[]>([]);

  const refreshClosedIds = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    setClosedIds(PANEL_DEFS.filter(p => api.getPanel(p.id) == null).map(p => p.id));
  }, []);

  const handleClosePanel = useCallback((id: string) => {
    apiRef.current?.getPanel(id)?.api.close();
    // onDidRemovePanel (wired in onReady) also calls refreshClosedIds,
    // this is just a same-tick fallback so the reopen menu never lags
    // a frame behind the click that caused it.
    refreshClosedIds();
  }, [refreshClosedIds]);

  const handleReopen = useCallback((id: string) => {
    const api = apiRef.current;
    if (!api) return;
    addPanelById(api, id);
    refreshClosedIds();
  }, [refreshClosedIds]);

  const tabComponent = useRef(makeTabComponent(handleClosePanel)).current;

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;

    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    let restored = false;
    if (saved) {
      try {
        event.api.fromJSON(JSON.parse(saved));
        restored = true;
      } catch {
        restored = false;
      }
    }
    if (!restored) buildDefaultLayout(event.api);

    event.api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(event.api.toJSON()));
    });
    event.api.onDidAddPanel(() => refreshClosedIds());
    event.api.onDidRemovePanel(() => refreshClosedIds());
    refreshClosedIds();
  }, [refreshClosedIds]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <DockviewReact
        className="devslate-dockview dockview-theme-abyss"
        components={components}
        defaultTabComponent={tabComponent}
        onReady={onReady}
      />
      <ReopenMenu closedIds={closedIds} onReopen={handleReopen} />
    </div>
  );
}
