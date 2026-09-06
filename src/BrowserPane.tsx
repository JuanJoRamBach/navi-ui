// A real embedded browser tab for the right sidebar (2026-09-06,
// JuanJo: "wire the true browser for the Tauri implementation... user
// will be able to see pages in Chat mode and Dev Slate"). Two real
// surfaces behind one UI, chosen at runtime via isTauriRuntime():
//
// - Plain browser (today's actual shippable build — dev server, GitHub
//   Pages): a real <iframe>, real URL bar, real back/forward/reload
//   driven by a client-side history stack (a cross-origin iframe's own
//   `contentWindow.history` isn't readable — same-origin policy — so
//   this tracks visited URLs itself instead of trying to read the
//   iframe's history). Many real sites refuse to be framed at all
//   (X-Frame-Options/CSP `frame-ancestors`) — that's the target site's
//   own security policy, not something fixable from inside the page
//   that's embedding it; the empty/blank result is the honest limit of
//   running inside a normal browser tab, which is exactly why this is
//   "wired for Tauri" rather than considered finished here.
// - Tauri desktop build (the NEXT step, not built yet — this repo has
//   no Tauri project at all as of this file): a real native child
//   webview (`@tauri-apps/api/webview`'s Webview, Tauri v2's multiwebview
//   feature), positioned/sized to track a placeholder div's own bounding
//   rect so it reads as "docked" inside this same panel, even though a
//   native webview is actually a separate OS-level surface layered on
//   top of the window, not a DOM node. Only ever imported dynamically,
//   inside the isTauriRuntime() branch — a plain web build never
//   executes or even downloads this path.
//
// The Tauri Webview API calls below are checked against the actually-
// installed @tauri-apps/api v2 type definitions (node_modules), not
// guessed — confirmed there's no navigate()-style method on Webview,
// which is why navigating recreates the webview (see the effect's own
// [url, active] deps) rather than mutating one in place. What's still
// genuinely untested is the RUNTIME behavior — there is no Tauri host
// process anywhere in this repo yet to actually run this against, only
// its JS API's types; that real test has to wait for the Tauri wrapper
// project itself (JuanJo: "that will be the last part, then we make
// the Tauri file").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, GlobeIcon, SyncIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, iconSize } from "./tokens";
import { isTauriRuntime } from "./tauriRuntime";

const HOME_URL = "https://www.google.com";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A bare domain-looking string ("wikipedia.org") gets a scheme; anything
  // else (no dot, has spaces) is treated as a search rather than guessed at.
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function toolbarButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    width: 26, height: 26, borderRadius: radius.xs, border: "none",
    background: "transparent", display: "flex", alignItems: "center", justifyContent: "center",
    color: enabled ? neutral.textMuted : neutral.textFaint,
    cursor: enabled ? "pointer" : "default",
  };
}

