import type { Node, Edge } from "@xyflow/react";
import type { AgentWorkNodeData } from "./AgentWorkGraphNode";
import type { WorkflowGraph } from "./agentWork";
import { NODE_KINDS, type NodeKindId } from "./agentWorkNodeKinds";
import { neutral } from "./tokens";

// Which node kinds dispatcher/agent_work.py's node-function library
// actually knows how to run (2026-09-02 build) — everything else gets a
// clear "not wired up yet" error at save time instead of silently
// creating a workflow that fails the moment it runs. Keep this in sync
// with SINGLE_TOOL_NODE_HANDLERS in dispatcher/agent_work.py; there's no
// shared source of truth across the language boundary, so a real
// mismatch here means Save either over- or under-restricts what it lets
// through.
const BACKEND_READY: Record<NodeKindId, boolean> = {
  writeText: true, generateAi: true, searchWeb: true, readPage: true,
  saveFile: true, sendMessage: true, apiCall: false, sendMail: false, choosePath: true,
  input: true, output: true,
};

const TOOL_FOR_KIND: Partial<Record<NodeKindId, string>> = {
  searchWeb: "web_search", readPage: "fetch_page", saveFile: "save_note", sendMessage: "send_to_telegram",
  input: "input", output: "output", choosePath: "choose_path",
};

export interface GraphConversionResult {
  graph: WorkflowGraph | null;
  errors: string[];
}

// One entry per canvas group that actually has a fan-out items list —
// see AgentWorkGraphEditor.tsx's GroupInspector, the only place `items`
// gets set. A group with none never reaches here at all (filtered by
// the GraphCanvas call site), so this input is already "real fan-out
// groups only," not every group on the canvas.
export interface GraphGroupInput {
  id: string;
  items: string[];
}

// Turns the canvas (React Flow nodes/edges, editor-only field names like
// "instructions"/"url") into storage/agent_work.py's real graph shape
// ({nodes:[{id,prompt,tools?}], edges:[{from,to}], groups?:[{id,node_ids,items}]})
// — the same node/edge shape the chat tool's create_workflow builds,
// plus groups (2026-09-03, "let's properly make the sub flows, not just
// an idea") — dispatcher/agent_work.py runs a group's member nodes once
// per item instead of once total. writeText nodes have no backend node
// of their own: a literal value someone already typed at build time
// isn't something to re-generate at run time, so it's inlined directly
// into whatever node it feeds (matching exactly how a chat-created
// send_to_telegram step's own literal prompt already works) rather than
// becoming its own step.
export function convertGraphToBackend(
  nodes: Node<AgentWorkNodeData>[], edges: Edge[], groups: GraphGroupInput[] = [],
): GraphConversionResult {
  if (nodes.length === 0) {
    return { graph: null, errors: ["Add at least one node before saving."] };
  }

  const errors: string[] = [];
  for (const n of nodes) {
    const kind = NODE_KINDS[n.data.kindId];
    if (!BACKEND_READY[n.data.kindId]) {
      errors.push(`"${kind.label}" isn't wired to NAVI's backend yet.`);
    } else if (n.data.kindId === "sendMessage" && n.data.values.channel && n.data.values.channel !== "telegram") {
      errors.push(`"Send Message To" only supports Telegram so far — Discord isn't wired up yet.`);
    }
  }
  if (errors.length > 0) return { graph: null, errors };

  const writeTextIds = new Set<string>();
  const literalTextByTarget = new Map<string, string>();
  for (const n of nodes) {
    if (n.data.kindId === "writeText") {
      writeTextIds.add(n.id);
      const outgoing = edges.find(e => e.source === n.id);
      if (outgoing) literalTextByTarget.set(outgoing.target, n.data.values.text ?? "");
    }
  }

  const backendNodes = nodes
    .filter(n => !writeTextIds.has(n.id))
    .map(n => {
      const { kindId, values } = n.data;
      let prompt =
        kindId === "generateAi" ? (values.instructions ?? "") :
        kindId === "searchWeb" ? (values.instructions ?? "") :
        kindId === "readPage" ? (values.url ?? "") :
        kindId === "input" ? (values.value ?? "") :
        kindId === "output" ? (values.value ?? "") :
        kindId === "choosePath" ? (values.condition ?? "") : "";
      const inlined = literalTextByTarget.get(n.id);
      if (inlined) prompt = prompt ? `${prompt}\n\n${inlined}` : inlined;
      const tool = TOOL_FOR_KIND[kindId];
      // output_type only means anything to an Output node (renders to a
      // real PDF file when set to "pdf" — dispatcher/agent_work.py's
      // _run_output_node); omitted entirely for every other kind rather
      // than sending a stray blank field.
      const outputType = kindId === "output" ? values.outputType : undefined;
      return {
        id: n.id, prompt, ...(tool ? { tools: [tool] } : {}),
        ...(outputType ? { output_type: outputType } : {}),
      };
    });

  const backendEdges = edges
    .filter(e => !writeTextIds.has(e.source) && !writeTextIds.has(e.target))
    .map(e => {
      const label = (e.data as { label?: string } | undefined)?.label;
      return { from: e.source, to: e.target, ...(label ? { label } : {}) };
    });

  // A node whose only content source was an inlined writeText that was
  // left blank silently ships an empty action — catch it now, not as a
  // confusing empty send later.
  for (const n of backendNodes) {
    const kindId = nodes.find(x => x.id === n.id)!.data.kindId;
    const isActionKind = kindId === "sendMessage" || kindId === "saveFile" || kindId === "input" || kindId === "output";
    const hasIncoming = backendEdges.some(e => e.to === n.id);
    if (isActionKind && !n.prompt.trim() && !hasIncoming) {
      errors.push(`"${NODE_KINDS[kindId].label}" has no content — connect a Write Text/Generate with AI node, or type something in it.`);
    }
    // A Choose a Path node with no labeled outgoing edge has nothing for
    // the dispatcher to pick between at run time — same "catch it at
    // save time" principle as an empty action node above.
    if (kindId === "choosePath") {
      const hasLabeledBranch = backendEdges.some(e => e.from === n.id && e.label);
      if (!hasLabeledBranch) {
        errors.push(`"Choose a Path" needs at least one labeled outgoing connection — click an edge leaving it to name a branch.`);
      }
    }
  }
  if (errors.length > 0) return { graph: null, errors };

  const backendGroups = groups
    .map(g => ({
      id: g.id, items: g.items,
      node_ids: nodes.filter(n => n.parentId === g.id && !writeTextIds.has(n.id)).map(n => n.id),
    }))
    // A group with items but nothing dragged into it yet is a no-op —
    // skip it rather than shipping empty fan-out metadata.
    .filter(g => g.node_ids.length > 0);

  return {
    graph: { nodes: backendNodes, edges: backendEdges, ...(backendGroups.length ? { groups: backendGroups } : {}) },
    errors: [],
  };
}

