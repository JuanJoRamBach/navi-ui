import { marked } from "marked";
import DOMPurify from "dompurify";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily } from "./tokens";

// The checkpoint a branch opens through.
//
// Branching used to be instant, and handed the model nothing — the parent's
// messages were copied into the client's scrollback while the branch's
// server conversation started empty, so the user read a conversation the
// model could not see. A branch now receives a SPEC compacted from the
// parent and scoped to what the user said they were going off to do.
//
// This screen exists because that spec is not just context, it is the
// contract the finished work gets judged against — the acceptance lines
// are literally what "done" will mean. That makes this the moment to
// agree the scope, which is the one approval step the research actually
// supports: sign-off on requirements BEFORE the work, rather than a
// senior approval gate after it.
//
// So: no auto-accept, ever. A spec the user did not read is not an
// agreement, and this whole mechanism would be theatre if the branch
// opened before they had a chance to decline.
export function BranchSpecReview({
  scope, markdown, loading, error, onAccept, onRedraft, onCancel,
}: {
  scope: string;
  markdown: string | null;
  loading: boolean;
  error: string | null;
  onAccept: () => void;
  onRedraft: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: spacing.lg,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(680px, 95vw)", maxHeight: "85vh", display: "flex", flexDirection: "column",
          background: neutral.surfaceSolid, borderRadius: radius.md,
          border: "1px solid var(--border-default)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)", fontFamily,
        }}
      >
        <div style={{ padding: `${spacing.md}px ${spacing.lg}px`, borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
            {scope}
          </div>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, marginTop: spacing.xxs }}>
            {loading
              ? "Reading this chat for what matters to that…"
              : "This is everything the new chat will start with. It won't see this conversation."}
          </div>
        </div>

        <div style={{ padding: spacing.lg, overflowY: "auto", flex: 1, minHeight: 0 }}>
          {loading && (
            <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Working…</div>
          )}
          {!loading && error && (
            <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>
              {error}
            </div>
          )}
          {/* No spec is a normal outcome, not a failure — a chat with
              barely any history has nothing to hand down. Say that
              plainly instead of dressing it up as an error, and still
              let the branch open. */}
          {!loading && !error && !markdown && (
            <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>
              There isn't enough in this chat yet to write a brief from. The new
              chat will start with just its name — which is all this one had to give.
            </div>
          )}
          {!loading && !error && markdown && (
            <div
              className="md"
              style={{ fontSize: fontSize.xs, color: neutral.textPrimary, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true }) as string),
              }}
            />
          )}
        </div>

        <div style={{
          padding: `${spacing.sm}px ${spacing.lg}px`, borderTop: "1px solid var(--border-subtle)",
          display: "flex", justifyContent: "flex-end", gap: spacing.sm, alignItems: "center",
        }}>
          <button onClick={onCancel} style={ghostButton}>Cancel</button>
          <button onClick={onRedraft} disabled={loading} style={{ ...ghostButton, opacity: loading ? 0.4 : 1 }}>
            Change scope
          </button>
          <button
            onClick={onAccept}
            disabled={loading}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm,
              border: "1px solid oklch(75% 0.14 250 / 0.5)",
              background: "oklch(75% 0.14 250 / 0.18)",
              color: "oklch(75% 0.14 250)",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.4 : 1,
              fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium, whiteSpace: "nowrap",
            }}
          >
            Start this chat
          </button>
        </div>
      </div>
    </div>
  );
}

const ghostButton = {
  padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm,
  border: "1px solid var(--border-default)",
  background: "transparent",
  color: neutral.textMuted,
  cursor: "pointer",
  fontSize: fontSize.xs,
  fontFamily,
  whiteSpace: "nowrap" as const,
};
