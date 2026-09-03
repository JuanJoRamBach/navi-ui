// MCP connections client — REST calls for server.py's /mcp/connections*
// (see dispatcher/mcp_client.py for the actual security model this sits
// on top of: rug-pull hash-pinning, tool-poisoning sanitization, the
// read/write confirmation gate). Plain fetch, same shape as agentWork.ts.
import { NAVI_BACKEND_URL } from "./config";

export type MCPTransport = "stdio" | "http";

export interface MCPConnectionTool {
  name: string;
  read_only: boolean;
  approved_at: number;
}

export interface MCPConnection {
  name: string;
  transport: MCPTransport;
  connected: boolean;
  tools: MCPConnectionTool[];
}

export interface MCPDiscoveredTool {
  name: string;
  description: string;
  read_only: boolean;
  status: "approved" | "new" | "changed";
}

// A real, searchable result from the official MCP Registry
// (tools/mcp_marketplace.py's proxy) — enough to pre-fill the existing
// connect form, not a full server.json.
export interface MCPMarketplaceResult {
  name: string;
  title: string;
  description: string;
  repository_url: string | null;
  transport: MCPTransport;
  requires_auth: boolean;
  url?: string;
  command?: string;
  args?: string[];
}

export async function searchMCPMarketplace(query: string): Promise<MCPMarketplaceResult[]> {
  const res = await fetch(`${NAVI_BACKEND_URL}/mcp/marketplace/search?q=${encodeURIComponent(query)}`);
  const data: { results?: MCPMarketplaceResult[]; error?: string } = await res.json();
  return data.results ?? [];
}

export async function listMCPConnections(): Promise<MCPConnection[]> {
  const res = await fetch(`${NAVI_BACKEND_URL}/mcp/connections`);
  return res.json();
}

export async function createMCPConnection(config: {
  name: string; transport: MCPTransport;
  command?: string; args?: string[]; url?: string; auth_header?: string;
}): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/mcp/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function deleteMCPConnection(name: string): Promise<boolean> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/mcp/connections/${encodeURIComponent(name)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// Real handshake + tool discovery — everything "new" gets auto-approved
// server-side (first trust, since the user just configured this
// connection themselves); "changed" tools (the rug-pull case) come back
// unapproved for approveMCPTools below to handle explicitly.
export async function connectMCP(name: string): Promise<{ tools?: MCPDiscoveredTool[]; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/mcp/connections/${encodeURIComponent(name)}/connect`, { method: "POST" });
  return res.json();
}

export async function approveMCPTools(name: string, toolNames: string[]): Promise<{ approved?: string[]; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/mcp/connections/${encodeURIComponent(name)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool_names: toolNames }),
  });
  return res.json();
}
