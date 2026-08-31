import type { Request } from "express";

// ── Customer portal accounts ─────────────────────────────────────────────────
// role = "customer" accounts are end-users linked one-to-one to a customers
// row. They may ONLY access their own self-service auth endpoints and the
// chat endpoints that enforce per-room membership. Everything else returns
// 403 CUSTOMER_PORTAL_FORBIDDEN — fail-closed at the auth boundary so
// future business endpoints are blocked by default.

const UUID = "[0-9a-fA-F-]{36}";

// Explicit allowlist. Method wildcard "*" means all HTTP methods.
const ALLOWED: Array<{ method: string | "*"; re: RegExp }> = [
  // ── Auth self-service ────────────────────────────────────────────────────
  // Profile, sessions, and logout — but NOT registration
  // endpoints that could create additional accounts.
  { method: "GET",    re: /^\/auth\/me$/ },
  { method: "PATCH",  re: /^\/auth\/me$/ },
  { method: "POST",   re: /^\/auth\/logout$/ },
  { method: "GET",    re: /^\/auth\/sessions$/ },
  { method: "DELETE", re: new RegExp(`^\\/auth\\/sessions\\/${UUID}$`) },
  { method: "POST",   re: /^\/auth\/sessions\/revoke-others$/ },
  { method: "GET",    re: /^\/auth\/login-history$/ },
  // Profile image upload is still self-service; the storage route scopes the
  // object path to the authenticated user's ID before issuing the signed URL.
  { method: "POST",   re: /^\/storage\/profiles\/upload-url$/ },

  // ── Optional business workspace ─────────────────────────────────────────
  // Each route performs its own membership/owner checks. Customers need this
  // entry point to create or claim their first workspace.
  { method: "*",      re: /^\/shop(?:\/.*)?$/ },

  // ── Exact-recipient notifications ───────────────────────────────────────
  { method: "GET",    re: /^\/notifications$/ },
  { method: "POST",   re: /^\/notifications\/read$/ },

  // ── Personal Status ─────────────────────────────────────────────────────
  { method: "GET",    re: /^\/statuses$/ },
  { method: "POST",   re: /^\/statuses$/ },
  { method: "POST",   re: /^\/statuses\/upload-url$/ },
  { method: "GET",    re: new RegExp(`^\\/statuses\\/${UUID}$`) },
  { method: "POST",   re: new RegExp(`^\\/statuses\\/${UUID}\\/view$`) },
  { method: "GET",    re: new RegExp(`^\\/statuses\\/${UUID}\\/viewers$`) },
  { method: "DELETE", re: new RegExp(`^\\/statuses\\/${UUID}$`) },
  // Status objects remain protected by the storage route's active-status,
  // audience/contact, block, expiry, and active-author checks.
  { method: "GET",    re: new RegExp(`^\\/storage\\/objects\\/uploads\\/status\\/${UUID}\\/${UUID}$`) },

  // ── Chat ─────────────────────────────────────────────────────────────────
  // Capabilities
  { method: "GET",    re: /^\/chat\/capabilities$/ },
  // Privacy-safe contact match (exact number lookup, same-shop only)
  { method: "POST",   re: /^\/chat\/contacts\/match$/ },
  // Direct room creation (kind=direct, same-shop target only)
  { method: "POST",   re: /^\/chat\/rooms$/ },
  // Room list (filtered to rooms customer is a member of inside the route)
  { method: "GET",    re: /^\/chat\/rooms$/ },
  // Single room (membership enforced inside the route)
  { method: "GET",    re: new RegExp(`^\\/chat\\/rooms\\/${UUID}$`) },
  // Global direct-room safety controls (membership + direct scope enforced)
  { method: "POST",   re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/block$`) },
  { method: "DELETE", re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/block$`) },
  { method: "POST",   re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/reports$`) },
  // Messages in a room
  { method: "GET",    re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/messages$`) },
  { method: "POST",   re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/messages$`) },
  // Read markers
  { method: "POST",   re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/read$`) },
  // Media uploads for chat
  { method: "POST",   re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/upload-url$`) },
  // Call tokens
  { method: "POST",   re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/call-token$`) },
  // Authenticated chat media download — membership + message ownership enforced
  // inside the route. Generic /storage/objects/* is NOT allowed: a customer
  // should never be able to read arbitrary shop objects (repair photos, etc.)
  // by guessing or leaking a path.
  { method: "GET",    re: new RegExp(`^\\/chat\\/rooms\\/${UUID}\\/messages\\/${UUID}\\/media$`) },
];

export function customerPortalAllowed(req: Request): boolean {
  const path = req.path.replace(/\/+$/, "") || "/";
  return ALLOWED.some(
    (a) =>
      (a.method === "*" || a.method === req.method) && a.re.test(path),
  );
}
