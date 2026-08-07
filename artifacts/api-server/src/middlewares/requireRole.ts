import type { NextFunction, Request, Response } from "express";

/**
 * Role-based access control guard. Must be mounted AFTER requireAuth so that
 * `req.user` is populated. Responds 403 when the authenticated user's role is
 * not in the allowed list.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: { role: string } }).user;
    if (!user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ message: "You do not have permission to perform this action" });
      return;
    }
    next();
  };
}
