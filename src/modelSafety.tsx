import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AlertFillIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, fontFamily, neutral, status } from "./tokens";
import { fetchModelCatalog, type ModelCandidate, type ModelCatalog } from "./devslate";

// Models NAVI must not send client data to (2026-09-23). The server marks
// them with `client_data_warning` (config/store.py's NOT_FOR_CLIENT_DATA:
// LLM7, GMI Cloud, OpenRouter's free models) after checking each
// provider's own terms. NAVI never routes to them on its own; a person can
// still pick one, and then:
// - the picker asks first (RiskyPickConfirm),
// - the chat shows ClientDataWarning over its input for as long as that
//   model stays selected.

export const CLIENT_DATA_WARNING_TEXT = "This AI model must not handle client data, it might break EU privacy laws.";

// ---- One shared model catalog per task -----------------------------------
//
// Dev Slate, Agent Work and Agent Vault each had their model catalog as
// private state inside their picker, so nothing else in the chat could
// know which model was selected. The warning over the input needs to, so
// the catalog lives here, once per task, and both the picker and the
// warning read the same copy. Agent Work and Agent Vault share the
// "agent_work" role, so a pick in one now shows in the other too.

const catalogs = new Map<string, ModelCatalog | null>();
const listeners = new Map<string, Set<() => void>>();

function notify(task: string) {
  listeners.get(task)?.forEach(fn => fn());
}

export function refreshModelCatalog(task: string): Promise<void> {
  return fetchModelCatalog(task)
    .then(c => { catalogs.set(task, c); })
    .catch(() => { catalogs.set(task, null); })
    .then(() => notify(task));
}

export function useModelCatalog(task: string): [ModelCatalog | null, () => Promise<void>] {
  const subscribe = useCallback((fn: () => void) => {
    if (!listeners.has(task)) listeners.set(task, new Set());
    listeners.get(task)!.add(fn);
    return () => { listeners.get(task)!.delete(fn); };
  }, [task]);
  const catalog = useSyncExternalStore(subscribe, () => catalogs.get(task) ?? null);
  useEffect(() => {
    if (!catalogs.has(task)) void refreshModelCatalog(task);
  }, [task]);
  const refresh = useCallback(() => refreshModelCatalog(task), [task]);
  return [catalog, refresh];
}

// ---- The warning over the chat input -------------------------------------

// Same shape as the live status line that shows while a model is working
// (a marker, then one short line of text), in the danger colors instead of
// muted grey, with a faint tinted background so it still reads over the
// dot-grid behind Dev Slate and Agent Work.
export function ClientDataWarning({ reason }: { reason?: string | null }) {
  return (
    <div
      role="alert"
      title={reason ?? undefined}
      style={{
        display: "flex", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start",
        maxWidth: "100%", boxSizing: "border-box",
        padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.sm,
        background: status.danger.bg, border: `1px solid ${status.danger.border}`,
        color: status.danger.color, fontSize: fontSize.xxs, fontFamily, lineHeight: 1.4,
      }}
    >
      <AlertFillIcon size={12} />
      <span>{CLIENT_DATA_WARNING_TEXT}</span>
    </div>
  );
}

// Renders the warning only while the selected model needs it.
export function ClientDataWarningFor({ catalog, style }: { catalog: ModelCatalog | null; style?: React.CSSProperties }) {
  const reason = catalog?.current?.client_data_warning;
  if (!reason) return null;
  return (
    <div style={{ display: "flex", ...style }}>
      <ClientDataWarning reason={reason} />
    </div>
  );
}

// ---- In the picker ----------------------------------------------------------

// Shown next to a flagged model's name, so the risk is visible before the
// click, not only after it.
export function NotForClientDataTag({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
        fontSize: 10, lineHeight: "14px", padding: "0 5px", borderRadius: 9999,
        color: status.danger.color, background: status.danger.bg, border: `1px solid ${status.danger.border}`,
        fontFamily, whiteSpace: "nowrap",
      }}
    >
      <AlertFillIcon size={9} /> Not for client data
    </span>
  );
}

// Picking a flagged model takes two clicks: the first opens this under the
// row, the second confirms. Everything else still picks in one.
export function useRiskyPick(onPick: (provider: string, model: string) => void) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const request = (c: ModelCandidate) => {
    if (c.client_data_warning) setConfirming(`${c.provider}/${c.model}`);
    else onPick(c.provider, c.model);
  };
  const isConfirming = (c: ModelCandidate) => confirming === `${c.provider}/${c.model}`;
  const cancel = () => setConfirming(null);
  const confirm = (c: ModelCandidate) => { setConfirming(null); onPick(c.provider, c.model); };
  return { request, isConfirming, cancel, confirm };
}

export function RiskyPickConfirm({ candidate, onConfirm, onCancel }: {
  candidate: ModelCandidate; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      style={{
        display: "flex", flexDirection: "column", gap: spacing.xs,
        margin: `2px 0 ${spacing.xs}px`, padding: spacing.xs, borderRadius: radius.xs,
        background: status.danger.bg, border: `1px solid ${status.danger.border}`,
        fontSize: fontSize.xxs, fontFamily, color: status.danger.color, lineHeight: 1.45,
      }}
    >
      <span style={{ display: "flex", gap: spacing.xxs }}>
        <AlertFillIcon size={12} />
        <span>
          {CLIENT_DATA_WARNING_TEXT} {candidate.client_data_warning} Only use it with information that is already public.
        </span>
      </span>
      <span style={{ display: "flex", gap: spacing.xs }}>
        <button
          onClick={onConfirm}
          style={{
            padding: `2px ${spacing.sm}px`, borderRadius: radius.xs, cursor: "pointer", fontFamily,
            fontSize: fontSize.xxs, fontWeight: fontWeight.medium,
            border: `1px solid ${status.danger.border}`, background: "transparent", color: status.danger.color,
          }}
        >
          Use it anyway
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: `2px ${spacing.sm}px`, borderRadius: radius.xs, cursor: "pointer", fontFamily,
            fontSize: fontSize.xxs, border: "1px solid var(--border-default)", background: "transparent",
            color: neutral.textMuted,
          }}
        >
          Cancel
        </button>
      </span>
    </div>
  );
}
