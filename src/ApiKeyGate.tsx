import { useState, type FormEvent, type ReactNode } from "react";
import { NAVI_BACKEND_URL } from "./config";
import { API_KEY_HEADER, getApiKey, setApiKey } from "./apiAuth";
import { status, surface } from "./tokens";

// Blocks the app behind a one-time access-key prompt (2026-09-04) — see
// apiAuth.ts's own docstring for why this exists and what it does/doesn't
// protect against. Validates the key against the live backend (a real
// 401 vs 200, not just "something is stored") before letting the app
// through, so a wrong key fails here with a clear message instead of the
// user hitting silent 401s all over a half-working app.
export function ApiKeyGate({ children }: { children: ReactNode }) {
  const [verifiedKey, setVerifiedKey] = useState<string | null>(() => getApiKey());
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (verifiedKey) return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`${NAVI_BACKEND_URL}/config/routing`, { headers: { [API_KEY_HEADER]: trimmed } });
      if (!res.ok) {
        setError(res.status === 401 ? "That key was rejected — check it and try again." : "NAVI didn't accept that — try again.");
        return;
      }
      setApiKey(trimmed);
      setVerifiedKey(trimmed);
    } catch {
      setError("Couldn't reach NAVI — check your connection and try again.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: surface.field, fontFamily: "system-ui, -apple-system, sans-serif", padding: 24,
    }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, width: "min(360px, 100%)" }}>
        <div style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>NAVI access key</div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 1.5 }}>
          This install of NAVI requires an access key. Enter the one you were given.
        </div>
        <input
          type="password" autoFocus value={input} onChange={e => setInput(e.target.value)}
          placeholder="Access key" disabled={checking}
          style={{
            padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14, boxSizing: "border-box",
          }}
        />
        {error && <div style={{ color: status.danger.color, fontSize: 12.5 }}>{error}</div>}
        <button
          type="submit" disabled={checking || !input.trim()}
          style={{
            padding: "10px 12px", borderRadius: 8, border: `1px solid ${status.success.border}`,
            background: status.success.bg, color: status.success.color, fontSize: 14, fontWeight: 600,
            cursor: checking ? "default" : "pointer", opacity: checking || !input.trim() ? 0.6 : 1,
          }}
        >
          {checking ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
