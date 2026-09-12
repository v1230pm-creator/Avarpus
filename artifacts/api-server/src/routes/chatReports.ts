import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import {
  chatMessagesTable,
  chatReportDecisionBatchesTable,
  chatReportDecisionBatchItemsTable,
  chatReportsTable,
  chatReportTranscriptViewsTable,
  chatRoomsTable,
  db,
  usersTable,
} from "@workspace/db";
import {
  ChatAdminReportListQueryParams,
  ChatAdminReportStatusBatchBody,
  ChatAdminReportStatusUpdateBody,
  ChatAdminReportTranscriptQueryParams,
} from "@workspace/api-zod";
import { asyncHandler } from "../lib/asyncHandler";
import { notifyUser } from "../lib/notify";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { uuidParam } from "../lib/validate";

// Abuse reports name both the reporter and the person they accuse, so they are
// readable only by platform operators — never by shop staff, never by the users
// involved. There is deliberately no shop-scoped variant of this queue.
const router: IRouter = Router();
router.param("id", uuidParam);
router.param("batchId", uuidParam);
const ADMIN = requireRole("super_admin");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A decision is recorded once. Reopening a settled report would erase the
// operator attribution that makes the queue an audit trail.
const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  open: ["reviewed", "actioned", "dismissed"],
  reviewed: ["actioned", "dismissed"],
  actioned: [],
  dismissed: [],
};

// A settled report closes the loop with the person who filed it. Both terminal
// decisions produce the same wording on purpose: the reporter learns that a
// human looked at their report, never the operator's note and never whether the
// other account was penalised. Nothing is ever sent to the reported user.
const SETTLED_STATUSES = new Set(["actioned", "dismissed"]);

// How long the operator who recorded a bulk decision has to withdraw it. A
// misclick is noticed within seconds; anything longer than a coffee break is a
// change of mind about a decision several reporters have already been told is
// finished, and moderation state stays one-way for those.
const BATCH_WITHDRAW_WINDOW_MS = 15 * 60 * 1000;

function withdrawableUntil(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + BATCH_WITHDRAW_WINDOW_MS);
}

function notifyReporterOfDecision(input: {
  reportId: string;
  reporterUserId: string;
}): void {
  // Fire-and-forget: the operator's decision is already committed, and a failed
  // notification must never undo it or fail their request.
  void notifyUser({
    userId: input.reporterUserId,
    shopId: null,
    type: "chat_report_reviewed",
    title: "Your report was reviewed",
    body:
      "We finished reviewing the conversation you reported and have closed "
      + "your report. We can't share what happens to another person's account.",
    // No navigation payload — there is nothing for the reporter to open, and
    // the report itself is operator-only data.
    data: { chatReportId: input.reportId },
    // One decision per report is possible, but a retry must not stack alerts.
    dedupeKey: `chat-report-reviewed:${input.reportId}`,
  });
}

const reporter = alias(usersTable, "chat_report_reporter");
const reported = alias(usersTable, "chat_report_reported");
const reviewer = alias(usersTable, "chat_report_reviewer");
const room = alias(chatRoomsTable, "chat_report_room");

const queueColumns = {
  id: chatReportsTable.id,
  reason: chatReportsTable.reason,
  details: chatReportsTable.details,
  status: chatReportsTable.status,
  createdAt: chatReportsTable.createdAt,
  messageId: chatReportsTable.messageId,
  reviewerUserId: chatReportsTable.reviewerUserId,
  reviewedAt: chatReportsTable.reviewedAt,
  reviewNote: chatReportsTable.reviewNote,
  reporterId: chatReportsTable.reporterUserId,
  reporterName: reporter.name,
  reporterMobile: reporter.mobile,
  reportedId: chatReportsTable.reportedUserId,
  reportedName: reported.name,
  reportedMobile: reported.mobile,
  reviewerName: reviewer.name,
  roomId: chatReportsTable.roomId,
  roomName: room.name,
  roomScope: room.scope,
};

type QueueRow = Awaited<ReturnType<typeof baseQuery>>[number];

