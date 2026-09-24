import { useCallback, useEffect, useState } from "react";
import { BookIcon, FileDirectoryIcon, GearIcon, KeyIcon, OrganizationIcon, PersonIcon, XIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, status } from "./tokens";
import { getCurrentUser, type NaviUser } from "./auth";
import { ProfileSettings, TeamSettings } from "./AccountSettings";
import { ApiKeysSettings } from "./ProviderKeys";
import { CompanyKnowledgeSettings, ProjectsSettings } from "./KnowledgeSettings";
import { fetchOverview, isError, type KnowledgeOverview } from "./knowledgeApi";

export type SettingsSection = "profile" | "organization" | "knowledge" | "projects" | "apiKeys";
type Section = SettingsSection;

const SECTIONS: { id: Section; label: string; icon: React.ReactNode; dividerBefore?: boolean }[] = [
  { id: "profile", label: "Your profile", icon: <PersonIcon size={14} /> },
  { id: "organization", label: "Your organization", icon: <OrganizationIcon size={14} /> },
  { id: "knowledge", label: "Company knowledge", icon: <BookIcon size={14} /> },
  { id: "projects", label: "Projects", icon: <FileDirectoryIcon size={14} /> },
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
export function SettingsOverlay({ onClose, initialSection = "profile", initialProjectId, onKnowledgeChanged }: {
  onClose: () => void;
  initialSection?: Section;
  initialProjectId?: string | null;
  // Projects created, archived or re-shared here change which projects the
  // sidebar offers; the app refreshes its list when this fires.
  onKnowledgeChanged?: () => void;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const [me, setMe] = useState<NaviUser | null | undefined>(undefined); // undefined = loading
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const narrow = useNarrow();

  useEffect(() => { getCurrentUser().then(setMe); }, []);

  const loadOverview = useCallback(async () => {
    const r = await fetchOverview();
    if (isError(r)) setOverviewError(r.error); else { setOverview(r); setOverviewError(null); }
  }, []);
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  const knowledgeChanged = useCallback(() => { void loadOverview(); onKnowledgeChanged?.(); }, [loadOverview, onKnowledgeChanged]);

  // What waits for this person, shown on the menu so an approval doesn't
  // sit unnoticed until someone happens to open the right screen.
  const waitingFor = (id: Section): number => {
    if (!overview) return 0;
    if (id === "knowledge") return overview.waiting.company ?? 0;
    if (id === "projects") {
      return Object.entries(overview.waiting).filter(([s]) => s.startsWith("project:")).reduce((n, [, c]) => n + c, 0);
    }
    return 0;
  };

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
                  {waitingFor(s.id) > 0 && (
                    <span
                      title="Waiting for you"
                      style={{
                        marginLeft: "auto", minWidth: 16, padding: "0 5px", borderRadius: 9999, textAlign: "center",
                        fontSize: 10, lineHeight: "16px", fontVariantNumeric: "tabular-nums",
                        color: status.warning.color, background: status.warning.bg, border: `1px solid ${status.warning.border}`,
                      }}
                    >
                      {waitingFor(s.id)}
                    </span>
                  )}
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
              {me && (section === "knowledge" || section === "projects") && !overview && (
                <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>{overviewError ?? "Loading…"}</div>
              )}
              {me && section === "knowledge" && overview && (
                <CompanyKnowledgeSettings overview={overview} onChanged={knowledgeChanged} />
              )}
              {me && section === "projects" && overview && (
                <ProjectsSettings overview={overview} initialProjectId={initialProjectId} onChanged={knowledgeChanged} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
