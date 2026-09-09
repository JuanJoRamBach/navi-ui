import { useCallback, useEffect, useState } from "react";
import { PlusIcon, SignOutIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, status, surface } from "./tokens";
import { createUser, getCurrentUser, listUsers, logout, setUserActive, updateUserRole, type NaviUser, type Role } from "./auth";
import { clearSessionToken } from "./sessionAuth";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

// Settings panel content (2026-09-10) — replaces its previous "Coming
// soon" placeholder (App.tsx's openPanel === "settings" branch). Real
// per-user accounts (storage/auth.py) had no UI surface at all until
// this: the only way to see who's logged in, log out, or invite an
// Admin/Member was a raw curl call. Team management (list/create/
// role/active) only renders for Owner/Admin — same role gate the
// backend itself enforces on /auth/users, this just hides a form a
// Member would get a 403 from anyway rather than showing then failing.
export function AccountSettings() {
  const [me, setMe] = useState<NaviUser | null | undefined>(undefined); // undefined = loading
  const [users, setUsers] = useState<NaviUser[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const refreshUsers = useCallback(() => {
    listUsers().then(result => { if (!("error" in result)) setUsers(result); });
  }, []);

  useEffect(() => {
    getCurrentUser().then(setMe);
  }, []);

  useEffect(() => {
    if (me && me.role !== "member") refreshUsers();
  }, [me, refreshUsers]);

  const doLogout = async () => {
    await logout();
    clearSessionToken();
    // A full reload is the simplest correct way back to LoginGate's
    // form — every other piece of app state (open canvas, chat history)
    // is tied to this same session anyway, so there's nothing worth
    // preserving through a soft transition here.
    window.location.reload();
  };

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

  if (me === undefined) {
    return <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>;
  }
  // Shouldn't normally happen (LoginGate already required a valid
  // session to render App at all) — but a session can expire/get
  // revoked mid-use, so this is the honest fallback rather than a blank
  // panel.
  if (me === null) {
    return <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Not logged in.</div>;
  }

  const canManageUsers = me.role === "owner" || me.role === "admin";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
      <div style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Account</div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
        padding: spacing.sm, borderRadius: radius.sm, background: "var(--surface-panel)", border: "1px solid var(--border-default)",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: fontSize.sm, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {me.name || me.email}
          </div>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{me.email} — {ROLE_LABEL[me.role]}</div>
        </div>
        <button
          onClick={doLogout}
          style={{
            display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
            border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
            color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
          }}
        >
          <SignOutIcon size={12} /> Log out
        </button>
      </div>

      {canManageUsers && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: fontSize.xs, color: neutral.textMuted }}>Team</span>
            <button
              onClick={() => setShowAddForm(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
              }}
            >
              <PlusIcon size={10} /> Add person
            </button>
          </div>

          {showAddForm && (
            <div style={{
              display: "flex", flexDirection: "column", gap: spacing.xs,
              padding: spacing.sm, borderRadius: radius.sm, background: surface.raised, border: "1px solid rgba(255,255,255,0.1)",
            }}>
              <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
                No email invites yet — set a password here and share it with them directly.
              </div>
              <input
                type="text" placeholder="Name (optional)" value={newName} onChange={e => setNewName(e.target.value)}
                style={inputStyle}
              />
              <input
                type="email" placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password" placeholder="Password (min. 8 characters)" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                style={inputStyle}
              />
              <select
                value={newRole} onChange={e => setNewRole(e.target.value as Role)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="member">Member</option>
                {/* Matches the backend: an Admin can only create Members
                    (server.py's auth_create_user escalation guard) —
                    hiding the option here is a UX nicety, not the real
                    enforcement, which stays server-side. */}
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

          <div style={{ display: "flex", flexDirection: "column", gap: spacing.xxs }}>
            {users === null && <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Loading…</div>}
            {users?.map(user => (
              <div
                key={user.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
                  padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs,
                  background: "var(--surface-panel)", border: "1px solid var(--border-default)",
                  opacity: user.is_active ? 1 : 0.5,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: fontSize.xs, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.name || user.email}
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
                  <button
                    onClick={() => toggleActive(user)}
                    disabled={busyUserId === user.id}
                    style={{
                      padding: `2px ${spacing.xs}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
                      background: "transparent", color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily, flexShrink: 0,
                    }}
                  >
                    {user.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.04)", color: neutral.textPrimary, fontSize: fontSize.xs, fontFamily, boxSizing: "border-box",
};