function queueView(row: QueueRow, otherOpenReports: number) {
  return {
    id: row.id,
    reason: row.reason,
    details: row.details ?? null,
    status: row.status,
    createdAt: row.createdAt,
    reporter: {
      id: row.reporterId,
      name: row.reporterName ?? null,
      mobile: row.reporterMobile ?? null,
    },
    reportedUser: {
      id: row.reportedId,
      name: row.reportedName ?? null,
      mobile: row.reportedMobile ?? null,
    },
    room: {
      id: row.roomId,
      name: row.roomName ?? null,
      scope: row.roomScope ?? null,
    },
    messageId: row.messageId ?? null,
    reviewerUserId: row.reviewerUserId ?? null,
    reviewerName: row.reviewerName ?? null,
    reviewedAt: row.reviewedAt ?? null,
    reviewNote: row.reviewNote ?? null,
    // Other reports still open against the same accused account — the signal
    // that a single account is drawing complaints from several people.
    otherOpenReports,
  };
}

// A page names at most `limit` distinct accused accounts, so their open-report
// tallies come back in one grouped query rather than one query per row.
async function otherOpenReportsByUser(
  reportedUserIds: readonly string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(reportedUserIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      reportedUserId: chatReportsTable.reportedUserId,
      total: count(),
    })
    .from(chatReportsTable)
    .where(
      and(
        eq(chatReportsTable.status, "open"),
        inArray(chatReportsTable.reportedUserId, unique),
      ),
    )
    .groupBy(chatReportsTable.reportedUserId);
  return new Map(rows.map((row) => [row.reportedUserId, Number(row.total)]));
}

// The tally is "other open reports", so a report that is itself open must not
// count itself.
function otherOpenFor(
  row: { reportedId: string; status: string },
  totals: Map<string, number>,
): number {
  const total = totals.get(row.reportedId) ?? 0;
  return Math.max(0, total - (row.status === "open" ? 1 : 0));
}

function baseQuery() {
  return db
    .select(queueColumns)
    .from(chatReportsTable)
    .innerJoin(reporter, eq(reporter.id, chatReportsTable.reporterUserId))
    .innerJoin(reported, eq(reported.id, chatReportsTable.reportedUserId))
    .innerJoin(room, eq(room.id, chatReportsTable.roomId))
    .leftJoin(reviewer, eq(reviewer.id, chatReportsTable.reviewerUserId));
}

// A search term is matched literally: an operator pasting a name with an
// underscore, or a mobile with a percent sign in it, must not turn into a
// wildcard that widens the search silently.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt);
    if (
      typeof parsed.id !== "string" ||
      !UUID_RE.test(parsed.id) ||
      Number.isNaN(createdAt.getTime())
    ) {
      return null;
    }
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

router.get(
  "/chat/admin/reports",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const parsed = ChatAdminReportListQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid report queue filters" });
      return;
    }
    const { limit = 25, status, cursor } = parsed.data;
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after) {
      res.status(400).json({ message: "Invalid report queue cursor" });
      return;
    }

    // A term matches either party of the report: an operator chasing one
    // abusive account and an operator chasing one complainant both type into
    // the same box. A term is read as a name or as a mobile, never as both —
    // searching names for "9876" would answer a phone-number search with
    // whoever happens to have those digits in their name, and searching mobiles
    // for the digits inside "User 1" would answer a name search with everyone
    // whose number contains a 1.
    const search = parsed.data.search?.trim() ?? "";
    const searchesName = /\p{L}/u.test(search);
    // Country codes are the one part of a number people type inconsistently, so
    // compare on the trailing local digits: "+91 98765 43210" and "9876543210"
    // are the same person whichever side stored the prefix.
    const digits = search.replace(/\D+/g, "");
    const mobileDigits = digits.length > 10 ? digits.slice(-10) : digits;
    const asDigits = (column: AnyPgColumn) =>
      sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')`;
    const searchClause = !search
      ? undefined
      : searchesName
      ? or(
        ilike(reporter.name, likePattern(search)),
        ilike(reported.name, likePattern(search)),
      )
      : mobileDigits.length >= 3
      ? or(
        sql`${asDigits(reporter.mobile)} LIKE ${likePattern(mobileDigits)}`,
        sql`${asDigits(reported.mobile)} LIKE ${likePattern(mobileDigits)}`,
      )
      // Punctuation, or one or two digits: too little to name a person. An
      // empty page is the honest answer; falling back to a name search would
      // quietly answer a different question.
      : sql`false`;

    const clauses = [
      ...(status ? [eq(chatReportsTable.status, status)] : []),
      ...(searchClause ? [searchClause] : []),
      // Reports about one exact account, which is what the repeat-offender
      // count on a report is counting. A text search cannot stand in for it:
      // an accused account that has also filed a report would drag its own
      // complaint into a list that claims to be complaints against it.
      ...(parsed.data.reportedUserId
        ? [eq(chatReportsTable.reportedUserId, parsed.data.reportedUserId)]
        : []),
      // Keyset paging, so a filtered or searched queue pages on the same
      // newest-first ordering as the unfiltered one.
      ...(after
        ? [
          sql`(${chatReportsTable.createdAt}, ${chatReportsTable.id}) < (${after.createdAt}, ${after.id}::uuid)`,
        ]
        : []),
    ];

    const rows = await baseQuery()
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(chatReportsTable.createdAt), desc(chatReportsTable.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const reports = rows.slice(0, limit);
    const [totals, [open]] = await Promise.all([
      otherOpenReportsByUser(reports.map((row) => row.reportedId)),
      // The backlog badge counts the whole open queue, not the current filter
      // or search — it is what is left to work through, not what is on screen.
      db
        .select({ total: count() })
        .from(chatReportsTable)
        .where(eq(chatReportsTable.status, "open")),
    ]);

    res.json({
      reports: reports.map((row) => queueView(row, otherOpenFor(row, totals))),
      nextCursor: hasMore ? encodeCursor(reports[reports.length - 1]!) : null,
      openCount: Number(open?.total ?? 0),
    });
  }),
);

