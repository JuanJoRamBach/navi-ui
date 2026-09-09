// REST client for server.py's /auth/* routes (2026-09-10) — real
// per-user accounts, see storage/auth.py's own docstring on the backend
// for the full design. Plain fetch, same shape as agentWork.ts.
import { NAVI_BACKEND_URL } from "./config";

export type Role = "owner" | "admin" | "member";

export interface NaviUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  is_active: boolean;
  created_at: number;
}

async function parseJsonOrError(res: Response): Promise<{ error: string }> {
  try {
    return await res.json();
  } catch {
    return { error: `Request failed (${res.status})` };
  }
}

export async function login(email: string, password: string): Promise<{ token: string; user: NaviUser } | { error: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return parseJsonOrError(res);
  return res.json();
}

// Only ever succeeds once — the very first account on a fresh backend.
// Every account after that comes from createUser below, called by an
// already-logged-in Owner/Admin (server.py's /auth/register refuses once
// a single account exists).
export async function registerFirstOwner(email: string, password: string, name?: string): Promise<{ token: string; user: NaviUser } | { error: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) return parseJsonOrError(res);
  return res.json();
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${NAVI_BACKEND_URL}/auth/logout`, { method: "POST" });
  } catch {
    // Best-effort — clearing the local token (sessionAuth.ts) is what
    // actually matters client-side; a failed server-side revoke just
    // means that token would've expired on its own in 30 days anyway.
  }
}

export async function getCurrentUser(): Promise<NaviUser | null> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/auth/me`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function listUsers(): Promise<NaviUser[] | { error: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/auth/users`);
  if (!res.ok) return parseJsonOrError(res);
  return res.json();
}

export async function createUser(email: string, password: string, name: string | undefined, role: Role): Promise<NaviUser | { error: string }> {
  const res = await fetch(`${NAVI_BACKEND_URL}/auth/users`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name, role }),
  });
  if (!res.ok) return parseJsonOrError(res);
  return res.json();
}

export async function updateUserRole(userId: string, role: Role): Promise<boolean> {
  const res = await fetch(`${NAVI_BACKEND_URL}/auth/users/${encodeURIComponent(userId)}/role`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  return res.ok;
}

export async function setUserActive(userId: string, isActive: boolean): Promise<boolean> {
  const res = await fetch(`${NAVI_BACKEND_URL}/auth/users/${encodeURIComponent(userId)}/active`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
  return res.ok;
}