// Reverse of TOOL_FOR_KIND above — a backend node's single tool name maps
// back to the canvas kind that produces it. Kept in sync by hand, same
// caveat as BACKEND_READY: no shared source of truth across the language
// boundary.
const KIND_FOR_TOOL: Partial<Record<string, NodeKindId>> = {
  web_search: "searchWeb", fetch_page: "readPage", save_note: "saveFile",
  send_to_telegram: "sendMessage", input: "input", output: "output", choose_path: "choosePath",
};

// sendMessage/saveFile have no text field of their own on the canvas
// (their real content always arrives via an inlined Write Text node or an
// upstream step — see convertGraphToBackend's own inlining logic above);
// a backend node using one of these tools with a real literal prompt
// needs that same Write Text node synthesized back in, not a value these
// kinds have nowhere to hold.
const NEEDS_INLINE_TEXT = new Set<NodeKindId>(["sendMessage", "saveFile"]);

const EDGE_STYLE = { stroke: neutral.textPrimary, strokeWidth: 3 };

// Turns storage/agent_work.py's real graph shape back into canvas
// nodes/edges — the other direction of convertGraphToBackend, used to
// show a workflow that Agent Work Chat (or any other non-canvas path)
// created as actual nodes, not just an entry in the Workflows list
// (2026-09-03, JuanJo: "why is the work chat separated from the visual
// nodes... I specifically told you to create the nodes"). Every node
// with no tools, or a tool this palette doesn't recognize, or more than
// one tool becomes a "Generate with AI" node — AGENT_WORK_CHAT.md's own
// brief never produces more than one tool per step today, so this is a
// graceful fallback, not the expected case. Layout is a plain left-to-
// right chain in `graph.nodes`' own order — correct for every graph the
// chat can currently produce (always linear; see tools/workflows.py's
// create_workflow), not a general graph layout algorithm.
export function convertBackendToGraph(graph: WorkflowGraph): { nodes: Node<AgentWorkNodeData>[]; edges: Edge[] } {
  const nodes: Node<AgentWorkNodeData>[] = [];
  const edges: Edge[] = [];
  const X_STEP = 320;
  const Y_MAIN = 140;

  graph.nodes.forEach((n, i) => {
    const tools = n.tools ?? [];
    const kindId: NodeKindId = tools.length === 1 && KIND_FOR_TOOL[tools[0]] ? KIND_FOR_TOOL[tools[0]]! : "generateAi";
    const x = 40 + i * X_STEP;
    const prompt = n.prompt ?? "";
    const values: Record<string, string> =
      kindId === "readPage" ? { url: prompt } :
      kindId === "input" ? { value: prompt } :
      kindId === "output" ? { value: prompt, outputType: n.output_type ?? "chat" } :
      kindId === "choosePath" ? { condition: prompt } :
      kindId === "sendMessage" ? { channel: "telegram" } :
      kindId === "saveFile" ? {} :
      { instructions: prompt }; // generateAi, searchWeb

    nodes.push({ id: n.id, type: "agentWorkNode", position: { x, y: Y_MAIN }, data: { kindId, values } });

    if (NEEDS_INLINE_TEXT.has(kindId) && prompt) {
      const textId = `${n.id}-text`;
      nodes.push({ id: textId, type: "agentWorkNode", position: { x, y: Y_MAIN - 160 }, data: { kindId: "writeText", values: { text: prompt } } });
      edges.push({ id: `e-${textId}-${n.id}`, source: textId, target: n.id, animated: false, style: EDGE_STYLE });
    }
  });

  for (const e of graph.edges) {
    edges.push({
      id: `e-${e.from}-${e.to}`, source: e.from, target: e.to, animated: false, style: EDGE_STYLE,
      ...(e.label ? { data: { label: e.label } } : {}),
    });
  }

  return { nodes, edges };
}
