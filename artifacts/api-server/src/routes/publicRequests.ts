import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import {
  db,
  publicRequestIdentityVerificationsTable,
  publicRequestTransitionsTable,
  publicRequestsTable,
  usersTable,
} from "@workspace/db";
import {
  PublicRequestAdminListQueryParams,
  PublicRequestAdminIdentityVerificationCreateBody,
  PublicRequestAdminStatusUpdateBody,
  PublicRequestCreateBody,
  PublicRequestCreateResponse,
} from "@workspace/api-zod";
import { asyncHandler } from "../lib/asyncHandler";
import { sha256 } from "../lib/authUtils";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { notifyActiveSuperAdminsOfPublicRequest } from "../lib/notify";

const router: IRouter = Router();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const ADMIN = requireRole("super_admin");
const REQUEST_STATUSES = new Set(["received", "in_review", "resolved", "rejected"]);
const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  received: ["in_review", "rejected"],
  in_review: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
};

function requestView(request: typeof publicRequestsTable.$inferSelect) {
  // Intentionally whitelist fields: ipHash is abuse-protection data, never an
  // admin API field.
  return {
    id: request.id,
    kind: request.kind,
    requesterName: request.requesterName,
    mobile: request.mobile,
    email: request.email,
    subject: request.subject,
    message: request.message,
    status: request.status,
    reviewerUserId: request.reviewerUserId,
    reviewedAt: request.reviewedAt,
    confirmationAcceptedAt: request.confirmationAcceptedAt,
    createdAt: request.createdAt,
  };
}

function queueRequestView(request: typeof publicRequestsTable.$inferSelect) {
  return {
    id: request.id,
    kind: request.kind,
    requesterName: request.requesterName,
    mobile: request.mobile,
    subject: request.subject,
    status: request.status,
    createdAt: request.createdAt,
  };
}

function isRequestId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function encodeCursor(request: typeof publicRequestsTable.$inferSelect): string {
  return Buffer.from(JSON.stringify({
    createdAt: request.createdAt.toISOString(),
    id: request.id,
  })).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt);
    if (
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id) ||
      Number.isNaN(createdAt.getTime())
    ) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

async function requestDetail(id: string) {
  const [request] = await db
    .select()
    .from(publicRequestsTable)
    .where(eq(publicRequestsTable.id, id))
    .limit(1);
  if (!request) return null;
  const transitions = await db
    .select({
      id: publicRequestTransitionsTable.id,
      fromStatus: publicRequestTransitionsTable.fromStatus,
      toStatus: publicRequestTransitionsTable.toStatus,
      note: publicRequestTransitionsTable.note,
      reviewerUserId: publicRequestTransitionsTable.reviewerUserId,
      reviewerName: usersTable.name,
      createdAt: publicRequestTransitionsTable.createdAt,
    })
    .from(publicRequestTransitionsTable)
    .leftJoin(usersTable, eq(publicRequestTransitionsTable.reviewerUserId, usersTable.id))
    .where(eq(publicRequestTransitionsTable.publicRequestId, id))
    .orderBy(publicRequestTransitionsTable.createdAt, publicRequestTransitionsTable.id);
  const [identityVerification] = await db
    .select({
      id: publicRequestIdentityVerificationsTable.id,
      reviewerUserId: publicRequestIdentityVerificationsTable.reviewerUserId,
      reviewerName: usersTable.name,
      method: publicRequestIdentityVerificationsTable.method,
      note: publicRequestIdentityVerificationsTable.note,
      createdAt: publicRequestIdentityVerificationsTable.createdAt,
    })
    .from(publicRequestIdentityVerificationsTable)
    .leftJoin(usersTable, eq(publicRequestIdentityVerificationsTable.reviewerUserId, usersTable.id))
    .where(eq(publicRequestIdentityVerificationsTable.publicRequestId, id))
    .limit(1);
  return {
    request: requestView(request),
    transitions,
    identityVerification: identityVerification ?? null,
  };
}

