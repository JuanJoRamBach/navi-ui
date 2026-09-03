import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Panel,
  BaseEdge, EdgeLabelRenderer, getBezierPath,
  addEdge, useNodesState, useEdgesState, useReactFlow, useViewport,
  type Node, type Edge, type Connection, type OnConnectEnd, type FinalConnectionState, type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { XIcon, PlusIcon, SquareIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
import { NODE_KIND_LIST, NODE_KINDS, type NodeKindId } from "./agentWorkNodeKinds";
import { AGENT_WORK_NODE_TYPES, type AgentWorkNodeData, type AgentWorkGroupData } from "./AgentWorkGraphNode";
import { convertGraphToBackend } from "./agentWorkGraphConvert";
import { createWorkflow, WORKFLOW_CREATED_EVENT } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;
let nodeCounter = 0;
let groupCounter = 0;

// Sub-flows (2026-09-03, JuanJo: "we must implement the sub-flows from
// reactflow", reactflow.dev/learn/layouting/sub-flows) — a resizable
// "group" node other nodes can be dragged into, built on React Flow's
// own parentId/extent mechanism. Purely visual/organizational for now:
// convertGraphToBackend never sees group nodes (filtered at the
// handleSave call site below), and nothing here changes HOW a workflow
// executes. Wiring an actual "run this group once per row of a list"
// fan-out into the dispatcher is a separate, larger, later feature —
// see IDEAS.md.
type AgentWorkAnyNode = Node<AgentWorkNodeData> | Node<AgentWorkGroupData>;

function isExecNode(n: AgentWorkAnyNode): n is Node<AgentWorkNodeData> {
  return n.type !== "group";
}

// React Flow's own hard requirement: "parent nodes appear before their
// children in the nodes array" or child positioning breaks. Groups can
// be created after nodes that later get dragged into them, so creation
// order alone can't guarantee this — re-sort after every membership
// change instead. Single-level nesting only (no group-in-group), so
// "all groups first, then everything else, relative order otherwise
// preserved" is sufficient — no real topological sort needed.
function reorderGroupsFirst(nds: AgentWorkAnyNode[]): AgentWorkAnyNode[] {
  const groups = nds.filter(n => n.type === "group");
  const rest = nds.filter(n => n.type !== "group");
  return [...groups, ...rest];
}

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
// 16px/64px ("uff it looks bad") overshot; 8px dots still too big at
// 24px spacing — settled on 6px dots / 24px spacing (2026-09-03,
// JuanJo: "the distance is right, the dots are not"). snapGrid stays
// tied to this same constant, so the visible spacing and where nodes
// actually lock never drift apart.
const GRID_SIZE = 24;
const GRID_DOT_RADIUS = 3; // `size` is a RADIUS — 3 gives a 6px-diameter dot
const GRID_DOT_COLOR = "rgba(189, 129, 48, 0.4)";

// Edges: 1px default read as too thin, and the amber accent at 60%
// opacity read as a dim off-white rather than a real color (2026-09-03,
// JuanJo: "make it 3 pixels, and a more whiter white, not #FFFFFF, but
// whiter than what it is now"). Reusing neutral.textPrimary rather than
// inventing a new value — it's the app's own existing "bright but not
// harsh #FFFFFF" white, used everywhere else text needs to read clearly
// on dark surfaces.
const EDGE_COLOR = neutral.textPrimary;
const EDGE_WIDTH = 3;

// Edges were selectable + Backspace-deletable via React Flow's own
// defaults already, but with zero visual affordance — nothing on
// screen suggested a thin line was clickable at all (2026-09-03,
// JuanJo: "there is no way to erase a connection"). A small × button
// at the edge's midpoint, always visible but subtle until hovered, is
// the same pattern n8n uses. Registered as the "default" edge type so
// every edge gets it without needing an explicit `type` on creation.
function AgentWorkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd }: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const [hovered, setHovered] = useState(false);
  const { setEdges } = useReactFlow();
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          onClick={e => { e.stopPropagation(); setEdges(eds => eds.filter(edge => edge.id !== id)); }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-label="Delete connection"
          style={{
            position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.25)", background: hovered ? "#e05a4a" : "#161616",
            color: hovered ? "#fff" : neutral.textFaint, fontSize: 11, lineHeight: 1, padding: 0,
            cursor: "pointer", pointerEvents: "all", fontFamily,
          }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const AGENT_WORK_EDGE_TYPES = { default: AgentWorkEdge };

// Closes a floating menu on an outside click WITHOUT an intercepting
// full-screen overlay (2026-09-03 fix, JuanJo: "I can't drag the nodes
// when the add node window is open"). The original close mechanism was
// a `position:fixed, inset:0` transparent div sitting above the canvas
// — it caught the outside click correctly, but it also silently ate
// every other pointer interaction underneath it (node dragging
// included) for as long as the menu was open. A document-level
// mousedown listener gets the same "click away to close" behavior
// without ever sitting in the canvas's own hit-testing path.
function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

// Shared list body for both node-add menus below — the top-bar dropdown
// and the connection-drop quick-add. Each item supports BOTH gestures:
// click creates the node (position decided by whichever menu is
// showing it), drag places it exactly where dropped via the existing
// onDrop handler on the canvas wrapper.
function NodeKindItems({ onPick, onDragStart }: { onPick: (kind: NodeKindId) => void; onDragStart?: () => void }) {
  return (
    <>
      {NODE_KIND_LIST.map(kind => {
        const Icon = kind.icon;
        const color = `oklch(65% 0.14 ${kind.hue})`;
        return (
          <div
            key={kind.id}
            draggable
            onDragStart={e => { e.dataTransfer.setData("application/agentwork-node-kind", kind.id); e.dataTransfer.effectAllowed = "move"; onDragStart?.(); }}
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
    </>
  );
}

// On-demand menu, not a persistent docked palette (2026-09-02 research
// pass before this was built) — a permanently-visible left-side list is
// what caused the earlier space-competition/layout bug in the first
// place, and it's not actually how professional node editors solve
// this: Blender's Shift+A, Unreal Blueprint's right-click, and n8n's own
// "+" button are all on-demand, not docked. Opens below the "+ Add
// Node" button in the top bar. Click creates the node centered in the
// current canvas view; drag places it exactly where dropped.
function AddNodeMenu({ onPick, onClose }: { onPick: (kind: NodeKindId) => void; onClose: () => void }) {
  const ref = useClickOutside(onClose);
  return (
    <div ref={ref} style={{
      position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 321,
      width: 200, background: "#161616", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: radius.sm, padding: spacing.xs, display: "flex", flexDirection: "column", gap: 3,
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)", maxHeight: 360, overflowY: "auto",
    }}>
      <NodeKindItems onPick={onPick} onDragStart={onClose} />
    </div>
  );
}

// Quick-add menu that opens right where a dragged connection line is
// dropped on empty canvas — "that's one hell of a recurring pattern,
// dragging the line and drop to create a new node" (2026-09-03,
// JuanJo). Picking a kind creates the node at the drop point AND wires
// the edge automatically (see handleConnectDropPick in GraphCanvas),
// so the connect-drag gesture itself never has to be redone.
function ConnectDropMenu({ left, top, onPick, onClose }: { left: number; top: number; onPick: (kind: NodeKindId) => void; onClose: () => void }) {
  const ref = useClickOutside(onClose);
  return (
    <div ref={ref} style={{
      position: "absolute", left, top, transform: "translate(-50%, -50%)", zIndex: 50,
      width: 200, background: "#161616", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: radius.sm, padding: spacing.xs, display: "flex", flexDirection: "column", gap: 3,
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)", maxHeight: 360, overflowY: "auto",
    }}>
      <NodeKindItems onPick={onPick} />
    </div>
  );
}

// Floating popover anchored under the selected node — not a right
// sidebar (2026-09-03, JuanJo: "when I click the nodes, it opens a
// right sidebar. It should open a window under the nodes (like a
// comment window)"). Position is computed by NodeInspectorAnchor below
// from the node's own flow-space position plus the live viewport
// transform, so it tracks the node through pan/zoom rather than sitting
// in a fixed layout slot. Every edit here only touches local canvas
// state — nothing is sent to NAVI until "Save as Agent/Workflow" is
// pressed.
function NodeInspector({ node, onChange, onDelete, onClose }: {
  node: Node<AgentWorkNodeData>; onChange: (values: Record<string, string>) => void;
  onDelete: () => void; onClose: () => void;
}) {
  const kind = NODE_KINDS[node.data.kindId];
  const Icon = kind.icon;
  const color = `oklch(65% 0.14 ${kind.hue})`;

  return (
    <div style={{
      width: 260, display: "flex", flexDirection: "column", borderRadius: radius.md,
      border: "1px solid rgba(255,255,255,0.12)", background: "#161616",
      boxShadow: "0 12px 40px rgba(0,0,0,0.55)", maxHeight: 360,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
        padding: spacing.sm, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
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

// The fan-out editing surface — a group's only real config (2026-09-03,
// JuanJo: "let's properly make the sub flows, not just an idea"). One
// textarea, one line per item; blank/whitespace-only lines are dropped
// on change so "3 blank lines at the end" never silently becomes "3
// phantom iterations that call the LLM for nothing." Leaving this
// blank/empty is the explicit way to keep a group purely visual — no
// separate toggle needed, "no items" already means "no fan-out"
// everywhere else this data is read (the node's own badge,
// convertGraphToBackend, the dispatcher).
function GroupInspector({ node, onChangeItems, onClose }: {
  node: Node<AgentWorkGroupData>; onChangeItems: (items: string[]) => void; onClose: () => void;
}) {
  const itemsText = (node.data.items ?? []).join("\n");
  return (
    <div style={{
      width: 280, display: "flex", flexDirection: "column", borderRadius: radius.md,
      border: "1px solid rgba(255,255,255,0.12)", background: "#161616",
      boxShadow: "0 12px 40px rgba(0,0,0,0.55)", maxHeight: 360,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
        padding: spacing.sm, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>{node.data.label}</span>
        <button onClick={onClose} aria-label="Close" style={{ display: "flex", background: "none", border: "none", color: neutral.textFaint, cursor: "pointer" }}>
          <XIcon size={12} />
        </button>
      </div>
      <div style={{ padding: spacing.sm, display: "flex", flexDirection: "column", gap: spacing.xs, overflowY: "auto", flex: 1 }}>
        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.5 }}>
          Repeat every node in this group once per line below. Reference the current line in any node's text as <code>{"{{item}}"}</code>.
        </div>
        <textarea
          value={itemsText} rows={7} placeholder={"lead1@company.com\nlead2@company.com\n..."}
          onChange={e => onChangeItems(e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
          style={{
            width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
            padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box", resize: "vertical",
          }}
        />
        {!node.data.items?.length && (
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>Empty — this group is just visual organization, it runs its contents once as normal.</div>
        )}
      </div>
    </div>
  );
}

function GroupInspectorAnchor({ node, onChangeItems, onClose }: {
  node: Node<AgentWorkGroupData>; onChangeItems: (items: string[]) => void; onClose: () => void;
}) {
  const { x, y, zoom } = useViewport();
  const width = node.measured?.width ?? 320;
  const height = node.measured?.height ?? 220;
  const left = node.position.x * zoom + x + (width * zoom) / 2;
  const top = node.position.y * zoom + y + height * zoom + 8;
  return (
    <div style={{ position: "absolute", left, top, transform: "translateX(-50%)", zIndex: 50 }}>
      <GroupInspector node={node} onChangeItems={onChangeItems} onClose={onClose} />
    </div>
  );
}

// Computes where NodeInspector renders: node position (flow space) run
// through the live pan/zoom transform (screen = flow * zoom + offset —
// the same math React Flow itself uses internally), so the popover
// tracks its node across pans/zooms instead of sitting in a fixed
// layout slot. useViewport() subscribes this specifically to viewport
// changes, since GraphCanvas itself doesn't re-render on pan/zoom alone.
// Rendered as an absolute child of the same wrapper ReactFlow fills, so
// its (0,0) already lines up with the flow pane's own — no bounding-rect
// math needed on top of the viewport transform.
function NodeInspectorAnchor({ node, onChange, onDelete, onClose }: {
  node: Node<AgentWorkNodeData>; onChange: (values: Record<string, string>) => void;
  onDelete: () => void; onClose: () => void;
}) {
  const { x, y, zoom } = useViewport();
  const width = node.measured?.width ?? 200;
  const height = node.measured?.height ?? 70;
  const left = node.position.x * zoom + x + (width * zoom) / 2;
  const top = node.position.y * zoom + y + height * zoom + 8;
  return (
    <div style={{ position: "absolute", left, top, transform: "translateX(-50%)", zIndex: 50 }}>
      <NodeInspector node={node} onChange={onChange} onDelete={onDelete} onClose={onClose} />
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
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentWorkAnyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [showAddNodeMenu, setShowAddNodeMenu] = useState(false);
  const [connectDropMenu, setConnectDropMenu] = useState<{
    left: number; top: number; flowPosition: { x: number; y: number }; sourceId: string; handleType: "source" | "target";
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow();

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({ ...connection, animated: false, style: { stroke: EDGE_COLOR, strokeWidth: EDGE_WIDTH } }, eds));
  }, [setEdges]);

  const addNode = useCallback((kindId: NodeKindId, position: { x: number; y: number }) => {
    nodeCounter += 1;
    const id = `node-${nodeCounter}`;
    setNodes(nds => [...nds, {
      id, type: "agentWorkNode", position,
      data: { kindId, values: {} } satisfies AgentWorkNodeData,
    }]);
    return id;
  }, [setNodes]);

  const handleDeleteGroup = useCallback((groupId: string) => {
    // Ungroups rather than cascading — deleting the container shouldn't
    // silently delete everything inside it. Children go back to absolute
    // positions (group.position + their own relative position) so they
    // don't jump on screen once the parent reference is gone.
    setNodes(nds => {
      const group = nds.find(n => n.id === groupId);
      return nds
        .filter(n => n.id !== groupId)
        .map(n => n.parentId === groupId
          ? { ...n, parentId: undefined, extent: undefined, position: { x: n.position.x + (group?.position.x ?? 0), y: n.position.y + (group?.position.y ?? 0) } }
          : n
        );
    });
  }, [setNodes]);

  const addGroup = useCallback((position: { x: number; y: number }) => {
    groupCounter += 1;
    const id = `group-${groupCounter}`;
    setNodes(nds => reorderGroupsFirst([...nds, {
      id, type: "group", position, style: { width: 320, height: 220 },
      data: { label: "Group", onDelete: () => handleDeleteGroup(id) } satisfies AgentWorkGroupData,
    }]));
  }, [setNodes, handleDeleteGroup]);

  // Reassigns a dragged node's parentId based on whether it was dropped
  // inside a group's bounds — the actual "drag into/out of a sub-flow"
  // interaction (reactflow.dev/learn/layouting/sub-flows' own pattern:
  // getIntersectingNodes finds overlap, parentId + a recomputed relative
  // position does the reparenting). Only one level of nesting is
  // supported (groups can't contain groups), so a group's own position
  // is always absolute — that's what keeps this math simple.
  const onNodeDragStop = useCallback((_e: MouseEvent | TouchEvent, dragged: AgentWorkAnyNode) => {
    if (dragged.type === "group") return;
    const overlappingGroup = getIntersectingNodes(dragged).find(n => n.type === "group");
    const currentParentId = dragged.parentId;

    if (overlappingGroup && overlappingGroup.id !== currentParentId) {
      setNodes(nds => {
        const oldParent = currentParentId ? nds.find(n => n.id === currentParentId) : undefined;
        const absX = dragged.position.x + (oldParent?.position.x ?? 0);
        const absY = dragged.position.y + (oldParent?.position.y ?? 0);
        return reorderGroupsFirst(nds.map(n => n.id === dragged.id
          ? { ...n, parentId: overlappingGroup.id, extent: "parent" as const, position: { x: absX - overlappingGroup.position.x, y: absY - overlappingGroup.position.y } }
          : n
        ));
      });
    } else if (!overlappingGroup && currentParentId) {
      setNodes(nds => {
        const oldParent = nds.find(n => n.id === currentParentId);
        return reorderGroupsFirst(nds.map(n => n.id === dragged.id
          ? { ...n, parentId: undefined, extent: undefined, position: { x: n.position.x + (oldParent?.position.x ?? 0), y: n.position.y + (oldParent?.position.y ?? 0) } }
          : n
        ));
      });
    }
  }, [getIntersectingNodes, setNodes]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kindId = e.dataTransfer.getData("application/agentwork-node-kind") as NodeKindId;
    if (!kindId || !NODE_KINDS[kindId]) return;
    addNode(kindId, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [screenToFlowPosition, addNode]);

  // "Drag a connection line and drop it on empty canvas to create a
  // node" — the recurring pattern JuanJo called out from n8n/Blueprint-
  // style editors. onConnectEnd fires for every connect-drag regardless
  // of outcome; connectionState.toNode is null exactly when the drop
  // landed on empty canvas rather than an existing handle, which is
  // also true whether the drag started from a source or a target handle
  // (fromHandle.type tells us which, so the eventual edge points the
  // right direction either way).
  const onConnectEnd: OnConnectEnd = useCallback((event, connectionState: FinalConnectionState) => {
    if (connectionState.toNode || !connectionState.fromNode || !connectionState.fromHandle?.type) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const rect = wrapperRef.current?.getBoundingClientRect();
    setConnectDropMenu({
      left: point.clientX - (rect?.left ?? 0),
      top: point.clientY - (rect?.top ?? 0),
      flowPosition: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      sourceId: connectionState.fromNode.id,
      handleType: connectionState.fromHandle.type,
    });
  }, [screenToFlowPosition]);

  const handleConnectDropPick = (kindId: NodeKindId) => {
    if (!connectDropMenu) return;
    const newId = addNode(kindId, connectDropMenu.flowPosition);
    const connection: Connection = connectDropMenu.handleType === "target"
      ? { source: newId, target: connectDropMenu.sourceId, sourceHandle: null, targetHandle: null }
      : { source: connectDropMenu.sourceId, target: newId, sourceHandle: null, targetHandle: null };
    setEdges(eds => addEdge({ ...connection, animated: false, style: { stroke: EDGE_COLOR, strokeWidth: EDGE_WIDTH } }, eds));
    setConnectDropMenu(null);
  };

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

  const addGroupAtViewCenter = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const flowCenter = screenToFlowPosition(center);
    // addNode centers a small node on the click point; a group is much
    // bigger, so center the whole 320x220 box on that same point instead
    // of anchoring its top-left corner there.
    addGroup({ x: flowCenter.x - 160, y: flowCenter.y - 110 });
  };

  const selectedNode = nodes.find((n): n is Node<AgentWorkNodeData> => n.id === selectedId && isExecNode(n));

  const updateSelectedValues = (values: Record<string, string>) => {
    if (!selectedId) return;
    // selectedId is only ever set for exec nodes (groups never open the
    // inspector, see onNodeClick), so isExecNode here is a real
    // narrowing, not just a defensive check.
    setNodes(nds => nds.map(n => n.id === selectedId && isExecNode(n) ? { ...n, data: { ...n.data, values } } : n));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes(nds => nds.filter(n => n.id !== selectedId));
    setEdges(eds => eds.filter(e => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const selectedGroupNode = nodes.find((n): n is Node<AgentWorkGroupData> => n.id === selectedGroupId && n.type === "group");

  const isGroupNode = (n: AgentWorkAnyNode): n is Node<AgentWorkGroupData> => n.type === "group";

  const updateGroupItems = (groupId: string, items: string[]) => {
    setNodes(nds => nds.map(n => n.id === groupId && isGroupNode(n) ? { ...n, data: { ...n.data, items } } : n));
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
    // A group only ships as real fan-out metadata if it actually has
    // items — one with none stays exactly what it's always been, pure
    // canvas organization convertGraphToBackend never sees at all.
    const groupInputs = nodes
      .filter((n): n is Node<AgentWorkGroupData> => n.type === "group")
      .map(n => ({ id: n.id, items: n.data.items ?? [] }));
    const { graph, errors } = convertGraphToBackend(nodes.filter(isExecNode), edges, groupInputs);
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
              onClick={addGroupAtViewCenter}
              title="Group nodes together for visual organization — drag nodes into it"
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: `${spacing.xxs}px ${spacing.sm}px`,
                borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily,
              }}
            >
              <SquareIcon size={11} /> Group
            </button>
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
        <div ref={wrapperRef} style={{ flex: 1, minWidth: 0, position: "relative" }} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            // Clicking inside the canvas — the pane itself or a node —
            // never reached the outside-click listener that closes the
            // Add Node / quick-add menus: React Flow's own pointer
            // handling stops the mousedown from bubbling to document
            // (2026-09-03, JuanJo: "I can actually make [them]
            // disappear... I need to click outside the canvas, it's
            // rather counter intuitive"). onPaneClick/onNodeClick are
            // React Flow's own callbacks, dispatched regardless of that
            // internal stopPropagation, so closing the menus here is
            // reliable everywhere the outside-click listener wasn't.
            onNodeClick={(_e, node) => {
              // Groups get their own, simpler inspector (just the
              // fan-out items list) — not the per-field editor exec
              // nodes use, they have no prompt/tools to configure.
              setSelectedId(node.type === "group" ? null : node.id);
              setSelectedGroupId(node.type === "group" ? node.id : null);
              setShowAddNodeMenu(false); setConnectDropMenu(null);
            }}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={() => { setSelectedId(null); setSelectedGroupId(null); setShowAddNodeMenu(false); setConnectDropMenu(null); }}
            nodeTypes={AGENT_WORK_NODE_TYPES}
            edgeTypes={AGENT_WORK_EDGE_TYPES}
            snapToGrid snapGrid={[GRID_SIZE, GRID_SIZE]}
            defaultEdgeOptions={{ style: { stroke: EDGE_COLOR, strokeWidth: EDGE_WIDTH } }}
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
          {selectedNode && (
            <NodeInspectorAnchor
              node={selectedNode}
              onChange={updateSelectedValues}
              onDelete={deleteSelected}
              onClose={() => setSelectedId(null)}
            />
          )}
          {selectedGroupNode && (
            <GroupInspectorAnchor
              node={selectedGroupNode}
              onChangeItems={items => updateGroupItems(selectedGroupNode.id, items)}
              onClose={() => setSelectedGroupId(null)}
            />
          )}
          {connectDropMenu && (
            <ConnectDropMenu
              left={connectDropMenu.left}
              top={connectDropMenu.top}
              onPick={handleConnectDropPick}
              onClose={() => setConnectDropMenu(null)}
            />
          )}
        </div>
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
