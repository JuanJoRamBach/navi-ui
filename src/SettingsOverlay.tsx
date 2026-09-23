import { useEffect, useState } from "react";
import { GearIcon, KeyIcon, OrganizationIcon, PersonIcon, XIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily } from "./tokens";
import { getCurrentUser, type NaviUser } from "./auth";
import { ProfileSettings, TeamSettings } from "./AccountSettings";
import { ApiKeysSettings } from "./ProviderKeys";

type Section = "profile" | "organization" | "apiKeys";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode; dividerBefore?: boolean }[] = [
  { id: "profile", label: "Your profile", icon: <PersonIcon size={14} /> },
  { id: "organization", label: "Your organization", icon: <OrganizationIcon size={14} /> },
  { id: "apiKeys", label: "Your API keys", icon: <KeyIcon size={14} />, dividerBefore: true },
];

// Below this width the section menu moves from a left column to a row of
// tabs across the top, so the content keeps a readable width on a phone.
const NARROW_QUERY = "(max-width: 640px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

// Settings as a window over the app (2026-09-23), same shell as Usage &
// Savings (UsageSavings.tsx) — replaces the small Settings popover, which
// had no room for more than one section.
export function SettingsOverlay({ onClose, initialSection = "profile" }: { onClose: () => void; initialSection?: Section }) {
  const [section, setSection] = useState<Section>(initialSection);
  const [me, setMe] = useState<NaviUser | null | undefined>(undefined); // undefined = loading
  const narrow = useNarrow();

  useEffect(() => { getCurrentUser().then(setMe); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: narrow ? spacing.sm : spacing.lg,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog" aria-label="Settings"
        style={{
          width: "min(880px, 100%)", height: "min(640px, 88vh)", display: "flex", flexDirection: "column",
          background: neutral.surfaceSolid, borderRadius: radius.md, border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)", fontFamily, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: spacing.md, borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
        }}>
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, display: "flex", alignItems: "center", gap: spacing.xs }}>
            <GearIcon size={16} /> Settings
          </span>
          <button
            onClick={onClose} aria-label="Close"
            style={{ display: "flex", background: "none", border: "none", color: neutral.textMuted, cursor: "pointer" }}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", flex: 1, minHeight: 0 }}>
          <nav
            aria-label="Settings sections"
            style={{
              display: "flex", flexDirection: narrow ? "row" : "column", gap: 2, flexShrink: 0,
              width: narrow ? "auto" : 200, padding: spacing.sm, overflowX: narrow ? "auto" : "visible",
              borderRight: narrow ? "none" : "1px solid var(--border-subtle)",
              borderBottom: narrow ? "1px solid var(--border-subtle)" : "none",
            }}
          >
            {SECTIONS.map(s => (
              <div key={s.id} style={{ display: "contents" }}>
                {s.dividerBefore && (
                  <div
                    role="separator"
                    style={narrow
                      ? { width: 1, alignSelf: "stretch", background: "var(--border-subtle)", margin: `0 ${spacing.xxs}px`, flexShrink: 0 }
                      : { height: 1, background: "var(--border-subtle)", margin: `${spacing.xs}px ${spacing.xs}px` }}
                  />
                )}
                <button
                  onClick={() => setSection(s.id)}
                  aria-current={section === s.id ? "page" : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: spacing.sm, flexShrink: 0,
                    padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.sm, border: "none",
                    background: section === s.id ? "rgba(255,255,255,0.08)" : "transparent",
                    color: section === s.id ? neutral.textPrimary : neutral.textMuted,
                    cursor: "pointer", textAlign: "left", whiteSpace: "nowrap",
                    fontSize: fontSize.xs, fontFamily, fontWeight: fontWeight.medium,
                  }}
                >
                  {s.icon} {s.label}
                </button>
              </div>
            ))}
          </nav>

          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: narrow ? spacing.md : spacing.lg }}>
            <div style={{ maxWidth: 560 }}>
              {me === undefined && <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Loading…</div>}
              {/* A session can expire or be revoked mid-use; say so rather
                  than show an empty section. */}
              {me === null && <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Not logged in.</div>}
              {me && section === "profile" && <ProfileSettings me={me} />}
              {me && section === "organization" && <TeamSettings me={me} />}
              {me && section === "apiKeys" && <ApiKeysSettings />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
