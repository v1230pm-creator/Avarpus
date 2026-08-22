import type { NextFunction, Request, Response } from "express";
import type { DbUser } from "@workspace/db";
import { getSessionUser } from "../lib/authUtils";
import { isDealerPortalRole, dealerPortalAllowed } from "../lib/dealerPortal";
import { customerPortalAllowed } from "../lib/customerPortal";
import { userHasFeature } from "../lib/roleFeatures";

declare global {
  namespace Express {
    interface Request {
      user?: DbUser;
      sessionToken?: string;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  // Wrap async work in a promise chain so any DB failure is forwarded to the
  // global error-handling middleware via next(err) instead of becoming an
  // unhandled rejection.
  getSessionUser(token)
    .then(async (user) => {
      if (!user || !user.isActive) {
        res.status(401).json({ message: "Session expired. Please sign in again." });
        return;
      }
      // ── Customer accounts ───────────────────────────────────────────────
      // Customer users (role = "customer") are end-users tied to a single
      // customer record. They may ONLY access the explicit allowlist in
      // customerPortal.ts — everything else is 403 CUSTOMER_PORTAL_FORBIDDEN.
      // Fail-closed: new business endpoints are blocked by default.
      if (user.role === "customer") {
        if (!customerPortalAllowed(req)) {
          res.status(403).json({
            message: "Customer account: access limited to your own profile and chat rooms.",
            code: "CUSTOMER_PORTAL_FORBIDDEN",
          });
          return;
        }
        req.user = user;
        req.sessionToken = token;
        next();
        return;
      }
      // ── Dealer-portal accounts ──────────────────────────────────────────
      // External B2B dealer logins are read-only and restricted to their
      // own dealer's repair data. Enforced here so every endpoint — present
      // and future — is blocked by default unless explicitly allowlisted.
      if (isDealerPortalRole(user.role)) {
        if (!dealerPortalAllowed(req)) {
          res.status(403).json({
            message: "Dealer account: access limited to your own repairs.",
            code: "DEALER_PORTAL_FORBIDDEN",
          });
          return;
        }
        // Shop owner can switch the portal off per role (Staff Permissions).
        // Account self-service under /auth stays available so the user can
        // still manage their profile and sign out.
        if (!req.path.startsWith("/auth")) {
          await userHasFeature(user, "portal_repairs").then((ok) => {
            if (!ok) {
              res.status(403).json({
                message: "Dealer portal access has been turned off by the shop. Please contact the shop.",
                code: "FEATURE_DISABLED",
              });
              return;
            }
            req.user = user;
            req.sessionToken = token;
            next();
          });
          return;
        }
      }
      req.user = user;
      req.sessionToken = token;
      next();
    })
    .catch(next);
}
