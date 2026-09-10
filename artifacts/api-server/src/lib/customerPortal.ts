import type { Request } from "express";
import contract from "./customerPortalContract.json";

// ── Customer portal accounts ─────────────────────────────────────────────────
// role = "customer" accounts are end-users linked one-to-one to a customers
// row. They may ONLY access their own self-service auth endpoints and the
// chat endpoints that enforce per-room membership. Everything else returns
// 403 CUSTOMER_PORTAL_FORBIDDEN — fail-closed at the auth boundary so
// future business endpoints are blocked by default.

// Explicit allowlist. Families and their focused isolation probe (or documented
// self-service exemption) live in the same contract consumed by validation.
const ALLOWED = contract.rules.map(({ method, pattern }) => ({
  method,
  re: new RegExp(pattern),
}));

export function customerPortalAllowed(req: Request): boolean {
  const path = req.path.replace(/\/+$/, "") || "/";
  return ALLOWED.some(
    (a) =>
      (a.method === "*" || a.method === req.method) && a.re.test(path),
  );
}