// How much conversation an operator sees in one read, and how it is split
// around the reported message. A window rather than the whole room: the point
// is to judge one report, not to browse two people's private history.
const TRANSCRIPT_DEFAULT_WINDOW = 40;

type TranscriptRow = typeof chatMessagesTable.$inferSelect;

function transcriptMessageView(
  row: TranscriptRow,
  input: { reportedMessageId: string | null; reportedUserId: string },
) {
  return {
    id: row.id,
    senderId: row.senderId,
    senderName: row.senderName,
    kind: row.kind,
    // A message the sender later deleted stays legible here: it is the very
    // content a report is usually about, and hiding it would let a deletion
    // defeat the review. `deletedAt` tells the operator it was retracted.
    body: row.body,
    // Attachments themselves stay out of reach — an operator reads the
    // conversation, they do not get a handle on its stored media.
    hasAttachment: row.objectPath !== null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    isReportedMessage: row.id === input.reportedMessageId,
    isFromReportedUser: row.senderId === input.reportedUserId,
  };
}

router.get(
  "/chat/admin/reports/:id/transcript",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const parsed = ChatAdminReportTranscriptQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid transcript window" });
      return;
    }
    const limit = parsed.data.limit ?? TRANSCRIPT_DEFAULT_WINDOW;

    const [report] = await db
      .select({
        id: chatReportsTable.id,
        roomId: chatReportsTable.roomId,
        messageId: chatReportsTable.messageId,
        reportedUserId: chatReportsTable.reportedUserId,
        roomName: room.name,
        roomScope: room.scope,
      })
      .from(chatReportsTable)
      .innerJoin(room, eq(room.id, chatReportsTable.roomId))
      .where(eq(chatReportsTable.id, id))
      .limit(1);
    if (!report) {
      res.status(404).json({ message: "Report not found" });
      return;
    }

    // Reading a transcript never touches membership, delivery receipts or read
    // state: the operator is an observer of the room, not a participant in it.
    const anchor = report.messageId
      ? (
        await db
          .select()
          .from(chatMessagesTable)
          .where(
            and(
              eq(chatMessagesTable.id, report.messageId),
              eq(chatMessagesTable.roomId, report.roomId),
            ),
          )
          .limit(1)
      )[0] ?? null
      : null;

    let messages: TranscriptRow[];
    let hasMoreBefore: boolean;
    let hasMoreAfter: boolean;

    if (anchor) {
      // Centre the window on the reported message so the operator sees both
      // what led up to it and how the conversation continued.
      const beforeLimit = Math.ceil((limit - 1) / 2);
      const afterLimit = limit - 1 - beforeLimit;
      // Compare against the stored row rather than a JavaScript Date: a
      // timestamp round-tripped through JS loses microseconds, and the reported
      // message would then fall on both sides of its own window.
      const anchorPosition = sql`(select ${chatMessagesTable.createdAt}, ${chatMessagesTable.id} from ${chatMessagesTable} where ${chatMessagesTable.id} = ${anchor.id}::uuid)`;
      const [before, after] = await Promise.all([
        beforeLimit > 0
          ? db
            .select()
            .from(chatMessagesTable)
            .where(
              and(
                eq(chatMessagesTable.roomId, report.roomId),
                sql`(${chatMessagesTable.createdAt}, ${chatMessagesTable.id}) < ${anchorPosition}`,
              ),
            )
            .orderBy(desc(chatMessagesTable.createdAt), desc(chatMessagesTable.id))
            .limit(beforeLimit + 1)
          : Promise.resolve([] as TranscriptRow[]),
        afterLimit > 0
          ? db
            .select()
            .from(chatMessagesTable)
            .where(
              and(
                eq(chatMessagesTable.roomId, report.roomId),
                sql`(${chatMessagesTable.createdAt}, ${chatMessagesTable.id}) > ${anchorPosition}`,
              ),
            )
            .orderBy(asc(chatMessagesTable.createdAt), asc(chatMessagesTable.id))
            .limit(afterLimit + 1)
          : Promise.resolve([] as TranscriptRow[]),
      ]);
      hasMoreBefore = before.length > beforeLimit;
      hasMoreAfter = after.length > afterLimit;
      messages = [
        ...before.slice(0, beforeLimit).reverse(),
        anchor,
        ...after.slice(0, afterLimit),
      ];
    } else {
      // The report named no message, or the message row is gone. Fall back to
      // the tail of the conversation, which is what the reporter saw last.
      const tail = await db
        .select()
        .from(chatMessagesTable)
        .where(eq(chatMessagesTable.roomId, report.roomId))
        .orderBy(desc(chatMessagesTable.createdAt), desc(chatMessagesTable.id))
        .limit(limit + 1);
      hasMoreBefore = tail.length > limit;
      hasMoreAfter = false;
      messages = tail.slice(0, limit).reverse();
    }

    // Record the access before the content leaves the server. If this insert
    // fails the request fails with it: an unlogged read of two private users'
    // messages is exactly what this endpoint must not allow.
    await db.insert(chatReportTranscriptViewsTable).values({
      reportId: report.id,
      roomId: report.roomId,
      operatorUserId: req.user!.id,
      operatorName: req.user!.name ?? "Unknown operator",
      anchorMessageId: anchor?.id ?? null,
      messageCount: messages.length,
    });

    res.json({
      reportId: report.id,
      room: {
        id: report.roomId,
        name: report.roomName ?? null,
        scope: report.roomScope ?? null,
      },
      reportedMessageId: report.messageId ?? null,
      reportedMessageFound: anchor !== null,
      messages: messages.map((row) =>
        transcriptMessageView(row, {
          reportedMessageId: report.messageId ?? null,
          reportedUserId: report.reportedUserId,
        }),
      ),
      hasMoreBefore,
      hasMoreAfter,
    });
  }),
);

