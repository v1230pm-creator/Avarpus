import type { Request } from "express";

// ── B2B dealer portal accounts ──────────────────────────────────────────────
// Roles for external dealer logins (NOT the shop-owner `dealer` role).
// These accounts may only READ their own dealer's repair data — everything
// else in the API is blocked, fail-closed, at the auth boundary.
export const DEALER_PORTAL_ROLES = ["dealer_owner", "dealer_staff"] as const;

export function isDealerPortalRole(role: string): boolean {
  return (DEALER_PORTAL_ROLES as readonly string[]).includes(role);
}

const UUID = "[0-9a-fA-F-]{36}";

// Allowlist of endpoints a dealer-portal account may call. Anything not
// listed is 403 — new endpoints are therefore blocked by default.
const ALLOWED: Array<{ method: string; re: RegExp }> = [
  // Own dealer profile + stats
  { method: "GET", re: /^\/dealers\/me$/ },
  // Own repairs (list is force-filtered by dealerId server-side)
  { method: "GET", re: new RegExp(`^\\/repairs$`) },
  { method: "GET", re: new RegExp(`^\\/repairs\\/${UUID}\\/events$`) },
  { method: "GET", re: new RegExp(`^\\/repairs\\/${UUID}\\/photos$`) },
  { method: "GET", re: new RegExp(`^\\/repairs\\/${UUID}\\/payments$`) },
  { method: "GET", re: /^\/role-features$/ },
  // Account self-service (profile, sessions, logout live under /auth)
  { method: "GET", re: /^\/auth\/.*$/ },
  { method: "POST", re: /^\/auth\/.*$/ },
  { method: "PATCH", re: /^\/auth\/.*$/ },
  { method: "DELETE", re: /^\/auth\/.*$/ },
  { method: "GET", re: /^\/drive-backup(?:\/.*)?$/ },
  { method: "POST", re: /^\/drive-backup(?:\/.*)?$/ },
  { method: "PATCH", re: /^\/drive-backup(?:\/.*)?$/ },
  { method: "DELETE", re: /^\/drive-backup(?:\/.*)?$/ },
  // Exact-recipient notifications
  { method: "GET", re: /^\/notifications$/ },
  { method: "POST", re: /^\/notifications\/read$/ },
  // Global direct chat. Room routes enforce exact membership internally, and
  // POST /chat/rooms additionally limits portal accounts to kind=direct.
  { method: "GET", re: /^\/chat\/capabilities$/ },
  { method: "POST", re: /^\/chat\/contacts\/match$/ },
  { method: "POST", re: /^\/chat\/rooms$/ },
  { method: "GET", re: /^\/chat\/rooms$/ },
  { method: "GET", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}$`) },
  { method: "POST", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/block$`) },
  { method: "DELETE", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/block$`) },
  { method: "POST", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/reports$`) },
  { method: "GET", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/messages$`) },
  { method: "POST", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/messages$`) },
  { method: "POST", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/read$`) },
  { method: "POST", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/upload-url$`) },
  { method: "POST", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/call-token$`) },
  { method: "GET", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/messages\\/${UUID}\\/media$`) },
  // Serving uploaded photos — the actual mounted route is /storage/objects/*.
  // Dealer-level scoping (only objects attached to the portal dealer's own
  // repairs) is enforced inside the storage route itself.
  { method: "GET", re: /^\/storage\/objects\/.*$/ },
];

export function dealerPortalAllowed(req: Request): boolean {
  // req.path is relative to the /api mount (e.g. /repairs/…)
  const path = req.path.replace(/\/+$/, "") || "/";
  return ALLOWED.some((a) => a.method === req.method && a.re.test(path));
}
