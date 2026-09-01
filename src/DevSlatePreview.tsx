import { useEffect, useRef, useState } from "react";
import grapesjs, { type Editor } from "grapesjs";
import gjsPresetWebpage from "grapesjs-preset-webpage";
import "grapesjs/dist/css/grapes.min.css";
import "./devslate-grapesjs-theme.css";
import { GlobeIcon, PencilIcon, EyeIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { isLocalFileError, readLocalFile, writeLocalFile } from "./devslateFs";
import { appendTerminalLine, notifyFileWritten, openDevSlateFile, useDevSlateState } from "./devslateStore";

const accent = CANVAS_ACCENT.devSlate.color;

// Console output from inside the sandboxed iframe reaches this pane's
// parent window via postMessage — the iframe has no other way to talk
// back out, deliberately (sandbox="allow-scripts", no allow-same-origin,
// so it can't reach window.parent directly or read/write anything
// outside itself). Bridge script gets inlined into every rendered page.
const CONSOLE_BRIDGE = `
<script>
(function () {
  var send = function (level, args) {
    try {
      window.parent.postMessage({ __devslate: true, level: level, text: Array.prototype.map.call(args, function (a) {
        try { return typeof a === "string" ? a : JSON.stringify(a); } catch (e) { return String(a); }
      }).join(" ") }, "*");
    } catch (e) {}
  };
  ["log", "warn", "error"].forEach(function (level) {
    var original = console[level];
    console[level] = function () { send(level, arguments); original.apply(console, arguments); };
  });
  window.addEventListener("error", function (e) { send("error", [e.message + " (" + e.filename + ":" + e.lineno + ")"]); });
})();
</script>
`;

const LOCAL_REF_RE = /<(link|script)\b[^>]*\b(?:href|src)=["']([^"':]+)["'][^>]*>(?:<\/script>)?/gi;

// Simple relative-link inlining — not a bundler, deliberately, per the
// light-coding scope this whole feature targets (HTML/CSS/JS quick
// prototyping, not real module resolution). A ':' in the path (http://,
// https://, //) is treated as external and left untouched.
async function inlineLocalReferences(html: string, basePath: string): Promise<string> {
  const baseDir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
  const matches = [...html.matchAll(LOCAL_REF_RE)];
  let result = html;
  for (const match of matches) {
    const [full, tag, href] = match;
    const resolved = baseDir ? `${baseDir}/${href}` : href;
    const content = await readLocalFile(resolved).catch(() => null);
    if (content === null) continue;
    const inlined = tag.toLowerCase() === "link" ? `<style>\n${content}\n</style>` : `<script>\n${content}\n</script>`;
    result = result.replace(full, inlined);
  }
  return result;
}

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

// Two views into the same file, toggled by the user, both isolated the
// same way: "preview" (default) is a clean sandboxed iframe — no chrome
// at all, exactly what a normal browser would render, real
// browser-enforced isolation (sandbox="allow-scripts", no
// allow-same-origin — reviewed and confirmed with JuanJo, 2026-09-01,
// specifically NOT a same-origin blob URL / new tab, which would have
// shared navi-pwa's own origin and given rendered content reach into
// its localStorage/IndexedDB). "editor" is GrapesJS, opened explicitly
// via the top-bar button, never the default. Preview always reflects
// the last SAVED content (activeFileContent), not GrapesJS's in-progress
// unsaved edits — switching back to preview without saving first just
// shows what's actually on disk, which is the honest thing to show.
export function DevSlatePreview() {
  const { activeFilePath, activeFileContent, pendingWrite } = useDevSlateState();
  const [mode, setMode] = useState<"preview" | "editor">("preview");
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const headHtmlRef = useRef("");
  const loadedPathRef = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const isHtml = activeFilePath?.toLowerCase().endsWith(".html") ?? false;
  const isPendingThisFile = pendingWrite?.path === activeFilePath;
  // A failed read (most commonly: File System Access permission hasn't
  // re-confirmed yet right after a page refresh) comes back as a plain
  // string, not a thrown error — see isLocalFileError. Without this
  // check that string used to get fed straight into the iframe as if
  // it were the page's HTML, rendering as unstyled text on the
  // iframe's default white background (JuanJo, 2026-09-01: "the
  // preview is white" after a refresh).
  const readFailed = !isPendingThisFile && isLocalFileError(activeFileContent);
  const showEmptyState = !activeFilePath || !isHtml || isPendingThisFile || readFailed;

  // Plain preview's content — computed regardless of which mode is
  // active, so switching to "preview" never shows stale content.
  useEffect(() => {
    if (showEmptyState) { setSrcDoc(null); return; }
    let cancelled = false;
    inlineLocalReferences(activeFileContent, activeFilePath!).then((inlined) => {
      if (cancelled) return;
      const withBridge = inlined.includes("</head>")
        ? inlined.replace("</head>", `${CONSOLE_BRIDGE}</head>`)
        : `${CONSOLE_BRIDGE}${inlined}`;
      setSrcDoc(withBridge);
    });
    return () => { cancelled = true; };
  }, [showEmptyState, activeFilePath, activeFileContent]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === "object" && e.data.__devslate) {
        appendTerminalLine(e.data.level, e.data.text);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // GrapesJS only ever initializes once the user explicitly opens the
  // editor for the first time — never eagerly on mount, since "preview"
  // is the default and most sessions may never touch the editor at all.
  // Once created it stays alive (hidden via CSS, not unmounted) so
  // switching back and forth doesn't lose undo history or in-progress
  // edits.
  useEffect(() => {
    if (mode !== "editor" || !containerRef.current || editorRef.current) return;
    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      fromElement: false,
      storageManager: false,
      plugins: [gjsPresetWebpage],
    });
    editor.on("component:update", () => setDirty(true));
    editor.on("style:update", () => setDirty(true));
    for (const id of ["fullscreen", "export-template"]) {
      editor.Panels.removeButton("options", id);
    }
    editorRef.current = editor;
  }, [mode]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || showEmptyState) return;
    if (loadedPathRef.current === activeFilePath && !dirty) return; // don't clobber in-progress edits on an unrelated re-render
    const { headHtml, bodyHtml, css } = splitHtmlDocument(activeFileContent);
    headHtmlRef.current = headHtml;
    editor.setComponents(bodyHtml);
    editor.setStyle(css);
    loadedPathRef.current = activeFilePath;
    setDirty(false);
  }, [showEmptyState, activeFilePath, activeFileContent, mode]);

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

  const emptyMessage = !activeFilePath
    ? "Select an HTML file to preview it here."
    : readFailed
      ? "Couldn't read this file — the connected folder's permission may need a moment to reconnect after a refresh."
      : !isHtml
        ? "Preview only renders HTML files — open one from the Files pane."
        : "Reviewing a proposed change — see the Code pane. This pane updates once it's accepted.";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      {/* No header row anymore — dockview's own tab already says
          "Preview" (JuanJo, 2026-09-01: the in-pane label was
          redundant with the tab above it). Controls are a small
          floating overlay instead, only shown once there's something
          to act on. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {!showEmptyState && (
          <div style={{ position: "absolute", top: spacing.xs, right: spacing.xs, zIndex: 3, display: "flex", gap: spacing.xs }}>
            {mode === "editor" && (
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                style={{
                  padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, border: "none",
                  background: dirty ? accent : "rgba(8,8,10,0.85)",
                  color: dirty ? "#08110d" : neutral.textFaint,
                  cursor: dirty && !saving ? "pointer" : "default",
                  fontSize: fontSize.xxs, fontWeight: fontWeight.medium, fontFamily,
                }}
              >
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </button>
            )}
            <button
              onClick={() => setMode(m => m === "editor" ? "preview" : "editor")}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
                border: "1px solid rgba(255,255,255,0.1)", background: "rgba(8,8,10,0.85)",
                color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
              }}
            >
              {mode === "editor" ? <><EyeIcon size={12} /> Back to preview</> : <><PencilIcon size={12} /> Open visual editor</>}
            </button>
          </div>
        )}

        {showEmptyState && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 2, background: "#080808",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: spacing.sm, color: neutral.textFaint, padding: spacing.lg, textAlign: "center",
          }}>
            <GlobeIcon size={22} fill={accent} />
            <div style={{ fontSize: fontSize.xs }}>{emptyMessage}</div>
            {readFailed && (
              <button
                onClick={() => void openDevSlateFile(activeFilePath!)}
                style={{
                  padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs,
                  border: `1px solid ${accent}`, background: "transparent",
                  color: accent, cursor: "pointer", fontSize: fontSize.xxs, fontWeight: fontWeight.medium, fontFamily,
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        <iframe
          key={activeFilePath}
          title="Dev Slate preview"
          srcDoc={srcDoc ?? ""}
          sandbox="allow-scripts"
          style={{
            width: "100%", height: "100%", border: "none", background: "#fff",
            display: mode === "preview" ? "block" : "none",
          }}
        />
        <div ref={containerRef} className="devslate-grapesjs" style={{ height: "100%", display: mode === "editor" ? "block" : "none" }} />
      </div>
    </div>
  );
}