router.post(
  "/public/requests",
  asyncHandler(async (req, res) => {
    const honeypot = (req.body as { website?: unknown } | null)?.website;
    if (typeof honeypot === "string" && honeypot.length > 0) {
      res.status(202).json({
        requestId: crypto.randomUUID(),
        status: "received",
        message: "Your request has been received for review.",
      });
      return;
    }

    const parsed = PublicRequestCreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Please check the form and try again." });
      return;
    }

    if (parsed.data.kind === "account_deletion" && !parsed.data.confirmation) {
      res.status(400).json({
        message: "Confirm that you understand identity verification is required.",
      });
      return;
    }

    const hashKey = process.env.SESSION_SECRET;
    if (!hashKey) {
      throw new Error("SESSION_SECRET is required for public request abuse protection");
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const ipHash = sha256(`public-request-ip:v1:${hashKey}:${ip}`);
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

    const request = await db.transaction(async (tx) => {
      // Serialize requests from the same hashed IP for the duration of this
      // transaction so concurrent bursts cannot all pass the count check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ipHash}))`);
      const [usage] = await tx
        .select({ value: count() })
        .from(publicRequestsTable)
        .where(
          and(
            eq(publicRequestsTable.ipHash, ipHash),
            gte(publicRequestsTable.createdAt, windowStart),
          ),
        );
      if ((usage?.value ?? 0) >= RATE_LIMIT_MAX) {
        return null;
      }

      const [inserted] = await tx
        .insert(publicRequestsTable)
        .values({
          kind: parsed.data.kind,
          requesterName: parsed.data.name.trim(),
          mobile: parsed.data.mobile,
          email: parsed.data.email?.trim() || null,
          subject: parsed.data.subject?.trim() || null,
          message: parsed.data.message.trim(),
          ipHash,
          confirmationAcceptedAt:
            parsed.data.kind === "account_deletion" ? new Date() : null,
        })
        .returning({ id: publicRequestsTable.id });
      return inserted;
    });

    if (!request) {
      res.status(429).json({
        message: "Too many requests. Please wait before trying again.",
      });
      return;
    }

    // The request is already committed; alerting active super administrators is a
    // side effect that must not delay or fail the requester's response.
    void notifyActiveSuperAdminsOfPublicRequest({
      requestId: request.id,
      kind: parsed.data.kind,
    });

    const response = PublicRequestCreateResponse.parse({
      requestId: request.id,
      status: "received",
      message:
        parsed.data.kind === "account_deletion"
          ? "Your deletion request was recorded. Your account has not been deleted; identity verification is still required."
          : "Your support request was recorded for review.",
    });
    res.status(202).json(response);
  }),
);

// The review queue deliberately has a separate authenticated namespace from
// the public intake endpoint. Only super administrators can inspect requester
// data or advance the workflow.
router.get(
  "/public/requests/admin",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const parsed = PublicRequestAdminListQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid request queue filters" });
      return;
    }
    const { limit = 25, status, kind, search, cursor } = parsed.data;
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after) {
      res.status(400).json({ message: "Invalid request queue cursor" });
      return;
    }
    const clauses = [
      ...(status ? [eq(publicRequestsTable.status, status)] : []),
      ...(kind ? [eq(publicRequestsTable.kind, kind)] : []),
      ...(search
        ? [or(
          ilike(publicRequestsTable.requesterName, `%${search}%`),
          ilike(publicRequestsTable.mobile, `%${search}%`),
          ilike(publicRequestsTable.email, `%${search}%`),
          ilike(publicRequestsTable.subject, `%${search}%`),
        )]
        : []),
      ...(after
        ? [sql`(${publicRequestsTable.createdAt}, ${publicRequestsTable.id}) < (${after.createdAt}, ${after.id}::uuid)`]
        : []),
    ];
    const rows = await db
      .select()
      .from(publicRequestsTable)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(publicRequestsTable.createdAt), desc(publicRequestsTable.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const requests = rows.slice(0, limit);
    res.json({
      requests: requests.map(queueRequestView),
      nextCursor: hasMore ? encodeCursor(requests[requests.length - 1]) : null,
    });
  }),
);

