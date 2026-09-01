// Dev Slate's local-file bridge — the user's project files live on their
// own machine, never on Lightsail (see handoff.md, 2026-09-01: "files on
// the user's PC, not on LightSail, only the chat is saved there for
// context"). NAVI's backend can't touch them directly, so read_file/
// write_file/grep tool calls get relayed here (over the Dev Slate
// WebSocket, see devslate.ts) and executed against a real local folder
// via the browser's File System Access API.
//
// Deliberately kept behind this one module's function signatures rather
// than called inline wherever a tool_request arrives — when the eventual
// Tauri desktop wrapper ships (see the navi-desktop-packaging-tauri
// memory), swapping this module's internals for Tauri's native fs
// bridge is a drop-in replacement, not a rewrite of every call site.
// That's also why every export here is async and returns plain
// strings/booleans, never a raw FileSystemHandle — callers (and a future
// Tauri implementation) shouldn't need to know which backend is live.
//
// Chromium-only (Chrome/Edge/Opera) — Safari and Firefox never
// implemented showDirectoryPicker(). hasLocalFsSupport() lets the UI
// degrade honestly instead of silently failing.

const HANDLE_DB_NAME = "navi-devslate-fs";
const HANDLE_STORE = "handles";
const ROOT_HANDLE_KEY = "root";

export function hasLocalFsSupport(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, ROOT_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(ROOT_HANDLE_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return handle;
}

let _rootHandle: FileSystemDirectoryHandle | null = null;

// Re-authorizes a handle restored from IndexedDB across a page reload —
// the browser persists the handle object itself, but re-confirms
// permission per session rather than granting it forever silently.
async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  type PermissionCapable = FileSystemDirectoryHandle & {
    queryPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
    requestPermission(opts: { mode: "readwrite" }): Promise<PermissionState>;
  };
  const h = handle as PermissionCapable;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function getConnectedFolderName(): Promise<string | null> {
  if (_rootHandle) return _rootHandle.name;
  const stored = await loadRootHandle();
  if (!stored) return null;
  if (!(await ensurePermission(stored))) return null;
  _rootHandle = stored;
  return stored.name;
}

// The one user-gesture-gated entry point — must be called directly from
// a click handler (browser requirement for showDirectoryPicker), not
// from inside an awaited chain.
export async function connectFolder(): Promise<string | null> {
  if (!hasLocalFsSupport()) return null;
  const picker = (window as unknown as {
    showDirectoryPicker: (opts: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  const handle = await picker({ mode: "readwrite" });
  _rootHandle = handle;
  await saveRootHandle(handle);
  return handle.name;
}

export function disconnectFolder(): void {
  _rootHandle = null;
}

async function requireRoot(): Promise<FileSystemDirectoryHandle> {
  if (_rootHandle) return _rootHandle;
  const name = await getConnectedFolderName();
  if (!name || !_rootHandle) throw new Error("No project folder connected yet.");
  return _rootHandle;
}

async function resolveDirectory(root: FileSystemDirectoryHandle, segments: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

function splitPath(path: string): { dirSegments: string[]; filename: string } {
  const clean = path.replace(/^\/+/, "");
  const parts = clean.split("/").filter(Boolean);
  return { dirSegments: parts.slice(0, -1), filename: parts[parts.length - 1] ?? "" };
}

export async function readLocalFile(path: string): Promise<string> {
  const root = await requireRoot();
  const { dirSegments, filename } = splitPath(path);
  if (!filename) return `Error: '${path}' isn't a file path.`;
  try {
    const dir = await resolveDirectory(root, dirSegments, false);
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return `Error: couldn't read '${path}' — it may not exist.`;
  }
}

export async function writeLocalFile(path: string, content: string): Promise<string> {
  const root = await requireRoot();
  const { dirSegments, filename } = splitPath(path);
  if (!filename) return `Error: '${path}' isn't a file path.`;
  const dir = await resolveDirectory(root, dirSegments, true);
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return `Wrote ${content.length} characters to ${path}.`;
}

const GREP_MAX_MATCHES = 40;
const GREP_MAX_FILES_SCANNED = 500;
const GREP_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".vite"]);

async function* walkFiles(dir: FileSystemDirectoryHandle, prefix: string): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      if (GREP_SKIP_DIRS.has(name)) continue;
      yield* walkFiles(handle as FileSystemDirectoryHandle, path);
    } else {
      yield { path, handle: handle as FileSystemFileHandle };
    }
  }
}

// Plain substring/regex search across the connected folder — deliberately
// simple (no ripgrep-style binary, no gitignore parsing) given the
// light-coding scope Dev Slate targets. path_glob is matched as a plain
// suffix/substring check, not real glob syntax, for the same reason.
export async function grepLocal(pattern: string, pathGlob?: string): Promise<string> {
  const root = await requireRoot();
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }

  const matches: string[] = [];
  let scanned = 0;
  for await (const { path, handle } of walkFiles(root, "")) {
    if (scanned >= GREP_MAX_FILES_SCANNED || matches.length >= GREP_MAX_MATCHES) break;
    if (pathGlob && !path.includes(pathGlob.replace(/[*]/g, ""))) continue;
    scanned++;
    let text: string;
    try {
      text = await (await handle.getFile()).text();
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && matches.length < GREP_MAX_MATCHES; i++) {
      if (regex.test(lines[i])) {
        matches.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  }
  if (matches.length === 0) return `No matches for "${pattern}".`;
  const truncated = matches.length >= GREP_MAX_MATCHES ? `\n(showing first ${GREP_MAX_MATCHES} matches)` : "";
  return matches.join("\n") + truncated;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

// Shallow listing (one level) for the Files panel — drills in on click
// rather than eagerly reading the whole tree, same shape as the existing
// mock Files browser's drill-in pattern.
export async function listLocalDirectory(path = ""): Promise<FileTreeEntry[]> {
  const root = await requireRoot();
  const { dirSegments } = path ? splitPath(`${path}/_`) : { dirSegments: [] as string[] };
  const dir = await resolveDirectory(root, dirSegments, false);
  const entries: FileTreeEntry[] = [];
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (GREP_SKIP_DIRS.has(name)) continue;
    entries.push({
      name,
      path: path ? `${path}/${name}` : name,
      kind: handle.kind === "directory" ? "directory" : "file",
    });
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  return entries;
}

// Dispatches one relayed tool call by name — the single function
// devslate.ts's WebSocket handler needs to know about, so it doesn't
// have to import every individual fs function itself.
export async function handleDevSlateToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "read_file":
        return await readLocalFile(String(args.path ?? ""));
      case "write_file":
        return await writeLocalFile(String(args.path ?? ""), String(args.content ?? ""));
      case "grep":
        return await grepLocal(String(args.pattern ?? ""), args.path_glob ? String(args.path_glob) : undefined);
      default:
        return `Tool error: unknown local tool '${name}'.`;
    }
  } catch (e) {
    return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
