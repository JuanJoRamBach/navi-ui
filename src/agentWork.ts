// Agent Work's client — REST calls for workflow definitions and their runs
// (server.py's /agent/workflows*, /agent/runs*; see storage/agent_work.py
// and dispatcher/agent_work.py on the backend). Plain fetch, no socket —
// unlike Dev Slate, nothing here needs a live connection.
import { NAVI_BACKEND_URL } from "./config";

export interface WorkflowGraphNode {
  id: string;
  label?: string;
  prompt?: string;
  role?: string;
  tools?: string[];
  // Only meaningful on an Output node — "pdf" renders its text to a real
  // PDF file (dispatcher/agent_work.py's _run_output_node), which a
  // following send_to_telegram step sends as an attachment.
  output_type?: string;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  // Only meaningful leaving a Choose a Path node — the branch this edge
  // represents (dispatcher/agent_work.py's _run_choose_path_node picks
  // one label per run; every OTHER edge out of that node gets pruned).
  label?: string;
}

// Fan-out ("sub-flow") metadata — dispatcher/agent_work.py runs every
// node in node_ids once per entry in items instead of once total,
// substituting "{{item}}" into that node's prompt each pass (2026-09-03).
// Optional and usually absent: a canvas group with no items list is
// pure visual organization and never produces one of these at all.
export interface WorkflowGraphGroup {
  id: string;
  node_ids: string[];
  items: string[];
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  groups?: WorkflowGraphGroup[];
}

export type WorkflowTrigger =
  | { type: "manual" }
  // remaining_runs: how many more times this fires. null (or the field
  // absent) means "no expiration set" — keeps firing until removed.
  // Real prior art for this shape: Quartz Scheduler's SimpleTrigger.
  // repeatCount (an integer, or a sentinel for unlimited); null here
  // instead of a magic number is the more idiomatic REST/JSON
  // convention (e.g. GitLab's own token-expiration API uses null the
  // same way) — see dispatcher/agent_work.py's check_due_workflows for
  // the backend side.
  | { type: "scheduled"; interval_seconds?: number; next_run_at?: number | null; remaining_runs?: number | null };

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string | null;
  graph: WorkflowGraph;
  trigger: WorkflowTrigger;
  // The Agent Work Chat exchange that built this workflow (null for one
  // built by hand, node-by-node, with no chat involved) — Agent Vault
  // reads this as the starting "Instructions" text when starred.
  creation_transcript: string | null;
  created_at: number;
  updated_at: number;
}

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface AgentRun {
  id: string;
  workflow_id: string | null;
  status: RunStatus;
  trigger_source: "manual" | "scheduled";
  started_at: number;
  finished_at: number | null;
  error: string | null;
}

export interface AgentRunStep {
  id: string;
  run_id: string;
  node_id: string;
  seq: number;
  status: RunStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agent/workflows`);
  return res.json();
}

export async function createWorkflow(
  name: string, description: string | null, graph: WorkflowGraph, trigger: WorkflowTrigger,
): Promise<WorkflowDefinition> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agent/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, graph, trigger }),
  });
  return res.json();
}

// Fired after a manual creation (see App.tsx's "agents" popover form) so
// AgentWorkWorkflows' list refreshes without a shared store just for
// this one signal — the same "plain window event, no new state layer"
// shortcut is fine here since it's a single one-way notification, not
// ongoing shared state.
export const WORKFLOW_CREATED_EVENT = "agent-workflow-created";

export async function getWorkflow(workflowId: string): Promise<WorkflowDefinition> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agent/workflows/${encodeURIComponent(workflowId)}`);
  return res.json();
}

// Star/unstar a workflow into the Agent Vault — a reference (server.py
// stores the agent's workflow_id, not a copy of the graph), so it's a
// pure toggle: starring twice is a no-op (the route reuses the existing
// entry), unstarring removes it. See agents.ts's SavedAgent.workflow_id.
export async function starWorkflow(workflowId: string): Promise<{ id: string } & Record<string, unknown>> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agent/workflows/${encodeURIComponent(workflowId)}/star`, { method: "POST" });
  return res.json();
}

export async function unstarWorkflow(workflowId: string): Promise<boolean> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/agent/workflows/${encodeURIComponent(workflowId)}/star`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteWorkflow(workflowId: string): Promise<boolean> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/agent/workflows/${encodeURIComponent(workflowId)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    // Network failure (server down, unreachable) — same "return false,
    // let the caller decide how to surface it" shape as a non-2xx
    // response, rather than throwing and leaving the confirm dialog in
    // an ambiguous state.
    return false;
  }
}

export async function runWorkflowNow(workflowId: string): Promise<{ run_id?: string; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agent/workflows/${encodeURIComponent(workflowId)}/run`, { method: "POST" });
  return res.json();
}

export async function listRuns(workflowId?: string, status?: string): Promise<AgentRun[]> {
  const params = new URLSearchParams();
  if (workflowId) params.set("workflow_id", workflowId);
  if (status) params.set("status", status);
  const qs = params.toString();
  const res = await fetch(`${NAVI_BACKEND_URL}/agent/runs${qs ? `?${qs}` : ""}`);
  return res.json();
}

export async function getRunSteps(runId: string): Promise<AgentRunStep[]> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agent/runs/${encodeURIComponent(runId)}/steps`);
  return res.json();
}