router.patch(
  "/chat/admin/reports/:id/status",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const parsed = ChatAdminReportStatusUpdateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid review decision" });
      return;
    }
    const note = parsed.data.note?.trim();
    if (note !== undefined && (note.length < 1 || note.length > 2000)) {
      res.status(400).json({ message: "Invalid review decision" });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: chatReportsTable.id,
          status: chatReportsTable.status,
          reviewNote: chatReportsTable.reviewNote,
          reporterUserId: chatReportsTable.reporterUserId,
        })
        .from(chatReportsTable)
        .where(eq(chatReportsTable.id, id))
        .for("update")
        .limit(1);
      if (!current) return { ok: false as const, status: 404 };
      if (!VALID_TRANSITIONS[current.status]?.includes(parsed.data.status)) {
        return { ok: false as const, status: 409 };
      }
      await tx
        .update(chatReportsTable)
        .set({
          status: parsed.data.status,
          reviewerUserId: req.user!.id,
          reviewedAt: new Date(),
          // An omitted note keeps whatever an earlier decision recorded rather
          // than silently erasing it.
          reviewNote: note ?? current.reviewNote,
          // This row is now carrying a decision of its own. Whatever batch put
          // it where it was can no longer claim it, so withdrawing that batch
          // must not roll this decision back with it.
          decisionBatchId: null,
        })
        .where(eq(chatReportsTable.id, current.id));
      return { ok: true as const, reporterUserId: current.reporterUserId };
    });

    if (!outcome.ok) {
      res.status(outcome.status).json({
        message:
          outcome.status === 404
            ? "Report not found"
            : "This report has already been decided",
      });
      return;
    }

    if (SETTLED_STATUSES.has(parsed.data.status)) {
      notifyReporterOfDecision({
        reportId: id,
        reporterUserId: outcome.reporterUserId,
      });
    }

    const [updated] = await baseQuery()
      .where(eq(chatReportsTable.id, id))
      .limit(1);
    if (!updated) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const totals = await otherOpenReportsByUser([updated.reportedId]);
    res.json({ report: queueView(updated, otherOpenFor(updated, totals)) });
  }),
);

