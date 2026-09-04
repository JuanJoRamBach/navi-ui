import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, DiffEditor } from "@monaco-editor/react";
import { CheckIcon, XIcon, FileIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, status, actionInk, isDayTheme } from "./tokens";
import { decideWriteReview, notifyFileWritten, useDevSlateState } from "./devslateStore";
import { writeLocalFile } from "./devslateFs";

const accent = CANVAS_ACCENT.devSlate.color;

// Custom Monaco theme matched to Dev Slate's near-black/teal palette,
// replacing the stock "vs-dark" blue-gray that clashed with the canvas.
function defineNaviMonacoTheme(monaco: any): void {
  const day = isDayTheme();
  monaco.editor.defineTheme("navi-devslate", {
    base: day ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: day ? {
      "editor.background": "#f7f8fb",
      "editor.foreground": "#16181f",
      "editorLineNumber.foreground": "#9aa1b2",
      "editorCursor.foreground": "#0f7a96",
      "editor.selectionBackground": "rgba(15, 122, 150, 0.2)",
      "editor.lineHighlightBackground": "#eef0f6",
      "editorIndentGuide.background1": "rgba(22, 24, 31, 0.08)",
      "editorWidget.background": "#ffffff",
      "editorGutter.background": "#f7f8fb",
    } : {
      "editor.background": "#10141f",
      "editor.foreground": "#f4f6fb",
      "editorLineNumber.foreground": "#5f6880",
      "editorCursor.foreground": "#40b7d6",
      "editor.selectionBackground": "rgba(64, 183, 214, 0.28)",
      "editor.lineHighlightBackground": "#151a26",
      "editorIndentGuide.background1": "rgba(255, 255, 255, 0.08)",
      "editorWidget.background": "#1c2231",
      "editorGutter.background": "#10141f",
    },
  });
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  html: "html", css: "css", json: "json", md: "markdown", py: "python",
};

function languageFor(path: string | null): string {
  const ext = path?.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}

const SAVE_DEBOUNCE_MS = 600;

// Hosts both the plain editor (viewing/editing whatever file is
// currently selected in the Files pane) and the diff view for an
// AI-proposed write_file change — per this canvas layout's own original
// comment ("Monaco — also hosts the diff view when reviewing an
// AI-proposed change"). The plain editor is directly editable (JuanJo,
// 2026-09-01: reversing the earlier "read-only, model writes only"
// scope call) — typed changes save to disk debounced, not on every
// keystroke, then flow through notifyFileWritten so Preview/Files/
// Change History all pick them up the same way an AI write does. The
// DIFF view stays read-only — it's a review UI for an AI proposal
// (Accept/Reject), not a general editing surface; editing mid-review
// would need new design (does an edited diff still count as Accept?).
export function DevSlateCode() {
  const { activeFilePath, activeFileContent, pendingWrite } = useDevSlateState();
  const [localContent, setLocalContent] = useState(activeFileContent);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  // Resets local content on a file switch, or when a diff review just
  // resolved (pendingWrite going from present to absent) — NOT on every
  // activeFileContent tick, since our own debounced save round-trips
  // through the store too and would otherwise fight the user's typing.
  useEffect(() => {
    setLocalContent(activeFileContent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath, !!pendingWrite]);

  useEffect(() => {
    return () => { if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current); };
  }, []);

  const handleChange = useCallback((value: string | undefined) => {
    const next = value ?? "";
    setLocalContent(next);
    const path = activeFilePath;
    if (!path) return;
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      setSaving(true);
      setSaveError(null);
      try {
        await writeLocalFile(path, next);
        notifyFileWritten(path, next);
      } catch (e) {
        // writeLocalFile has no internal error handling of its own (it
        // throws straight through, e.g. requireRoot()'s "No project
        // folder connected yet." right after a refresh, before File
        // System Access permission has re-confirmed) — without this
        // catch, that became an unhandled rejection and the edit
        // silently never saved, no indication to the user at all.
        setSaveError(e instanceof Error ? e.message : "Couldn't save.");
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [activeFilePath]);

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
        {!pendingWrite && saving && (
          <span style={{ flexShrink: 0, color: neutral.textFaint }}>Saving…</span>
        )}
        {!pendingWrite && !saving && saveError && (
          <span style={{ flexShrink: 0, color: status.danger.color }} title={saveError}>Couldn't save — {saveError}</span>
        )}
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
              color: actionInk, cursor: "pointer", fontSize: fontSize.xxs, fontFamily, fontWeight: fontWeight.medium,
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
            theme="navi-devslate"
            beforeMount={defineNaviMonacoTheme}
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
          />
        ) : (
          <Editor
            key={activeFilePath}
            language={language}
            value={localContent}
            onChange={handleChange}
            theme="navi-devslate"
            beforeMount={defineNaviMonacoTheme}
            options={{ readOnly: false, minimap: { enabled: false }, fontSize: 13 }}
          />
        )}
      </div>
    </div>
  );
}
