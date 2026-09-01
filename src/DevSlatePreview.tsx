import { useEffect, useState } from "react";
import { GlobeIcon } from "@primer/octicons-react";
import { spacing, fontSize, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { readLocalFile } from "./devslateFs";
import { appendTerminalLine, useDevSlateState } from "./devslateStore";

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

export function DevSlatePreview() {
  const { activeFilePath, activeFileContent } = useDevSlateState();
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  const isHtml = activeFilePath?.toLowerCase().endsWith(".html") ?? false;

  useEffect(() => {
    if (!isHtml || !activeFilePath) {
      setSrcDoc(null);
      return;
    }
    let cancelled = false;
    inlineLocalReferences(activeFileContent, activeFilePath).then((inlined) => {
      if (cancelled) return;
      const withBridge = inlined.includes("</head>")
        ? inlined.replace("</head>", `${CONSOLE_BRIDGE}</head>`)
        : `${CONSOLE_BRIDGE}${inlined}`;
      setSrcDoc(withBridge);
    });
    return () => { cancelled = true; };
  }, [isHtml, activeFilePath, activeFileContent]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === "object" && e.data.__devslate) {
        appendTerminalLine(e.data.level, e.data.text);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!activeFilePath) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: spacing.sm, color: neutral.textFaint, fontFamily }}>
        <GlobeIcon size={22} fill={accent} />
        <div style={{ fontSize: fontSize.xs }}>Select an HTML file to preview it here.</div>
      </div>
    );
  }

  if (!isHtml) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: spacing.sm, color: neutral.textFaint, fontFamily, padding: spacing.lg, textAlign: "center" }}>
        <GlobeIcon size={22} fill={accent} />
        <div style={{ fontSize: fontSize.xs }}>Preview only renders HTML files — open one from the Files pane.</div>
      </div>
    );
  }

  return (
    <iframe
      key={activeFilePath}
      title="Dev Slate preview"
      srcDoc={srcDoc ?? ""}
      // No allow-same-origin, on purpose — real browser-enforced
      // isolation for whatever the model just wrote, no exception. This
      // is the client-side sandbox the whole "no server execution
      // engine" design bet depends on.
      sandbox="allow-scripts"
      style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
    />
  );
}
