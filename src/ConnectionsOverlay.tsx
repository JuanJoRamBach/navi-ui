import { useEffect, useState } from "react";
import {
  XIcon, MarkGithubIcon, MailIcon, ChecklistIcon, CommentDiscussionIcon, NoteIcon,
  DeviceCameraIcon, PlayIcon, CommentIcon, LinkIcon, CheckCircleFillIcon, PlusIcon, SearchIcon,
} from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, tintedGlow, CANVAS_ACCENT } from "./tokens";
import {
  listMCPConnections, createMCPConnection, connectMCP, deleteMCPConnection, searchMCPMarketplace,
  type MCPConnection, type MCPTransport, type MCPMarketplaceResult,
} from "./mcpConnections";

// A connect target from either source — the fixed catalog below, or a
// live MCP Registry search result (2026-09-04). credentialsUrl is
// optional since a marketplace result has no "get a token from X's own
// settings page" link the way a known first-party service does; its
// repository (if any) is shown instead.
interface ConnectTarget { id: string; label: string; credentialsUrl?: string }

// The full-screen "over all the UI" overlay JuanJo asked for — Profile
// button's Connections option, not another corner popover (2026-09-03):
// "Clicking Connections opens an 'overlay window' over all the UI
// showing the possible connections, and a 'connect' button." Two-click
// reachable from the rail (Profile -> Connections), separate from
// Settings entirely per his own explicit steer.
//
// The service catalog below is deliberately generic on HOW to connect —
// NAVI has no verified official MCP server command/URL for most of
// these yet (only GitHub's is well-established public knowledge; the
// others vary by vendor and shouldn't be guessed at). "Connect" opens a
// real transport-config form (stdio command+args, or an HTTP URL, plus
// an optional token) rather than a fake one-click OAuth redirect NAVI
// can't actually back yet — and links to each service's real, stable
// credentials page, which is the honest version of "sends you to the
// authorization window" until per-service MCP servers are individually
// wired and verified.
const SERVICE_CATALOG: { id: string; label: string; icon: typeof MarkGithubIcon; credentialsUrl: string; tier: "core" | "extra" }[] = [
  { id: "github", label: "GitHub", icon: MarkGithubIcon, credentialsUrl: "https://github.com/settings/tokens", tier: "core" },
  { id: "google", label: "Google Workspace", icon: MailIcon, credentialsUrl: "https://myaccount.google.com/permissions", tier: "core" },
  { id: "jira", label: "Jira", icon: ChecklistIcon, credentialsUrl: "https://id.atlassian.com/manage-profile/security/api-tokens", tier: "core" },
  { id: "slack", label: "Slack", icon: CommentDiscussionIcon, credentialsUrl: "https://api.slack.com/apps", tier: "core" },
  { id: "notion", label: "Notion", icon: NoteIcon, credentialsUrl: "https://www.notion.so/my-integrations", tier: "core" },
  { id: "instagram", label: "Instagram / Facebook", icon: DeviceCameraIcon, credentialsUrl: "https://developers.facebook.com/apps", tier: "extra" },
  { id: "youtube", label: "YouTube", icon: PlayIcon, credentialsUrl: "https://console.cloud.google.com/apis/credentials", tier: "extra" },
  { id: "whatsapp", label: "WhatsApp", icon: CommentIcon, credentialsUrl: "https://developers.facebook.com/apps", tier: "extra" },
];

const CARD_BG = "rgba(255,255,255,0.05)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.08)";

