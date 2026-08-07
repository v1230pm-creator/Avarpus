import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler so that any rejected promise is
 * forwarded to the Express error-handling middleware via `next(err)`.
 * Express 4 does not auto-catch async errors, so this is required.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
