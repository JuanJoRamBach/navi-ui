import { useState, type FormEvent, type ReactNode } from "react";
import { login, registerFirstOwner } from "./auth";
import { getSessionToken, setSessionToken } from "./sessionAuth";
import { status, surface } from "./tokens";

// Second, inner gate (2026-09-10) — sits INSIDE ApiKeyGate, not instead
// of it (see main.tsx). Blocks the app behind a real login until a
// session token is stored, mirroring ApiKeyGate.tsx's own shape.
//
// A fresh backend has no accounts at all yet — "Log in" alone would be a
// dead end with nothing to log into. This gate defaults to Log In but
// offers a link to switch to a one-time "Set up the first account"
// form; the backend itself is the source of truth on whether that's
// still allowed (POST /auth/register refuses once any account exists),
// so a stale/wrong guess here just surfaces as a normal form error
// rather than this component needing its own separate check first.
//
// Deliberately doesn't lift the logged-in user up as a prop — nothing
// here needs it, and anything downstream that does (AccountSettings.tsx)
// just calls auth.ts's getCurrentUser() itself, same "fetch what you
// need where you need it" pattern the rest of the app already uses
// rather than threading auth state through main.tsx.
export function LoginGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => !!getSessionToken());
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authed) return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = mode === "login"
        ? await login(email.trim(), password)
        : await registerFirstOwner(email.trim(), password, name.trim() || undefined);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSessionToken(result.token);
      setAuthed(true);
    } catch {
      setError("Couldn't reach NAVI — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: surface.field, fontFamily: "system-ui, -apple-system, sans-serif", padding: 24,
    }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, width: "min(360px, 100%)" }}>
        <div style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>
          {mode === "login" ? "Log in to NAVI" : "Set up the first account"}
        </div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 1.5 }}>
          {mode === "login"
            ? "This account is separate from the access key — real per-user login."
            : "Only works once, on a backend with no accounts yet. This account becomes Owner."}
        </div>
        {mode === "register" && (
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Name (optional)" disabled={submitting}
            style={{
              padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14, boxSizing: "border-box",
            }}
          />
        )}
        <input
          type="email" autoFocus value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Email" disabled={submitting} autoComplete="email"
          style={{
            padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14, boxSizing: "border-box",
          }}
        />
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password" disabled={submitting}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          style={{
            padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14, boxSizing: "border-box",
          }}
        />
        {error && <div style={{ color: status.danger.color, fontSize: 12.5 }}>{error}</div>}
        <button
          type="submit" disabled={submitting || !email.trim() || !password}
          style={{
            padding: "10px 12px", borderRadius: 8, border: `1px solid ${status.success.border}`,
            background: status.success.bg, color: status.success.color, fontSize: 14, fontWeight: 600,
            cursor: submitting ? "default" : "pointer", opacity: submitting || !email.trim() || !password ? 0.6 : 1,
          }}
        >
          {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create Owner account"}
        </button>
        <button
          type="button"
          onClick={() => { setMode(m => (m === "login" ? "register" : "login")); setError(null); }}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 12.5, cursor: "pointer", padding: 0 }}
        >
          {mode === "login" ? "First time setting this up? Create the owner account" : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
