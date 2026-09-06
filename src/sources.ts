// Sources batch-dispatch client — REST calls for server.py's /sources*
// routes (see storage/sources.py + dispatcher/source_fetch.py on the
// backend). Plain fetch, same shape as agents.ts/agentWork.ts.
import { NAVI_BACKEND_URL } from "./config";

export type SourceDocumentStatus = "pending_review" | "accepted" | "rejected";

export interface SourceDocument {
  id: string;
  batch_id: string;
  term: string;
  title: string;
  url: string;
  domain: string;
  filen_path: string | null;
  status: SourceDocumentStatus;
  // Set only for a document the dispatcher auto-rejected before a human
  // ever saw it (tools/registry.py's content-quality guard) — explains
  // WHY, instead of the term just having zero documents with no trace.
  reason: string | null;
  created_at: number;
}

export interface SourceBatch {
  id: string;
  status: "running" | "done" | "error";
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

export async function startBatchDispatch(terms: string[], trustedSites: string[]): Promise<{ started?: boolean; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ terms, trusted_sites: trustedSites }),
  });
  return res.json();
}

export async function getBatchStatus(): Promise<{ batch: SourceBatch | null }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources/status`);
  return res.json();
}

export async function listSourceDocuments(): Promise<SourceDocument[]> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources`);
  return res.json();
}

// `content` is null (not thrown as an error) when the document's own
// filen_path was never set or the Filen read-back failed — the caller
// should render that as "content unavailable," not a fetch failure; the
// metadata fields are still real either way.
export async function getSourceDocument(id: string): Promise<SourceDocument & { content: string | null }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources/${encodeURIComponent(id)}`);
  return res.json();
}

export async function reviewSourceDocument(id: string, status: "accepted" | "rejected"): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources/${encodeURIComponent(id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return res.json();
}

export async function deleteSourceDocument(id: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
  return res.json();
}
