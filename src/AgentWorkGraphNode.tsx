import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { XIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, tintedSurface, tintedGlow } from "./tokens";
import { NODE_KINDS, type NodeKindId } from "./agentWorkNodeKinds";

export interface AgentWorkNodeData {
  kindId: NodeKindId;
  values: Record<string, string>;
  [key: string]: unknown; // required by @xyflow/react's Node<T> constraint
}

export interface AgentWorkGroupData {
  label: string;
  onDelete?: () => void;
  [key: string]: unknown;
}

// The node's on-canvas look — compact enough that a graph of 5-10 of
// these stays readable, but with enough of the actual content (first
// field's value) visible that you don't have to click every node just
// to see what it does. Full editing lives in a floating popover under
// the node (see NodeInspector in AgentWorkGraphEditor.tsx) — clicking
// here selects, it doesn't inline-edit. Handles are left (target) /
// right (source), not top/bottom (2026-09-03, JuanJo) — matches n8n's
// left-in/right-out convention, already this file's own reference point.
export function AgentWorkGraphNode({ data, selected }: NodeProps & { data: AgentWorkNodeData }) {
  const kind = NODE_KINDS[data.kindId];
  const Icon = kind.icon;
  const color = `oklch(65% 0.14 ${kind.hue})`;
  const preview = Object.values(data.values).find(v => v && v.trim());

  return (
    <div style={{
      width: 200, borderRadius: radius.md, fontFamily,
      background: tintedSurface(kind.hue, 16, 0.05),
      border: `1.5px solid ${selected ? color : `${color}55`}`,
      boxShadow: selected ? `0 0 0 3px ${tintedGlow(kind.hue, 0.25)}, 0 4px 16px rgba(0,0,0,0.4)` : "0 4px 16px rgba(0,0,0,0.35)",
      padding: spacing.sm,
    }}>
      <Handle type="target" position={Position.Left} style={{ background: color, width: 8, height: 8, border: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, minWidth: 0 }}>
        <span style={{ display: "flex", flexShrink: 0, color }}>
          <Icon size={14} />
        </span>
        <span style={{
          fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
        }}>
          {kind.label}
        </span>
      </div>
      {preview && (
        <div style={{
          marginTop: 4, fontSize: fontSize.xxs, color: neutral.textFaint,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {preview}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color, width: 8, height: 8, border: "none" }} />
    </div>
  );
}

// A resizable container nodes can be dropped into — pure visual/
// organizational grouping for now (2026-09-03, JuanJo: "we must
// implement the sub-flows from reactflow"), built on React Flow's own
// parentId/extent mechanism (reactflow.dev/learn/layouting/sub-flows),
// not a bespoke nesting system. No handles — a group can't itself be
// wired into the graph, matching the library's own "group node type...
// has no handles attached" default. Registered under the type key
// "group" specifically so React Flow's own parent/child ordering rules
// apply the same way they would to its built-in group node; this is a
// resizable replacement for that default, not a different concept.
// Deliberately NOT yet wired to any backend execution semantics ("run
// this group once per row of a list") — that's the larger, separately-
// flagged fan-out feature (see IDEAS.md), this is only the visual piece.
export function AgentWorkGroupNode({ data, selected }: NodeProps & { data: AgentWorkGroupData }) {
  return (
    <div style={{
      width: "100%", height: "100%", borderRadius: radius.md,
      border: `1.5px dashed ${selected ? neutral.textMuted : "rgba(255,255,255,0.18)"}`,
      background: "rgba(255,255,255,0.02)",
    }}>
      <NodeResizer minWidth={200} minHeight={140} isVisible={selected} lineStyle={{ borderColor: neutral.textMuted }} handleStyle={{ background: neutral.textMuted, width: 8, height: 8, borderRadius: 2 }} />
      <div style={{
        position: "absolute", top: -9, left: spacing.sm, padding: `0 ${spacing.xxs}px`,
        background: "#0a0a0a", fontSize: fontSize.xxs, fontWeight: fontWeight.medium,
        color: neutral.textFaint, fontFamily,
      }}>
        {data.label}
      </div>
      {data.onDelete && (
        <button
          onClick={e => { e.stopPropagation(); data.onDelete?.(); }}
          aria-label="Delete group"
          title="Delete group (nodes inside stay, just ungrouped)"
          style={{
            position: "absolute", top: -11, right: -11, width: 18, height: 18, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.18)", background: "#0a0a0a",
            color: neutral.textFaint, cursor: "pointer", padding: 0,
          }}
        >
          <XIcon size={10} />
        </button>
      )}
    </div>
  );
}

export const AGENT_WORK_NODE_TYPES = { agentWorkNode: AgentWorkGraphNode, group: AgentWorkGroupNode };
