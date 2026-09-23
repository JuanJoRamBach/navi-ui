import { useEffect, useState } from "react";
import { KeyIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, status, surface } from "./tokens";
import { listProviderKeys, removeProviderKey, saveProviderKey, type ProviderKeyStatus } from "./providerKeysApi";

// "Your API keys" section of the Settings panel (2026-09-23). Saving a key
// doesn't route anything to it by itself — its models then show up in the
// chat's model picker under "your key", and only picking one there uses
// it. That two-step split is deliberate: these are paid, per-token keys.
export function ProviderKeys() {
  const [providers, setProviders] = useState<ProviderKeyStatus[] | null | undefined>(undefined); // undefined = loading
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    listProviderKeys().then(setProviders);
  }, []);

  // Not Owner/Admin (or the server predates BYOK) — nothing to show.
  if (!providers) return null;

  const replace = (next: ProviderKeyStatus) =>
    setProviders(list => list?.map(p => (p.provider === next.provider ? next : p)) ?? list);

  const save = async (provider: string) => {
    if (!draft.trim() || busy) return;
    setBusy(provider);
    setErrors(e => ({ ...e, [provider]: "" }));
    const result = await saveProviderKey(provider, draft.trim());
    setBusy(null);
    if ("error" in result) {
      setErrors(e => ({ ...e, [provider]: result.error }));
      return;
    }
    replace(result);
    setDraft("");
    setEditing(null);
  };

  const remove = async (provider: string) => {
    setBusy(provider);
    setErrors(e => ({ ...e, [provider]: "" }));
    const result = await removeProviderKey(provider);
    setBusy(null);
    if ("error" in result) {
      setErrors(e => ({ ...e, [provider]: result.error }));
      return;
    }
    replace(result);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
      <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Your API keys</div>
      <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
        Add a key to try a model NAVI doesn't use by default. Its models then appear in the chat's model
        picker. Calls are billed to your own account with that provider.
      </div>

      {providers.map(p => {
        const isEditing = editing === p.provider;
        const isBusy = busy === p.provider;
        const error = errors[p.provider];
        return (
          <div
            key={p.provider}
            style={{
              display: "flex", flexDirection: "column", gap: spacing.xs,
              padding: spacing.sm, borderRadius: radius.sm,
              background: "var(--surface-panel)", border: "1px solid var(--border-default)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fontSize.sm, color: neutral.textPrimary }}>
                  <KeyIcon size={12} /> {p.label}
                </div>
                <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, marginTop: 2 }}>
                  {!p.configured && "No key"}
                  {p.configured && p.source === "saved" && `Key ending …${p.hint} · ${p.models.length} model${p.models.length === 1 ? "" : "s"}`}
                  {p.configured && p.source === "env" && `Key ending …${p.hint}, set on the server`}
                </div>
              </div>
              {!isEditing && (
                <div style={{ display: "flex", gap: spacing.xs, flexShrink: 0 }}>
                  {p.source !== "env" && (
                    <button onClick={() => { setEditing(p.provider); setDraft(""); }} disabled={isBusy} style={smallButton}>
                      {p.configured ? "Replace" : "Add key"}
                    </button>
                  )}
                  {p.source === "saved" && (
                    <button onClick={() => void remove(p.provider)} disabled={isBusy} style={smallButton}>
                      {isBusy ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {isEditing && (
              <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  placeholder={`Paste your ${p.label} API key`}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void save(p.provider); if (e.key === "Escape") setEditing(null); }}
                  style={inputStyle}
                />
                <div style={{ display: "flex", gap: spacing.xs }}>
                  <button
                    onClick={() => void save(p.provider)}
                    disabled={isBusy || !draft.trim()}
                    style={{
                      ...smallButton,
                      border: `1px solid ${status.success.border}`, background: status.success.bg, color: status.success.color,
                      fontWeight: fontWeight.medium, opacity: isBusy || !draft.trim() ? 0.6 : 1,
                    }}
                  >
                    {isBusy ? "Checking key…" : "Check and save"}
                  </button>
                  <button onClick={() => setEditing(null)} disabled={isBusy} style={smallButton}>Cancel</button>
                </div>
              </div>
            )}

            {error && <div style={{ fontSize: fontSize.xxs, color: status.danger.color, lineHeight: 1.5 }}>{error}</div>}
          </div>
        );
      })}
    </div>
  );
}

const smallButton: React.CSSProperties = {
  padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
  border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
  color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
};

const inputStyle: React.CSSProperties = {
  padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
  background: surface.raised, color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily, boxSizing: "border-box",
};
