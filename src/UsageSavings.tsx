import { useState, useEffect } from "react";
import { XIcon, GraphIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, status } from "./tokens";
import { NAVI_BACKEND_URL } from "./config";

// The full-screen "over all the UI" overlay, same shell ConnectionsOverlay.tsx
// established (2026-09-03) — replaces the old `openPanel === "usage"` docked/
// floating popover (App.tsx's ~280px-tall "System" panel), which was sized for
// a short list, not a savings report plus a per-provider breakdown (JuanJo,
// 2026-09-11: "the floating window might be too small... make it bigger").
// Same trigger ("Usage counters" in the System section) now opens this
// instead of the small popover — not a second, redundant entry point.
//
// Section order (Monthly savings report ABOVE Usage counters) is a
// deliberate, researched call, not arbitrary: real dashboard-design
// consensus puts the headline KPI/summary stat first, operational detail
// below (progressive disclosure) — and the savings report is the new,
// narratively important content this bigger surface exists FOR; the
// per-provider quota list already existed and worked fine small, so
// putting it first would bury the actual point of this rebuild under
// already-familiar content.

interface UsageCounters {
  groq: { models: { model: string; used: number | null; limit: number | null; reset_seconds: number | null }[] };
  cloudflare: { neurons_used: number; neurons_cap: number };
  openrouter: { requests_used: number; requests_cap: number; spend: Record<string, unknown> | null };
  llm7: { tokens_used: number; keyed_cap: number; anonymous_cap: number };
  gmi: { requests_today: number; status: string };
  ollama_cloud: { requests_today: number; tokens_today: number; cap: null };
  gemini: { models: { model: string; requests: number; tokens: number; cap: number | null }[] };
}
interface MistralUsage {
  usage: Record<string, unknown> | null;
  credit_usd: number;
}

// Matches storage/usage.py's get_savings_summary() — real prompt/
// completion tokens used, and what that same real volume would have cost
// against each tracked reference model's real published rate (flat,
// uncached — see this file's own "vs." caption below for why that's
// disclosed, not hidden). No `by_tier`/`realistic` breakdown yet — that's
// the tiered, task-matched version designed 2026-09-11 but not built;
// this ships with today's real, honestly-labeled ceiling comparison
// rather than wait on that.
interface SavingsSummary {
  days: number;
  total_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  counterfactual_usd: Record<string, number>;
}

// Real, human-readable names for storage/usage.py's REFERENCE_MODELS keys
// — kept here rather than have the backend send display strings, same
// "backend is the data, frontend is the copy" split already used
// elsewhere (e.g. AgentVault's OUTPUT_OPTIONS labels).
const REFERENCE_MODEL_LABELS: Record<string, string> = {
  "gpt-6-astra": "GPT-6 Astra",
  "claude-fable-5.1": "Claude Fable 5.1",
};

function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function SavingsReportSection() {
  const [savings, setSavings] = useState<SavingsSummary | null>(null);
  useEffect(() => {
    fetch(`${NAVI_BACKEND_URL}/usage/savings?days=30`)
      .then(res => res.json())
      .then(setSavings)
      .catch(() => {});
  }, []);

  const totalTokens = savings ? savings.total_prompt_tokens + savings.total_completion_tokens : 0;

  return (
    <div>
      <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, marginBottom: spacing.xs }}>
        Monthly savings report
      </div>
      {!savings ? (
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>
      ) : totalTokens === 0 ? (
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
          No usage recorded yet in the last {savings.days} days — this fills in as NAVI gets used.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xs }}>
            {Object.entries(savings.counterfactual_usd).map(([ref, usd]) => (
              <div key={ref} style={{
                flex: "1 1 200px", minWidth: 180,
                background: "var(--surface-panel)", border: "1px solid var(--border-default)",
                borderRadius: radius.md, padding: spacing.sm,
              }}>
                {/* tokens.ts's fontSize scale tops out at "sm" (body copy)
                    — a headline stat like this genuinely needs to read
                    bigger than any existing token, hence the explicit
                    px value rather than a nonexistent fontSize.lg. */}
                <div style={{ fontSize: 20, fontWeight: fontWeight.medium, color: status.success.color }}>
                  {formatUsd(usd)} avoided
                </div>
                <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginTop: 2 }}>
                  vs. running everything through {REFERENCE_MODEL_LABELS[ref] ?? ref}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.5 }}>
            Estimated from {totalTokens.toLocaleString()} real tokens used across the last {savings.days} days
            ({savings.total_requests.toLocaleString()} requests), priced at each model's flat published rate —
            uncached, list price. This compares against the single most capable model available today; a
            task-matched comparison (idle chat priced against a lighter model, complex work against a heavier
            one) is planned but not built yet, so treat this as a ceiling, not a like-for-like estimate.
          </div>
        </>
      )}
    </div>
  );
}

