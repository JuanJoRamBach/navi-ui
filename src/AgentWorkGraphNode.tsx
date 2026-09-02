import { Handle, Position, type NodeProps } from "@xyflow/react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, tintedSurface, tintedGlow } from "./tokens";
import { NODE_KINDS, type NodeKindId } from "./agentWorkNodeKinds";

export interface AgentWorkNodeData {
  kindId: NodeKindId;
  values: Record<string, string>;
  [key: string]: unknown; // required by @xyflow/react's Node<T> constraint
}

// The node's on-canvas look — compact enough that a graph of 5-10 of
// these stays readable, but with enough of the actual content (first
// field's value) visible that you don't have to click every node just
// to see what it does. Full editing lives in the right sidebar (see
// AgentWorkGraphEditor.tsx) — clicking here selects, it doesn't inline-edit.
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
      <Handle type="target" position={Position.Top} style={{ background: color, width: 8, height: 8, border: "none" }} />
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
      <Handle type="source" position={Position.Bottom} style={{ background: color, width: 8, height: 8, border: "none" }} />
    </div>
  );
}

export const AGENT_WORK_NODE_TYPES = { agentWorkNode: AgentWorkGraphNode };