// One account drawing complaints from several people is still several reports:
// each one has its own reporter waiting on an answer, and each one has to keep
// its own row in the audit trail. This records the same decision across all of
// them in one go, rather than asking the operator to judge the same account
// five times.
router.post(
  "/chat/admin/reports/:id/status/batch",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const parsed = ChatAdminReportStatusBatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid review decision" });
      return;
    }
    const note = parsed.data.note?.trim();
    if (note !== undefined && (note.length < 1 || note.length > 2000)) {
      res.status(400).json({ message: "Invalid review decision" });
      return;
    }
    const status = parsed.data.status;

    const outcome = await db.transaction(async (tx) => {
      // Which account the batch is about. The reported user of a report never
      // changes, so reading it before taking any lock is safe.
      const [anchorMeta] = await tx
        .select({ reportedUserId: chatReportsTable.reportedUserId })
        .from(chatReportsTable)
        .where(eq(chatReportsTable.id, id))
        .limit(1);
      if (!anchorMeta) return { ok: false as const, status: 404 };

      // Every report about that account is claimed in one statement, ordered by
      // id: two operators batching different reports about the same account
      // then take the same locks in the same order instead of deadlocking on
      // each other. Rows filed after this statement are not in the result and
      // so are not touched by the batch.
      const locked = await tx
        .select({
          id: chatReportsTable.id,
          status: chatReportsTable.status,
          reporterUserId: chatReportsTable.reporterUserId,
          reviewerUserId: chatReportsTable.reviewerUserId,
          reviewedAt: chatReportsTable.reviewedAt,
          reviewNote: chatReportsTable.reviewNote,
        })
        .from(chatReportsTable)
        .where(eq(chatReportsTable.reportedUserId, anchorMeta.reportedUserId))
        .orderBy(asc(chatReportsTable.id))
        .for("update");

      const anchor = locked.find((row) => row.id === id);
      if (!anchor) return { ok: false as const, status: 404 };
      if (!VALID_TRANSITIONS[anchor.status]?.includes(status)) {
        return { ok: false as const, status: 409 };
      }

      // The batch reaches exactly what the operator was shown: this report, and
      // the other reports about this account that are still open. A sibling
      // another operator settled in the meantime keeps their decision — it is
      // skipped, not overwritten — and so does one already marked reviewed,
      // which the "other open reports" count never claimed.
      const targets = [
        anchor,
        ...locked.filter(
          (row) =>
            row.id !== anchor.id &&
            row.status === "open" &&
            (VALID_TRANSITIONS[row.status]?.includes(status) ?? false),
        ),
      ];

      // One decision happened at one moment, and every row it moved records
      // that moment as its own.
      const decidedAt = new Date();

      // The batch is a row of its own before any report moves: one click that
      // settles several people's complaints has to be recoverable, and it can
      // only be recovered from a record of what each report looked like first.
      const [batch] = await tx
        .insert(chatReportDecisionBatchesTable)
        .values({
          reportedUserId: anchorMeta.reportedUserId,
          anchorReportId: anchor.id,
          operatorUserId: req.user!.id,
          operatorName: req.user!.name ?? "Unknown operator",
          status,
          decidedAt,
        })
        .returning({ id: chatReportDecisionBatchesTable.id });
      if (!batch) throw new Error("failed to record the batch decision");

      await tx.insert(chatReportDecisionBatchItemsTable).values(
        targets.map((row) => ({
          batchId: batch.id,
          reportId: row.id,
          // Each report can be coming from somewhere different — its own
          // earlier reviewer, its own note — so the state to restore is
          // recorded per report, not once for the batch.
          previousStatus: row.status,
          previousReviewerUserId: row.reviewerUserId,
          previousReviewedAt: row.reviewedAt,
          previousReviewNote: row.reviewNote,
        })),
      );

      await tx
        .update(chatReportsTable)
        .set({
          status,
          reviewerUserId: req.user!.id,
          reviewedAt: decidedAt,
          // An omitted note leaves each row's earlier note in place rather than
          // erasing several operators' notes at once.
          ...(note === undefined ? {} : { reviewNote: note }),
          // Marks the row as still carrying this batch's decision, and detaches
          // it from any earlier batch that moved it.
          decisionBatchId: batch.id,
        })
        .where(inArray(chatReportsTable.id, targets.map((row) => row.id)));

      return {
        ok: true as const,
        batchId: batch.id,
        decidedAt,
        // Anchor first, then ascending id, so the reporter of the report the
        // operator acted from is keyed by that report.
        applied: targets.map((row) => ({
          id: row.id,
          reporterUserId: row.reporterUserId,
        })),
        skippedCount: locked.length - targets.length,
      };
    });

    if (!outcome.ok) {
      res.status(outcome.status).json({
        message:
          outcome.status === 404
            ? "Report not found"
            : "This report has already been decided",
      });
      return;
    }

    // One alert per person, not per report: somebody who filed three of these
    // complaints learns once that a human has finished with them, in the same
    // wording a single decision sends.
    const notifiedReporters = new Set<string>();
    if (SETTLED_STATUSES.has(status)) {
      for (const row of outcome.applied) {
        if (notifiedReporters.has(row.reporterUserId)) continue;
        notifiedReporters.add(row.reporterUserId);
        notifyReporterOfDecision({
          reportId: row.id,
          reporterUserId: row.reporterUserId,
        });
      }
    }

    const [updated] = await baseQuery()
      .where(eq(chatReportsTable.id, id))
      .limit(1);
    if (!updated) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const totals = await otherOpenReportsByUser([updated.reportedId]);
    res.json({
      report: queueView(updated, otherOpenFor(updated, totals)),
      appliedCount: outcome.applied.length,
      skippedCount: outcome.skippedCount,
      notifiedReporterCount: notifiedReporters.size,
      // The handle the operator withdraws this batch by, and how long they
      // have. Returned even for a batch of one: the caller cannot know in
      // advance how far the batch reached.
      batchId: outcome.batchId,
      withdrawableUntil: withdrawableUntil(outcome.decidedAt).toISOString(),
    });
  }),
);

