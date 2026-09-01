import { useEffect, useRef, useState } from "react";
import grapesjs, { type Editor } from "grapesjs";
import gjsPresetWebpage from "grapesjs-preset-webpage";
import "grapesjs/dist/css/grapes.min.css";
import "./devslate-grapesjs-theme.css";
import { GlobeIcon, DeviceDesktopIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { writeLocalFile } from "./devslateFs";
import { notifyFileWritten, useDevSlateState } from "./devslateStore";

const accent = CANVAS_ACCENT.devSlate.color;

// GrapesJS's editor.getHtml()/getCss() only return <body> content and
// bare CSS respectively — it has no concept of <head> boilerplate
// (meta/title/viewport). Splitting/rejoining around that gap via
// DOMParser (real HTML parsing, not regex) rather than reinventing it.
function splitHtmlDocument(html: string): { headHtml: string; bodyHtml: string; css: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const styleEls = Array.from(doc.querySelectorAll("style"));
  const css = styleEls.map(s => s.textContent ?? "").join("\n");
  styleEls.forEach(s => s.remove());
  return { headHtml: doc.head.innerHTML, bodyHtml: doc.body.innerHTML, css };
}

function buildHtmlDocument(headHtml: string, bodyHtml: string, css: string): string {
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n${headHtml}\n<style>\n${css}\n</style>\n</head>\n<body>\n${bodyHtml}\n</body>\n</html>\n`;
}

// A real embedded visual editor (drag/style/edit elements), not a
// static viewer — replaces an earlier plain sandboxed-iframe renderer.
// Scoped to the plain-HTML/CSS/JS track; a React/Tailwind track would
// need a different tool entirely (GrapesJS edits a DOM tree directly,
// it doesn't understand JSX/component boundaries) — not built here.
export function DevSlatePreview() {
  const { activeFilePath, activeFileContent, pendingWrite } = useDevSlateState();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const headHtmlRef = useRef("");
  const loadedPathRef = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const isHtml = activeFilePath?.toLowerCase().endsWith(".html") ?? false;
  const isPendingThisFile = pendingWrite?.path === activeFilePath;

  // Editor instance lives for the pane's whole lifetime, not per-file —
  // re-creating it on every file switch would be slow and would lose
  // GrapesJS's own undo history pointlessly. Content gets swapped via
  // setComponents/setStyle in the effect below instead.
  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      fromElement: false,
      storageManager: false,
      plugins: [gjsPresetWebpage],
    });
    editor.on("component:update", () => setDirty(true));
    editor.on("style:update", () => setDirty(true));
    // Removes buttons that duplicate chrome NAVI already has elsewhere
    // (Fullscreen — the pane's already resizable; Export/code-view —
    // that's Monaco's job in the Code pane) via GrapesJS's own official
    // Panels API (real button ids, not guessing at rendered title text
    // the way a CSS selector would have to) — belt-and-suspenders with
    // the title-based hide in devslate-grapesjs-theme.css.
    for (const id of ["fullscreen", "export-template"]) {
      editor.Panels.removeButton("options", id);
    }
    editorRef.current = editor;
    return () => { editor.destroy(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isHtml || !activeFilePath || isPendingThisFile) return;
    if (loadedPathRef.current === activeFilePath && !dirty) return; // don't clobber in-progress edits on an unrelated re-render
    const { headHtml, bodyHtml, css } = splitHtmlDocument(activeFileContent);
    headHtmlRef.current = headHtml;
    editor.setComponents(bodyHtml);
    editor.setStyle(css);
    loadedPathRef.current = activeFilePath;
    setDirty(false);
  }, [isHtml, activeFilePath, activeFileContent, isPendingThisFile]);

  const save = async () => {
    const editor = editorRef.current;
    if (!editor || !activeFilePath) return;
    setSaving(true);
    const fullHtml = buildHtmlDocument(headHtmlRef.current, editor.getHtml(), editor.getCss() ?? "");
    await writeLocalFile(activeFilePath, fullHtml);
    notifyFileWritten(activeFilePath, fullHtml);
    setSaving(false);
    setDirty(false);
  };

  const showEmptyState = !activeFilePath || !isHtml || isPendingThisFile;
  const emptyMessage = !activeFilePath
    ? "Select an HTML file to edit it here."
    : !isHtml
      ? "Preview only edits HTML files — open one from the Files pane."
      : "Reviewing a proposed change — see the Code pane. This pane updates once it's accepted.";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
        padding: `${spacing.xxs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, color: neutral.textFaint, fontSize: fontSize.xxs }}>
          <DeviceDesktopIcon size={14} fill={accent} /> Visual editor — GrapesJS
        </div>
        {!showEmptyState && (
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            style={{
              padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, border: "none",
              background: dirty ? accent : "rgba(255,255,255,0.06)",
              color: dirty ? "#08110d" : neutral.textFaint,
              cursor: dirty && !saving ? "pointer" : "default",
              fontSize: fontSize.xxs, fontWeight: fontWeight.medium, fontFamily,
            }}
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {showEmptyState && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 1, background: "#080808",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: spacing.sm, color: neutral.textFaint, padding: spacing.lg, textAlign: "center",
          }}>
            <GlobeIcon size={22} fill={accent} />
            <div style={{ fontSize: fontSize.xs }}>{emptyMessage}</div>
          </div>
        )}
        <div ref={containerRef} className="devslate-grapesjs" style={{ height: "100%" }} />
      </div>
    </div>
  );
}
