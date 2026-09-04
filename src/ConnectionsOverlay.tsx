import { Fragment, useEffect, useState } from "react";
import {
  XIcon, MarkGithubIcon, MailIcon, ChecklistIcon, CommentDiscussionIcon, NoteIcon,
  LinkIcon, CheckCircleFillIcon, PlusIcon, SearchIcon,
} from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, status } from "./tokens";
import {
  listMCPConnections, createMCPConnection, connectMCP, deleteMCPConnection, searchMCPMarketplace, startMCPOAuth,
  type MCPConnection, type MCPMarketplaceResult,
} from "./mcpConnections";

// A connect target — either one of the hand-verified CORE_SERVICES below,
// or a live MCP Registry search result. credentialsUrl, when present, is
// where to get a token from — the service's own settings page for a Core
// entry, the result's repository link for a Browse result.
interface ConnectTarget { id: string; label: string; credentialsUrl?: string }

// The full-screen "over all the UI" overlay JuanJo asked for — Profile
// button's Connections option, not another corner popover (2026-09-03).
//
// Core is deliberately back to a small hand-verified list (2026-09-04,
// reverted same day after trying registry-search-based Core and testing
// it live): a real query against the MCP Registry for "github" surfaced
// a third-party Smithery-hosted wrapper as the top hit, not GitHub's own
// server — confirmed by hand, not guessed. Keyword search is fine for
// open-ended Browse below, where the user is explicitly told to review
// before connecting, but it's the wrong mechanism for a "quick, trusted
// connect" section. Only GitHub has a real, documented, first-party
// hosted MCP endpoint NAVI can pre-fill with confidence
// (api.githubcopilot.com); the other four have no single verified
// official server, so they show with no pre-filled URL — the user pastes
// their own once they've found the real one, same honest gap the
// original SERVICE_CATALOG design already had.
//
// Also real: the MCP Registry's own schema has no icon/logo field at all
// (checked against a live response) — a Browse result can only ever get
// a generic monogram, never a real brand icon. Core's icons are real
// because these five are hardcoded, not because the registry provided
// them.
const CORE_SERVICES: { id: string; label: string; icon: typeof MarkGithubIcon; credentialsUrl: string; defaultUrl?: string; description: string; oauth?: boolean }[] = [
  {
    id: "github", label: "GitHub", icon: MarkGithubIcon,
    credentialsUrl: "https://github.com/settings/tokens",
    defaultUrl: "https://api.githubcopilot.com/mcp/",
    description: "GitHub's own official hosted MCP server — sign in with GitHub, no token to paste.",
    oauth: true,
  },
  {
    id: "google-workspace", label: "Google Workspace", icon: MailIcon,
    credentialsUrl: "https://myaccount.google.com/permissions",
    description: "No single official MCP server yet — paste your own once you have one.",
  },
  {
    id: "jira", label: "Jira", icon: ChecklistIcon,
    credentialsUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    description: "No single official MCP server yet — paste your own once you have one.",
  },
  {
    id: "slack", label: "Slack", icon: CommentDiscussionIcon,
    credentialsUrl: "https://api.slack.com/apps",
    description: "No single official MCP server yet — paste your own once you have one.",
  },
  {
    id: "notion", label: "Notion", icon: NoteIcon,
    credentialsUrl: "https://www.notion.so/my-integrations",
    description: "No single official MCP server yet — paste your own once you have one.",
  },
];

const CARD_BG = "rgba(255,255,255,0.05)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.08)";

function monogram(title: string): string {
  return (title.trim()[0] || "?").toUpperCase();
}

