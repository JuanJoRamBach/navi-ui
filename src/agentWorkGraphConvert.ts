import type { Node, Edge } from "@xyflow/react";
import type { AgentWorkNodeData } from "./AgentWorkGraphNode";
import type { WorkflowGraph } from "./agentWork";
import { NODE_KINDS, type NodeKindId } from "./agentWorkNodeKinds";

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
  saveFile: true, sendMessage: true, apiCall: false, sendMail: false, choosePath: false,
};

const TOOL_FOR_KIND: Partial<Record<NodeKindId, string>> = {
  searchWeb: "web_search", readPage: "fetch_page", saveFile: "save_note", sendMessage: "send_to_telegram",
};

export interface GraphConversionResult {
  graph: WorkflowGraph | null;
  errors: string[];
}

// Turns the canvas (React Flow nodes/edges, editor-only field names like
// "instructions"/"url") into storage/agent_work.py's real graph shape
// ({nodes:[{id,prompt,tools?}], edges:[{from,to}]}) — the same shape
// the chat tool's create_workflow builds, just hand-authored instead of
// LLM-authored. writeText nodes have no backend node of their own: a
// literal value someone already typed at build time isn't something to
// re-generate at run time, so it's inlined directly into whatever node
// it feeds (matching exactly how a chat-created send_to_telegram step's
// own literal prompt already works) rather than becoming its own step.
export function convertGraphToBackend(nodes: Node<AgentWorkNodeData>[], edges: Edge[]): GraphConversionResult {
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
        kindId === "readPage" ? (values.url ?? "") : "";
      const inlined = literalTextByTarget.get(n.id);
      if (inlined) prompt = prompt ? `${prompt}\n\n${inlined}` : inlined;
      const tool = TOOL_FOR_KIND[kindId];
      return { id: n.id, prompt, ...(tool ? { tools: [tool] } : {}) };
    });

  const backendEdges = edges
    .filter(e => !writeTextIds.has(e.source) && !writeTextIds.has(e.target))
    .map(e => ({ from: e.source, to: e.target }));

  // A node whose only content source was an inlined writeText that was
  // left blank silently ships an empty action — catch it now, not as a
  // confusing empty send later.
  for (const n of backendNodes) {
    const kindId = nodes.find(x => x.id === n.id)!.data.kindId;
    const isActionKind = kindId === "sendMessage" || kindId === "saveFile";
    const hasIncoming = backendEdges.some(e => e.to === n.id);
    if (isActionKind && !n.prompt.trim() && !hasIncoming) {
      errors.push(`"${NODE_KINDS[kindId].label}" has no content — connect a Write Text/Generate with AI node, or type something in it.`);
    }
  }
  if (errors.length > 0) return { graph: null, errors };

  return { graph: { nodes: backendNodes, edges: backendEdges }, errors: [] };
}