function ConnectForm({ serviceLabel, credentialsUrl, initial, onCancel, onSubmit, submitting, error }: {
  serviceLabel: string; credentialsUrl?: string; submitting: boolean; error: string | null;
  // Pre-fills the form from a marketplace result's real transport info
  // (2026-09-04) — the user still reviews/edits before submitting,
  // never a silent one-click connect.
  initial?: { transport: MCPTransport; url?: string; command?: string; args?: string[] };
  onCancel: () => void;
  onSubmit: (config: { transport: MCPTransport; command: string; args: string; url: string; authHeader: string }) => void;
}) {
  const [transport, setTransport] = useState<MCPTransport>(initial?.transport ?? "http");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [args, setArgs] = useState(initial?.args?.join(" ") ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [authHeader, setAuthHeader] = useState("");

  const fieldStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
    padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: 2 };

  return (
    <div style={{ padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.sm }}>
      <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
        {credentialsUrl ? (
          <>
            Get credentials from {serviceLabel}'s own settings page, then point NAVI at the MCP
            server that talks to it — a locally-run command, or a hosted URL if the service
            provides one.{" "}
            <a href={credentialsUrl} target="_blank" rel="noreferrer" style={{ color: neutral.textPrimary }}>
              Open {serviceLabel}'s credentials page <LinkIcon size={10} />
            </a>
          </>
        ) : initial ? (
          "Pulled from the MCP Registry — review before connecting, and add an access token below if the server needs one."
        ) : (
          "Point NAVI at the MCP server that talks to this service — a locally-run command, or a hosted URL if it provides one."
        )}
      </div>

      <div style={{ display: "flex", gap: spacing.xs }}>
        {(["http", "stdio"] as const).map(t => (
          <button
            key={t} onClick={() => setTransport(t)}
            style={{
              flex: 1, padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
              border: `1px solid ${transport === t ? neutral.textPrimary : "rgba(255,255,255,0.12)"}`,
              background: transport === t ? "rgba(255,255,255,0.08)" : "transparent",
              color: neutral.textPrimary, cursor: "pointer", fontSize: fontSize.xs, fontFamily,
            }}
          >
            {t === "http" ? "Hosted URL" : "Local command"}
          </button>
        ))}
      </div>

      {transport === "http" ? (
        <div>
          <div style={labelStyle}>Server URL</div>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/mcp" style={fieldStyle} />
        </div>
      ) : (
        <>
          <div>
            <div style={labelStyle}>Command</div>
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder="npx" style={fieldStyle} />
          </div>
          <div>
            <div style={labelStyle}>Arguments (space-separated)</div>
            <input value={args} onChange={e => setArgs(e.target.value)} placeholder="-y @vendor/server-name" style={fieldStyle} />
          </div>
        </>
      )}

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
          onClick={() => onSubmit({ transport, command, args, url, authHeader })}
          disabled={submitting || (transport === "http" ? !url.trim() : !command.trim())}
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

function ServiceCard({ service, connection, onOpenForm, onDisconnect }: {
  service: typeof SERVICE_CATALOG[number]; connection: MCPConnection | undefined;
  onOpenForm: () => void; onDisconnect: () => void;
}) {
  const Icon = service.icon;
  const connected = connection?.connected ?? false;
  return (
    <div style={{
      background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm,
      padding: spacing.sm, display: "flex", alignItems: "center", gap: spacing.sm,
    }}>
      <span style={{ display: "flex", color: neutral.textMuted, flexShrink: 0 }}><Icon size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>{service.label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: fontSize.xxs, color: connected ? "#3ecf8e" : neutral.textFaint }}>
          {connected && <CheckCircleFillIcon size={10} />}
          {connected ? `Connected · ${connection?.tools.length ?? 0} tool${connection?.tools.length === 1 ? "" : "s"}` : "Not connected"}
        </div>
      </div>
      {connected ? (
        <button
          onClick={onDisconnect}
          style={{
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent", color: neutral.textFaint, cursor: "pointer", fontSize: fontSize.xxs, fontFamily, flexShrink: 0,
          }}
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={onOpenForm}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent", color: neutral.textPrimary, cursor: "pointer", fontSize: fontSize.xxs, fontWeight: fontWeight.medium, fontFamily, flexShrink: 0,
          }}
        >
          <PlusIcon size={10} /> Connect
        </button>
      )}
    </div>
  );
}

// One live search result from the official MCP Registry (2026-09-04) —
// same card shape/actions as a catalog ServiceCard, but there's no fixed
// icon or credentials link for an arbitrary third-party server, and the
// "Connect" button opens ConnectForm pre-filled with the registry's own
// real transport info instead of an empty form.
function MarketplaceResultRow({ result, connection, onOpenForm, onDisconnect }: {
  result: MCPMarketplaceResult; connection: MCPConnection | undefined;
  onOpenForm: () => void; onDisconnect: () => void;
}) {
  const connected = connection?.connected ?? false;
  const accent = CANVAS_ACCENT.agentWork.color;
  return (
    <div style={{
      background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm,
      padding: spacing.sm, display: "flex", alignItems: "flex-start", gap: spacing.sm,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>{result.title}</div>
        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.4, marginTop: 2 }}>{result.description}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fontSize.xxs, color: connected ? "#3ecf8e" : neutral.textFaint, marginTop: 4 }}>
          {connected && <CheckCircleFillIcon size={10} />}
          <span>{connected ? `Connected · ${connection?.tools.length ?? 0} tool${connection?.tools.length === 1 ? "" : "s"}` : result.transport === "http" ? "Hosted" : "Local (npx)"}</span>
          {result.requires_auth && !connected && <span style={{ color: accent }}>· needs a token</span>}
        </div>
      </div>
      {connected ? (
        <button
          onClick={onDisconnect}
          style={{
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent", color: neutral.textFaint, cursor: "pointer", fontSize: fontSize.xxs, fontFamily, flexShrink: 0,
          }}
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={onOpenForm}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent", color: neutral.textPrimary, cursor: "pointer", fontSize: fontSize.xxs, fontWeight: fontWeight.medium, fontFamily, flexShrink: 0,
          }}
        >
          <PlusIcon size={10} /> Connect
        </button>
      )}
    </div>
  );
}

