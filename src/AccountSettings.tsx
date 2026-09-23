import { useCallback, useEffect, useState } from "react";
import { PlusIcon, SignOutIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, status, surface } from "./tokens";
import { createUser, listUsers, logout, setUserActive, updateUserRole, type NaviUser, type Role } from "./auth";
import { clearSessionToken } from "./sessionAuth";

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

// Settings → Your profile and Your organization (2026-09-23). These were
// one "Account" panel in the old Settings popover (2026-09-10, which gave
// per-user accounts their first UI); the Settings window now shows them
// as two separate sections. `me` is fetched once by SettingsOverlay and
// passed down, since both sections and the section menu need it.

export function ProfileSettings({ me }: { me: NaviUser }) {
  const doLogout = async () => {
    await logout();
    clearSessionToken();
    // A full reload is the simplest correct way back to LoginGate's
    // form — every other piece of app state (open canvas, chat history)
    // is tied to this same session anyway, so there's nothing worth
    // preserving through a soft transition here.
    window.location.reload();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <SectionTitle>Your profile</SectionTitle>
      <Row label="Name">{me.name || "Not set"}</Row>
      <Row label="Email">{me.email}</Row>
      <Row label="Role">{ROLE_LABEL[me.role]}</Row>
      <Row label="Log out of this device" last>
        <button onClick={doLogout} style={ghostButton}>
          <SignOutIcon size={12} /> Log out
        </button>
      </Row>
    </div>
  );
}

export function TeamSettings({ me }: { me: NaviUser }) {
  const [users, setUsers] = useState<NaviUser[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const canManageUsers = me.role === "owner" || me.role === "admin";

  const refreshUsers = useCallback(() => {
    listUsers().then(result => { if (!("error" in result)) setUsers(result); });
  }, []);

  useEffect(() => {
    if (canManageUsers) refreshUsers();
  }, [canManageUsers, refreshUsers]);

  const submitAdd = async () => {
    if (!newEmail.trim() || newPassword.length < 8 || creating) return;
    setCreating(true);
    setFormError(null);
    try {
      const result = await createUser(newEmail.trim(), newPassword, newName.trim() || undefined, newRole);
      if ("error" in result) {
        setFormError(result.error);
        return;
      }
      setNewEmail(""); setNewPassword(""); setNewName(""); setNewRole("member"); setShowAddForm(false);
      refreshUsers();
    } finally {
      setCreating(false);
    }
  };

  const changeRole = async (userId: string, role: Role) => {
    setBusyUserId(userId);
    try {
      if (await updateUserRole(userId, role)) refreshUsers();
    } finally {
      setBusyUserId(null);
    }
  };

  const toggleActive = async (user: NaviUser) => {
    setBusyUserId(user.id);
    try {
      if (await setUserActive(user.id, !user.is_active)) refreshUsers();
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>Your organization</SectionTitle>
        {canManageUsers && (
          <button onClick={() => setShowAddForm(v => !v)} style={ghostButton}>
            <PlusIcon size={10} /> Add person
          </button>
        )}
      </div>

      {!canManageUsers && (
        <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, lineHeight: 1.5 }}>
          Only an Owner or Admin can see and manage the team.
        </div>
      )}

      {canManageUsers && showAddForm && (
        <div style={{
          display: "flex", flexDirection: "column", gap: spacing.xs,
          padding: spacing.sm, borderRadius: radius.sm, background: surface.raised, border: "1px solid rgba(255,255,255,0.1)",
        }}>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
            No email invites yet — set a password here and share it with them directly.
          </div>
          <input type="text" placeholder="Name (optional)" value={newName} onChange={e => setNewName(e.target.value)} style={inputStyle} />
          <input type="email" placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} style={inputStyle} />
          <input
            type="password" placeholder="Password (min. 8 characters)" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            style={inputStyle}
          />
          <select value={newRole} onChange={e => setNewRole(e.target.value as Role)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="member">Member</option>
            {/* Matches the backend: an Admin can only create Members
                (server.py's auth_create_user escalation guard) — hiding the
                option here is a UX nicety, not the real enforcement. */}
            {me.role === "owner" && <option value="admin">Admin</option>}
            {me.role === "owner" && <option value="owner">Owner</option>}
          </select>
          {formError && <div style={{ fontSize: fontSize.xxs, color: status.danger.color }}>{formError}</div>}
          <button
            onClick={submitAdd}
            disabled={creating || !newEmail.trim() || newPassword.length < 8}
            style={{
              padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
              border: `1px solid ${status.success.border}`, background: status.success.bg, color: status.success.color,
              cursor: creating ? "default" : "pointer", fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily,
              opacity: creating || !newEmail.trim() || newPassword.length < 8 ? 0.6 : 1,
            }}
          >
            {creating ? "Creating…" : "Create account"}
          </button>
        </div>
      )}

      {canManageUsers && (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.xxs }}>
          {users === null && <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>}
          {users?.map(user => (
            <div
              key={user.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
                padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs,
                background: "var(--surface-panel)", border: "1px solid var(--border-default)",
                opacity: user.is_active ? 1 : 0.5,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: fontSize.xs, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.name || user.email}{user.id === me.id && " (you)"}
                </div>
                <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
                  {user.email}{!user.is_active && " — deactivated"}
                </div>
              </div>
              {me.role === "owner" && user.id !== me.id ? (
                <select
                  value={user.role} disabled={busyUserId === user.id}
                  onChange={e => changeRole(user.id, e.target.value as Role)}
                  style={{ ...inputStyle, width: "auto", padding: `2px ${spacing.xs}px`, fontSize: fontSize.xxs }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              ) : (
                <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted, flexShrink: 0 }}>{ROLE_LABEL[user.role]}</span>
              )}
              {me.role === "owner" && user.id !== me.id && (
                <button onClick={() => toggleActive(user)} disabled={busyUserId === user.id} style={ghostButton}>
                  {user.is_active ? "Deactivate" : "Reactivate"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Shared pieces for the Settings window's sections ----

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary, marginBottom: spacing.xs }}>
      {children}
    </div>
  );
}

// A label on the left, its value or control on the right, a hairline
// between rows: the same shape as the reference Settings window JuanJo
// pointed at.
function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.md,
      padding: `${spacing.md}px 0`, borderBottom: last ? "none" : "1px solid var(--border-subtle)",
    }}>
      <span style={{ fontSize: fontSize.xs, color: neutral.textPrimary }}>{label}</span>
      <span style={{ fontSize: fontSize.xs, color: neutral.textMuted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {children}
      </span>
    </div>
  );
}

export const ghostButton: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
  padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
  border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
  color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
};

export const inputStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.04)", color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily, boxSizing: "border-box",
  width: "100%",
};
