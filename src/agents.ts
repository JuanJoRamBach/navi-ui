// Agent Vault client — REST calls for server.py's /agents* (see
// storage/agents.py on the backend). Plain fetch, same shape as
// agentWork.ts/mcpConnections.ts.
import { NAVI_BACKEND_URL } from "./config";

export type AgentOutputType = "chat" | "pdf" | "markdown" | null;

export interface SavedAgent {
  id: string;
  name: string;
  instructions: string;
  tools: string[];
  model: string | null;
  output_type: AgentOutputType;
  created_at: number;
  updated_at: number;
}

export interface SavedAgentInput {
  name: string;
  instructions: string;
  tools: string[];
  model: string | null;
  output_type: AgentOutputType;
}

export async function listAgents(): Promise<SavedAgent[]> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agents`);
  return res.json();
}

export async function createAgent(input: SavedAgentInput): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function updateAgent(id: string, input: SavedAgentInput): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function deleteAgent(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
