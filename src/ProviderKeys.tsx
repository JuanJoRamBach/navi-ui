import { useEffect, useMemo, useState } from "react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, status } from "./tokens";
import { fetchKeys, removeKey, saveKey, type CatalogEntry, type KeyRow, type KeysOverview } from "./providerKeysApi";
import { SectionTitle, ghostButton, inputStyle } from "./AccountSettings";

const OTHER = "other";

// Settings → Your API keys (2026-09-23). Two parts:
// - Bring your key: pick a provider, paste its key, save. The server checks
//   the key with the provider first, so a bad one is refused with the
//   provider's own reason and nothing is saved.
// - Connected APIs: the 8 free providers NAVI runs on, always listed and
//   marked "Free tier", plus every key someone brought.
// Saving a paid key routes nothing to it by itself: its models appear in
// the chat's model picker, and only picking one there uses the key.
export function ApiKeysSettings() {
  const [overview, setOverview] = useState<KeysOverview | null | undefined>(undefined); // undefined = loading
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [otherName, setOtherName] = useState("");
  const [otherAddress, setOtherAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const reload = () => fetchKeys().then(setOverview);
  useEffect(() => { reload(); }, []);

  const entry: CatalogEntry | undefined = overview?.catalog.find(c => c.id === provider);
  const isOther = provider === OTHER;

  // "Save key" only enables once the form could plausibly be right. The
  // server still does the real check with the provider.
  const inputOk = useMemo(() => {
    const key = apiKey.trim();
    if (!provider || key.length < 8 || /\s/.test(key)) return false;
    if (entry?.needs_account_id && !/^[0-9a-f]{32}$/i.test(accountId.trim())) return false;
    if (isOther && (otherName.trim().length < 2 || !/^https:\/\/[^\s/]+\.[^\s]+/.test(otherAddress.trim()))) return false;
    return true;
  }, [provider, apiKey, accountId, otherName, otherAddress, entry, isOther]);

  if (overview === undefined) {
    return <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Loading…</div>;
  }
  if (overview === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <SectionTitle>Your API keys</SectionTitle>
        <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Only an Owner or Admin can manage API keys.</div>
      </div>
    );
  }

  const paid = overview.catalog.filter(c => c.kind === "paid");
  const free = overview.catalog.filter(c => c.kind === "free");

  const resetForm = () => {
    setApiKey(""); setAccountId(""); setOtherName(""); setOtherAddress("");
  };

  const submit = async () => {
    if (!inputOk || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    const result = await saveKey({
      provider,
      api_key: apiKey.trim(),
      ...(entry?.needs_account_id ? { account_id: accountId.trim() } : {}),
      ...(isOther ? { name: otherName.trim(), base_url: otherAddress.trim() } : {}),
    });
    setSaving(false);
    if ("error" in result) {
      setSaveError(result.error);
      return;
    }
    const row = result.row;
    setSaved(
      row.kind === "free"
        ? `Saved. NAVI now uses your ${row.label} account.${row.checkable ? "" : " This key couldn't be checked in advance, so it'll be tested on first use."}`
        : `Saved. ${row.models ?? 0} ${row.label} model${row.models === 1 ? " is" : "s are"} now in the chat's model picker.`,
    );
    resetForm();
    setProvider("");
    reload();
  };

  const remove = async (row: KeyRow) => {
    setRemoving(row.provider);
    setRowErrors(e => ({ ...e, [row.provider]: "" }));
    const result = await removeKey(row.provider);
    setRemoving(null);
    if ("error" in result) {
      setRowErrors(e => ({ ...e, [row.provider]: result.error }));
      return;
    }
    reload();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
        <SectionTitle>Your API keys</SectionTitle>
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
          Keys are checked with the provider before they're saved, stored encrypted, and never shown again, only
          their last four characters. Only Owners and Admins can see this page.
        </div>
        {overview.encryption.source === "local_file" && (
          <div style={{
            fontSize: fontSize.xxs, lineHeight: 1.5, color: status.warning.color,
            padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs,
            background: status.warning.bg, border: `1px solid ${status.warning.border}`,
          }}>
            The server has no NAVI_SECRET_KEY yet, so the key that encrypts these is stored right next to them.
            Add NAVI_SECRET_KEY to the server's .env and restart to protect them properly.
          </div>
        )}
      </div>

      {/* ---- Bring your key ---- */}
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        <SubTitle>Bring your key</SubTitle>
        <Field label="Provider">
          <select
            value={provider}
            // Switching provider clears the key: a key pasted for one
            // provider must never be sent to another by accident.
            onChange={e => { setProvider(e.target.value); resetForm(); setSaveError(null); setSaved(null); }}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="" disabled>Choose a provider…</option>
            <optgroup label="Paid, billed to your account">
              {paid.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </optgroup>
            <optgroup label="Free tier, use your own account">
              {free.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </optgroup>
            <option value={OTHER}>Other…</option>
          </select>
        </Field>

        {isOther && (
          <>
            <Field label="Name">
              <input value={otherName} onChange={e => setOtherName(e.target.value)} placeholder="e.g. Together AI" style={inputStyle} />
            </Field>
            <Field label="API address" hint="The OpenAI-compatible address from their docs, usually ending in /v1.">
              <input
                value={otherAddress} onChange={e => setOtherAddress(e.target.value)}
                placeholder="https://api.example.com/v1" spellCheck={false} style={inputStyle}
              />
            </Field>
          </>
        )}

        {entry?.needs_account_id && (
          <Field label="Account ID" hint="32 letters and numbers, on the right of your Cloudflare dashboard.">
            <input value={accountId} onChange={e => setAccountId(e.target.value)} spellCheck={false} style={inputStyle} />
          </Field>
        )}

        {provider && (
          <Field
            label="Your key"
            hint={
              entry?.kind === "free"
                ? `Replaces NAVI's ${entry.label} key, so this usage counts against your own account.`
                : "Calls on this key are billed to your account with the provider."
            }
          >
            <input
              // "new-password" rather than "off": browsers ignore "off" on
              // password fields and offer to save the key as a site
              // password. The data-* attributes ask 1Password, LastPass
              // and Bitwarden to leave it alone too.
              type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="off" autoCorrect="off"
              data-1p-ignore="true" data-lpignore="true" data-bwignore="true" name="navi-provider-key"
              value={apiKey} onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void submit(); }}
              placeholder="Paste your key here" style={inputStyle}
            />
          </Field>
        )}

        {provider && (
          <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
            <button
              onClick={() => void submit()}
              disabled={!inputOk || saving}
              style={{
                ...ghostButton, padding: `${spacing.xs}px ${spacing.md}px`, fontSize: fontSize.xs, fontWeight: fontWeight.medium,
                border: `1px solid ${status.success.border}`, background: status.success.bg, color: status.success.color,
                opacity: !inputOk || saving ? 0.5 : 1, cursor: !inputOk || saving ? "default" : "pointer",
              }}
            >
              {saving ? "Checking key…" : "Save key"}
            </button>
          </div>
        )}
        {saveError && <div style={{ fontSize: fontSize.xxs, color: status.danger.color, lineHeight: 1.5 }}>{saveError}</div>}
        {saved && <div style={{ fontSize: fontSize.xxs, color: status.success.color, lineHeight: 1.5 }}>{saved}</div>}
      </div>

      {/* ---- Connected APIs ---- */}
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        <SubTitle>Connected APIs</SubTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.xxs }}>
          {overview.connected.map(row => (
            <div
              key={row.provider}
              style={{
                display: "flex", flexDirection: "column", gap: 2,
                padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs,
                background: "var(--surface-panel)", border: "1px solid var(--border-default)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
                  <span style={{ fontSize: fontSize.xs, color: neutral.textPrimary }}>{row.label}</span>
                  {row.kind === "free" && <Badge tone="free">Free tier</Badge>}
                  {row.kind === "paid" && <Badge tone="paid">Paid</Badge>}
                  {row.kind === "custom" && <Badge tone="paid">Other</Badge>}
                </div>
                {row.source === "yours" && (
                  <button onClick={() => void remove(row)} disabled={removing === row.provider} style={ghostButton}>
                    {removing === row.provider ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
              <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, fontVariantNumeric: "tabular-nums" }}>
                {describe(row)}
              </div>
              {rowErrors[row.provider] && (
                <div style={{ fontSize: fontSize.xxs, color: status.danger.color, lineHeight: 1.5 }}>{rowErrors[row.provider]}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function describe(row: KeyRow): string {
  if (!row.connected) return "Not connected";
  const whose = row.source === "yours" ? "Your key" : row.source === "navi" ? "NAVI's key" : "Server key";
  const models = row.models != null ? ` · ${row.models} model${row.models === 1 ? "" : "s"}` : "";
  const added = row.added_by
    ? ` · added by ${row.added_by}${row.added_at ? ` on ${new Date(row.added_at * 1000).toLocaleDateString()}` : ""}`
    : "";
  return `${whose} ending …${row.hint}${models}${added}`;
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textFaint,
      textTransform: "uppercase", letterSpacing: "0.06em",
    }}>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: fontSize.xs, color: neutral.textPrimary }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}

function Badge({ tone, children }: { tone: "free" | "paid"; children: React.ReactNode }) {
  const c = tone === "free" ? status.success : { color: neutral.textMuted, bg: "transparent", border: "rgba(255,255,255,0.15)" };
  return (
    <span style={{
      fontSize: 10, lineHeight: "14px", padding: "0 6px", borderRadius: 9999,
      color: c.color, background: c.bg, border: `1px solid ${c.border}`, fontFamily, whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}