// Tauri-only child webview, kept alive across navigations and torn down
// on unmount — positioned to track `anchorRef`'s own rect so it reads as
// docked inside the surrounding panel. Returns nothing; this is a real
// OS-level side effect (a separate native surface), not something that
// renders through React's own tree.
function useTauriChildWebview(anchorRef: React.RefObject<HTMLDivElement | null>, url: string, active: boolean) {
  const webviewRef = useRef<unknown>(null);

  useEffect(() => {
    if (!active || !isTauriRuntime()) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      // Dynamic import so this module — and the @tauri-apps/api package
      // it pulls in — is never even requested by a plain web build.
      // Confirmed against the actually-installed @tauri-apps/api v2
      // types (not guessed): the Webview constructor takes plain-number
      // x/y/width/height, but the instance's own setPosition/setSize
      // need real LogicalPosition/LogicalSize instances instead — two
      // genuinely different shapes for the same numbers.
      const [{ Webview }, { getCurrentWindow }, { LogicalPosition, LogicalSize }] = await Promise.all([
        import("@tauri-apps/api/webview"),
        import("@tauri-apps/api/window"),
        import("@tauri-apps/api/dpi"),
      ]);
      if (cancelled || !anchorRef.current) return;

      const rect = anchorRef.current.getBoundingClientRect();
      const parent = getCurrentWindow();
      const label = `navi-browser-${Math.random().toString(36).slice(2)}`;
      const webview = new Webview(parent, label, {
        url,
        x: Math.round(rect.left), y: Math.round(rect.top),
        width: Math.round(rect.width), height: Math.round(rect.height),
      });
      webviewRef.current = webview;

      const syncPosition = () => {
        if (!anchorRef.current) return;
        const r = anchorRef.current.getBoundingClientRect();
        void webview.setPosition(new LogicalPosition(Math.round(r.left), Math.round(r.top)));
        void webview.setSize(new LogicalSize(Math.round(r.width), Math.round(r.height)));
      };
      resizeObserver = new ResizeObserver(syncPosition);
      resizeObserver.observe(anchorRef.current);
      window.addEventListener("resize", syncPosition);
      window.addEventListener("scroll", syncPosition, true);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      const webview = webviewRef.current as { close: () => Promise<void> } | null;
      webview?.close().catch(() => {});
      webviewRef.current = null;
    };
    // Re-created whenever the target url changes — see the module-level
    // comment on why navigation recreates rather than calling an
    // uncertain in-place navigate() method.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, active]);
}

export function BrowserPane({ storageKey, accentColor }: { storageKey: string; accentColor: string }) {
  const tauri = useMemo(() => isTauriRuntime(), []);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return [saved || HOME_URL];
    } catch {
      return [HOME_URL];
    }
  });
  const [index, setIndex] = useState(0);
  const [addressDraft, setAddressDraft] = useState(history[0]);
  const [loading, setLoading] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const currentUrl = history[index];

  useEffect(() => setAddressDraft(currentUrl), [currentUrl]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, currentUrl); } catch { /* best-effort only */ }
  }, [currentUrl, storageKey]);

  const navigate = useCallback((raw: string) => {
    const url = normalizeUrl(raw);
    setHistory(h => [...h.slice(0, index + 1), url]);
    setIndex(i => i + 1);
    setLoading(true);
  }, [index]);

  useTauriChildWebview(anchorRef, currentUrl, true);

  const canGoBack = index > 0;
  const canGoForward = index < history.length - 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
      }}>
        <button disabled={!canGoBack} onClick={() => setIndex(i => Math.max(0, i - 1))} style={toolbarButtonStyle(canGoBack)} title="Back">
          <ArrowLeftIcon size={13} />
        </button>
        <button disabled={!canGoForward} onClick={() => setIndex(i => Math.min(history.length - 1, i + 1))} style={toolbarButtonStyle(canGoForward)} title="Forward">
          <ArrowRightIcon size={13} />
        </button>
        <button onClick={() => navigate(currentUrl)} style={toolbarButtonStyle(true)} title="Reload">
          <SyncIcon size={13} />
        </button>
        <form
          onSubmit={e => { e.preventDefault(); navigate(addressDraft); }}
          style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
        >
          <GlobeIcon size={12} fill={neutral.textFaint} />
          <input
            value={addressDraft}
            onChange={e => setAddressDraft(e.target.value)}
            placeholder="Search or enter a URL"
            style={{
              flex: 1, minWidth: 0, background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--border-default)", borderRadius: radius.xs,
              color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily,
              padding: `4px ${spacing.xs}px`, boxSizing: "border-box",
            }}
          />
        </form>
      </div>

      <div ref={anchorRef} style={{ flex: 1, minHeight: 0, position: "relative", background: "#fff" }}>
        {tauri ? (
          // The real content here is the native child webview tracking
          // this div's rect (see useTauriChildWebview) — this element is
          // purely a positioning anchor, deliberately empty.
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: fontSize.xxs, color: "rgba(0,0,0,0.35)", fontFamily, pointerEvents: "none",
          }}>
            {loading ? "Loading…" : ""}
          </div>
        ) : (
          <iframe
            key={currentUrl}
            src={currentUrl}
            title="Embedded browser"
            onLoad={() => setLoading(false)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          />
        )}
      </div>

      {!tauri && (
        <div style={{
          padding: `${spacing.xxs}px ${spacing.sm}px`, borderTop: "1px solid var(--border-subtle)",
          fontSize: 10, color: neutral.textFaint, flexShrink: 0, lineHeight: 1.4,
        }}>
          Some sites block embedding here — that's their own policy, not fixable from inside a browser
          tab. The desktop app (
          <span style={{ color: accentColor }}>coming soon</span>
          ) opens every page in a real native view instead.
        </div>
      )}
    </div>
  );
}