// Matches storage/context_store.py's get_friction_summary() joined with
// the per-call denominator in server.py's /usage/friction.
interface FrictionKind {
  kind: string;
  events: number;
  severity: number;
  wasted_tokens: number;
  unmeasured: number;
  conversations: number;
  last_seen: number;
  per_1k_calls: number | null;
}
interface FrictionSummary {
  days: number;
  total_calls: number;
  total_events: number;
  total_wasted_tokens: number;
  kinds: FrictionKind[];
}

// Plain-language names for the backend's kind slugs. Same "backend is the
// data, frontend is the copy" split as REFERENCE_MODEL_LABELS above.
// Written from the reader's side, not the code's: someone opening this
// panel wants to know what happened, not which function recorded it.
const FRICTION_LABELS: Record<string, string> = {
  provider_timeout: "Model took too long and gave up",
  provider_error: "Model call failed",
  empty_response: "Model answered with nothing",
  tool_loop_exhausted: "Ran out of steps before answering",
  tool_loop_near_limit: "Nearly ran out of steps",
  tool_result_empty: "A tool came back empty",
  repetition_loop: "Model repeated itself",
  fallback_used: "Answered by a backup model",
  tier_escalation: "Needed a stronger model",
  escalation_at_ceiling: "Strongest model said it wasn't enough",
  compaction_failed: "Couldn't tidy up memory",
  compaction_above_target: "Memory wouldn't shrink enough",
  context_floor_reached: "Chat stopped being compactable",
  checkpoint_revised: "You sent a plan back for changes",
  checkpoint_rejected: "You cancelled a plan",
  completion_rejected: "A branch said done, you disagreed",
};

function FrictionSection() {
  const [friction, setFriction] = useState<FrictionSummary | null>(null);
  useEffect(() => {
    fetch(`${NAVI_BACKEND_URL}/usage/friction?days=30`)
      .then(res => res.json())
      .then(setFriction)
      .catch(() => {});
  }, []);

  return (
    <div>
      <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, marginBottom: spacing.xs }}>
        What got in the way
      </div>
      {!friction ? (
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>
      ) : friction.total_events === 0 ? (
        // An empty state that says what empty MEANS. "Nothing here" on its
        // own reads as broken instrumentation — which, for most of this
        // log's life, is exactly what it was. Naming the denominator is
        // what turns zero into a real result.
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
          {friction.total_calls > 0
            ? `Nothing recorded across ${friction.total_calls.toLocaleString()} model calls in the last ${friction.days} days — no timeouts, no empty replies, no rejected plans.`
            : `No model calls yet in the last ${friction.days} days, so there is nothing to report on.`}
        </div>
      ) : (
        <>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginBottom: spacing.sm, lineHeight: 1.5 }}>
            {friction.total_events.toLocaleString()} across{" "}
            {friction.total_calls.toLocaleString()} model calls
            {friction.total_wasted_tokens > 0 && (
              <>
                {" — "}
                <span style={{ color: status.warning.color }}>
                  {friction.total_wasted_tokens.toLocaleString()} tokens spent for nothing
                </span>
              </>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {friction.kinds.map(k => (
              <div
                key={k.kind}
                style={{
                  display: "flex", alignItems: "baseline", gap: spacing.sm,
                  background: "var(--surface-panel)", padding: `${spacing.xs} ${spacing.sm}`,
                  borderLeft: `2px solid ${k.severity >= 3 ? status.danger.color : k.severity === 2 ? status.warning.color : "var(--border-strong)"}`,
                }}
              >
                <span style={{ flex: 1, fontSize: fontSize.xxs, color: neutral.textPrimary }}>
                  {FRICTION_LABELS[k.kind] ?? k.kind}
                </span>
                {k.wasted_tokens > 0 && (
                  <span style={{ fontSize: fontSize.xxs, color: status.warning.color, whiteSpace: "nowrap" }}>
                    {k.wasted_tokens.toLocaleString()} tok
                  </span>
                )}
                <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted, whiteSpace: "nowrap", minWidth: 96, textAlign: "right" }}>
                  {k.events}×
                  {k.per_1k_calls !== null && ` · ${k.per_1k_calls}/1k calls`}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.5, marginTop: spacing.xs }}>
            Rates are per thousand model calls, so they stay comparable as usage grows. Token figures are
            measured where the provider reported them and estimated from the sent payload where a call failed
            before reporting anything — rate limits are excluded here on purpose: a backup model picks those
            up and the answer still arrives.
          </div>
        </>
      )}
    </div>
  );
}

