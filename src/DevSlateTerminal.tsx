import { useEffect, useRef } from "react";
import { TerminalIcon } from "@primer/octicons-react";
import { spacing, fontSize, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { clearTerminal, useDevSlateState } from "./devslateStore";

const accent = CANVAS_ACCENT.devSlate.color;

const COLOR_BY_LEVEL: Record<string, string> = {
  log: neutral.textMuted,
  warn: "#e0b94a",
  error: "#e0685a",
};

// Deliberately a plain scrollback log, not xterm.js — there's no real
// interactive shell behind this (no server-side execution engine; see
// the navi-planner-and-completion-rate memory's own call that HTML/CSS/
// JS execution stays client-side-sandboxed, never a backend concern).
// What this actually shows is console output forwarded from the Preview
// pane's sandboxed iframe — a real TTY emulator's ANSI/resize/input
// handling would be solving a problem Dev Slate doesn't have yet.
export function DevSlateTerminal() {
  const { terminalLines } = useDevSlateState();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [terminalLines]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
        padding: `${spacing.xxs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, color: neutral.textFaint, fontSize: fontSize.xxs }}>
          <TerminalIcon size={14} fill={accent} /> Console — from the Preview pane's sandbox
        </div>
        <button onClick={clearTerminal} style={{
          background: "none", border: "none", color: neutral.textFaint, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
        }}>
          Clear
        </button>
      </div>
      <div ref={scrollRef} style={{
        flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.xs,
        fontFamily: "monospace", fontSize: fontSize.xxs,
      }}>
        {terminalLines.length === 0 && (
          <div style={{ color: neutral.textFaint }}>Nothing yet — output from the sandboxed preview shows up here.</div>
        )}
        {terminalLines.map((line, i) => (
          <div key={i} style={{ color: COLOR_BY_LEVEL[line.level], whiteSpace: "pre-wrap" }}>{line.text}</div>
        ))}
      </div>
    </div>
  );
}
