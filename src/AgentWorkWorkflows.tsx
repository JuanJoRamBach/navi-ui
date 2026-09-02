import { useCallback, useEffect, useState } from "react";
import { PlayIcon, PlusIcon, CalendarIcon, CommentDiscussionIcon, TrashIcon, AlertIcon, ChevronDownIcon, ChevronRightIcon, GitBranchIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
import { WORKFLOW_CREATED_EVENT, deleteWorkflow, listRuns, listWorkflows, runWorkflowNow, type AgentRun, type WorkflowDefinition } from "./agentWork";
import { AgentWorkGraphEditor } from "./AgentWorkGraphEditor";

const accent = CANVAS_ACCENT.agentWork.color;

// Neutral white-alpha overlay, not an accent/mode-tinted background —
// the established rule for every "raised surface" card in a right
// sidebar (sidebar-tokens.ts's own comment: "a consistent, restrained
// 'raised' surface, not a bright pill" — same treatment Knowledge items
// and source rows already use). Workflow cards previously had no
// background at all, reading as placeholder rows rather than real,
// separated features (2026-09-02, JuanJo).
const CARD_BG = "rgba(255,255,255,0.05)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.08)";

const STATUS_COLOR: Record<string, string> = {
  completed: "#3ecf8e", running: "#e0b94a", queued: "#e0b94a", failed: "#e05a4a",
};

function formatWhen(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatInterval(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds / 86400 === 1 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds / 3600 === 1 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds / 60 === 1 ? "" : "s"}`;
  return `${seconds}s`;
}

// Confirm-before-destroy (2026-09-02, JuanJo, after a workflow he created
// recurred every 5 minutes indefinitely: "make a warning pop up over the
// erase/eliminate button to confirm — we don't want accidents happening").
// A real overlay, not an inline "are you sure" row — a stray second click
// on a spot the row un-expectedly reflows into shouldn't be able to
// confirm a delete it never meant to.
function DeleteConfirmDialog({ name, scheduled, deleting, error, onCancel, onConfirm }: {
  name: string; scheduled: boolean; deleting: boolean; error: string | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center", fontFamily,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 300, background: "#161616", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: radius.sm, padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.sm,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, color: "#e05a4a" }}>
          <AlertIcon size={16} />
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>Delete this workflow?</span>
        </div>
        <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, lineHeight: 1.5 }}>
          <strong style={{ color: neutral.textPrimary }}>{name}</strong> will be permanently deleted.
          {scheduled && " Its schedule is cancelled immediately — it will not fire again."}
          {" "}Past runs stay in Run History; this can't be undone.
        </div>
        {error && <div style={{ fontSize: fontSize.xxs, color: "#e05a4a" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing.xs, marginTop: spacing.xxs }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
              background: "transparent", color: neutral.textMuted, cursor: deleting ? "default" : "pointer", fontSize: fontSize.xs, fontFamily,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid #e05a4a55",
              background: "#e05a4a22", color: "#e05a4a", cursor: deleting ? "default" : "pointer",
              fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily, opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One workflow, as a real card — not a flat list row (2026-09-02,
// JuanJo: "those 'workflows' feel like placeholders, not actual working
// features" + "a UI Card for being over the right sidebar, separating
// each"). Click-to-expand reveals what was previously invisible: every
// step's actual prompt and tool(s), and the real schedule detail (not
// just "1 left") — the whole point being that a saved workflow should
// read as a real, inspectable thing, not a name with a Run button.
function WorkflowCard({ wf, lastRun, running, onRun, onDeleteClick }: {
  wf: WorkflowDefinition; lastRun: AgentRun | undefined; running: boolean;
  onRun: () => void; onDeleteClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = wf.trigger;
  const scheduled = trigger.type === "scheduled";
  // Wording matters here (2026-09-01, JuanJo: "we must show the user
  // that those 'jobs' exist... no 'forever' wording") — an indefinite
  // schedule and a bounded one used to look identical ("Scheduled"
  // either way), which is exactly the "invisible, perpetually
  // repeating, wasting resources" risk being flagged against. "No
  // expiration set" mirrors the same wording the manual creation form
  // uses for the same field.
  const triggerLabel = trigger.type !== "scheduled"
    ? "Manual"
    : trigger.next_run_at == null
      ? "Scheduled · done"
      : trigger.remaining_runs == null
        ? "Scheduled · no expiration set"
        : `Scheduled · ${trigger.remaining_runs} left`;

  return (
    <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: radius.sm, marginBottom: spacing.xs, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%", display: "flex", flexDirection: "column", gap: 4, textAlign: "left",
          padding: spacing.sm, border: "none", background: "transparent", cursor: "pointer", fontFamily,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, minWidth: 0 }}>
          {expanded ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
          <span style={{
            flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
          }}>
            {wf.name}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              onClick={onRun}
              disabled={running}
              title="Run now"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
                border: `1px solid ${accent}55`, background: "transparent",
                color: accent, cursor: running ? "default" : "pointer",
                fontSize: fontSize.xxs, fontFamily, opacity: running ? 0.5 : 1,
              }}
            >
              <PlayIcon size={10} /> {running ? "Starting…" : "Run"}
            </button>
            <button
              onClick={onDeleteClick}
              title="Delete workflow"
              style={{
                display: "flex", alignItems: "center", padding: `2px ${spacing.xxs}px`, borderRadius: radius.xs,
                border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
                color: neutral.textFaint, cursor: "pointer",
              }}
            >
              <TrashIcon size={10} />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.xxs, color: neutral.textFaint, paddingLeft: 18 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {scheduled && <CalendarIcon size={10} />}
            {triggerLabel}
          </span>
          {lastRun && (
            <>
              <span>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: 9999, background: STATUS_COLOR[lastRun.status] ?? neutral.textFaint }} />
                {lastRun.status} {formatWhen(lastRun.started_at)}
              </span>
            </>
          )}
        </div>
      </button>
      {expanded && (
        <div style={{ padding: `0 ${spacing.sm}px ${spacing.sm}px ${spacing.sm}px`, display: "flex", flexDirection: "column", gap: spacing.sm }}>
          {wf.description && (
            <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>{wf.description}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
            {wf.graph.nodes.map((node, i) => (
              <div key={node.id} style={{
                borderLeft: `2px solid ${accent}55`, paddingLeft: spacing.xs,
                display: "flex", flexDirection: "column", gap: 2,
              }}>
                <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, fontFamily: "monospace" }}>
                  {i + 1}. {node.tools && node.tools.length > 0 ? node.tools.join(", ") : "text only"}
                </div>
                <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {node.prompt}
                </div>
              </div>
            ))}
          </div>
          {scheduled && trigger.type === "scheduled" && (
            <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, lineHeight: 1.6 }}>
              {trigger.interval_seconds ? <>Repeats every {formatInterval(trigger.interval_seconds)}.<br /></> : "One-time run.\n"}
              {trigger.next_run_at != null
                ? <>Next run: {formatWhen(trigger.next_run_at)}.</>
                : "No further runs scheduled."}
              {trigger.remaining_runs != null && <> {trigger.remaining_runs} remaining.</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Every saved workflow_definition — name, trigger, most recent run
// (client-side joined against a plain listRuns() call rather than a new
// backend field, since run volume is small right now), manual "Run Now".
// Right sidebar's primary pane for Agent Work (JuanJo, 2026-09-01: this
// replaces the earlier "Schedule" calendar placeholder here — the
// calendar itself moved to its own floating overlay instead, see
// AgentWorkCalendar.tsx).
//
// onNewWorkflow (2026-09-01): "that button should be inside where
// workflows live" — the sidebar's own header is the primary entry point
// now; App.tsx still keeps a fallback CTA in the empty-canvas state too,
// since the right sidebar defaults closed and auto-closes on a canvas
// switch, so this alone wouldn't always be reachable.
export function AgentWorkWorkflows({ onNewWorkflow }: { onNewWorkflow: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[] | null>(null);
  const [lastRunByWorkflow, setLastRunByWorkflow] = useState<Record<string, AgentRun>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string; scheduled: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showGraphEditor, setShowGraphEditor] = useState(false);

  const refresh = useCallback(() => {
    listWorkflows().then(setWorkflows).catch(() => setWorkflows([]));
    listRuns().then(runs => {
      const latest: Record<string, AgentRun> = {};
      for (const run of runs) {
        if (!run.workflow_id) continue;
        const existing = latest[run.workflow_id];
        if (!existing || run.started_at > existing.started_at) latest[run.workflow_id] = run;
      }
      setLastRunByWorkflow(latest);
    }).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener(WORKFLOW_CREATED_EVENT, refresh);
    return () => window.removeEventListener(WORKFLOW_CREATED_EVENT, refresh);
  }, [refresh]);

  const runNow = async (workflowId: string) => {
    setRunningId(workflowId);
    try {
      await runWorkflowNow(workflowId);
      refresh();
      // Also refreshes AgentWorkRunHistory's separate sidebar pane —
      // same event, not a new one, since it's the same "something
      // workflow-related just happened" signal.
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
    } finally {
      setRunningId(null);
    }
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setDeletingId(confirmTarget.id);
    setDeleteError(null);
    try {
      const ok = await deleteWorkflow(confirmTarget.id);
      if (!ok) {
        setDeleteError("Couldn't delete it — NAVI may be unreachable. Try again.");
        return;
      }
      setConfirmTarget(null);
      refresh();
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
    } finally {
      setDeletingId(null);
    }
  };

  const header = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
    }}>
      <span style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em" }}>
        WORKFLOWS
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={() => setShowGraphEditor(true)}
          title="Visual Builder"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
            border: "1px solid rgba(255,255,255,0.12)", background: "transparent",
            color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
          }}
        >
          <GitBranchIcon size={10} /> Visual
        </button>
        <button
          onClick={onNewWorkflow}
          title="New Workflow"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
            border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.1),
            color: accent, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
          }}
        >
          <PlusIcon size={10} /> New
        </button>
      </div>
    </div>
  );

  if (workflows === null) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", color: neutral.textFaint, fontSize: fontSize.xs }}>
          Loading…
        </div>
        {showGraphEditor && <AgentWorkGraphEditor onClose={() => setShowGraphEditor(false)} />}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
        {header}
        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: spacing.lg, textAlign: "center", color: neutral.textFaint, gap: spacing.xs,
        }}>
          <CommentDiscussionIcon size={22} fill={accent} />
          <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, fontWeight: fontWeight.medium }}>No workflows yet</div>
          <div style={{ fontSize: fontSize.xxs }}>Describe one in the chat, or create one with the button above.</div>
        </div>
        {showGraphEditor && <AgentWorkGraphEditor onClose={() => setShowGraphEditor(false)} />}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      {header}
      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.xs }}>
      {workflows.map(wf => (
        <WorkflowCard
          key={wf.id}
          wf={wf}
          lastRun={lastRunByWorkflow[wf.id]}
          running={runningId === wf.id}
          onRun={() => runNow(wf.id)}
          onDeleteClick={() => { setConfirmTarget({ id: wf.id, name: wf.name, scheduled: wf.trigger.type === "scheduled" }); setDeleteError(null); }}
        />
      ))}
      </div>
      {confirmTarget && (
        <DeleteConfirmDialog
          name={confirmTarget.name}
          scheduled={confirmTarget.scheduled}
          deleting={deletingId === confirmTarget.id}
          error={deleteError}
          onCancel={() => { setConfirmTarget(null); setDeleteError(null); }}
          onConfirm={confirmDelete}
        />
      )}
      {showGraphEditor && <AgentWorkGraphEditor onClose={() => setShowGraphEditor(false)} />}
    </div>
  );
}