function UsageCountersSection() {
  const [usageCounters, setUsageCounters] = useState<UsageCounters | null>(null);
  useEffect(() => {
    fetch(`${NAVI_BACKEND_URL}/usage/counters`)
      .then(res => res.json())
      .then(setUsageCounters)
      .catch(() => {});
  }, []);
  const [expandedUsageProvider, setExpandedUsageProvider] = useState<string | null>(null);
  const [mistralUsage, setMistralUsage] = useState<MistralUsage | null>(null);
  const [mistralUsageLoading, setMistralUsageLoading] = useState(false);
  const toggleUsageProvider = (key: string) => {
    setExpandedUsageProvider(prev => (prev === key ? null : key));
    if (key === "mistral" && mistralUsage === null && !mistralUsageLoading) {
      setMistralUsageLoading(true);
      fetch(`${NAVI_BACKEND_URL}/usage/mistral`)
        .then(res => res.json())
        .then(setMistralUsage)
        .catch(() => {})
        .finally(() => setMistralUsageLoading(false));
    }
  };

  return (
    <div>
      <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, marginBottom: spacing.xs }}>
        Usage counters
      </div>
      <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginBottom: spacing.sm }}>
        Click a provider for its real numbers
      </div>
      {!usageCounters ? (
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
          {([
            { key: "groq", label: "Groq" },
            { key: "cloudflare", label: "Cloudflare" },
            { key: "openrouter", label: "OpenRouter" },
            { key: "llm7", label: "LLM7" },
            { key: "gmi", label: "GMI" },
            { key: "ollama_cloud", label: "Ollama Cloud" },
            { key: "mistral", label: "Mistral" },
            { key: "gemini", label: "Google AI Studio" },
          ] as const).map(({ key, label }) => {
            const isOpen = expandedUsageProvider === key;
            return (
              <div key={key} style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: spacing.xs }}>
                <button
                  onClick={() => toggleUsageProvider(key)}
                  style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "transparent", border: "none", cursor: "pointer",
                    // Explicit, not "inherit" (2026-09-13): nothing up this
                    // overlay's chain sets a text colour, so inherit resolved
                    // to the browser default — fine on the light theme,
                    // invisible black-on-dark at night.
                    color: neutral.textPrimary,
                    padding: `${spacing.xs}px 0`, fontSize: fontSize.sm, fontFamily,
                  }}
                >
                  <span>{label}</span>
                  <span style={{ color: neutral.textMuted, fontSize: fontSize.xxs }}>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: `0 0 ${spacing.xs}px`, fontSize: fontSize.xxs, color: neutral.textMuted }}>
                    {key === "gemini" && (
                      usageCounters.gemini.models.length === 0 ? (
                        <div>No Google AI calls yet today — quota is per-model, shown once a model's been used.</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
                          {usageCounters.gemini.models.map(m => (
                            <div key={m.model}>
                              <div style={{ color: neutral.textPrimary }}>{m.model}</div>
                              <div>
                                {m.cap
                                  ? `${m.requests.toLocaleString()} / ${m.cap.toLocaleString()} requests today`
                                  : `${m.requests.toLocaleString()} requests today`}
                                {" · "}{m.tokens.toLocaleString()} tokens
                              </div>
                            </div>
                          ))}
                          {/* The thing that is easy to get wrong about this
                              provider, said once where it is relevant: the
                              limit is per MODEL, so two Flash-Lite models are
                              two independent pools. That is exactly why the
                              idle and exploratory tiers sit on different
                              ones rather than sharing a counter. */}
                          <div>Each model has its own daily allowance — they don't share one pool.</div>
                        </div>
                      )
                    )}
                    {key === "groq" && (
                      usageCounters.groq.models.length === 0 ? (
                        <div>No Groq calls observed yet this run — quota is per-model, shown once a model's been used.</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
                          {usageCounters.groq.models.map(m => (
                            <div key={m.model}>
                              <div style={{ color: neutral.textPrimary }}>{m.model}</div>
                              <div>
                                {m.used !== null && m.limit !== null
                                  ? `${m.used.toLocaleString()} / ${m.limit.toLocaleString()} requests today`
                                  : "used/limit unknown"}
                                {m.reset_seconds !== null && ` · resets in ${Math.round(m.reset_seconds)}s`}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    )}
                    {key === "cloudflare" && (
                      <div>
                        {usageCounters.cloudflare.neurons_used.toFixed(2)} / {usageCounters.cloudflare.neurons_cap.toLocaleString()} Neurons today (resets 00:00 UTC)
                      </div>
                    )}
                    {key === "openrouter" && (
                      <div>
                        {usageCounters.openrouter.requests_used.toLocaleString()} / {usageCounters.openrouter.requests_cap.toLocaleString()} free-model requests today (NAVI's own count — OpenRouter's API doesn't report this number directly)
                        {usageCounters.openrouter.spend && (
                          <div style={{ marginTop: spacing.xs }}>
                            ${String(usageCounters.openrouter.spend.usage_daily ?? "?")} spent today · ${String(usageCounters.openrouter.spend.usage_monthly ?? "?")} this month (real, from OpenRouter)
                          </div>
                        )}
                      </div>
                    )}
                    {key === "llm7" && (
                      <div>
                        {usageCounters.llm7.tokens_used.toLocaleString()} / {usageCounters.llm7.keyed_cap.toLocaleString()} tokens today (keyed pool)
                        <br />
                        A separate {usageCounters.llm7.anonymous_cap.toLocaleString()}-token/24h anonymous pool exists but isn't used by NAVI yet.
                      </div>
                    )}
                    {key === "gmi" && (
                      <div>
                        {usageCounters.gmi.requests_today.toLocaleString()} requests today
                        <br />
                        {usageCounters.gmi.status}
                      </div>
                    )}
                    {key === "ollama_cloud" && (
                      <div>
                        {usageCounters.ollama_cloud.requests_today.toLocaleString()} requests / {usageCounters.ollama_cloud.tokens_today.toLocaleString()} tokens today — not calculable against a real cap (GPU-time metered, no published number)
                      </div>
                    )}
                    {key === "mistral" && (
                      mistralUsageLoading ? (
                        <div>Loading…</div>
                      ) : mistralUsage?.usage ? (
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                          {JSON.stringify(mistralUsage.usage, null, 2)}
                        </pre>
                      ) : (
                        <div>No Mistral key configured, or the admin usage fetch failed. Free credit: ${mistralUsage?.credit_usd ?? 10}/month.</div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function UsageSavings({ onClose }: { onClose: () => void }) {
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
          width: "min(820px, 95vw)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          background: neutral.surfaceSolid, borderRadius: radius.md, border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)", fontFamily,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: spacing.md, borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
        }}>
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, display: "flex", alignItems: "center", gap: spacing.xs }}>
            <GraphIcon size={16} /> Usage &amp; Savings
          </span>
          <button
            onClick={onClose} aria-label="Close"
            style={{ display: "flex", background: "none", border: "none", color: neutral.textMuted, cursor: "pointer" }}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.lg }}>
          <SavingsReportSection />
          {/* Between the savings headline and the quota detail, following
              the same progressive-disclosure order this file's header
              comment already argues for: the summary stat first, then
              what it cost to get, then the operational per-provider
              detail. Friction belongs next to savings because it is the
              other half of the same story — what the routing avoided
              spending, and what it spent without getting anything. */}
          <FrictionSection />
          <UsageCountersSection />
        </div>
      </div>
    </div>
  );
}
