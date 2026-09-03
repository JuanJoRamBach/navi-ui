import { useCallback, useEffect, useState } from "react";
import { PlusIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, PersonIcon, SparkleFillIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
import { createAgent, deleteAgent, listAgents, type AgentOutputType, type SavedAgent } from "./agents";
import { listMCPConnections } from "./mcpConnections";

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
      {error && <div style={{ fontSize: fontSize.xxs, color: "#e05a4a" }}>{error}</div>}
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

function AgentCard({ agent, onDelete }: { agent: SavedAgent; onDelete: () => void }) {
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
          <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>{agent.instructions}</div>
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
        </div>
      )}
    </div>
  );
}

export function AgentVault() {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const refresh = useCallback(() => {
    listAgents().then(setAgents).catch(() => setAgents([]));
  }, []);
  useEffect(refresh, [refresh]);

  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    refresh();
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
          </div>
        ) : (
          agents.map(a => <AgentCard key={a.id} agent={a} onDelete={() => handleDelete(a.id)} />)
        )}
      </div>
    </div>
  );
}
