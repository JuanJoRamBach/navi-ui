import { Editor, DiffEditor } from "@monaco-editor/react";
import { CheckIcon, XIcon, FileIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { decideWriteReview, useDevSlateState } from "./devslateStore";

const accent = CANVAS_ACCENT.devSlate.color;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  html: "html", css: "css", json: "json", md: "markdown", py: "python",
};

function languageFor(path: string | null): string {
  const ext = path?.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}

// Hosts both the plain editor (viewing whatever file is currently
// selected in the Files pane) and the diff view for an AI-proposed
// write_file change — per this canvas layout's own original comment
// ("Monaco — also hosts the diff view when reviewing an AI-proposed
// change"). Read-only either way for now: Dev Slate's edit path is the
// model calling write_file, not the user typing directly into Monaco —
// that's a real, deliberate scope line for this pass, not an oversight.
export function DevSlateCode() {
  const { activeFilePath, activeFileContent, pendingWrite } = useDevSlateState();

  if (!activeFilePath) {
    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: spacing.sm, color: neutral.textFaint, fontFamily,
      }}>
        <FileIcon size={22} fill={accent} />
        <div style={{ fontSize: fontSize.xs }}>Select a file in the Files pane to view it here.</div>
      </div>
    );
  }

  const language = languageFor(activeFilePath);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
        padding: `${spacing.xxs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.08)",
        fontSize: fontSize.xxs, color: neutral.textFaint, fontFamily: "monospace", flexShrink: 0,
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeFilePath}</span>
        {pendingWrite && (
          <div style={{ display: "flex", gap: spacing.xs, flexShrink: 0 }}>
            <button onClick={() => decideWriteReview(false)} style={{
              display: "flex", alignItems: "center", gap: 4, padding: `${spacing.xxs}px ${spacing.sm}px`,
              borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.12)", background: "transparent",
              color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
            }}>
              <XIcon size={12} /> Reject
            </button>
            <button onClick={() => decideWriteReview(true)} style={{
              display: "flex", alignItems: "center", gap: 4, padding: `${spacing.xxs}px ${spacing.sm}px`,
              borderRadius: radius.xs, border: "none", background: accent,
              color: "#08110d", cursor: "pointer", fontSize: fontSize.xxs, fontFamily, fontWeight: fontWeight.medium,
            }}>
              <CheckIcon size={12} /> Accept
            </button>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {pendingWrite ? (
          <DiffEditor
            language={language}
            original={pendingWrite.before}
            modified={pendingWrite.after}
            theme="vs-dark"
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
          />
        ) : (
          <Editor
            language={language}
            value={activeFileContent}
            theme="vs-dark"
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
          />
        )}
      </div>
    </div>
  );
}
