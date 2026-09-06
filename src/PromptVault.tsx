import { useCallback, useEffect, useState } from "react";
import { PlusIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, CommentIcon, SparkleFillIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow, status } from "./tokens";
import { PROMPT_VAULT_CHANGED_EVENT, createPrompt, deletePrompt, listPrompts, updatePrompt, type SavedPrompt } from "./prompts";

const accent = CANVAS_ACCENT.chat.color;
const CARD_BG = "var(--surface-panel)";
const CARD_BORDER = "1px solid var(--border-default)";

const fieldStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
  padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: 2 };

// Inline form, not a modal — same weight as AgentVault's NewAgentForm.
// Shared between create and edit (editing just pre-fills and calls
// updatePrompt instead of createPrompt) rather than two near-duplicate
// components.
function PromptForm({ initial, onSaved, onCancel }: { initial?: SavedPrompt; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [template, setTemplate] = useState(initial?.template ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const input = { name, description, template };
      const result = initial ? await updatePrompt(initial.id, input) : await createPrompt(input);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm, padding: spacing.sm, display: "flex", flexDirection: "column", gap: spacing.sm, marginBottom: spacing.xs }}>
      <div>
        <div style={labelStyle}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Competitor pricing check" style={fieldStyle} />
      </div>
      <div>
        <div style={labelStyle}>Description</div>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this prompt does, shown before you use it" style={fieldStyle} />
      </div>
      <div>
        <div style={labelStyle}>Template</div>
        <textarea value={template} onChange={e => setTemplate(e.target.value)} rows={4} placeholder="The actual text that fills the chat input when you click this." style={{ ...fieldStyle, resize: "vertical" }} />
      </div>
      {error && <div style={{ fontSize: fontSize.xxs, color: status.danger.color }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing.xs }}>
        <button onClick={onCancel} disabled={saving} style={{ padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xs, fontFamily }}>
          Cancel
        </button>
        <button
          onClick={handleSave} disabled={saving}
          style={{ padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.chat.hue, 0.12), color: accent, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily }}
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Create prompt"}
        </button>
      </div>
    </div>
  );
}

function PromptCard({ prompt, onDelete, onEdit, onUse }: { prompt: SavedPrompt; onDelete: () => void; onEdit: () => void; onUse?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm, marginBottom: spacing.xs, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: spacing.xs, textAlign: "left", padding: spacing.sm, border: "none", background: "transparent", cursor: "pointer", fontFamily }}
      >
        {expanded ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
        <CommentIcon size={12} />
        <span style={{ flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {prompt.name}
        </span>
        <span onClick={e => { e.stopPropagation(); onDelete(); }} style={{ display: "flex", color: neutral.textFaint, cursor: "pointer" }}>
          <TrashIcon size={11} />
        </span>
      </button>
      {expanded && (
        <div style={{ padding: `0 ${spacing.sm}px ${spacing.sm}px`, display: "flex", flexDirection: "column", gap: spacing.xs }}>
          {prompt.description && (
            <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>{prompt.description}</div>
          )}
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, background: "rgba(255,255,255,0.04)", borderRadius: radius.xs, padding: spacing.xs, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {prompt.template}
          </div>
          <div style={{ display: "flex", gap: spacing.xs }}>
            <button
              onClick={e => { e.stopPropagation(); onEdit(); }}
              style={{ padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily }}
            >
              Edit
            </button>
            {onUse && (
              <button
                onClick={e => { e.stopPropagation(); onUse(); }}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.chat.hue, 0.12), color: accent, cursor: "pointer", fontSize: fontSize.xxs, fontWeight: fontWeight.medium, fontFamily }}
              >
                <SparkleFillIcon size={10} /> Use
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// onUse is passed only by the right sidebar's Commands tab (see App.tsx)
// — the left sidebar's own Vault tab manages prompts but has no chat
// input to insert into, so it omits onUse and cards just show
// Edit/Delete. Same "reference, not a copy" relationship AgentVault has
// with workflow_definitions — there's exactly one prompts.ts store,
// this component just renders it in two different contexts.
export function PromptVault({ onUse }: { onUse?: (template: string) => void }) {
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listPrompts().then(setPrompts).catch(() => setPrompts([]));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    window.addEventListener(PROMPT_VAULT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROMPT_VAULT_CHANGED_EVENT, refresh);
  }, [refresh]);

  const handleDelete = async (id: string) => {
    await deletePrompt(id);
    refresh();
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <span style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em" }}>PROMPTS</span>
        <button
          onClick={() => { setEditingId(null); setShowNewForm(v => !v); }}
          title="New prompt"
          style={{ display: "flex", alignItems: "center", gap: 4, padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.chat.hue, 0.1), color: accent, cursor: "pointer", fontSize: fontSize.xxs, fontFamily }}
        >
          <PlusIcon size={10} /> New
        </button>
      </div>
      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.xs }}>
        {showNewForm && <PromptForm onSaved={() => { setShowNewForm(false); refresh(); }} onCancel={() => setShowNewForm(false)} />}
        {prompts === null ? (
          <div style={{ fontSize: fontSize.xs, color: neutral.textFaint, textAlign: "center", padding: spacing.lg }}>Loading…</div>
        ) : prompts.length === 0 && !showNewForm ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: spacing.lg, textAlign: "center", color: neutral.textFaint, gap: spacing.xs }}>
            <CommentIcon size={20} fill={accent} />
            <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, fontWeight: fontWeight.medium }}>No saved prompts yet</div>
            <div style={{ fontSize: fontSize.xxs }}>Create a reusable one with the button above.</div>
          </div>
        ) : (
          prompts.map(p =>
            editingId === p.id ? (
              <PromptForm key={p.id} initial={p} onSaved={() => { setEditingId(null); refresh(); }} onCancel={() => setEditingId(null)} />
            ) : (
              <PromptCard key={p.id} prompt={p} onDelete={() => handleDelete(p.id)} onEdit={() => setEditingId(p.id)} onUse={onUse ? () => onUse(p.template) : undefined} />
            )
          )
        )}
      </div>
    </div>
  );
}
