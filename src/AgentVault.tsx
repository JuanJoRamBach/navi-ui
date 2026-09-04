import { useCallback, useEffect, useState } from "react";
import { PlusIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, PersonIcon, SparkleFillIcon, ToolsIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow, status } from "./tokens";
import { AGENT_VAULT_CHANGED_EVENT, createAgent, deleteAgent, listAgents, type AgentOutputType, type SavedAgent } from "./agents";
import { getWorkflow, type WorkflowGraph } from "./agentWork";
import { listMCPConnections } from "./mcpConnections";

// A ready-made entry so a brand-new Vault isn't just an empty box — the
// single most commonly wanted "review my changes" agent (JuanJo's
// brother's original suggestion), added on request rather than silently
// pre-seeded, so it doesn't show up for someone who deletes it once and
// would otherwise see it reappear.
const CODE_REVIEW_PRESET: { name: string; instructions: string; tools: string[]; model: string | null; output_type: AgentOutputType } = {
  name: "Code Review",
  instructions: "Review the diff for correctness, missed edge cases, and style issues against the project's own conventions. Flag anything risky or unclear, and suggest concrete fixes rather than just naming problems.",
  tools: [],
  model: null,
  output_type: "chat",
};

const accent = CANVAS_ACCENT.agentWork.color;
const CARD_BG = "rgba(255,255,255,0.05)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.08)";

// Fixed internal tools every agent can pick from regardless of MCP
// connections — mirrors tools/registry.py's TOOL_SCHEMAS names exactly,
// same vocabulary an Agent Work node's own tools field already uses.
const BUILTIN_SKILLS = ["web_search", "fetch_page", "save_note", "send_to_telegram"];

const OUTPUT_OPTIONS: { value: AgentOutputType; label: string }[] = [
  { value: null, label: "Ask me when it's done" },
  { value: "chat", label: "Chat" },
  { value: "pdf", label: "PDF" },
  { value: "markdown", label: "Markdown" },
];

function SkillPill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: `4px ${spacing.sm}px`, borderRadius: 16, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
        border: selected ? `1px solid ${accent}88` : "1px solid rgba(255,255,255,0.12)",
        background: selected ? tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.15) : "transparent",
        color: selected ? accent : neutral.textFaint,
      }}
    >
      {label}
    </button>
  );
}

// New-agent form — inline, not a modal (matches AgentWorkNewWorkflowForm's
// own "just a panel section" weight). Skills combine the fixed internal
// tool list with every APPROVED tool on every CONNECTED MCP server —
// same source tools/registry.py's schemas_for("mcp") pulls from, just
// surfaced here as pickable checkboxes instead of an LLM's own schema
// list (2026-09-03 design: "skills... map directly onto the existing
// tool catalog + connected MCP services").
function NewAgentForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mcpSkills, setMcpSkills] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [outputType, setOutputType] = useState<AgentOutputType>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMCPConnections().then(conns => {
      const names = conns.filter(c => c.connected).flatMap(c => c.tools.map(t => `mcp__${c.name}__${t.name}`));
      setMcpSkills(names);
    }).catch(() => setMcpSkills([]));
  }, []);

  const toggleSkill = (skill: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill); else next.add(skill);
      return next;
    });
  };

  const handleCreate = async () => {
    setError(null);
    if (!name.trim() || !instructions.trim()) {
      setError("Name and instructions are both required.");
      return;
    }
    setSaving(true);
    try {
      const result = await createAgent({
        name: name.trim(), instructions: instructions.trim(),
        tools: Array.from(selectedSkills), model: null, output_type: outputType,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onCreated();
    } catch {
      setError("Couldn't reach NAVI — check it's running.");
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
    padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: 2 };

  return (
    <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm, padding: spacing.sm, display: "flex", flexDirection: "column", gap: spacing.sm, marginBottom: spacing.xs }}>
      <div>
        <div style={labelStyle}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Code reviewer" style={fieldStyle} />
      </div>
      <div>
        <div style={labelStyle}>Instructions</div>
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} placeholder="Review the diff for bugs, missed edge cases, and style issues." style={{ ...fieldStyle, resize: "vertical" }} />
      </div>
      <div>
        <div style={labelStyle}>Skills</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[...BUILTIN_SKILLS, ...mcpSkills].map(skill => (
            <SkillPill key={skill} label={skill} selected={selectedSkills.has(skill)} onClick={() => toggleSkill(skill)} />
          ))}
          {BUILTIN_SKILLS.length === 0 && mcpSkills.length === 0 && (
            <span style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>No skills available yet — connect a service first.</span>
          )}
        </div>
      </div>
      <div>
        <div style={labelStyle}>Output</div>
        <select value={outputType ?? ""} onChange={e => setOutputType((e.target.value || null) as AgentOutputType)} style={fieldStyle}>
          {OUTPUT_OPTIONS.map(o => <option key={o.label} value={o.value ?? ""}>{o.label}</option>)}
        </select>
      </div>
      {error && <div style={{ fontSize: fontSize.xxs, color: status.danger.color }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing.xs }}>
        <button onClick={onCancel} disabled={saving} style={{ padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xs, fontFamily }}>
          Cancel
        </button>
        <button
          onClick={handleCreate} disabled={saving}
          style={{ padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.12), color: accent, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily }}
        >
          {saving ? "Creating…" : "Create agent"}
        </button>
      </div>
    </div>
  );
}

