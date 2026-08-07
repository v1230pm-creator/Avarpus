import type { NextFunction, Request, Response } from "express";
import type { DbUser } from "@workspace/db";
import { getSessionUser } from "../lib/authUtils";

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
    .then((user) => {
      if (!user || !user.isActive) {
        res.status(401).json({ message: "Session expired. Please sign in again." });
        return;
      }
      req.user = user;
      req.sessionToken = token;
      next();
    })
    .catch(next);
}
