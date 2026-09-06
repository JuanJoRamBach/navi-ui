import { useState, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef, type PanelImperativeHandle } from "react-resizable-panels";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { spacing, fontSize, fontWeight, neutral, fontFamily } from "./tokens";
import { type RefObject } from "react";

// Reusable "two stacked tools" primitive for both sidebars (2026-09-06,
// JuanJo: "inside the sidebars the sections should be resizeable
// vertically... each tool can be collapsed"). Real, not hand-rolled —
// react-resizable-panels (already used for the Sources tab's document-
// viewer split) has genuine collapsible-panel support built in
// (collapsedSize + an imperative collapse()/expand()/isCollapsed() API),
// so this wires that up rather than reinventing panel mechanics.
//
// A panel's own edge anchoring (top panel shrinks toward the top, bottom
// panel shrinks toward the bottom) needs no special logic at all — that
// falls straight out of the Group's own vertical layout once one panel
// collapses and the other grows to fill the freed space.
//
// Chevron convention matches what's already used elsewhere in this app
// (AgentCard/PromptCard's own expand toggles): ChevronDown = expanded
// ("showing, click to collapse"), ChevronRight = collapsed ("hidden,
// click to expand") — same for both the top and bottom section, no
// separate up/down scheme to learn.
export interface StackedPanelSection {
  id: string;
  label: string;
  content: ReactNode;
  // An action button (e.g. Agents' own "+ New") that lives in the
  // header row alongside the collapse chevron — kept separate from
  // `content` so it stays visible even while the section is collapsed
  // (content underneath doesn't render when collapsed, but the header
  // row always does).
  headerAction?: ReactNode;
  defaultSize?: number; // percentage of the Group's total height
  minSize?: number; // percentage
}

const HEADER_HEIGHT = 28; // px — collapsedSize target, just enough for the label row

function SectionHeader({ label, collapsed, onToggle, action }: { label: string; collapsed: boolean; onToggle: () => void; action?: ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
      height: HEADER_HEIGHT, boxSizing: "border-box", padding: `0 ${spacing.sm}px`, flexShrink: 0,
    }}>
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          display: "flex", alignItems: "center", gap: 4, minWidth: 0,
          border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
          fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted,
          letterSpacing: "0.04em", fontFamily, padding: 0,
        }}
      >
        {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
        {label.toUpperCase()}
      </button>
      {action}
    </div>
  );
}

function StackedSection({ section, panelRef, defaultSizeFallback, collapsed, onToggle }: {
  section: StackedPanelSection; panelRef: RefObject<PanelImperativeHandle | null>;
  defaultSizeFallback: number; collapsed: boolean; onToggle: () => void;
}) {
  return (
    <Panel
      id={section.id} panelRef={panelRef} collapsible collapsedSize={HEADER_HEIGHT}
      defaultSize={section.defaultSize ?? defaultSizeFallback} minSize={section.minSize ?? 15}
      style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <SectionHeader label={section.label} collapsed={collapsed} onToggle={onToggle} action={section.headerAction} />
      {!collapsed && (
        <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {section.content}
        </div>
      )}
    </Panel>
  );
}

// groupId must be stable and unique per usage site (Agent Vault, Agent
// Work's right panel, Dev Slate's right panel each need their own) —
// passed straight to react-resizable-panels' Group id, which the
// library uses to key its own internal layout state.
export function StackedPanels({ top, bottom, groupId }: { top: StackedPanelSection; bottom: StackedPanelSection; groupId: string }) {
  const topRef = usePanelRef();
  const bottomRef = usePanelRef();
  const [topCollapsed, setTopCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

  // Collapsed state is tracked locally, not read reactively off the
  // library's own panelRef.isCollapsed() — collapse()/expand() are
  // one-shot imperative calls the library doesn't re-render us for, so
  // the toggle button owns this state and drives the imperative API to
  // match, rather than the other way around.
  const toggleTop = () => {
    if (topCollapsed) { topRef.current?.expand(); setTopCollapsed(false); }
    else { topRef.current?.collapse(); setTopCollapsed(true); }
  };
  const toggleBottom = () => {
    if (bottomCollapsed) { bottomRef.current?.expand(); setBottomCollapsed(false); }
    else { bottomRef.current?.collapse(); setBottomCollapsed(true); }
  };

  return (
    <Group id={groupId} orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
      <StackedSection section={top} panelRef={topRef} defaultSizeFallback={60} collapsed={topCollapsed} onToggle={toggleTop} />
      <Separator className="sidebar-vertical-separator" />
      <StackedSection section={bottom} panelRef={bottomRef} defaultSizeFallback={40} collapsed={bottomCollapsed} onToggle={toggleBottom} />
    </Group>
  );
}