// A bulk decision moves several people's complaints on one click, so the
// operator who recorded it gets a short window to put them back. This is not a
// reopen: it undoes one specific batch, only for the operator who recorded it,
// and only for the rows still carrying that batch's decision. Everything it
// restores is written down — nothing here erases the batch's own trail.
router.post(
  "/chat/admin/reports/batches/:batchId/withdraw",
  requireAuth,
  ADMIN,
  asyncHandler(async (req, res) => {
    const batchId = String(req.params.batchId ?? "");
    if (!UUID_RE.test(batchId)) {
      res.status(404).json({ message: "Batch decision not found" });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [batch] = await tx
        .select({
          id: chatReportDecisionBatchesTable.id,
          operatorUserId: chatReportDecisionBatchesTable.operatorUserId,
          decidedAt: chatReportDecisionBatchesTable.decidedAt,
          withdrawnAt: chatReportDecisionBatchesTable.withdrawnAt,
        })
        .from(chatReportDecisionBatchesTable)
        .where(eq(chatReportDecisionBatchesTable.id, batchId))
        // Claimed for this transaction, so a double-click cannot withdraw the
        // same batch twice and count the restored rows twice with it.
        .for("update")
        .limit(1);
      if (!batch) return { ok: false as const, status: 404 };
      // A withdrawal never resurrects somebody else's judgement: only the
      // operator whose name is on the batch may take it back.
      if (batch.operatorUserId !== req.user!.id) {
        return { ok: false as const, status: 403 };
      }
      if (batch.withdrawnAt) {
        return { ok: false as const, status: 409, reason: "withdrawn" as const };
      }
      if (Date.now() > withdrawableUntil(batch.decidedAt).getTime()) {
        return { ok: false as const, status: 409, reason: "expired" as const };
      }

      const items = await tx
        .select({
          id: chatReportDecisionBatchItemsTable.id,
          reportId: chatReportDecisionBatchItemsTable.reportId,
          previousStatus: chatReportDecisionBatchItemsTable.previousStatus,
          previousReviewerUserId:
            chatReportDecisionBatchItemsTable.previousReviewerUserId,
          previousReviewedAt:
            chatReportDecisionBatchItemsTable.previousReviewedAt,
          previousReviewNote:
            chatReportDecisionBatchItemsTable.previousReviewNote,
        })
        .from(chatReportDecisionBatchItemsTable)
        .where(eq(chatReportDecisionBatchItemsTable.batchId, batch.id))
        .orderBy(asc(chatReportDecisionBatchItemsTable.reportId));

      // Claimed in one statement in id order, the same order a batch decision
      // takes them in, so an undo and a decision about the same account queue
      // behind each other instead of deadlocking.
      const locked = items.length
        ? await tx
          .select({
            id: chatReportsTable.id,
            decisionBatchId: chatReportsTable.decisionBatchId,
          })
          .from(chatReportsTable)
          .where(inArray(chatReportsTable.id, items.map((item) => item.reportId)))
          .orderBy(asc(chatReportsTable.id))
          .for("update")
        : [];
      const stillOnThisBatch = new Set(
        locked
          .filter((row) => row.decisionBatchId === batch.id)
          .map((row) => row.id),
      );

      const withdrawnAt = new Date();
      const restoredReportIds: string[] = [];
      for (const item of items) {
        // A report another operator has decided since is theirs now, and the
        // row no longer points at this batch. Leave it exactly as it is.
        if (!stillOnThisBatch.has(item.reportId)) continue;
        await tx
          .update(chatReportsTable)
          .set({
            // Back to what this particular report was before the batch: its own
            // earlier state, reviewer and note, not the batch's.
            status: item.previousStatus,
            reviewerUserId: item.previousReviewerUserId,
            reviewedAt: item.previousReviewedAt,
            reviewNote: item.previousReviewNote,
            decisionBatchId: null,
          })
          .where(eq(chatReportsTable.id, item.reportId));
        await tx
          .update(chatReportDecisionBatchItemsTable)
          .set({ restoredAt: withdrawnAt })
          .where(eq(chatReportDecisionBatchItemsTable.id, item.id));
        restoredReportIds.push(item.reportId);
      }

      await tx
        .update(chatReportDecisionBatchesTable)
        .set({
          withdrawnAt,
          withdrawnByUserId: req.user!.id,
          withdrawnByName: req.user!.name ?? "Unknown operator",
          restoredReportCount: restoredReportIds.length,
        })
        .where(eq(chatReportDecisionBatchesTable.id, batch.id));

      return {
        ok: true as const,
        withdrawnAt,
        restoredReportIds,
        skippedCount: items.length - restoredReportIds.length,
      };
    });

    if (!outcome.ok) {
      res.status(outcome.status).json({
        message:
          outcome.status === 404
            ? "Batch decision not found"
            : outcome.status === 403
            ? "Only the operator who recorded this batch can withdraw it"
            : outcome.reason === "withdrawn"
            ? "This batch has already been withdrawn"
            : "The window to withdraw this batch has passed",
      });
      return;
    }

    // Nothing is sent to anybody. The reporters were told a human finished with
    // their report; that stays true of the review, and telling them a decision
    // was taken back would expose the operator queue's inner workings to the
    // very people it is kept from.
    res.json({
      batchId,
      withdrawnAt: outcome.withdrawnAt.toISOString(),
      restoredReportIds: outcome.restoredReportIds,
      restoredCount: outcome.restoredReportIds.length,
      skippedCount: outcome.skippedCount,
    });
  }),
);

export default router;
