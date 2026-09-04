import { Fragment, useEffect, useState } from "react";
import {
  XIcon, MarkGithubIcon, MailIcon, ChecklistIcon, CommentDiscussionIcon, NoteIcon,
  LinkIcon, CheckCircleFillIcon, PlusIcon, SearchIcon,
} from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import {
  listMCPConnections, createMCPConnection, connectMCP, deleteMCPConnection, searchMCPMarketplace,
  type MCPConnection, type MCPMarketplaceResult,
} from "./mcpConnections";

// A connect target — always a live MCP Registry result now (2026-09-04:
// the old hand-maintained SERVICE_CATALOG is gone, "Core" below is just
// a curated set of registry searches). credentialsUrl, when present, is
// the result's own repository link — there's no per-service "get a
// token from X's settings page" link anymore since nothing here is
// hand-verified against a real first-party server; the user reviews the
// result the same way for Core as for a general Browse search.
interface ConnectTarget { id: string; label: string; credentialsUrl?: string }

// The full-screen "over all the UI" overlay JuanJo asked for — Profile
// button's Connections option, not another corner popover (2026-09-03).
//
// Core (2026-09-04 redesign): these five terms are searched against the
// live MCP Registry the same way a manual Browse search is — NOT a
// hand-verified list of official server URLs the way the old
// SERVICE_CATALOG was. That's a real, deliberate trade: convenience
// (these five show up pre-searched instead of the user typing them)
// over certainty (there's no guarantee the top hit for "slack" is
// Slack's own official server rather than a third-party community one —
// same trust level as any other registry result, just curated by
// keyword). The user still reviews title/description/repo link in
// ConnectForm before connecting, same step as any Browse result.
const CORE_ICON: Record<string, typeof MarkGithubIcon> = {
  github: MarkGithubIcon,
  "google workspace": MailIcon,
  jira: ChecklistIcon,
  slack: CommentDiscussionIcon,
  notion: NoteIcon,
};
const CORE_TERMS = Object.keys(CORE_ICON);

const CARD_BG = "rgba(255,255,255,0.05)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.08)";

function monogram(title: string): string {
  return (title.trim()[0] || "?").toUpperCase();
}

