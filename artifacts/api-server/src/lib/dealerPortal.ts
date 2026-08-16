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
  // Account self-service (profile, sessions, logout live under /auth)
  { method: "GET", re: /^\/auth\/.*$/ },
  { method: "POST", re: /^\/auth\/.*$/ },
  { method: "PATCH", re: /^\/auth\/.*$/ },
  { method: "DELETE", re: /^\/auth\/.*$/ },
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
