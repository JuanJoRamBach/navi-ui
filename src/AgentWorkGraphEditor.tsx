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
import { convertGraphToBackend } from "./agentWorkGraphConvert";
import { createWorkflow, WORKFLOW_CREATED_EVENT } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;
let nodeCounter = 0;

// Went lines-at-3:1 (2026-09-02: "horrible... a bad net effect" — the
// contrast math was fine, a full crossing grid is just a different
// visual weight no ratio fixes), then a hand-drawn 4-pointed sparkle
// (✦, matching JuanJo's reference glyph) via a custom SVG background —
// which turned out to visually match reactflow.dev's own marketing-site
// background closely enough to look like copied code (it wasn't, but
// the resemblance was real and funny). Landed back on React Flow's own
// built-in dots — 20px separation, 2px diameter (`size` is a RADIUS, so
// size=1). Opacity at 40%: no clean external precedent for this exact
// case, reasoned directly instead — a plain dot covers far less canvas
// area than the star or the crossing lines did, so the same opacity
// reads noticeably softer overall purely from less colored pixel area;
// higher than the original overly-cautious starting point for that
// reason, but pulled back from 50% since that number was only ever
// actually seen on the busier star shape, never tested on a bare dot.
const GRID_SIZE = 20;
const GRID_DOT_RADIUS = 1;
const GRID_DOT_COLOR = "rgba(189, 129, 48, 0.4)";

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
  const [workflowName, setWorkflowName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
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

  // Real save (2026-09-02) — converts the canvas into storage/
  // agent_work.py's own graph shape and POSTs it through the same
  // /agent/workflows route the chat-created path already uses.
  // Node kinds without backend support yet (apiCall, sendMail,
  // choosePath, Discord) are caught by convertGraphToBackend and
  // reported here rather than silently accepted.
  const handleSave = async () => {
    setSaveErrors([]);
    if (!workflowName.trim()) {
      setSaveErrors(["Name this workflow before saving."]);
      return;
    }
    const { graph, errors } = convertGraphToBackend(nodes, edges);
    if (errors.length > 0 || !graph) {
      setSaveErrors(errors);
      return;
    }
    setSaving(true);
    try {
      await createWorkflow(workflowName.trim(), null, graph, { type: "manual" });
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
      onClose();
    } catch {
      setSaveErrors(["Couldn't save — NAVI may be unreachable. Try again."]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "flex", flexDirection: "column", gap: spacing.xs,
        padding: `${spacing.sm}px ${spacing.md}px`, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, flexShrink: 0 }}>
              Visual Workflow Builder
            </span>
            <input
              value={workflowName} onChange={e => setWorkflowName(e.target.value)}
              placeholder="Name this workflow…"
              style={{
                flex: 1, minWidth: 0, maxWidth: 260, background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: radius.xs,
                color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
                padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, flexShrink: 0 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: `${spacing.xxs}px ${spacing.sm}px`,
                borderRadius: radius.xs, border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.12),
                color: accent, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily,
              }}
            >
              <PlusIcon size={11} /> {saving ? "Saving…" : "Save as Agent/Workflow"}
            </button>
            <button onClick={onClose} aria-label="Close" style={{ display: "flex", background: "none", border: "none", color: neutral.textFaint, cursor: "pointer", padding: spacing.xxs }}>
              <XIcon size={16} />
            </button>
          </div>
        </div>
        {saveErrors.length > 0 && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 2, padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: radius.xs, border: "1px solid #e05a4a55", background: "#e05a4a15",
            fontSize: fontSize.xxs, color: "#e08a7a",
          }}>
            {saveErrors.map((err, i) => <div key={i}>{err}</div>)}
          </div>
        )}
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
            // MIT-licensed — nothing legally requires keeping React
            // Flow's own attribution badge, and NAVI isn't a commercial
            // product being sold (2026-09-02 check before hiding it).
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color={GRID_DOT_COLOR} gap={GRID_SIZE} size={GRID_DOT_RADIUS} />
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
