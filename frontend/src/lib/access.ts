/**
 * access.ts — lightweight, client-side access gate for /form and /chat.
 *
 * Not real security — credentials are checked in the browser. It exists to land
 * users in the right intake mode: Underwriter/Admin (full optional questions) vs.
 * Loan Officer (mandatory only).
 *
 * Persistence: "Remember me on this device" stores the role in localStorage so it
 * survives a full browser restart. When unchecked the role is kept only in an
 * in-memory module variable — it survives client-side navigation between /form and
 * /chat but is gone on any full page reload, new tab, or browser restart.
 *
 * Admin === Underwriter for now: both map to the "underwriter" form mode.
 */
import type { FormChatMode } from "@/components/wizard/FormChatFlow";

export type AccessRole = "lo" | "underwriter" | "admin";

/** Human label shown in the header Access Type badge. */
export const ACCESS_ROLE_LABEL: Record<AccessRole, string> = {
  lo: "Loan Officer",
  underwriter: "Underwriter",
  admin: "Admin",
};

/** Hard-coded credentials (internal tool). username (case-insensitive) → role. */
const CREDENTIALS: Record<string, { password: string; role: AccessRole }> = {
  admin: { password: "adminassist2026", role: "admin" },
  underwriter: { password: "uwassist2026", role: "underwriter" },
};

const STORAGE_KEY = "nqm_access_v1";

/** Admin and Underwriter both unlock the underwriter intake; everyone else is LO. */
export function roleToFormMode(role: AccessRole): FormChatMode {
  return role === "lo" ? "lo" : "underwriter";
}

/**
 * Validate a username/password pair. Returns the granted role, or null if the
 * credentials don't match. Username is matched case-insensitively; password is exact.
 */
export function authenticate(username: string, password: string): AccessRole | null {
  const entry = CREDENTIALS[username.trim().toLowerCase()];
  if (entry && entry.password === password) return entry.role;
  return null;
}

function isRole(raw: string | null): raw is AccessRole {
  return raw === "lo" || raw === "underwriter" || raw === "admin";
}

/**
 * In-memory role for the "don't remember me" case. Survives in-app (client-side)
 * navigation between /form and /chat — the module stays loaded — but is lost on a
 * full page reload, a new tab, or a browser restart. That's exactly the behavior
 * we want when "Remember me" is OFF, and it makes the checkbox's effect visible
 * on a simple refresh (no sessionStorage that quietly survives reloads).
 */
let _memoryRole: AccessRole | null = null;

/**
 * The granted role, or null if the gate hasn't been answered yet. Remembered
 * (localStorage) wins so a restart restores it; otherwise the in-memory role.
 */
export function getAccessRole(): AccessRole | null {
  if (typeof window === "undefined") return _memoryRole;
  const remembered = window.localStorage.getItem(STORAGE_KEY);
  if (isRole(remembered)) return remembered;
  return _memoryRole;
}

/**
 * Persist the granted role. `remember` → localStorage (survives a browser
 * restart). Unchecked → in-memory only (gone on the next full reload).
 */
export function setAccessRole(role: AccessRole, remember = false): void {
  _memoryRole = role;
  if (typeof window === "undefined") return;
  if (remember) {
    window.localStorage.setItem(STORAGE_KEY, role);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearAccessRole(): void {
  _memoryRole = null;
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  // Clear any role left by older builds that used sessionStorage.
  window.sessionStorage.removeItem(STORAGE_KEY);
}