function ConnectForm({ serviceLabel, credentialsUrl, credentialsLabel = "repository", initial, onCancel, onSubmit, submitting, error }: {
  serviceLabel: string; credentialsUrl?: string;
  // "repository" for a Browse/marketplace result's repo link, "credentials
  // page" for a Core service's real settings-page link — those are two
  // different kinds of URL and the copy below needs to say which one.
  credentialsLabel?: string;
  submitting: boolean; error: string | null;
  // Pre-fills the form from a marketplace result's real transport info, or
  // a Core service's known-good URL (GitHub only) — the user still
  // reviews/edits before submitting, never a silent one-click connect.
  // Marketplace results are already filtered to http-only server-side, so
  // `initial` never carries stdio.
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
        {initial?.url
          ? "Real, pre-filled server URL — review before connecting."
          : `Point NAVI at ${serviceLabel}'s hosted MCP server URL.`}{credentialsUrl ? (
          <>
            {" "}Get a token from{" "}
            <a href={credentialsUrl} target="_blank" rel="noreferrer" style={{ color: neutral.textPrimary }}>
              {serviceLabel}'s {credentialsLabel} <LinkIcon size={10} />
            </a>.
          </>
        ) : null}
      </div>

      <div>
        <div style={labelStyle}>Server URL</div>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/mcp" style={fieldStyle} />
      </div>

      <div>
        <div style={labelStyle}>Access token (optional)</div>
        <input type="password" value={authHeader} onChange={e => setAuthHeader(e.target.value)} placeholder="Bearer …" style={fieldStyle} />
      </div>

      {error && <div style={{ fontSize: fontSize.xxs, color: status.danger.color }}>{error}</div>}

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
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: `1px solid ${status.success.border}`,
            background: status.success.bg, color: status.success.color, cursor: submitting ? "default" : "pointer",
            fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily, opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}

// One connection card, Core or Browse alike — icon left; title, then
// description, then a bottom row with Hosted/requirements on the left
// and the Connect/Disconnect button on the right (2026-09-04: moved down
// here from beside the title per live feedback — "the connection should
// be at the bottom right, not top right"). Two per row via the grid
// container in ConnectionsOverlay below; spanFull lets an open
// ConnectForm take the full width instead of being squeezed into one
// half-width column.
function RegistryCard({ icon, title, description, hostedLabel, requiresAuth, connection, spanFull, busy, onOpenForm, onDisconnect }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  hostedLabel: string;
  requiresAuth: boolean;
  connection: MCPConnection | undefined;
  spanFull: boolean;
  // True while an OAuth flow is being started for this card specifically
  // (network round-trip before the browser redirects away) — the manual
  // paste-a-URL form has no equivalent wait, so this only ever matters
  // for an oauth: true CORE_SERVICES entry.
  busy?: boolean;
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
        <div style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary, minWidth: 0 }}>{title}</div>
        {description && <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.4 }}>{description}</div>}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.xs, marginTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fontSize.xxs, color: connected ? status.success.color : neutral.textFaint, minWidth: 0 }}>
            {connected && <CheckCircleFillIcon size={10} />}
            <span>{connected ? `Connected · ${connection?.tools.length ?? 0} tool${connection?.tools.length === 1 ? "" : "s"}` : hostedLabel}</span>
            {requiresAuth && !connected && <span style={{ color: accent }}>· needs a token</span>}
          </div>
          {connected ? (
            <button onClick={onDisconnect} style={{ ...smallButtonStyle, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: neutral.textFaint }}>
              Disconnect
            </button>
          ) : (
            <button
              onClick={onOpenForm} disabled={busy}
              style={{ ...smallButtonStyle, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: neutral.textPrimary, fontWeight: fontWeight.medium, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
            >
              <PlusIcon size={10} /> {busy ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConnectionsOverlay({ onClose, oauthResult, onDismissOauthResult }: {
  onClose: () => void;
  // Set by App.tsx when this mount is the redirect-back from an OAuth
  // flow (server.py's /mcp/oauth/callback) — "partial" means the token
  // exchange itself worked but discover_tools right after it failed, so
  // the connection is NOT actually marked connected yet even though the
  // user just approved it on GitHub's side. Surfacing this distinctly
  // matters: it looks identical to a plain failure if collapsed into one
  // generic error message.
  oauthResult?: { status: string; connection: string | null } | null;
  onDismissOauthResult?: () => void;
}) {
  const [connections, setConnections] = useState<MCPConnection[] | null>(null);
  const [openFormFor, setOpenFormFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // General Browse search (2026-09-04) — live, debounced, no button/Enter
  // required (JuanJo: "it should automatically update as I write").
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceResults, setMarketplaceResults] = useState<MCPMarketplaceResult[] | null>(null);
  const [marketplaceSearching, setMarketplaceSearching] = useState(false);
  // Cursor-based pagination (2026-09-04, live feedback: "the browse has
  // no sections to filter, shows 11 random MCPs... and doesn't show
  // more") — an empty query returns the registry's most-recently-
  // published entries, not a curated or ranked list, so there's no
  // natural stopping point short of a real "Load more."
  const [marketplaceNextCursor, setMarketplaceNextCursor] = useState<string | null>(null);
  const [marketplaceLoadingMore, setMarketplaceLoadingMore] = useState(false);

  const refresh = () => { listMCPConnections().then(setConnections).catch(() => setConnections([])); };
  useEffect(refresh, []);

  const runMarketplaceSearch = async (query: string, append = false) => {
    if (append) setMarketplaceLoadingMore(true); else setMarketplaceSearching(true);
    try {
      const { results, next_cursor } = await searchMCPMarketplace(query, append ? marketplaceNextCursor : null);
      setMarketplaceResults(prev => (append && prev ? [...prev, ...results] : results));
      setMarketplaceNextCursor(next_cursor);
    } catch {
      if (!append) setMarketplaceResults([]);
    } finally {
      if (append) setMarketplaceLoadingMore(false); else setMarketplaceSearching(false);
    }
  };

  // Debounced live search — fires 400ms after the last keystroke,
  // including once immediately on mount (empty query), which is what
  // populates the section with real results before the user types
  // anything at all. A fresh query always replaces (append=false),
  // resetting pagination.
  useEffect(() => {
    const handle = setTimeout(() => { runMarketplaceSearch(marketplaceQuery.trim()); }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceQuery]);

  const byName = new Map(connections?.map(c => [c.name, c]) ?? []);

  // Reconciles a possibly-stale OAuth redirect result against the real,
  // freshly-fetched connection state (2026-09-04, live bug): clicking
  // Connect more than once fires overlapping OAuth attempts, each with
  // its own `state` — whichever attempt's redirect happens to be the one
  // the browser lands on last can show "error" or "partial" even after a
  // DIFFERENT attempt already fully succeeded. The actual backend record
  // is the source of truth; a redirect signal that disagrees with it is
  // outdated, not a real error to show.
  const effectiveOauthResult = (() => {
    if (!oauthResult || oauthResult.status === "success" || !oauthResult.connection) return oauthResult;
    return byName.get(oauthResult.connection)?.connected
      ? { status: "success", connection: oauthResult.connection }
      : oauthResult;
  })();

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

  // OAuth path (2026-09-04) — real MCP-spec flow (server.py's /oauth/
  // start + /oauth/callback), not a form: ensure the connection exists
  // with its known-good URL, ask the backend to run discovery and hand
  // back an authorize_url, then navigate the WHOLE browser there — the
  // user needs to actually see and approve the provider's own consent
  // screen. There's nothing to do after that in this tab; the provider
  // redirects back to server.py's callback, which lands the browser back
  // here (App.tsx's mcp_oauth effect reopens this overlay).
  const handleOAuthConnect = async (service: typeof CORE_SERVICES[number]) => {
    setSubmitting(true);
    setFormError(null);
    setOpenFormFor(service.id);
    try {
      if (!byName.get(service.id)) {
        const created = await createMCPConnection({ name: service.id, transport: "http", url: service.defaultUrl! });
        if (created.error) {
          setFormError(created.error);
          return;
        }
      }
      const result = await startMCPOAuth(service.id);
      if (result.error || !result.authorize_url) {
        setFormError(result.error ?? "Couldn't start the OAuth flow.");
        return;
      }
      window.location.href = result.authorize_url; // full-page navigation — nothing more to do here
    } catch {
      setFormError("Couldn't reach NAVI — check it's running.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderCoreService = (service: typeof CORE_SERVICES[number]) => {
    const isOpen = openFormFor === service.id;
    const Icon = service.icon;

    if (service.oauth) {
      return (
        <Fragment key={service.id}>
          <RegistryCard
            icon={<Icon size={16} />} title={service.label} description={service.description}
            hostedLabel="Hosted" requiresAuth={false} busy={isOpen && submitting}
            connection={byName.get(service.id)} spanFull={isOpen && !!formError}
            onOpenForm={() => handleOAuthConnect(service)}
            onDisconnect={() => handleDisconnect(service.id)}
          />
          {isOpen && !submitting && formError && (
            <div style={{
              gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
              background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm, padding: spacing.sm,
            }}>
              <span style={{ fontSize: fontSize.xxs, color: status.danger.color }}>{formError}</span>
              <button
                onClick={() => setOpenFormFor(null)}
                style={{ padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily }}
              >
                Dismiss
              </button>
            </div>
          )}
        </Fragment>
      );
    }

    const target: ConnectTarget = { id: service.id, label: service.label, credentialsUrl: service.credentialsUrl };
    return (
      <Fragment key={service.id}>
        <RegistryCard
          icon={<Icon size={16} />} title={service.label} description={service.description}
          hostedLabel={service.defaultUrl ? "Hosted" : "No URL yet"} requiresAuth
          connection={byName.get(service.id)} spanFull={isOpen}
          onOpenForm={() => { setOpenFormFor(service.id); setFormError(null); }}
          onDisconnect={() => handleDisconnect(service.id)}
        />
        {isOpen && (
          <ConnectForm
            serviceLabel={service.label} credentialsUrl={service.credentialsUrl} credentialsLabel="credentials page"
            initial={service.defaultUrl ? { url: service.defaultUrl } : undefined}
            submitting={submitting} error={formError}
            onCancel={() => setOpenFormFor(null)}
            onSubmit={form => handleConnect(target, form)}
          />
        )}
      </Fragment>
    );
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

        {effectiveOauthResult && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
            padding: `${spacing.xs}px ${spacing.md}px`, flexShrink: 0,
            background: effectiveOauthResult.status === "success" ? status.success.bg : effectiveOauthResult.status === "partial" ? status.warning.bg : status.danger.bg,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: fontSize.xxs,
              color: effectiveOauthResult.status === "success" ? status.success.color : effectiveOauthResult.status === "partial" ? status.warning.color : status.danger.color,
            }}>
              {effectiveOauthResult.status === "success" && <CheckCircleFillIcon size={11} />}
              {effectiveOauthResult.status === "success" && `Connected to ${effectiveOauthResult.connection ?? "the service"}.`}
              {effectiveOauthResult.status === "partial" && `Signed in to ${effectiveOauthResult.connection ?? "the service"}, but couldn't list its tools yet — try Connect again.`}
              {effectiveOauthResult.status === "error" && "Sign-in didn't complete — try again."}
            </div>
            <button
              onClick={onDismissOauthResult}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.7, display: "flex" }}
            >
              <XIcon size={12} />
            </button>
          </div>
        )}

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
                  {CORE_SERVICES.map(renderCoreService)}
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
                    {marketplaceSearching ? "Searching…" : "Loading…"}
                  </div>
                ) : marketplaceResults.length === 0 ? (
                  <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xs}px 0` }}>No results.</div>
                ) : (
                  <>
                    {!marketplaceQuery.trim() && (
                      <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: spacing.xs }}>
                        Recently published on the registry — not curated or ranked, search above for something specific.
                      </div>
                    )}
                    <div style={gridStyle}>
                      {marketplaceResults.map(result => renderResult(result, <span>{monogram(result.title)}</span>))}
                    </div>
                    {marketplaceNextCursor && (
                      <button
                        onClick={() => runMarketplaceSearch(marketplaceQuery.trim(), true)}
                        disabled={marketplaceLoadingMore}
                        style={{
                          marginTop: spacing.xs, width: "100%", padding: `${spacing.xs}px`, borderRadius: radius.xs,
                          border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: neutral.textMuted,
                          cursor: marketplaceLoadingMore ? "default" : "pointer", fontSize: fontSize.xxs, fontFamily,
                          opacity: marketplaceLoadingMore ? 0.6 : 1,
                        }}
                      >
                        {marketplaceLoadingMore ? "Loading…" : "Load more"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