router.get(
  "/public/requests/admin/:id",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isRequestId(id)) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    const detail = await requestDetail(id);
    if (!detail) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    res.json(detail);
  }),
);

router.patch(
  "/public/requests/admin/:id/status",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isRequestId(id)) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    const parsed = PublicRequestAdminStatusUpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid status update" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(publicRequestsTable)
        .where(eq(publicRequestsTable.id, id))
        .for("update")
        .limit(1);
      if (!current) return { ok: false as const, status: 404 };
      const nextStatus = parsed.data.status;
      if (
        !REQUEST_STATUSES.has(current.status) ||
        !VALID_TRANSITIONS[current.status]?.includes(nextStatus)
      ) {
        return { ok: false as const, status: 409 };
      }
      if (current.kind === "account_deletion" && nextStatus === "resolved") {
        const [verification] = await tx
          .select({ id: publicRequestIdentityVerificationsTable.id })
          .from(publicRequestIdentityVerificationsTable)
          .where(eq(publicRequestIdentityVerificationsTable.publicRequestId, current.id))
          .limit(1);
        if (!verification) return { ok: false as const, status: 409 };
      }
      const now = new Date();
      await tx
        .insert(publicRequestTransitionsTable)
        .values({
          publicRequestId: current.id,
          fromStatus: current.status,
          toStatus: nextStatus,
          note: parsed.data.note?.trim() || null,
          reviewerUserId: req.user!.id,
          createdAt: now,
        });
      const [updated] = await tx
        .update(publicRequestsTable)
        .set({
          status: nextStatus,
          reviewerUserId: req.user!.id,
          reviewedAt: now,
        })
        .where(eq(publicRequestsTable.id, current.id))
        .returning();
      return { ok: true as const, updated };
    });
    if (!result.ok) {
      res.status(result.status).json({
        message: result.status === 404 ? "Request not found" : "Illegal status transition",
      });
      return;
    }
    // Fetch history after the committed transition so the returned record
    // includes its immutable audit entry and reviewer attribution.
    const detail = await requestDetail(result.updated.id);
    if (!detail) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    res.json(detail);
  }),
);

router.post(
  "/public/requests/admin/:id/identity-verification",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!isRequestId(id)) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    const parsed = PublicRequestAdminIdentityVerificationCreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid identity verification" });
      return;
    }
    const method = parsed.data.method.trim();
    const note = parsed.data.note.trim();
    if (
      method.length < 2 ||
      method.length > 100 ||
      note.length < 2 ||
      note.length > 2000
    ) {
      res.status(400).json({ message: "Invalid identity verification" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(publicRequestsTable)
        .where(eq(publicRequestsTable.id, id))
        .for("update")
        .limit(1);
      if (!current) return { ok: false as const, status: 404 };
      if (current.kind !== "account_deletion" || current.status !== "in_review") {
        return { ok: false as const, status: 409 };
      }
      const [existing] = await tx
        .select({ id: publicRequestIdentityVerificationsTable.id })
        .from(publicRequestIdentityVerificationsTable)
        .where(eq(publicRequestIdentityVerificationsTable.publicRequestId, current.id))
        .limit(1);
      if (existing) return { ok: false as const, status: 409 };
      await tx.insert(publicRequestIdentityVerificationsTable).values({
        publicRequestId: current.id,
        reviewerUserId: req.user!.id,
        method,
        note,
      });
      return { ok: true as const };
    });
    if (!result.ok) {
      res.status(result.status).json({
        message: result.status === 404 ? "Request not found" : "Verification is not permitted",
      });
      return;
    }
    const detail = await requestDetail(id);
    if (!detail) {
      res.status(404).json({ message: "Request not found" });
      return;
    }
    res.json(detail);
  }),
);

export default router;