function ConnectForm({ serviceLabel, credentialsUrl, initial, onCancel, onSubmit, submitting, error }: {
  serviceLabel: string; credentialsUrl?: string; submitting: boolean; error: string | null;
  // Pre-fills the form from a marketplace result's real transport info —
  // the user still reviews/edits before submitting, never a silent
  // one-click connect. Marketplace results are already filtered to
  // http-only server-side, so `initial` never carries stdio.
  initial?: { url?: string };
  onCancel: () => void;
  onSubmit: (config: { url: string; authHeader: string }) => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [authHeader, setAuthHeader] = useState("");

  const fieldStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
    padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: 2 };

  return (
    <div style={{ gridColumn: "1 / -1", padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.sm }}>
      <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
        Pulled from the MCP Registry — review before connecting{credentialsUrl ? (
          <>
            , or check {serviceLabel}'s repository first:{" "}
            <a href={credentialsUrl} target="_blank" rel="noreferrer" style={{ color: neutral.textPrimary }}>
              Open repository <LinkIcon size={10} />
            </a>
          </>
        ) : "."}{" "}Add an access token below if the server needs one.
      </div>

      <div>
        <div style={labelStyle}>Server URL</div>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/mcp" style={fieldStyle} />
      </div>

      <div>
        <div style={labelStyle}>Access token (optional)</div>
        <input type="password" value={authHeader} onChange={e => setAuthHeader(e.target.value)} placeholder="Bearer …" style={fieldStyle} />
      </div>

      {error && <div style={{ fontSize: fontSize.xxs, color: "#e05a4a" }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing.xs, marginTop: spacing.xxs }}>
        <button
          onClick={onCancel} disabled={submitting}
          style={{
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent", color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xs, fontFamily,
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ url, authHeader })}
          disabled={submitting || !url.trim()}
          style={{
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid #3ecf8e55",
            background: "#3ecf8e15", color: "#3ecf8e", cursor: submitting ? "default" : "pointer",
            fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily, opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}

// One registry result, either from a Core curated search or a general
// Browse search — same card either way (2026-09-04 redesign): icon left,
// title + Connect/Disconnect on one line to its right, description
// below, then a Hosted/requirements line. Two per row via the grid
// container in ConnectionsOverlay below; spanFull lets an open
// ConnectForm take the full width instead of being squeezed into one
// half-width column.
function RegistryCard({ icon, title, description, hostedLabel, requiresAuth, connection, spanFull, onOpenForm, onDisconnect }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  hostedLabel: string;
  requiresAuth: boolean;
  connection: MCPConnection | undefined;
  spanFull: boolean;
  onOpenForm: () => void;
  onDisconnect: () => void;
}) {
  const connected = connection?.connected ?? false;
  const accent = CANVAS_ACCENT.agentWork.color;
  const smallButtonStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0,
    padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
  };
  return (
    <div style={{
      gridColumn: spanFull ? "1 / -1" : undefined,
      background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm,
      padding: spacing.sm, display: "flex", gap: spacing.sm, alignItems: "flex-start", minWidth: 0,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: radius.xs, background: "rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        color: neutral.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.xs }}>
          <div style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary, minWidth: 0 }}>{title}</div>
          {connected ? (
            <button onClick={onDisconnect} style={{ ...smallButtonStyle, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: neutral.textFaint }}>
              Disconnect
            </button>
          ) : (
            <button onClick={onOpenForm} style={{ ...smallButtonStyle, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: neutral.textPrimary, fontWeight: fontWeight.medium }}>
              <PlusIcon size={10} /> Connect
            </button>
          )}
        </div>
        {description && <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.4 }}>{description}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fontSize.xxs, color: connected ? "#3ecf8e" : neutral.textFaint }}>
          {connected && <CheckCircleFillIcon size={10} />}
          <span>{connected ? `Connected · ${connection?.tools.length ?? 0} tool${connection?.tools.length === 1 ? "" : "s"}` : hostedLabel}</span>
          {requiresAuth && !connected && <span style={{ color: accent }}>· needs a token</span>}
        </div>
      </div>
    </div>
  );
}

