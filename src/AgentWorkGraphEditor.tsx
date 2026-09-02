import { useCallback, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Panel,
  addEdge, useNodesState, useEdgesState, useReactFlow, useViewport,
  type Node, type Edge, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { XIcon, PlusIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
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

// On-demand menu, not a persistent docked palette (2026-09-02 research
// pass before this was built) — a permanently-visible left-side list is
// what caused the earlier space-competition/layout bug in the first
// place, and it's not actually how professional node editors solve
// this: Blender's Shift+A, Unreal Blueprint's right-click, and n8n's own
// "+" button are all on-demand, not docked. Opens below the "+ Add
// Node" button in the top bar. Each item supports BOTH gestures per
// JuanJo's spec: click creates the node centered in the current canvas
// view, drag places it exactly where dropped — same drop target
// (onDrop on the canvas wrapper) either way, this menu is just a second
// way to start that drag, plus a click shortcut for when precise
// placement doesn't matter yet.
function AddNodeMenu({ onPick, onClose }: { onPick: (kind: NodeKindId) => void; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 320 }} />
      <div style={{
        position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 321,
        width: 200, background: "#161616", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: radius.sm, padding: spacing.xs, display: "flex", flexDirection: "column", gap: 3,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)", maxHeight: 360, overflowY: "auto",
      }}>
        {NODE_KIND_LIST.map(kind => {
          const Icon = kind.icon;
          const color = `oklch(65% 0.14 ${kind.hue})`;
          return (
            <div
              key={kind.id}
              draggable
              onDragStart={e => { e.dataTransfer.setData("application/agentwork-node-kind", kind.id); e.dataTransfer.effectAllowed = "move"; onClose(); }}
              onClick={() => onPick(kind.id)}
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
    </>
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

// A live "100%"-style readout — React Flow's own zoom controls have no
// number on them at all (2026-09-02, JuanJo: "there is no numbers on
// the zoom buttons"). useViewport() re-renders this on every zoom/pan,
// no manual event wiring needed. Anchored next to Controls (both
// bottom-left) via Panel, React Flow's own corner-positioning helper,
// rather than hand-computed absolute coordinates.
function ZoomBadge() {
  const { zoom } = useViewport();
  return (
    <Panel position="bottom-left" style={{ marginLeft: 52, marginBottom: 10 }}>
      <div style={{
        padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,255,255,0.1)", color: neutral.textMuted,
        fontSize: fontSize.xxs, fontFamily, pointerEvents: "none",
      }}>
        {Math.round(zoom * 100)}%
      </div>
    </Panel>
  );
}

function GraphCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentWorkNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [showAddNodeMenu, setShowAddNodeMenu] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({ ...connection, animated: false, style: { stroke: `${accent}99` } }, eds));
  }, [setEdges]);

  const addNode = useCallback((kindId: NodeKindId, position: { x: number; y: number }) => {
    nodeCounter += 1;
    const id = `node-${nodeCounter}`;
    setNodes(nds => [...nds, {
      id, type: "agentWorkNode", position,
      data: { kindId, values: {} } satisfies AgentWorkNodeData,
    }]);
  }, [setNodes]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kindId = e.dataTransfer.getData("application/agentwork-node-kind") as NodeKindId;
    if (!kindId || !NODE_KINDS[kindId]) return;
    addNode(kindId, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [screenToFlowPosition, addNode]);

  // "+ Add Node" button's click path (as opposed to dragging the same
  // menu item onto a specific spot) — centers on the canvas wrapper's
  // own visible area, not the whole window, so the palette/inspector
  // panels being open doesn't throw the "center" off to one side.
  const addNodeAtViewCenter = (kindId: NodeKindId) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    addNode(kindId, screenToFlowPosition(center));
    setShowAddNodeMenu(false);
  };

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
      const saved = workflowName.trim();
      await createWorkflow(saved, null, graph, { type: "manual" });
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
      // No "close" to return to — this canvas IS Agent Work now, not an
      // overlay opened on top of it (2026-09-02: eliminated the empty-
      // canvas landing page entirely). Reset to a blank canvas so
      // building the next workflow starts clean, with a brief
      // confirmation instead of silently vanishing.
      setNodes([]); setEdges([]); setSelectedId(null); setWorkflowName("");
      setSavedName(saved);
      setTimeout(() => setSavedName(null), 4000);
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
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowAddNodeMenu(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: `${spacing.xxs}px ${spacing.sm}px`,
                  borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                  color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily,
                }}
              >
                <PlusIcon size={11} /> Add Node
              </button>
              {showAddNodeMenu && (
                <AddNodeMenu onPick={addNodeAtViewCenter} onClose={() => setShowAddNodeMenu(false)} />
              )}
            </div>
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
        {savedName && (
          <div style={{
            padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs,
            border: "1px solid #3ecf8e55", background: "#3ecf8e15",
            fontSize: fontSize.xxs, color: "#3ecf8e",
          }}>
            Saved "{savedName}" — find it in the Workflows sidebar.
          </div>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
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
            // zoom=1 is the standard 100%/actual-size convention (same
            // as a plain CSS transform: scale(1)) — every zoomable
            // canvas tool uses this. minZoom caps how far out the
            // canvas can go (2026-09-02, JuanJo: "don't allow a big zoom
            // out") — a small handful of nodes shouldn't be able to
            // shrink to unreadable specks; maxZoom left at React Flow's
            // own default (2, i.e. 200%).
            minZoom={0.5}
            // MIT-licensed — nothing legally requires keeping React
            // Flow's own attribution badge, and NAVI isn't a commercial
            // product being sold (2026-09-02 check before hiding it).
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color={GRID_DOT_COLOR} gap={GRID_SIZE} size={GRID_DOT_RADIUS} />
            <Controls showInteractive={false} />
            <ZoomBadge />
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

// Fills its parent — Agent Work's canvas itself, not an overlay opened
// on top of it (2026-09-02: previously a position:fixed full-screen
// takeover, but a right-sidebar entry point animates via CSS transform,
// which silently makes any descendant's position:fixed relative to THAT
// sidebar instead of the real viewport — the actual cause of the
// palette rendering underneath the app's own left rail. Removing the
// overlay entirely, in favor of the graph editor just BEING Agent
// Work's default canvas content, sidesteps that class of bug rather
// than working around it with a portal).
export function AgentWorkGraphEditor() {
  return (
    <div style={{ height: "100%", background: "rgba(6,7,10,0.97)", display: "flex", flexDirection: "column" }}>
      <ReactFlowProvider>
        <GraphCanvas />
      </ReactFlowProvider>
    </div>
  );
}
