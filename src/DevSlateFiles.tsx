import { useEffect, useState } from "react";
import { FileIcon, FileDirectoryIcon, ChevronLeftIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, iconSize, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { connectFolder, getConnectedFolderName, hasLocalFsSupport, listLocalDirectory, type FileTreeEntry } from "./devslateFs";
import { openDevSlateFile, useDevSlateState } from "./devslateStore";

const accent = CANVAS_ACCENT.devSlate.color;

// Shallow drill-in browser for the connected local folder — same
// "clicking a folder swaps the view to its contents" pattern the
// existing (mock) Files panel already uses, just backed by the real
// File System Access API here instead of mock data. Read-only browsing;
// the actual read/write/grep tool calls happen through devslateFs.ts's
// relay, not from clicking around here.
export function DevSlateFiles() {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { activeFilePath } = useDevSlateState();

  useEffect(() => {
    getConnectedFolderName().then(setFolderName);
  }, []);

  useEffect(() => {
    if (!folderName) return;
    setLoading(true);
    listLocalDirectory(path).then(setEntries).finally(() => setLoading(false));
  }, [folderName, path]);

  const handleConnect = async () => {
    const name = await connectFolder();
    if (name) setFolderName(name);
  };

  if (!folderName) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, textAlign: "center" }}>
        <FileDirectoryIcon size={22} fill={accent} />
        {hasLocalFsSupport() ? (
          <button onClick={handleConnect} style={{
            padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm, border: `1px solid ${accent}66`,
            background: "transparent", color: accent, cursor: "pointer", fontSize: fontSize.xs, fontFamily,
          }}>
            Connect a project folder
          </button>
        ) : (
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>
            Needs Chrome, Edge, or Opera for local file access.
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, padding: spacing.sm, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {path && (
          <button onClick={() => setPath(path.split("/").slice(0, -1).join("/"))} style={{
            display: "flex", background: "none", border: "none", color: neutral.textMuted, cursor: "pointer",
          }}>
            <ChevronLeftIcon size={iconSize.sm} />
          </button>
        )}
        <span style={{ fontSize: fontSize.xxs, color: neutral.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {folderName}{path ? `/${path}` : ""}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.xs }}>
        {loading && <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: spacing.xs }}>Loading…</div>}
        {!loading && entries.length === 0 && <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: spacing.xs }}>Empty folder.</div>}
        {entries.map(entry => {
          const isActive = entry.kind === "file" && entry.path === activeFilePath;
          return (
            <button
              key={entry.path}
              onClick={() => { entry.kind === "directory" ? setPath(entry.path) : openDevSlateFile(entry.path); }}
              style={{
                display: "flex", alignItems: "center", gap: spacing.xs, width: "100%", textAlign: "left",
                padding: `${spacing.xxs}px ${spacing.xs}px`, borderRadius: radius.xs, border: "none",
                background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                color: neutral.textPrimary, cursor: "pointer",
                fontSize: fontSize.xs, fontFamily,
              }}
            >
              {entry.kind === "directory" ? <FileDirectoryIcon size={iconSize.sm} /> : <FileIcon size={iconSize.sm} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
