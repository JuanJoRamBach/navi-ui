// Format-native rendering for the right sidebar's document viewer —
// PDFs render as real PDF pages, DOCX renders as an actual Word-like
// layout, Markdown renders to real HTML, instead of one generic text
// box pretending to be every format. Only works on files that carry a
// real browser File object (dragged/imported in) — the mock file tree
// entries have no bytes behind them, so they fall back to the honest
// placeholder/editable-text behavior that already existed.
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { renderAsync as renderDocx } from "docx-preview";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import readXlsxFile from "read-excel-file/browser";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { neutral, radius, spacing } from "./tokens";
import { extensionOf, isTextLike } from "./fileFormats";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function PdfView({ file }: { file: File }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    file.arrayBuffer().then(async buf => {
      try {
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.3 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = "block";
          canvas.style.margin = `0 auto ${spacing.sm}px`;
          canvas.style.boxShadow = "0 2px 12px rgba(0,0,0,0.4)";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (!cancelled) container.appendChild(canvas);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't render this PDF.");
      }
    });

    return () => { cancelled = true; };
  }, [file]);

  if (error) {
    return <div style={{ color: neutral.textFaint, fontSize: 12, padding: spacing.lg, textAlign: "center" }}>{error}</div>;
  }
  return <div ref={containerRef} style={{ height: "100%", overflowY: "auto" }} />;
}

function DocxView({ file }: { file: File }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    renderDocx(file, container, undefined, { className: "docx-view", inWrapper: true })
      .catch(err => setError(err instanceof Error ? err.message : "Couldn't render this document."));
  }, [file]);

  if (error) {
    return <div style={{ color: neutral.textFaint, fontSize: 12, padding: spacing.lg, textAlign: "center" }}>{error}</div>;
  }
  // docx-preview writes its own light-background page layout (that's
  // the point — it should look like an actual Word document, not
  // inherit NAVI's dark chrome), so it gets a plain white scroll area
  // rather than the app's usual dark surface.
  return (
    <div ref={containerRef} className="hide-scrollbar" style={{
      height: "100%", overflowY: "auto", background: "#e8e8ea", borderRadius: radius.sm,
    }} />
  );
}

function PptxView({ file }: { file: File }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let viewer: PptxViewer | null = null;
    let cancelled = false;
    container.innerHTML = "";

    file.arrayBuffer().then(async buf => {
      try {
        const v = await PptxViewer.open(buf, container, {
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          listOptions: { windowed: true },
        });
        if (cancelled) { v.destroy(); return; }
        viewer = v;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't render this presentation.");
      }
    });

    return () => { cancelled = true; viewer?.destroy(); };
  }, [file]);

  if (error) {
    return <div style={{ color: neutral.textFaint, fontSize: 12, padding: spacing.lg, textAlign: "center" }}>{error}</div>;
  }
  // pptx-renderer's own slide list needs real page-like backgrounds to
  // read correctly, same reasoning as DocxView going light instead of
  // inheriting NAVI's dark chrome.
  return (
    <div ref={containerRef} className="hide-scrollbar" style={{
      height: "100%", overflowY: "auto", background: "#3a3a3d", borderRadius: radius.sm,
    }} />
  );
}

function XlsxView({ file }: { file: File }) {
  const [sheets, setSheets] = useState<{ sheet: string; data: (string | number | boolean | null)[][] }[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setActiveSheet(0);
    readXlsxFile(file)
      .then(result => { if (!cancelled) setSheets(result as unknown as typeof sheets); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't read this spreadsheet."); });
    return () => { cancelled = true; };
  }, [file]);

  if (error) {
    return <div style={{ color: neutral.textFaint, fontSize: 12, padding: spacing.lg, textAlign: "center" }}>{error}</div>;
  }
  if (!sheets) {
    return <div style={{ color: neutral.textFaint, fontSize: 12, padding: spacing.lg, textAlign: "center" }}>Reading…</div>;
  }
  const current = sheets[activeSheet];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {sheets.length > 1 && (
        <div style={{ display: "flex", gap: 2, padding: `0 0 ${spacing.xs}px`, flexShrink: 0, overflowX: "auto" }}>
          {sheets.map((s, i) => (
            <button
              key={s.sheet}
              onClick={() => setActiveSheet(i)}
              style={{
                padding: "3px 8px", borderRadius: radius.xs, border: "none", cursor: "pointer",
                fontSize: 11, whiteSpace: "nowrap",
                background: i === activeSheet ? "rgba(120,165,235,0.14)" : "transparent",
                color: i === activeSheet ? "rgb(120,165,235)" : neutral.textMuted,
              }}
            >
              {s.sheet}
            </button>
          ))}
        </div>
      )}
      <div className="hide-scrollbar" style={{ flex: 1, overflow: "auto", background: "#e8e8ea", borderRadius: radius.sm }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11.5, fontFamily: "system-ui, sans-serif" }}>
          <tbody>
            {current?.data.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{
                    border: "1px solid #c8c8cc", padding: "3px 7px", color: "#1a1a1a",
                    background: r === 0 ? "#dcdce0" : "#fff",
                    fontWeight: r === 0 ? 600 : 400,
                    whiteSpace: "nowrap",
                  }}>
                    {cell === null ? "" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarkdownView({ file }: { file: File }) {
  const [html, setHtml] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    file.text().then(async text => {
      const raw = await marked.parse(text);
      if (!cancelled) setHtml(DOMPurify.sanitize(raw));
    });
    return () => { cancelled = true; };
  }, [file]);
  return (
    <div
      className="hide-scrollbar"
      style={{ height: "100%", overflowY: "auto", color: neutral.textPrimary, fontSize: 13, lineHeight: 1.6, padding: spacing.sm }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function DocumentViewer({
  name, file, content, onContentChange,
}: {
  name: string;
  file?: File;
  content: string;
  onContentChange: (text: string) => void;
}) {
  const ext = extensionOf(name);

  if (file && ext === "pdf") return <PdfView file={file} />;
  if (file && ext === "docx") return <DocxView file={file} />;
  if (file && ext === "md") return <MarkdownView file={file} />;
  if (file && ext === "pptx") return <PptxView file={file} />;
  if (file && ext === "xlsx") return <XlsxView file={file} />;
  if (file && ext === "ppt") {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: spacing.lg, color: neutral.textFaint, fontSize: 12,
      }}>
        .ppt (the old binary format) isn't supported — pptx-renderer reads Office Open XML
        (.pptx) only. Save as .pptx to view it.
      </div>
    );
  }
  if (!file && !isTextLike(name) && ext !== "md") {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: spacing.lg, color: neutral.textFaint, fontSize: 12,
      }}>
        Preview not available for .{ext} — this is a mock entry with no real file behind it yet.
      </div>
    );
  }

  // txt/code/md-without-a-real-file: plain editable text, same as
  // before — an editor IS the right viewer for these formats, no
  // format-native rendering needed the way pdf/docx need one.
  return (
    <textarea
      value={content}
      onChange={e => onContentChange(e.target.value)}
      className="hide-scrollbar"
      style={{
        width: "100%", height: "100%", resize: "none", outline: "none",
        background: neutral.surface, border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: radius.sm, color: neutral.textPrimary, fontSize: 12.5,
        lineHeight: 1.5, padding: spacing.sm, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      }}
    />
  );
}
