import { useState } from "react";
import { PlusIcon, XIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, status, actionInk } from "./tokens";
import { createWorkflow, WORKFLOW_CREATED_EVENT, type WorkflowGraph, type WorkflowTrigger } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;

interface StepDraft {
  id: string;
  prompt: string;
}

let stepCounter = 0;
function newStep(): StepDraft {
  stepCounter += 1;
  return { id: `n${stepCounter}`, prompt: "" };
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
  padding: `${spacing.xxs}px ${spacing.xs}px`, boxSizing: "border-box",
};

// Manual workflow creation (JuanJo, 2026-09-01: "Can't I create one
// manually?" — until now the only path was asking the chat to call
// create_workflow). Multi-step, not just single-step: a single-step
// workflow is just a one-row version of this, so supporting both costs
// little extra and doesn't artificially cap what gets tested. Steps
// become a linear node chain (n1 -> n2 -> n3...) — the same shape a
// chat-created workflow produces, no branching UI here (that's the
// future node-graph builder's job).
export function AgentWorkNewWorkflowForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([newStep()]);
  const [scheduled, setScheduled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  // Blank = null = "no expiration set" (2026-09-01) — keeps firing until
  // removed. A real count decrements each fire; see
  // dispatcher/agent_work.py's check_due_workflows for how that's
  // enforced server-side.
  const [repeatCountInput, setRepeatCountInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStep = (id: string, prompt: string) => {
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, prompt } : s)));
  };

  const removeStep = (id: string) => {
    setSteps(prev => (prev.length > 1 ? prev.filter(s => s.id !== id) : prev));
  };

  const save = async () => {
    setError(null);
    const trimmedName = name.trim();
    const validSteps = steps.filter(s => s.prompt.trim());
    if (!trimmedName || validSteps.length === 0) {
      setError("Name and at least one step are required.");
      return;
    }
    const graph: WorkflowGraph = {
      nodes: validSteps.map(s => ({ id: s.id, prompt: s.prompt.trim() })),
      edges: validSteps.slice(1).map((s, i) => ({ from: validSteps[i].id, to: s.id })),
    };
    const repeatCount = repeatCountInput.trim() ? Math.max(1, Number(repeatCountInput) || 1) : null;
    const trigger: WorkflowTrigger = scheduled
      ? {
          type: "scheduled", interval_seconds: intervalMinutes * 60,
          next_run_at: Date.now() / 1000 + intervalMinutes * 60,
          remaining_runs: repeatCount,
        }
      : { type: "manual" };

    setSaving(true);
    try {
      await createWorkflow(trimmedName, null, graph, trigger);
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
      onDone();
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
      <div>
        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: 2 }}>Name</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Weekly summary post" style={inputStyle} />
      </div>

      <div>
        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, marginBottom: 2 }}>
          Steps — each runs its own model call, in order
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
          {steps.map((step, i) => (
            <div key={step.id} style={{ display: "flex", gap: spacing.xs, alignItems: "flex-start" }}>
              <span style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xxs}px 0`, flexShrink: 0, width: 14 }}>{i + 1}.</span>
              <textarea
                value={step.prompt}
                onChange={e => updateStep(step.id, e.target.value)}
                placeholder="What should this step do?"
                rows={2}
                style={{ ...inputStyle, resize: "vertical", fontFamily }}
              />
              {steps.length > 1 && (
                <button
                  onClick={() => removeStep(step.id)}
                  aria-label="Remove step"
                  style={{ background: "none", border: "none", color: neutral.textFaint, cursor: "pointer", flexShrink: 0, padding: `${spacing.xxs}px 0` }}
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => setSteps(prev => [...prev, newStep()])}
          style={{
            display: "flex", alignItems: "center", gap: 4, marginTop: spacing.xs,
            background: "none", border: "none", color: accent, cursor: "pointer", fontSize: fontSize.xxs, fontFamily, padding: 0,
          }}
        >
          <PlusIcon size={11} /> Add step
        </button>
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.xxs, color: neutral.textMuted, cursor: "pointer" }}>
          <input type="checkbox" checked={scheduled} onChange={e => setScheduled(e.target.checked)} />
          Run on a schedule (otherwise manual only)
        </label>
        {scheduled && (
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs, fontSize: fontSize.xxs, color: neutral.textMuted }}>
            Every
            <input
              type="number" min={1} value={intervalMinutes}
              onChange={e => setIntervalMinutes(Math.max(1, Number(e.target.value) || 1))}
              style={{ ...inputStyle, width: 70 }}
            />
            minutes, starting now
          </div>
        )}
        {scheduled && (
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs, fontSize: fontSize.xxs, color: neutral.textMuted }}>
            Repeat
            <input
              type="number" min={1} value={repeatCountInput}
              onChange={e => setRepeatCountInput(e.target.value)}
              placeholder="No expiration set"
              style={{ ...inputStyle, width: 130 }}
            />
            times (blank = no expiration set)
          </div>
        )}
      </div>

      {error && <div style={{ fontSize: fontSize.xxs, color: status.danger.color }}>{error}</div>}

      <button
        onClick={save}
        disabled={saving}
        style={{
          alignSelf: "flex-start", padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm,
          border: "none", background: accent, color: actionInk, cursor: saving ? "default" : "pointer",
          fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily, opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "Creating…" : "Create workflow"}
      </button>
    </div>
  );
}
