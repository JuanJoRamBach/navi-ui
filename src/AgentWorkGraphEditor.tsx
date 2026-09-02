import { useCallback, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { XIcon, PlusIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow, tintedSurface } from "./tokens";
import { NODE_KIND_LIST, NODE_KINDS, type NodeKindId } from "./agentWorkNodeKinds";
import { AGENT_WORK_NODE_TYPES, type AgentWorkNodeData } from "./AgentWorkGraphNode";

const accent = CANVAS_ACCENT.agentWork.color;
let nodeCounter = 0;

// Lines-at-3:1 read as a bad net/mesh in practice (2026-09-02, JuanJo:
// "horrible... too thick... a bad net effect") — the contrast math was
// correct, but a full crossing grid of lines is a fundamentally
// different visual weight than a field of dots, no ratio fixes that.
// Switched to dots per explicit spec: 20px separation, 2px diameter
// (React Flow's `size` is a RADIUS, so size=1 for a 2px dot). Opacity
// started at 12%, bumped to 30% (2026-09-02, JuanJo) — a real,
// deliberately-tuned-by-eye value, not derived from a contrast target
// this time. Snap grid still matches the visible spacing exactly, same
// reasoning as before (what you see is what nodes lock to).
const GRID_SIZE = 20;
const GRID_DOT_RADIUS = 1;
const GRID_LINE_COLOR = "rgba(189, 129, 48, 0.3)";

// Left rail — drag a kind onto the canvas to create one. Not a click-to-
// add list on purpose: dragging is what every real node-graph tool uses
// (n8n, LangGraph Studio) for "place this specific thing at this
// specific spot," and it's the same gesture the connect-nodes step uses
// right after, so the whole canvas stays one consistent interaction
// model instead of switching between click-to-add and drag-to-connect.
function NodePalette() {
  return (
    <div style={{
      width: 168, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.08)",
      padding: spacing.sm, display: "flex", flexDirection: "column", gap: spacing.xs, overflowY: "auto",
    }}>
      <div style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em", marginBottom: 2 }}>
        DRAG A NODE
      </div>
      {NODE_KIND_LIST.map(kind => {
        const Icon = kind.icon;
        const color = `oklch(65% 0.14 ${kind.hue})`;
        return (
          <div
            key={kind.id}
            draggable
            onDragStart={e => { e.dataTransfer.setData("application/agentwork-node-kind", kind.id); e.dataTransfer.effectAllowed = "move"; }}
            title={kind.description}
            style={{
              display: "flex", alignItems: "center", gap: spacing.xs, padding: `${spacing.xs}px ${spacing.sm}px`,
              borderRadius: radius.sm, border: `1px solid ${color}40`, background: tintedGlow(kind.hue, 0.08),
              cursor: "grab", fontFamily,
            }}
          >
            <span style={{ display: "flex", flexShrink: 0, color }}><Icon size={13} /></span>
            <span style={{ fontSize: fontSize.xxs, color: neutral.textPrimary, lineHeight: 1.3 }}>{kind.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Right sidebar — the selected node's editable fields. Same "click a
// node, a panel slides in from the right" pattern n8n itself uses
// (checked before building this), reusing the same right-sidebar chrome
// Agent Work's Workflows/Run History panes already live in rather than
// inventing a modal. Every edit here only touches local canvas state —
// nothing is sent to NAVI until "Save as Agent/Workflow" is pressed.
function NodeInspector({ node, onChange, onDelete, onClose }: {
  node: Node<AgentWorkNodeData>; onChange: (values: Record<string, string>) => void;
  onDelete: () => void; onClose: () => void;
}) {
  const kind = NODE_KINDS[node.data.kindId];
  const Icon = kind.icon;
  const color = `oklch(65% 0.14 ${kind.hue})`;

  return (
    <div style={{ width: 240, flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
        padding: spacing.sm, borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, minWidth: 0 }}>
          <span style={{ display: "flex", flexShrink: 0, color }}><Icon size={14} /></span>
          <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>{kind.label}</span>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ display: "flex", background: "none", border: "none", color: neutral.textFaint, cursor: "pointer" }}>
          <XIcon size={12} />
        </button>
      </div>
      <div style={{ padding: spacing.sm, display: "flex", flexDirection: "column", gap: spacing.sm, overflowY: "auto", flex: 1 }}>
        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.5 }}>{kind.description}</div>
        {kind.fields.map(field => {
          const value = node.data.values[field.key] ?? "";
          const commonStyle: React.CSSProperties = {
            width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
            padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box",
          };
          return (
            <div key={field.key}>
              <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: 2 }}>{field.label}</div>
              {field.kind === "textarea" ? (
                <textarea
                  value={value} placeholder={field.placeholder} rows={4}
                  onChange={e => onChange({ ...node.data.values, [field.key]: e.target.value })}
                  style={{ ...commonStyle, resize: "vertical" }}
                />
              ) : field.kind === "select" ? (
                <select
                  value={value}
                  onChange={e => onChange({ ...node.data.values, [field.key]: e.target.value })}
                  style={commonStyle}
                >
                  <option value="" disabled>Choose…</option>
                  {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              ) : (
                <input
                  type={field.kind === "url" ? "url" : "text"} value={value} placeholder={field.placeholder}
                  onChange={e => onChange({ ...node.data.values, [field.key]: e.target.value })}
                  style={commonStyle}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: spacing.sm, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={onDelete}
          style={{
            width: "100%", padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs,
            border: "1px solid #e05a4a55", background: "#e05a4a15", color: "#e05a4a",
            cursor: "pointer", fontSize: fontSize.xs, fontFamily,
          }}
        >
          Delete node
        </button>
      </div>
    </div>
  );
}

function GraphCanvas({ onClose }: { onClose: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentWorkNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({ ...connection, animated: false, style: { stroke: `${accent}99` } }, eds));
  }, [setEdges]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kindId = e.dataTransfer.getData("application/agentwork-node-kind") as NodeKindId;
    if (!kindId || !NODE_KINDS[kindId]) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    nodeCounter += 1;
    const id = `node-${nodeCounter}`;
    setNodes(nds => [...nds, {
      id, type: "agentWorkNode", position,
      data: { kindId, values: {} } satisfies AgentWorkNodeData,
    }]);
  }, [screenToFlowPosition, setNodes]);

  const selectedNode = nodes.find(n => n.id === selectedId) ?? null;

  const updateSelectedValues = (values: Record<string, string>) => {
    if (!selectedId) return;
    setNodes(nds => nds.map(n => n.id === selectedId ? { ...n, data: { ...n.data, values } } : n));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes(nds => nds.filter(n => n.id !== selectedId));
    setEdges(eds => eds.filter(e => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  // Backend not wired yet (2026-09-02: "just make the nodes, later we
  // can do the 'backend' of them") — this exists so the flow is
  // complete end-to-end visually, and to say so honestly rather than
  // pretend a save happened.
  const handleSave = () => {
    // eslint-disable-next-line no-console
    console.log("Agent Work graph (not yet saved to NAVI):", { nodes, edges });
    alert(`${nodes.length} node(s), ${edges.length} connection(s) — logged to the console. Saving to NAVI isn't wired up yet.`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
        padding: `${spacing.sm}px ${spacing.md}px`, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
          Visual Workflow Builder
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
          <button
            onClick={handleSave}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: `${spacing.xxs}px ${spacing.sm}px`,
              borderRadius: radius.xs, border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.12),
              color: accent, cursor: "pointer", fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily,
            }}
          >
            <PlusIcon size={11} /> Save as Agent/Workflow
          </button>
          <button onClick={onClose} aria-label="Close" style={{ display: "flex", background: "none", border: "none", color: neutral.textFaint, cursor: "pointer", padding: spacing.xxs }}>
            <XIcon size={16} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <NodePalette />
        <div ref={wrapperRef} style={{ flex: 1, minWidth: 0 }} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_e, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={AGENT_WORK_NODE_TYPES}
            snapToGrid snapGrid={[GRID_SIZE, GRID_SIZE]}
            fitView
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} color={GRID_LINE_COLOR} gap={GRID_SIZE} size={GRID_DOT_RADIUS} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ background: tintedSurface(CANVAS_ACCENT.agentWork.hue, 12, 0.03) }} />
          </ReactFlow>
        </div>
        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            onChange={updateSelectedValues}
            onDelete={deleteSelected}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

// Full-screen overlay, same weight as a real editor taking over the
// workspace — a node graph needs real canvas space, not a cramped
// sidebar panel like the manual step-list form gets.
export function AgentWorkGraphEditor({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300, background: "rgba(6,7,10,0.97)",
      display: "flex", flexDirection: "column",
    }}>
      <ReactFlowProvider>
        <GraphCanvas onClose={onClose} />
      </ReactFlowProvider>
    </div>
  );
}