export function ConnectionsOverlay({ onClose }: { onClose: () => void }) {
  const [connections, setConnections] = useState<MCPConnection[] | null>(null);
  const [openFormFor, setOpenFormFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // General Browse search (2026-09-04) — live, debounced, no button/Enter
  // required (JuanJo: "it should automatically update as I write").
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceResults, setMarketplaceResults] = useState<MCPMarketplaceResult[] | null>(null);
  const [marketplaceSearching, setMarketplaceSearching] = useState(false);

  // Core (2026-09-04) — five fixed registry searches run once on open,
  // independent of the Browse box above. See CORE_ICON's own comment for
  // why this is "curated search," not a verified-official list.
  const [coreResults, setCoreResults] = useState<Record<string, MCPMarketplaceResult | null>>({});

  const refresh = () => { listMCPConnections().then(setConnections).catch(() => setConnections([])); };
  useEffect(refresh, []);

  useEffect(() => {
    CORE_TERMS.forEach(term => {
      searchMCPMarketplace(term)
        .then(results => setCoreResults(prev => ({ ...prev, [term]: results[0] ?? null })))
        .catch(() => setCoreResults(prev => ({ ...prev, [term]: null })));
    });
  }, []);

  const runMarketplaceSearch = async (query: string) => {
    setMarketplaceSearching(true);
    try {
      setMarketplaceResults(await searchMCPMarketplace(query));
    } catch {
      setMarketplaceResults([]);
    } finally {
      setMarketplaceSearching(false);
    }
  };

  // Debounced live search — fires 400ms after the last keystroke,
  // including once immediately on mount (empty query), which is what
  // populates the section with real results before the user types
  // anything at all.
  useEffect(() => {
    const handle = setTimeout(() => { runMarketplaceSearch(marketplaceQuery.trim()); }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceQuery]);

  const byName = new Map(connections?.map(c => [c.name, c]) ?? []);

  const handleConnect = async (
    target: ConnectTarget,
    form: { url: string; authHeader: string },
  ) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createMCPConnection({
        name: target.id, transport: "http",
        url: form.url.trim(),
        auth_header: form.authHeader.trim() || undefined,
      });
      if (created.error) {
        setFormError(created.error);
        return;
      }
      const result = await connectMCP(target.id);
      if (result.error) {
        setFormError(result.error);
        return;
      }
      setOpenFormFor(null);
      refresh();
    } catch {
      setFormError("Couldn't reach NAVI — check it's running.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    await deleteMCPConnection(id);
    refresh();
  };

  const renderResult = (result: MCPMarketplaceResult, icon: React.ReactNode) => {
    const target: ConnectTarget = { id: result.name, label: result.title, credentialsUrl: result.repository_url ?? undefined };
    const isOpen = openFormFor === result.name;
    // A plain wrapping <div> here would make grid-column a no-op — that
    // CSS property only does anything on a DIRECT child of the grid
    // container, and a wrapper would put one level between them. Fragment
    // keeps both RegistryCard and (when open) ConnectForm as real direct
    // grid children, so ConnectForm's own "span both columns" style
    // actually takes effect instead of being squeezed into one column.
    return (
      <Fragment key={result.name}>
        <RegistryCard
          icon={icon} title={result.title} description={result.description}
          hostedLabel="Hosted" requiresAuth={result.requires_auth}
          connection={byName.get(result.name)} spanFull={isOpen}
          onOpenForm={() => { setOpenFormFor(result.name); setFormError(null); }}
          onDisconnect={() => handleDisconnect(result.name)}
        />
        {isOpen && (
          <ConnectForm
            serviceLabel={result.title} credentialsUrl={result.repository_url ?? undefined}
            initial={{ url: result.url }}
            submitting={submitting} error={formError}
            onCancel={() => setOpenFormFor(null)}
            onSubmit={form => handleConnect(target, form)}
          />
        )}
      </Fragment>
    );
  };

  const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing.xs };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: spacing.lg,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(760px, 95vw)", maxHeight: "85vh", display: "flex", flexDirection: "column",
          background: neutral.surfaceSolid, borderRadius: radius.md, border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)", fontFamily,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: spacing.md, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
        }}>
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>Connections</span>
          <button
            onClick={onClose} aria-label="Close"
            style={{ display: "flex", background: "none", border: "none", color: neutral.textMuted, cursor: "pointer" }}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.md }}>
          {connections === null ? (
            <div style={{ fontSize: fontSize.xs, color: neutral.textFaint, textAlign: "center", padding: spacing.lg }}>Loading…</div>
          ) : (
            <>
              <div>
                <div style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em", marginBottom: spacing.xs }}>
                  CORE
                </div>
                <div style={gridStyle}>
                  {CORE_TERMS.map(term => {
                    const result = coreResults[term];
                    if (result === undefined) {
                      return (
                        <div key={term} style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm, padding: spacing.sm, fontSize: fontSize.xxs, color: neutral.textFaint }}>
                          Looking for {term}…
                        </div>
                      );
                    }
                    if (result === null) return null; // no registry match for this term — just omitted, not an error
                    const Icon = CORE_ICON[term];
                    return renderResult(result, <Icon size={16} />);
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em", marginBottom: spacing.xs }}>
                  BROWSE — MCP REGISTRY
                </div>
                <div style={{ position: "relative", marginBottom: spacing.xs }}>
                  <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", display: "flex" }}>
                    <SearchIcon size={11} fill={neutral.textFaint} />
                  </span>
                  <input
                    value={marketplaceQuery}
                    onChange={e => setMarketplaceQuery(e.target.value)}
                    placeholder="Search — e.g. jira, asana, linear… (updates as you type)"
                    style={{
                      width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
                      padding: `${spacing.xxs}px ${spacing.xs}px ${spacing.xxs}px 26px`, boxSizing: "border-box",
                    }}
                  />
                </div>
                {marketplaceResults === null ? (
                  <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xs}px 0` }}>
                    {marketplaceSearching ? "Searching…" : "Loading real, live results from the official MCP Registry…"}
                  </div>
                ) : marketplaceResults.length === 0 ? (
                  <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xs}px 0` }}>No results.</div>
                ) : (
                  <div style={gridStyle}>
                    {marketplaceResults.map(result => renderResult(result, <span>{monogram(result.title)}</span>))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
