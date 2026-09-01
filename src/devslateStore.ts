// Shared state across Dev Slate's independent panes (Chat/Files/Code/
// Terminal/Preview) — they're rendered as sibling components in App.tsx's
// Group/Panel layout, not nested under one wrapper, so prop-drilling
// isn't a natural fit. A plain module-level store (React's
// useSyncExternalStore, no context/redux needed for this little state)
// keeps every pane in sync: which file is open, a pending write's diff
// (shown in the Code pane, per the layout's own original comment —
// "also hosts the diff view when reviewing an AI-proposed change"), and
// the Preview sandbox's console output (shown in the Terminal pane).
import { useSyncExternalStore } from "react";
import { readLocalFile } from "./devslateFs";
import type { PendingWrite } from "./devslate";

export interface TerminalLine {
  level: "log" | "warn" | "error";
  text: string;
}

interface DevSlateState {
  activeFilePath: string | null;
  activeFileContent: string;
  pendingWrite: PendingWrite | null;
  terminalLines: TerminalLine[];
}

let state: DevSlateState = {
  activeFilePath: null,
  activeFileContent: "",
  pendingWrite: null,
  terminalLines: [],
};
let onWriteDecision: ((accepted: boolean) => void) | null = null;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function setState(patch: Partial<DevSlateState>) {
  state = { ...state, ...patch };
  emit();
}

export function useDevSlateState(): DevSlateState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
  );
}

export async function openDevSlateFile(path: string): Promise<void> {
  const content = await readLocalFile(path);
  setState({ activeFilePath: path, activeFileContent: content, pendingWrite: null });
}

// Called by devslate.ts's WebSocket handler when the model calls
// write_file — surfaces the diff in the Code pane and waits for the
// user's Accept/Reject (default review mode) before anything lands on
// disk, unless auto-accept is on (see DevSlateChat.tsx).
export function requestWriteReview(write: PendingWrite): Promise<boolean> {
  setState({ pendingWrite: write, activeFilePath: write.path, activeFileContent: write.before });
  return new Promise<boolean>((resolve) => {
    onWriteDecision = resolve;
  });
}

// Only updates local UI state and resolves the pending promise — the
// actual disk write happens exactly once, in devslate.ts's tool_request
// handler (it owns the WebSocket relay and reports the result back to
// the model). Writing here too would double-apply the same change.
export function decideWriteReview(accepted: boolean): void {
  const write = state.pendingWrite;
  if (!write) return;
  setState({ activeFileContent: accepted ? write.after : write.before, pendingWrite: null });
  onWriteDecision?.(accepted);
  onWriteDecision = null;
}

export function appendTerminalLine(level: TerminalLine["level"], text: string): void {
  setState({ terminalLines: [...state.terminalLines, { level, text }].slice(-500) });
}

export function clearTerminal(): void {
  setState({ terminalLines: [] });
}
