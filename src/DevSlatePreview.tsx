import { useCallback, useEffect, useRef, useState } from "react";
import grapesjs, { type Editor } from "grapesjs";
import gjsPresetWebpage from "grapesjs-preset-webpage";
import "grapesjs/dist/css/grapes.min.css";
import "./devslate-grapesjs-theme.css";
import { ArrowLeftIcon, ArrowRightIcon, GlobeIcon, PencilIcon, EyeIcon, SyncIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { isLocalFileError, readLocalFile, writeLocalFile } from "./devslateFs";
import { appendTerminalLine, notifyFileWritten, useDevSlateState } from "./devslateStore";

const accent = CANVAS_ACCENT.devSlate.color;

// Console output from inside the sandboxed iframe reaches this pane's
// parent window via postMessage — the iframe has no other way to talk
// back out, deliberately (sandbox="allow-scripts", no allow-same-origin,
// so it can't reach window.parent directly or read/write anything
// outside itself). Bridge script gets inlined into every rendered page.
// Also intercepts local <a href> clicks (2026-09-01, JuanJo: "add the
// classic URL, refresh, back and forward actions") — a click on a link
// that isn't external (no ":" — same convention LOCAL_REF_RE already
// uses) or an in-page "#" anchor gets prevented and posted up to the
// parent instead, which resolves it against the currently-previewed
// file's own directory and treats it as real in-preview navigation
// (pushes onto history), rather than doing nothing (there's no real URL
// for a relative link to resolve against inside a sandboxed srcDoc
// iframe with no allow-same-origin).
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
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.indexOf(":") !== -1 || href.charAt(0) === "#") return;
    e.preventDefault();
    try { window.parent.postMessage({ __devslate: true, type: "navigate", href: href }, "*"); } catch (e) {}
  }, true);
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

  // In-preview browsing history — separate from activeFilePath (the
  // file open in Files/Code/the visual editor). Resets to just the
  // active file whenever it changes externally (a different file
  // picked in the Files pane), but can diverge from it via in-preview
  // navigation (a clicked local link, or typing a path into the
  // address bar) without touching what's actually open for editing.
  const [nav, setNav] = useState<{ history: string[]; index: number }>({ history: [], index: -1 });
  useEffect(() => {
    if (activeFilePath) setNav({ history: [activeFilePath], index: 0 });
  }, [activeFilePath]);
  const previewPath = nav.history[nav.index] ?? null;
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.history.length - 1;
  const navigateTo = useCallback((path: string) => {
    setNav(s => ({ history: [...s.history.slice(0, s.index + 1), path], index: s.index + 1 }));
  }, []);
  const goBack = useCallback(() => setNav(s => ({ ...s, index: Math.max(0, s.index - 1) })), []);
  const goForward = useCallback(() => setNav(s => ({ ...s, index: Math.min(s.history.length - 1, s.index + 1) })), []);

  const [urlInput, setUrlInput] = useState("");
  useEffect(() => { setUrlInput(previewPath ?? ""); }, [previewPath]);

  // Whatever's actually shown in the iframe — mirrors activeFileContent
  // live (so e.g. typing in Monaco updates the preview without a manual
  // refresh) as long as previewPath IS the active file; once in-preview
  // navigation has gone somewhere else, it's fetched independently.
  const [previewContent, setPreviewContent] = useState("");
  const [previewLoadFailed, setPreviewLoadFailed] = useState(false);
  useEffect(() => {
    if (!previewPath) return;
    if (previewPath === activeFilePath) {
      setPreviewContent(activeFileContent);
      setPreviewLoadFailed(isLocalFileError(activeFileContent));
      return;
    }
    let cancelled = false;
    readLocalFile(previewPath).then(content => {
      if (cancelled) return;
      setPreviewContent(content);
      setPreviewLoadFailed(isLocalFileError(content));
    });
    return () => { cancelled = true; };
  }, [previewPath, activeFilePath, activeFileContent]);

  // Refresh — a real forced disk re-read regardless of what's cached,
  // useful specifically as a manual escape hatch for the recurring
  // "preview went blank" issue (2026-09-01): whatever the underlying
  // cause turns out to be, this always gives a way to force a clean
  // reload without navigating away and back.
  const refresh = useCallback(() => {
    if (!previewPath) return;
    readLocalFile(previewPath).then(content => {
      setPreviewContent(content);
      setPreviewLoadFailed(isLocalFileError(content));
    });
  }, [previewPath]);

  const isPendingThisFile = pendingWrite?.path === activeFilePath;
  const previewIsHtml = previewPath?.toLowerCase().endsWith(".html") ?? false;
  // Pending-review gating only applies while previewing the file that's
  // actually under review — in-preview navigation to some other local
  // file shouldn't get blocked by an unrelated review in progress.
  const previewIsPendingReview = previewPath === activeFilePath && isPendingThisFile;
  const showEmptyState = !previewPath || !previewIsHtml || previewIsPendingReview || previewLoadFailed;

  // Editor mode (GrapesJS) stays scoped to activeFilePath regardless of
  // where in-preview browsing has wandered — editing always targets the
  // file that's actually open, not whatever Preview happens to be
  // showing right now.
  const editorIsHtml = activeFilePath?.toLowerCase().endsWith(".html") ?? false;
  const editorShowEmptyState = !activeFilePath || !editorIsHtml || isPendingThisFile || isLocalFileError(activeFileContent);

  // Plain preview's content — computed regardless of which mode is
  // active, so switching to "preview" never shows stale content.
  useEffect(() => {
    if (showEmptyState || !previewPath) { setSrcDoc(null); return; }
    let cancelled = false;
    inlineLocalReferences(previewContent, previewPath).then((inlined) => {
      if (cancelled) return;
      const withBridge = inlined.includes("</head>")
        ? inlined.replace("</head>", `${CONSOLE_BRIDGE}</head>`)
        : `${CONSOLE_BRIDGE}${inlined}`;
      setSrcDoc(withBridge);
    });
    return () => { cancelled = true; };
  }, [showEmptyState, previewPath, previewContent]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object" || !e.data.__devslate) return;
      if (e.data.type === "navigate" && typeof e.data.href === "string" && previewPath) {
        const baseDir = previewPath.includes("/") ? previewPath.slice(0, previewPath.lastIndexOf("/")) : "";
        navigateTo(baseDir ? `${baseDir}/${e.data.href}` : e.data.href);
        return;
      }
      appendTerminalLine(e.data.level, e.data.text);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [previewPath, navigateTo]);

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
    if (!editor || editorShowEmptyState) return;
    if (loadedPathRef.current === activeFilePath && !dirty) return; // don't clobber in-progress edits on an unrelated re-render
    const { headHtml, bodyHtml, css } = splitHtmlDocument(activeFileContent);
    headHtmlRef.current = headHtml;
    editor.setComponents(bodyHtml);
    editor.setStyle(css);
    loadedPathRef.current = activeFilePath;
    setDirty(false);
  }, [editorShowEmptyState, activeFilePath, activeFileContent, mode]);

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

  const emptyMessage = !previewPath
    ? "Select an HTML file to preview it here."
    : previewLoadFailed
      ? "Couldn't read this file — the connected folder's permission may need a moment to reconnect after a refresh."
      : !previewIsHtml
        ? "Preview only renders HTML files."
        : "Reviewing a proposed change — see the Code pane. This pane updates once it's accepted.";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      {/* Classic browser chrome — back/forward/refresh + an address bar
          (2026-09-01, JuanJo: "add the classic URL, refresh, back and
          forward actions"). The "URL" is a local file path, not a real
          web URL — there's nothing else for it to mean here, this pane
          only ever shows local files — but the affordance (type a path,
          hit Enter, navigate) is the same. Only shown once there's an
          active file at all; an empty Dev Slate has nothing to browse. */}
      {activeFilePath && (
        <div style={{
          display: "flex", alignItems: "center", gap: spacing.xs,
          padding: `${spacing.xxs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}>
          <button
            onClick={goBack} disabled={!canGoBack} title="Back"
            style={{
              display: "flex", background: "none", border: "none", padding: 2,
              color: canGoBack ? neutral.textMuted : neutral.textFaint,
              cursor: canGoBack ? "pointer" : "default", opacity: canGoBack ? 1 : 0.4,
            }}
          >
            <ArrowLeftIcon size={12} />
          </button>
          <button
            onClick={goForward} disabled={!canGoForward} title="Forward"
            style={{
              display: "flex", background: "none", border: "none", padding: 2,
              color: canGoForward ? neutral.textMuted : neutral.textFaint,
              cursor: canGoForward ? "pointer" : "default", opacity: canGoForward ? 1 : 0.4,
            }}
          >
            <ArrowRightIcon size={12} />
          </button>
          <button
            onClick={refresh} title="Refresh"
            style={{ display: "flex", background: "none", border: "none", padding: 2, color: neutral.textMuted, cursor: "pointer" }}
          >
            <SyncIcon size={12} />
          </button>
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && urlInput.trim()) navigateTo(urlInput.trim()); }}
            placeholder="local/file/path.html"
            style={{
              flex: 1, minWidth: 0, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: radius.xs, color: neutral.textPrimary, fontSize: fontSize.xxs, fontFamily: "monospace",
              padding: `2px ${spacing.xs}px`,
            }}
          />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {!editorShowEmptyState && (
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
            {previewLoadFailed && (
              <button
                onClick={refresh}
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
          key={previewPath}
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
