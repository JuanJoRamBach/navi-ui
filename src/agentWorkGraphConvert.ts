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
  saveFile: true, sendMessage: true, apiCall: false, sendMail: true, choosePath: true,
  input: true, output: true, webhookTrigger: true,
};

const TOOL_FOR_KIND: Partial<Record<NodeKindId, string>> = {
  searchWeb: "web_search", readPage: "fetch_page", saveFile: "save_note", sendMessage: "send_to_telegram",
  input: "input", output: "output", choosePath: "choose_path",
};

// Kinds that map to the real `kind` discriminator (dispatcher/
// agent_work.py's _run_node checks this first) plus their own
// structured fields, rather than the legacy `tools: [name]` shape
// TOOL_FOR_KIND produces — send_email needs to/body/subject, which a
// bare tool name has no room for. webhookTrigger needs no fields at all
// (see its own comment at the backendNodes.map call site below) — it's
// here for the same reason, not because it has send_email-shaped data.
const BACKEND_KIND_FOR_NODE_KIND: Partial<Record<NodeKindId, string>> = {
  sendMail: "send_email",
  webhookTrigger: "webhookTrigger",
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
      const backendKind = BACKEND_KIND_FOR_NODE_KIND[kindId];
      if (backendKind === "send_email") {
        // Real structured fields, not a bare prompt. `body` comes from an
        // inlined Write Text box or an upstream edge (same
        // NEEDS_INLINE_TEXT convention sendMessage/saveFile already use
        // below), never a field on this node itself, so it's simply
        // omitted when there's no inlined text — the backend's own
        // `body or prior_context` fallback (dispatcher/agent_work.py)
        // picks up a real upstream edge's output at run time.
        const inlined = literalTextByTarget.get(n.id);
        return {
          id: n.id, kind: backendKind,
          to: values.to ?? "", ...(values.subject ? { subject: values.subject } : {}),
          ...(inlined ? { body: inlined } : {}),
        };
      }
      if (backendKind) {
        // webhookTrigger today — nothing to configure on the node itself
        // (see its own NODE_KINDS entry). dispatcher/agent_work.py never
        // calls _run_node on this kind at all; its output is pre-seeded
        // from the incoming webhook payload before the run starts, so it
        // needs just the bare `kind` discriminator, no prompt/tools/other
        // fields.
        return { id: n.id, kind: backendKind };
      }
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
    if (kindId === "sendMail") {
      if (!("to" in n && n.to?.trim())) {
        errors.push(`"Send Mail To" needs a recipient address.`);
      }
      const hasIncoming = backendEdges.some(e => e.to === n.id);
      if (!("body" in n && n.body) && !hasIncoming) {
        errors.push(`"Send Mail To" has no body — connect a Write Text/Generate with AI node, or type something in it.`);
      }
      continue;
    }
    const isActionKind = kindId === "sendMessage" || kindId === "saveFile" || kindId === "input" || kindId === "output";
    const hasIncoming = backendEdges.some(e => e.to === n.id);
    if (isActionKind && !("prompt" in n && n.prompt?.trim()) && !hasIncoming) {
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

// Reverse of BACKEND_KIND_FOR_NODE_KIND above — a node using the real
// `kind` discriminator (not the legacy `tools` list) maps back via its
// own value, checked separately from KIND_FOR_TOOL.
const CANVAS_KIND_FOR_BACKEND_KIND: Partial<Record<string, NodeKindId>> = {
  send_email: "sendMail",
};

// sendMessage/saveFile/sendMail have no text field of their own on the
// canvas (their real content always arrives via an inlined Write Text
// node or an upstream step — see convertGraphToBackend's own inlining
// logic above); a backend node using one of these with real literal
// content needs that same Write Text node synthesized back in, not a
// value these kinds have nowhere to hold.
const NEEDS_INLINE_TEXT = new Set<NodeKindId>(["sendMessage", "saveFile", "sendMail"]);

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

  // A node with a REAL upstream predecessor already has its live content
  // source — dispatcher/agent_work.py's own node functions all do
  // `prior_context or prompt`, so the node's own literal prompt is a
  // dormant fallback in that case, never actually used unless the whole
  // chain above it produces nothing. Synthesizing a Write Text box for
  // it anyway drew it as an ordinary parallel edge, indistinguishable
  // from the real live one (2026-09-04, JuanJo: caught this exact case
  // — "there is a loose write text that does nothing" — on a real
  // chat-created workflow where send_to_telegram's own static prompt
  // was shown feeding it right alongside the actual AI-generated
  // summary). Only worth showing as its own box when it's genuinely the
  // ONLY content source, matching how a hand-built canvas graph already
  // treats a writeText node feeding an action node with nothing else
  // upstream.
  const nodesWithRealPredecessor = new Set(graph.edges.map(e => e.to));

  graph.nodes.forEach((n, i) => {
    const tools = n.tools ?? [];
    const kindId: NodeKindId =
      n.kind && CANVAS_KIND_FOR_BACKEND_KIND[n.kind] ? CANVAS_KIND_FOR_BACKEND_KIND[n.kind]! :
      tools.length === 1 && KIND_FOR_TOOL[tools[0]] ? KIND_FOR_TOOL[tools[0]]! : "generateAi";
    const x = 40 + i * X_STEP;
    const prompt = n.prompt ?? "";
    // send_email's real content lives in `body`, not `prompt` — this is
    // the one kind whose "content-equivalent source" (used both as this
    // node's own values AND as what gets inlined into a synthesized
    // Write Text box below) isn't the shared `prompt` field.
    const contentSource = kindId === "sendMail" ? (n.body ?? "") : prompt;
    const values: Record<string, string> =
      kindId === "readPage" ? { url: prompt } :
      kindId === "input" ? { value: prompt } :
      kindId === "output" ? { value: prompt, outputType: n.output_type ?? "chat" } :
      kindId === "choosePath" ? { condition: prompt } :
      kindId === "sendMessage" ? { channel: "telegram" } :
      kindId === "saveFile" ? {} :
      kindId === "sendMail" ? { to: n.to ?? "", subject: n.subject ?? "" } :
      { instructions: prompt }; // generateAi, searchWeb

    nodes.push({ id: n.id, type: "agentWorkNode", position: { x, y: Y_MAIN }, data: { kindId, values } });

    if (NEEDS_INLINE_TEXT.has(kindId) && contentSource && !nodesWithRealPredecessor.has(n.id)) {
      const textId = `${n.id}-text`;
      nodes.push({ id: textId, type: "agentWorkNode", position: { x, y: Y_MAIN - 160 }, data: { kindId: "writeText", values: { text: contentSource } } });
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
