// Sources batch-dispatch client — REST calls for server.py's /sources*
// routes (see storage/sources.py + dispatcher/source_fetch.py on the
// backend). Plain fetch, same shape as agents.ts/agentWork.ts.
import { NAVI_BACKEND_URL } from "./config";

export type SourceDocumentStatus = "pending_review" | "accepted" | "rejected" | "failed" | "duplicate";

// The grounding record the dispatcher attaches to every distilled
// document. `verified` are claims whose quote was found word-for-word in
// the page; `disputed` are ones safeguard-20b judged unsupported or
// contradicted; `unchecked` are ones it could not be asked about at all,
// which is deliberately NOT the same as unsupported.
export interface GroundingSummary {
  points: number;
  verified: number;
  paraphrase: number;
  unlocated: number;
  grounded_ratio: number;
  needs_review: boolean;
  disputed?: number;
  unchecked?: number;
}

export interface SourceKeyPoint {
  claim: string;
  quote: string;
  grounding?: {
    status: "verified" | "paraphrase" | "unlocated";
    ratio: number;
    source_text: string | null;
    verdict: { verdict: string; reason: string } | null;
  };
}

// tools/source_document.py's schema. Every field can be missing on an
// older row, so treat all of it as optional at the boundary.
export interface StructuredSource {
  about?: string;
  summary?: string;
  topics?: string[];
  covers?: string[];
  caveats?: string[];
  key_points?: SourceKeyPoint[];
  grounding_summary?: GroundingSummary;
  source?: { url?: string; title?: string; author?: string; published?: string };
}

export interface InspectedSource {
  url: string;
  domain: string;
  title: string;
  status: string;
  created_at: number;
  times: number;
}

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
  // Added 2026-09-13 with the URL-driven rebuild. `document` is the
  // structured distillation as a JSON string; `markdown` is the cleaned
  // page it came from, kept so the structure is a VIEW of the source
  // rather than a replacement for it.
  document?: string | null;
  markdown?: string | null;
  extractor?: string | null;
  truncated?: number | null;
  fetch_error?: string | null;
  grounding?: string | null;
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

// URL-driven ingest (2026-09-13) — replaces startBatchDispatch's search
// terms. The user pastes URLs; the dispatcher fetches, distils and
// grounds each one. See dispatcher/source_ingest.py.
export async function startSourceIngest(urls: string[]): Promise<{ started?: boolean; urls?: number; error?: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  return res.json();
}

// Every URL already read. Replaces the old client-side Trusted Sites
// list, which existed to restrict a search that no longer happens.
export async function listInspectedSources(): Promise<InspectedSource[]> {
  const res = await fetch(`${NAVI_BACKEND_URL}/sources/inspected`);
  const data = await res.json();
  return data.inspected ?? [];
}

// Parses the stored JSON defensively — a malformed or missing document
// must render as "no distillation yet", never throw and blank the panel.
export function parseStructuredSource(doc: SourceDocument): StructuredSource | null {
  if (!doc.document) return null;
  try {
    const parsed = JSON.parse(doc.document);
    return parsed && typeof parsed === "object" ? parsed as StructuredSource : null;
  } catch {
    return null;
  }
}