export function ConnectionsOverlay({ onClose }: { onClose: () => void }) {
  const [connections, setConnections] = useState<MCPConnection[] | null>(null);
  const [openFormFor, setOpenFormFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Marketplace search (2026-09-04) — separate from the fixed catalog
  // above; queries the live MCP Registry rather than anything local.
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceResults, setMarketplaceResults] = useState<MCPMarketplaceResult[] | null>(null);
  const [marketplaceSearching, setMarketplaceSearching] = useState(false);

  const refresh = () => { listMCPConnections().then(setConnections).catch(() => setConnections([])); };
  useEffect(refresh, []);

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

  const byName = new Map(connections?.map(c => [c.name, c]) ?? []);

  const handleConnect = async (
    service: ConnectTarget,
    form: { transport: MCPTransport; command: string; args: string; url: string; authHeader: string },
  ) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createMCPConnection({
        name: service.id, transport: form.transport,
        command: form.transport === "stdio" ? form.command.trim() : undefined,
        args: form.transport === "stdio" ? form.args.trim().split(/\s+/).filter(Boolean) : undefined,
        url: form.transport === "http" ? form.url.trim() : undefined,
        auth_header: form.authHeader.trim() || undefined,
      });
      if (created.error) {
        setFormError(created.error);
        return;
      }
      const result = await connectMCP(service.id);
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

  const core = SERVICE_CATALOG.filter(s => s.tier === "core");
  const extra = SERVICE_CATALOG.filter(s => s.tier === "extra");

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
          width: "min(520px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column",
          background: neutral.surface, borderRadius: radius.md, border: "1px solid rgba(255,255,255,0.1)",
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
                <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                  {core.map(service => (
                    <div key={service.id}>
                      <ServiceCard
                        service={service} connection={byName.get(service.id)}
                        onOpenForm={() => { setOpenFormFor(service.id); setFormError(null); }}
                        onDisconnect={() => handleDisconnect(service.id)}
                      />
                      {openFormFor === service.id && (
                        <ConnectForm
                          serviceLabel={service.label} credentialsUrl={service.credentialsUrl}
                          submitting={submitting} error={formError}
                          onCancel={() => setOpenFormFor(null)}
                          onSubmit={form => handleConnect(service, form)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em", marginBottom: spacing.xs }}>
                  MORE
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                  {extra.map(service => (
                    <div key={service.id}>
                      <ServiceCard
                        service={service} connection={byName.get(service.id)}
                        onOpenForm={() => { setOpenFormFor(service.id); setFormError(null); }}
                        onDisconnect={() => handleDisconnect(service.id)}
                      />
                      {openFormFor === service.id && (
                        <ConnectForm
                          serviceLabel={service.label} credentialsUrl={service.credentialsUrl}
                          submitting={submitting} error={formError}
                          onCancel={() => setOpenFormFor(null)}
                          onSubmit={form => handleConnect(service, form)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em", marginBottom: spacing.xs }}>
                  MARKETPLACE
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, marginBottom: spacing.xs }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", display: "flex" }}>
                      <SearchIcon size={11} fill={neutral.textFaint} />
                    </span>
                    <input
                      value={marketplaceQuery}
                      onChange={e => setMarketplaceQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && marketplaceQuery.trim()) runMarketplaceSearch(marketplaceQuery.trim()); }}
                      placeholder="Search the MCP Registry — e.g. github, slack, notion…"
                      style={{
                        width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
                        padding: `${spacing.xxs}px ${spacing.xs}px ${spacing.xxs}px 26px`, boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    onClick={() => marketplaceQuery.trim() && runMarketplaceSearch(marketplaceQuery.trim())}
                    disabled={marketplaceSearching || !marketplaceQuery.trim()}
                    style={{
                      padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
                      border: `1px solid ${CANVAS_ACCENT.agentWork.color}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.1),
                      color: CANVAS_ACCENT.agentWork.color, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
                      opacity: marketplaceSearching || !marketplaceQuery.trim() ? 0.5 : 1,
                    }}
                  >
                    {marketplaceSearching ? "Searching…" : "Search"}
                  </button>
                </div>
                {marketplaceResults === null ? (
                  <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xs}px 0` }}>
                    Real, live results from the official MCP Registry — not the fixed list above.
                  </div>
                ) : marketplaceResults.length === 0 ? (
                  <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xs}px 0` }}>No results.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                    {marketplaceResults.map(result => {
                      const target: ConnectTarget = { id: result.name, label: result.title, credentialsUrl: result.repository_url ?? undefined };
                      return (
                        <div key={result.name}>
                          <MarketplaceResultRow
                            result={result} connection={byName.get(result.name)}
                            onOpenForm={() => { setOpenFormFor(result.name); setFormError(null); }}
                            onDisconnect={() => handleDisconnect(result.name)}
                          />
                          {openFormFor === result.name && (
                            <ConnectForm
                              serviceLabel={result.title} credentialsUrl={result.repository_url ?? undefined}
                              initial={{ transport: result.transport, url: result.url, command: result.command, args: result.args }}
                              submitting={submitting} error={formError}
                              onCancel={() => setOpenFormFor(null)}
                              onSubmit={form => handleConnect(target, form)}
                            />
                          )}
                        </div>
                      );
                    })}
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
