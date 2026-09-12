import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

// ── Request-boundary validation ─────────────────────────────────────────────
// Every route boundary should validate through these helpers so malformed
// input fails the same way everywhere: HTTP 400, `code: "VALIDATION_ERROR"`,
// and a short human-readable `message` (never a raw Zod dump).
//
// Body schemas come from @workspace/api-zod (generated from the OpenAPI
// contract) wherever the contract already describes the payload, so the API
// cannot silently accept fields the contract does not declare.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type ValidationFailure = { message: string; code: "VALIDATION_ERROR"; field?: string };

function firstIssueMessage(error: z.ZodError): ValidationFailure {
  const issue = error.issues[0];
  if (!issue) return { message: "Invalid request", code: "VALIDATION_ERROR" };
  const field = issue.path.map(String).join(".");
  const message = field ? `${field}: ${issue.message}` : issue.message;
  return field
    ? { message, code: "VALIDATION_ERROR", field }
    : { message, code: "VALIDATION_ERROR" };
}

/**
 * Parse `req.body` with a schema. On failure responds 400 and returns null so
 * the handler can `if (!body) return;`. On success returns the parsed data
 * (with Zod defaults/coercions applied) — handlers must use the returned
 * value, not `req.body`, so unknown keys never reach the database.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, req: Request, res: Response): z.infer<S> | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json(firstIssueMessage(parsed.error));
    return null;
  }
  return parsed.data;
}

/** Same contract as parseBody, for `req.query`. */
export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request, res: Response): z.infer<S> | null {
  const parsed = schema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json(firstIssueMessage(parsed.error));
    return null;
  }
  return parsed.data;
}

/** Same contract as parseBody, for `req.params`. */
export function parseParams<S extends ZodTypeAny>(schema: S, req: Request, res: Response): z.infer<S> | null {
  const parsed = schema.safeParse(req.params ?? {});
  if (!parsed.success) {
    res.status(400).json(firstIssueMessage(parsed.error));
    return null;
  }
  return parsed.data;
}

/**
 * Router-level guard for UUID path parameters. Register once per router:
 *
 *   router.param("id", uuidParam);
 *
 * A malformed id is answered as 404 rather than 400 on purpose: every handler
 * behind it already answers 404 for an unknown-but-well-formed id, and the
 * caller must not be able to tell "malformed" from "not yours" apart. Without
 * this guard Postgres rejects the cast with a 22P02 error that surfaces as a
 * misleading 500.
 */
export function uuidParam(_req: Request, res: Response, next: NextFunction, value: unknown): void {
  if (!isUuid(value)) {
    res.status(404).json({ message: "Not found" });
    return;
  }
  next();
}

/**
 * Variant for routers whose `:id` routes also accept the literal `me` as a
 * self-reference (e.g. `/customers/me/khata` for the customer portal). Every
 * handler on such a router must still treat `me` explicitly; this guard only
 * lets it through.
 */
export function uuidOrSelfParam(req: Request, res: Response, next: NextFunction, value: unknown): void {
  if (value === "me") {
    next();
    return;
  }
  uuidParam(req, res, next, value);
}
