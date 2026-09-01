// Dev Slate's client — the WebSocket connection to NAVI's own dev_slate_chat
// pipeline (server.py's /ws/devslate/{id}, dispatcher/devslate_chat.py) plus
// the REST calls for Slate management and model catalog/switching. Kept
// separate from App.tsx's existing chat plumbing (which still talks to
// /chat/send, single-message, no history) — Dev Slate has real server-side
// conversation memory and a persistent connection, a genuinely different
// shape, not a variant of the same thing.
import { NAVI_BACKEND_URL } from "./config";
import { handleDevSlateToolCall, readLocalFile, writeLocalFile } from "./devslateFs";

export interface PendingWrite {
  path: string;
  before: string;
  after: string;
}

export interface DevSlateMessage {
  role: "user" | "navi";
  text: string;
  provider?: string | null;
  model?: string | null;
}

export interface ModelCandidate {
  provider: string;
  model: string;
  context_length: number | null;
}

export interface ModelCatalog {
  task: string;
  current: { provider: string; model: string } | null;
  candidates: ModelCandidate[];
}

function wsUrl(conversationId: string): string {
  const httpUrl = new URL(NAVI_BACKEND_URL);
  const scheme = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${httpUrl.host}/ws/devslate/${conversationId}`;
}

export async function createSlate(parentId?: string): Promise<{ id: string; parent_id: string | null }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/devslate/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parentId ? { parent_id: parentId } : {}),
  });
  return res.json();
}

export async function loadSlateHistory(conversationId: string): Promise<{ messages: DevSlateMessage[]; task_state: unknown }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/devslate/conversations/${conversationId}/messages`);
  const data = await res.json();
  return {
    messages: (data.messages ?? []).map((m: { role: string; content: string; provider?: string; model?: string }) => ({
      role: m.role === "navi" ? "navi" : "user",
      text: m.content,
      provider: m.provider,
      model: m.model,
    })),
    task_state: data.task_state ?? null,
  };
}

export async function fetchModelCatalog(task: string): Promise<ModelCatalog> {
  const res = await fetch(`${NAVI_BACKEND_URL}/config/models?task=${encodeURIComponent(task)}`);
  return res.json();
}

export async function setPinnedModel(role: string, provider: string, model: string): Promise<boolean> {
  const res = await fetch(`${NAVI_BACKEND_URL}/config/role`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, provider, model }),
  });
  return res.ok;
}

type IncomingFrame =
  | { type: "assistant_message"; text: string; provider: string | null; model: string | null }
  | { type: "tool_request"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

export interface DevSlateConnection {
  send(text: string): void;
  close(): void;
}

// One open connection per active Slate. Every reply arriving on this
// socket is a push, not a poll response — the mechanism itself is what
// satisfies "NAVI can send a message without being asked" (see the
// dispatcher/devslate_chat.py module docstring); nothing yet triggers a
// truly unprompted message, but onMessage below fires for anything the
// server chooses to send, at any time, not just replies.
export interface DevSlateHandlers {
  onMessage: (msg: DevSlateMessage) => void;
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
  // Called for every proposed write_file — default review mode (see
  // App.tsx's autoAcceptEdits flag) awaits the user's Accept/Reject in
  // the UI; auto-accept mode skips straight to true. Not called at all
  // when autoAccept is on, since there's nothing to ask.
  onWriteRequest?: (write: PendingWrite) => Promise<boolean>;
  autoAccept?: boolean;
  // Fired the moment a user_message is sent and again on every relayed
  // tool call, so the UI has something concrete to show while a turn is
  // in flight — otherwise a slow (or silently failing) reply just looks
  // frozen. Cleared by the caller once assistant_message arrives.
  onActivity?: (status: string) => void;
}

const TOOL_ACTIVITY_LABEL: Record<string, (args: Record<string, unknown>) => string> = {
  read_file: (args) => `Reading ${args.path ?? "a file"}…`,
  write_file: (args) => `Proposing a change to ${args.path ?? "a file"}…`,
  grep: (args) => `Searching for "${args.pattern ?? ""}"…`,
  update_task_state: () => "Updating Slate notes…",
};

export function connectDevSlate(conversationId: string, handlers: DevSlateHandlers): DevSlateConnection {
  const ws = new WebSocket(wsUrl(conversationId));
  handlers.onStatusChange?.("connecting");

  ws.onopen = () => handlers.onStatusChange?.("open");
  ws.onclose = () => handlers.onStatusChange?.("closed");

  ws.onmessage = async (event) => {
    let frame: IncomingFrame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }

    if (frame.type === "assistant_message") {
      handlers.onMessage({ role: "navi", text: String(frame.text ?? ""), provider: frame.provider as string | null, model: frame.model as string | null });
      return;
    }

    if (frame.type === "tool_request") {
      const name = frame.name as string;
      const args = frame.arguments as Record<string, unknown>;
      handlers.onActivity?.((TOOL_ACTIVITY_LABEL[name] ?? (() => `Running ${name}…`))(args));

      // write_file gets the review treatment (default mode is "accept
      // changes" — the user approves each diff, per JuanJo's explicit
      // call, 2026-09-01) — every other relayed tool (read_file, grep)
      // is read-only and doesn't need it.
      if (name === "write_file" && !handlers.autoAccept) {
        const path = String(args.path ?? "");
        const after = String(args.content ?? "");
        const before = await readLocalFile(path).catch(() => "");
        const accepted = (await handlers.onWriteRequest?.({ path, before, after })) ?? false;
        const result = accepted
          ? await writeLocalFile(path, after)
          : `The user reviewed this change and did not accept it. ${path} was left unchanged.`;
        ws.send(JSON.stringify({ type: "tool_result", id: frame.id, result }));
        return;
      }

      // Executed locally (File System Access API today, a Tauri native
      // bridge later — see devslateFs.ts) since the user's project files
      // live on their own machine, never on NAVI's server.
      const result = await handleDevSlateToolCall(name, args);
      ws.send(JSON.stringify({ type: "tool_result", id: frame.id, result }));
    }
  };

  return {
    send(text: string) {
      if (ws.readyState === WebSocket.OPEN) {
        handlers.onActivity?.("Thinking…");
        ws.send(JSON.stringify({ type: "user_message", text }));
      }
    },
    close() {
      ws.close();
    },
  };
}