// Collapsible, chevron-toggled — the graph itself is only fetched the
// first time it's opened (2026-09-03, JuanJo: "add a section called
// 'tools/nodes'... that shows a list of the tools and nodes used in the
// creation of the agent"). Derived from the live workflow at read time,
// never duplicated into saved_agents — see agents.py's own docstring on
// why workflow_id is a reference, not a copy.
function ToolsNodesSection({ workflowId }: { workflowId: string }) {
  const [open, setOpen] = useState(false);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    setOpen(v => !v);
    if (!graph && !loading) {
      setLoading(true);
      getWorkflow(workflowId).then(wf => setGraph(wf.graph)).catch(() => setGraph({ nodes: [], edges: [] })).finally(() => setLoading(false));
    }
  };

  const distinctTools = graph ? Array.from(new Set(graph.nodes.flatMap(n => n.tools ?? []))) : [];

  return (
    <div>
      <button
        onClick={toggle}
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, color: neutral.textFaint, fontSize: fontSize.xxs, fontFamily }}
      >
        {open ? <ChevronDownIcon size={9} /> : <ChevronRightIcon size={9} />}
        <ToolsIcon size={10} /> Tools/Nodes
      </button>
      {open && (
        <div style={{ marginTop: spacing.xxs, display: "flex", flexDirection: "column", gap: 4 }}>
          {loading ? (
            <span style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>Loading…</span>
          ) : !graph || graph.nodes.length === 0 ? (
            <span style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>No nodes found.</span>
          ) : (
            <>
              <span style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>
                {graph.nodes.length} node{graph.nodes.length === 1 ? "" : "s"}
              </span>
              {distinctTools.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {distinctTools.map(t => (
                    <span key={t} style={{ fontSize: fontSize.xxs, padding: "2px 6px", borderRadius: 10, background: "rgba(255,255,255,0.06)", color: neutral.textFaint }}>{t}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, onDelete, onOpenInCanvas }: { agent: SavedAgent; onDelete: () => void; onOpenInCanvas: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm, marginBottom: spacing.xs, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: spacing.xs, textAlign: "left", padding: spacing.sm, border: "none", background: "transparent", cursor: "pointer", fontFamily }}
      >
        {expanded ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
        <PersonIcon size={12} />
        <span style={{ flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {agent.name}
        </span>
        <span onClick={e => { e.stopPropagation(); onDelete(); }} style={{ display: "flex", color: neutral.textFaint, cursor: "pointer" }}>
          <TrashIcon size={11} />
        </span>
      </button>
      {expanded && (
        <div style={{ padding: `0 ${spacing.sm}px ${spacing.sm}px`, display: "flex", flexDirection: "column", gap: spacing.xs }}>
          {agent.instructions && (
            <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>{agent.instructions}</div>
          )}
          {agent.tools.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {agent.tools.map(t => (
                <span key={t} style={{ fontSize: fontSize.xxs, padding: "2px 6px", borderRadius: 10, background: "rgba(255,255,255,0.06)", color: neutral.textFaint }}>{t}</span>
              ))}
            </div>
          )}
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>
            Output: {agent.output_type ?? "ask when it's done"}
          </div>
          {agent.workflow_id ? (
            <ToolsNodesSection workflowId={agent.workflow_id} />
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onOpenInCanvas(); }}
              title="Fork this agent into a real Agent Work graph you can extend — one-way, editing it afterward won't change this saved agent"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
                border: `1px solid ${accent}55`, background: "transparent", color: accent,
                cursor: "pointer", fontSize: fontSize.xxs, fontWeight: fontWeight.medium, fontFamily,
              }}
            >
              <SparkleFillIcon size={10} /> Open in canvas
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentVault({ onOpenInCanvas }: { onOpenInCanvas: (agent: SavedAgent) => void }) {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const [addingPreset, setAddingPreset] = useState(false);

  const refresh = useCallback(() => {
    listAgents().then(setAgents).catch(() => setAgents([]));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    window.addEventListener(AGENT_VAULT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AGENT_VAULT_CHANGED_EVENT, refresh);
  }, [refresh]);

  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    refresh();
  };

  const addPreset = async () => {
    setAddingPreset(true);
    try {
      await createAgent(CODE_REVIEW_PRESET);
      refresh();
    } finally {
      setAddingPreset(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <span style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em" }}>AGENTS</span>
        <button
          onClick={() => setShowNewForm(v => !v)}
          title="New agent"
          style={{ display: "flex", alignItems: "center", gap: 4, padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.1), color: accent, cursor: "pointer", fontSize: fontSize.xxs, fontFamily }}
        >
          <PlusIcon size={10} /> New
        </button>
      </div>
      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.xs }}>
        {showNewForm && <NewAgentForm onCreated={() => { setShowNewForm(false); refresh(); }} onCancel={() => setShowNewForm(false)} />}
        {agents === null ? (
          <div style={{ fontSize: fontSize.xs, color: neutral.textFaint, textAlign: "center", padding: spacing.lg }}>Loading…</div>
        ) : agents.length === 0 && !showNewForm ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: spacing.lg, textAlign: "center", color: neutral.textFaint, gap: spacing.xs }}>
            <SparkleFillIcon size={20} fill={accent} />
            <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, fontWeight: fontWeight.medium }}>No agents yet</div>
            <div style={{ fontSize: fontSize.xxs }}>Create a reusable one with the button above.</div>
            <button
              onClick={addPreset}
              disabled={addingPreset}
              style={{
                display: "flex", alignItems: "center", gap: 4, marginTop: spacing.xs,
                padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                color: neutral.textMuted, cursor: addingPreset ? "default" : "pointer",
                fontSize: fontSize.xxs, fontFamily, opacity: addingPreset ? 0.6 : 1,
              }}
            >
              <PlusIcon size={10} /> {addingPreset ? "Adding…" : `Add "${CODE_REVIEW_PRESET.name}" preset`}
            </button>
          </div>
        ) : (
          agents.map(a => <AgentCard key={a.id} agent={a} onDelete={() => handleDelete(a.id)} onOpenInCanvas={() => onOpenInCanvas(a)} />)
        )}
      </div>
    </div>
  );
}
