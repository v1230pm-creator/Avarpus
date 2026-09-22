// API integration checks for the operator chat-report queue.
//
// An abuse report names both the person who complained and the person they
// accused. Two things must hold at once: platform operators can actually see
// and settle the queue, and nobody else — not the reporter, not the shop that
// the two users belong to, not an anonymous caller — can read or move a report.
// A decision, once recorded, must survive in the database with its author.
//
// Usage: node scripts/run-isolated.mjs scripts/test-chat-reports.mjs
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatFixtures } from "./lib/chat-fixtures.mjs";

// Built server entry. scripts/run-isolated.mjs builds into a private per-run
// directory and passes it here so a concurrent `pnpm run build` rewriting
// ./dist cannot pull the bundle out from under this run.
const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5661;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FIXTURE_MARKER = `chat-reports-${randomBytes(8).toString("hex")}`;
let failures = 0;

// Shared with the other chat scripts (scripts/lib/chat-fixtures.mjs): users,
// shops, sessions, direct rooms with a short history, reports, and the
// marker-based cleanup that removes all of it again.
const {
  marked,
  seedUser,
  seedShop,
  ownerSession,
  seedDirectRoom,
  seedReport,
  cleanupFixtures,
  verifyFixtureCleanup,
} = createChatFixtures({ pool, marker: FIXTURE_MARKER });

function check(label, condition, detail) {
  if (condition) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label} — ${JSON.stringify(detail)}`);
  }
}

async function api(method, pathname, token, body) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Review notifications are fire-and-forget, so they can land just after the
// operator's response. Poll briefly rather than racing the insert.
async function reviewNotificationsFor(userId, { expected = 1, tries = 20 } = {}) {
  let rows = [];
  for (let attempt = 0; attempt < tries; attempt++) {
    ({ rows } = await pool.query(
      `SELECT id, type, title, body, data, shop_id, dedupe_key, read_at
       FROM notifications
       WHERE user_id = $1 AND type = 'chat_report_reviewed'
       ORDER BY created_at`,
      [userId],
    ));
    if (rows.length >= expected) break;
    await sleep(100);
  }
  return rows;
}

async function transcriptViewRows(reportId) {
  const { rows } = await pool.query(
    `SELECT operator_user_id, operator_name, room_id, anchor_message_id, message_count, viewed_at
     FROM chat_report_transcript_views
     WHERE report_id = $1
     ORDER BY viewed_at`,
    [reportId],
  );
  return rows;
}

async function roomSideEffects(roomId, userId) {
  const { rows: [row] } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM chat_room_members WHERE room_id = $1 AND user_id = $2) AS memberships,
       (SELECT count(*)::int FROM chat_read_state WHERE room_id = $1 AND user_id = $2) AS read_state,
       (SELECT count(*)::int FROM chat_room_members WHERE room_id = $1 AND last_synced_at IS NOT NULL) AS synced`,
    [roomId, userId],
  );
  return row;
}

async function reportRow(id) {
  const { rows } = await pool.query(
    `SELECT status, reviewer_user_id, reviewed_at, review_note, decision_batch_id
     FROM chat_reports WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function decisionBatchRow(id) {
  const { rows } = await pool.query(
    `SELECT operator_user_id, operator_name, status, decided_at, withdrawn_at,
            withdrawn_by_user_id, withdrawn_by_name, restored_report_count
     FROM chat_report_decision_batches WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function decisionBatchItemRows(batchId) {
  const { rows } = await pool.query(
    `SELECT report_id, previous_status, previous_reviewer_user_id, previous_reviewed_at,
            previous_review_note, restored_at
     FROM chat_report_decision_batch_items WHERE batch_id = $1`,
    [batchId],
  );
  return rows;
}

// ── Checks ──────────────────────────────────────────────────────────────────

function bodyMentions(result, needles) {
  const serialized = JSON.stringify(result.json ?? {});
  return needles.some((needle) => serialized.includes(needle));
}

async function run() {
  const shop = await seedShop("s1");
  const [operator, owner, staff, reporter, reported, bystander] = await Promise.all([
    seedUser({ tag: "operator", role: "super_admin" }),
    ownerSession(shop.ownerId),
    seedUser({ tag: "staff", role: "technician", shopId: shop.shopId }),
    seedUser({ tag: "reporter", shopId: shop.shopId }),
    seedUser({ tag: "reported", shopId: shop.shopId }),
    seedUser({ tag: "bystander", shopId: shop.shopId }),
  ]);
  const room = await seedDirectRoom({ memberIds: [reporter.userId, reported.userId], tag: "r1" });

  const oldest = await seedReport({
    reporter,
    reported,
    room,
    reason: "spam",
    details: `oldest ${marked("details")}`,
    ageMinutes: 30,
  });
  const middle = await seedReport({
    reporter,
    reported,
    room,
    reason: "harassment",
    details: `middle ${marked("details")}`,
    ageMinutes: 20,
    messageId: room.messageId,
  });
  const newest = await seedReport({
    reporter,
    reported,
    room,
    reason: "scam",
    details: `newest ${marked("details")}`,
    ageMinutes: 10,
  });
  const fixtureIds = [newest.id, middle.id, oldest.id];

  console.log("== only platform operators can read the queue ==");
  const anonymous = await api("GET", "/chat/admin/reports", null);
  check("an unauthenticated caller cannot list reports", anonymous.status === 401, anonymous);

  for (const [label, caller] of [
    ["the reporter", reporter],
    ["the reported user", reported],
    ["an unrelated user", bystander],
    ["the shop owner", owner],
    ["shop staff", staff],
  ]) {
    const listed = await api("GET", "/chat/admin/reports", caller.token);
    check(`${label} cannot list reports`, listed.status === 403, listed);
    check(
      `${label}'s refused list leaked no report content`,
      !bodyMentions(listed, [oldest.id, middle.id, newest.id, reported.name, reporter.name]),
      listed,
    );
  }

  console.log("== an operator sees the queue newest first ==");
  const queue = await api("GET", "/chat/admin/reports?limit=100", operator.token);
  check("the operator can list reports", queue.status === 200, queue);
  const listedIds = (queue.json.reports ?? []).map((report) => report.id);
  const fixturePositions = fixtureIds.map((id) => listedIds.indexOf(id));
  check(
    "every seeded report appears in the queue",
    fixturePositions.every((position) => position >= 0),
    { fixtureIds, fixturePositions },
  );
  check(
    "seeded reports are ordered newest first",
    fixturePositions[0] < fixturePositions[1] && fixturePositions[1] < fixturePositions[2],
    fixturePositions,
  );
  const timestamps = (queue.json.reports ?? []).map((report) => Date.parse(report.createdAt));
  check(
    "the whole page is ordered by time, descending",
    timestamps.every((value, index) => index === 0 || timestamps[index - 1] >= value),
    timestamps.slice(0, 5),
  );

  const seeded = (queue.json.reports ?? []).find((report) => report.id === middle.id);
  check(
    "a queue entry carries reporter, reported peer, room, reason and time",
    !!seeded
      && seeded.reporter?.id === reporter.userId
      && seeded.reporter?.name === reporter.name
      && seeded.reporter?.mobile === reporter.mobile
      && seeded.reportedUser?.id === reported.userId
      && seeded.reportedUser?.name === reported.name
      && seeded.room?.id === room.roomId
      && seeded.room?.name === room.roomName
      && seeded.room?.scope === "global_direct"
      && seeded.messageId === room.messageId
      && seeded.reason === "harassment"
      && seeded.details === middle.details
      && seeded.status === "open"
      && !Number.isNaN(Date.parse(seeded.createdAt ?? "")),
    seeded,
  );
  check(
    "an unreviewed report has no reviewer attribution yet",
    !!seeded && seeded.reviewerUserId === null && seeded.reviewedAt === null,
    seeded,
  );

  console.log("== only an operator can read the reported conversation ==");
  const bodyNeedles = room.messages.map((message) => message.body);
  const anonymousTranscript = await api("GET", `/chat/admin/reports/${middle.id}/transcript`, null);
  check(
    "an unauthenticated caller cannot read a transcript",
    anonymousTranscript.status === 401,
    anonymousTranscript,
  );
  for (const [label, caller] of [
    ["the reporter", reporter],
    ["the reported user", reported],
    ["an unrelated user", bystander],
    ["the shop owner", owner],
    ["shop staff", staff],
  ]) {
    const attempt = await api(
      "GET",
      `/chat/admin/reports/${middle.id}/transcript`,
      caller.token,
    );
    check(`${label} cannot read the transcript`, attempt.status === 403, attempt);
    check(
      `${label}'s refused transcript leaked no message`,
      !bodyMentions(attempt, bodyNeedles),
      attempt,
    );
  }
  check(
    "a refused transcript was not recorded as a read",
    (await transcriptViewRows(middle.id)).length === 0,
    await transcriptViewRows(middle.id),
  );

  console.log("== an operator reads the conversation around the reported message ==");
  const transcript = await api(
    "GET",
    `/chat/admin/reports/${middle.id}/transcript`,
    operator.token,
  );
  const shown = transcript.json.messages ?? [];
  check("the operator can read the transcript", transcript.status === 200, transcript.status);
  check(
    "the transcript names the reported room and message",
    transcript.json.reportId === middle.id
      && transcript.json.room?.id === room.roomId
      && transcript.json.room?.name === room.roomName
      && transcript.json.reportedMessageId === room.messageId
      && transcript.json.reportedMessageFound === true,
    transcript.json,
  );
  check(
    "the whole conversation is shown, oldest first",
    shown.map((message) => message.id).join(",")
      === room.messages.map((message) => message.id).join(","),
    shown.map((message) => message.body),
  );
  const anchorShown = shown.find((message) => message.id === room.messageId);
  check(
    "the reported message is marked and attributed to the reported user",
    !!anchorShown
      && anchorShown.isReportedMessage === true
      && anchorShown.isFromReportedUser === true
      && anchorShown.senderId === reported.userId
      && anchorShown.body === room.messages[3].body,
    anchorShown,
  );
  check(
    "no other message is marked as the reported one",
    shown.filter((message) => message.isReportedMessage).length === 1,
    shown.map((message) => message.isReportedMessage),
  );
  check(
    "the reporter's own messages are not attributed to the reported user",
    shown
      .filter((message) => message.senderId === reporter.userId)
      .every((message) => message.isFromReportedUser === false),
    shown.map((message) => [message.senderId, message.isFromReportedUser]),
  );
  check(
    "a transcript exposes no stored media handle",
    !JSON.stringify(shown).includes("objectPath"),
    shown[0],
  );

  console.log("== a narrow window stays centred on the reported message ==");
  const windowed = await api(
    "GET",
    `/chat/admin/reports/${middle.id}/transcript?limit=3`,
    operator.token,
  );
  const windowIds = (windowed.json.messages ?? []).map((message) => message.id);
  check(
    "a limited window returns only that many messages",
    windowed.status === 200 && windowIds.length === 3,
    windowIds,
  );
  check(
    "the window surrounds the reported message",
    windowIds[0] === room.messages[2].id
      && windowIds[1] === room.messages[3].id
      && windowIds[2] === room.messages[4].id,
    windowIds,
  );
  check(
    "the operator is told the conversation continues past the window",
    windowed.json.hasMoreBefore === true && windowed.json.hasMoreAfter === true,
    windowed.json,
  );
  const badWindow = await api(
    "GET",
    `/chat/admin/reports/${middle.id}/transcript?limit=0`,
    operator.token,
  );
  check("a nonsensical window is refused", badWindow.status === 400, badWindow);

  console.log("== a report with no message falls back to the latest messages ==");
  const noAnchor = await api(
    "GET",
    `/chat/admin/reports/${oldest.id}/transcript?limit=2`,
    operator.token,
  );
  const tailIds = (noAnchor.json.messages ?? []).map((message) => message.id);
  check(
    "a report without a message still shows the conversation",
    noAnchor.status === 200
      && noAnchor.json.reportedMessageId === null
      && noAnchor.json.reportedMessageFound === false
      && tailIds.length === 2
      && tailIds[0] === room.messages[4].id
      && tailIds[1] === room.messages[5].id
      && noAnchor.json.hasMoreBefore === true
      && noAnchor.json.hasMoreAfter === false,
    noAnchor.json,
  );

  console.log("== reading a transcript is recorded and changes nothing in the room ==");
  const views = await transcriptViewRows(middle.id);
  check(
    "each operator read of this report left a record",
    views.length === 2,
    views,
  );
  check(
    "the record names the operator who read it",
    views.every((row) => row.operator_user_id === operator.userId
      && row.operator_name === operator.name
      && row.room_id === room.roomId),
    views,
  );
  const shownCounts = views.map((row) => row.message_count).sort((a, b) => a - b);
  check(
    "the record keeps the reported message and how much was shown",
    views.every((row) => row.anchor_message_id === room.messageId && !!row.viewed_at)
      && shownCounts[0] === 3
      && shownCounts[1] === room.messages.length,
    views,
  );
  const otherViews = await transcriptViewRows(oldest.id);
  check(
    "a fallback read is recorded against its own report with no message",
    otherViews.length === 1
      && otherViews[0].anchor_message_id === null
      && otherViews[0].message_count === 2,
    otherViews,
  );
  const sideEffects = await roomSideEffects(room.roomId, operator.userId);
  check(
    "reading a transcript never joined the operator to the room",
    sideEffects.memberships === 0,
    sideEffects,
  );
  check(
    "reading a transcript marked nothing as read or delivered",
    sideEffects.read_state === 0 && sideEffects.synced === 0,
    sideEffects,
  );

  console.log("== a transcript for an unknown report is not found ==");
  const unknownTranscript = await api(
    "GET",
    `/chat/admin/reports/${randomUUID()}/transcript`,
    operator.token,
  );
  check("an unknown report has no transcript", unknownTranscript.status === 404, unknownTranscript);
  const malformedTranscript = await api(
    "GET",
    "/chat/admin/reports/not-a-uuid/transcript",
    operator.token,
  );
  check(
    "a malformed report id has no transcript",
    malformedTranscript.status === 404,
    malformedTranscript,
  );

  console.log("== the queue pages without losing or repeating rows ==");
  const paged = [];
  let cursor;
  for (let page = 0; page < 40; page++) {
    const query = `/chat/admin/reports?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await api("GET", query, operator.token);
    if (response.status !== 200) {
      check("paging stays available", false, response);
      break;
    }
    check(
      `page ${page + 1} honours the limit`,
      (response.json.reports ?? []).length <= 1,
      response.json.reports,
    );
    paged.push(...(response.json.reports ?? []).map((report) => report.id));
    cursor = response.json.nextCursor ?? undefined;
    if (!cursor || fixtureIds.every((id) => paged.includes(id))) break;
  }
  check("paging reached every seeded report", fixtureIds.every((id) => paged.includes(id)), paged);
  check("paging repeated no row", new Set(paged).size === paged.length, paged);
  check(
    "paging preserves newest-first order",
    paged.indexOf(newest.id) < paged.indexOf(middle.id)
      && paged.indexOf(middle.id) < paged.indexOf(oldest.id),
    paged,
  );
  const badCursor = await api("GET", "/chat/admin/reports?cursor=not-a-cursor", operator.token);
  check("a malformed cursor is refused", badCursor.status === 400, badCursor);

  console.log("== nobody but an operator can move a report ==");
  for (const [label, caller, expected] of [
    ["an unauthenticated caller", { token: null }, 401],
    ["the reporter", reporter, 403],
    ["the reported user", reported, 403],
    ["the shop owner", owner, 403],
    ["shop staff", staff, 403],
  ]) {
    const attempt = await api(
      "PATCH",
      `/chat/admin/reports/${oldest.id}/status`,
      caller.token,
      { status: "dismissed", note: "should never apply" },
    );
    check(`${label} cannot decide a report`, attempt.status === expected, attempt);
    const row = await reportRow(oldest.id);
    check(
      `${label}'s refused decision changed nothing`,
      row.status === "open" && row.reviewer_user_id === null && row.reviewed_at === null,
      row,
    );
  }

  console.log("== an operator decision persists with its author ==");
  const reviewed = await api(
    "PATCH",
    `/chat/admin/reports/${oldest.id}/status`,
    operator.token,
    { status: "reviewed", note: `looked into it ${marked("note")}` },
  );
  check(
    "marking a report reviewed returns the updated record",
    reviewed.status === 200
      && reviewed.json.report?.status === "reviewed"
      && reviewed.json.report?.reviewerUserId === operator.userId
      && reviewed.json.report?.reviewerName === operator.name
      && !!reviewed.json.report?.reviewedAt,
    reviewed,
  );
  const reviewedRow = await reportRow(oldest.id);
  check(
    "the review state is stored, not just returned",
    reviewedRow.status === "reviewed"
      && reviewedRow.reviewer_user_id === operator.userId
      && !!reviewedRow.reviewed_at
      && reviewedRow.review_note === `looked into it ${marked("note")}`,
    reviewedRow,
  );
  const afterReview = await api(
    "GET",
    "/chat/admin/reports?status=reviewed&limit=100",
    operator.token,
  );
  check(
    "the reviewed report is retrievable by its new state",
    (afterReview.json.reports ?? []).some((report) => report.id === oldest.id),
    afterReview.status,
  );
  const stillOpen = await api("GET", "/chat/admin/reports?status=open&limit=100", operator.token);
  check(
    "the reviewed report left the open queue",
    !(stillOpen.json.reports ?? []).some((report) => report.id === oldest.id)
      && (stillOpen.json.reports ?? []).some((report) => report.id === middle.id),
    stillOpen.status,
  );

  console.log("== an interim review tells the reporter nothing yet ==");
  const beforeSettlement = await reviewNotificationsFor(reporter.userId, {
    expected: 1,
    tries: 5,
  });
  check(
    "marking a report reviewed does not notify the reporter",
    beforeSettlement.length === 0,
    beforeSettlement,
  );

  console.log("== a reviewed report can still be actioned or dismissed ==");
  const actioned = await api(
    "PATCH",
    `/chat/admin/reports/${oldest.id}/status`,
    operator.token,
    { status: "actioned" },
  );
  check(
    "a reviewed report can be actioned",
    actioned.status === 200 && actioned.json.report?.status === "actioned",
    actioned,
  );
  check(
    "omitting a note preserves the earlier one",
    actioned.json.report?.reviewNote === `looked into it ${marked("note")}`,
    actioned.json.report,
  );
  const dismissed = await api(
    "PATCH",
    `/chat/admin/reports/${newest.id}/status`,
    operator.token,
    { status: "dismissed", note: `no action needed ${marked("note")}` },
  );
  check(
    "an open report can be dismissed directly",
    dismissed.status === 200 && dismissed.json.report?.status === "dismissed",
    dismissed,
  );

  console.log("== settling a report closes the loop with its reporter ==");
  const reporterAlerts = await reviewNotificationsFor(reporter.userId, { expected: 2 });
  check(
    "each settled report produced exactly one alert for the reporter",
    reporterAlerts.length === 2,
    reporterAlerts,
  );
  const alertReportIds = reporterAlerts.map((row) => {
    const data = typeof row.data === "string" ? JSON.parse(row.data) : (row.data ?? {});
    return data.chatReportId ?? null;
  });
  check(
    "the alerts point at the two settled reports",
    alertReportIds.includes(oldest.id) && alertReportIds.includes(newest.id),
    alertReportIds,
  );
  check(
    "each alert carries a stable dedupe identity",
    reporterAlerts.every((row) => typeof row.dedupe_key === "string" && row.dedupe_key.includes("chat-report-reviewed")),
    reporterAlerts.map((row) => row.dedupe_key),
  );
  check(
    "the alerts arrive unread",
    reporterAlerts.every((row) => row.read_at === null),
    reporterAlerts.map((row) => row.read_at),
  );
  const leakNeedles = [
    FIXTURE_MARKER,
    "actioned",
    "dismissed",
    reported.name,
    reported.mobile,
    "penal",
    "banned",
    "suspend",
  ];
  for (const row of reporterAlerts) {
    const text = `${row.title} ${row.body}`;
    check(
      "the alert says a human reviewed the report in plain language",
      /review/i.test(text) && /report/i.test(text),
      text,
    );
    check(
      "the alert leaks no operator note, outcome or reported-account detail",
      !leakNeedles.some((needle) => text.toLowerCase().includes(String(needle).toLowerCase())),
      text,
    );
  }
  check(
    "an actioned report and a dismissed report read identically",
    reporterAlerts[0].title === reporterAlerts[1].title
      && reporterAlerts[0].body === reporterAlerts[1].body,
    reporterAlerts.map((row) => [row.title, row.body]),
  );
  const reportedAlerts = await reviewNotificationsFor(reported.userId, {
    expected: 1,
    tries: 5,
  });
  check("the reported user is never notified", reportedAlerts.length === 0, reportedAlerts);
  const bystanderAlerts = await reviewNotificationsFor(bystander.userId, {
    expected: 1,
    tries: 3,
  });
  check("nobody else is notified", bystanderAlerts.length === 0, bystanderAlerts);

  console.log("== a settled report cannot be quietly rewritten ==");
  for (const [label, id, next] of [
    ["an actioned report", oldest.id, "dismissed"],
    ["a dismissed report", newest.id, "actioned"],
  ]) {
    const before = await reportRow(id);
    const attempt = await api(
      "PATCH",
      `/chat/admin/reports/${id}/status`,
      operator.token,
      { status: next },
    );
    check(`${label} cannot be moved again`, attempt.status === 409, attempt);
    const after = await reportRow(id);
    check(
      `${label} kept its recorded decision`,
      after.status === before.status && after.review_note === before.review_note,
      { before, after },
    );
  }

  console.log("== malformed decisions are refused ==");
  const cases = [
    ["reopening a report", { status: "open" }, 400],
    ["an unknown state", { status: "escalated" }, 400],
    ["a missing state", {}, 400],
    ["an overlong note", { status: "reviewed", note: "x".repeat(2001) }, 400],
  ];
  for (const [label, body, expected] of cases) {
    const attempt = await api(
      "PATCH",
      `/chat/admin/reports/${middle.id}/status`,
      operator.token,
      body,
    );
    check(`${label} is rejected`, attempt.status === expected, attempt);
    const row = await reportRow(middle.id);
    check(`${label} left the report untouched`, row.status === "open", row);
  }
  const unknown = await api(
    "PATCH",
    `/chat/admin/reports/${randomUUID()}/status`,
    operator.token,
    { status: "reviewed" },
  );
  check("an unknown report id is not found", unknown.status === 404, unknown);
  const malformedId = await api(
    "PATCH",
    "/chat/admin/reports/not-a-uuid/status",
    operator.token,
    { status: "reviewed" },
  );
  check("a malformed report id is not found", malformedId.status === 404, malformedId);

  await reporterOwnReportChecks({
    reporter,
    reported,
    bystander,
    staff,
    owner,
    operator,
    room,
    reports: { oldest, middle, newest },
  });

  await volumeChecks({ operator, priorOpenReport: middle });

  await batchDecisionChecks({ operator });

  await concurrentBatchDecisionChecks({ operator });

  await batchWithdrawalChecks({ operator });
}

// Five complaints about one account are one judgement, not five. A batch has to
// record that judgement on every open report about the account while leaving
// each report a row of its own, and it must not tread on a report somebody else
// already decided, on a report about a different account, or on one filed after
// the batch ran.
async function batchDecisionChecks({ operator }) {
  const secondOperator = await seedUser({ tag: "operator-2", role: "super_admin" });
  const [accused, otherAccused] = await Promise.all([
    seedUser({ tag: "batch-accused" }),
    seedUser({ tag: "batch-other-accused" }),
  ]);
  const [complainantA, complainantB, complainantC, complainantD] = await Promise.all([
    seedUser({ tag: "batch-a" }),
    seedUser({ tag: "batch-b" }),
    seedUser({ tag: "batch-c" }),
    seedUser({ tag: "batch-d" }),
  ]);
  const [roomA, roomB, roomC, roomD, roomUnrelated] = await Promise.all([
    seedDirectRoom({ memberIds: [complainantA.userId, accused.userId], tag: "ba" }),
    seedDirectRoom({ memberIds: [complainantB.userId, accused.userId], tag: "bb" }),
    seedDirectRoom({ memberIds: [complainantC.userId, accused.userId], tag: "bc" }),
    seedDirectRoom({ memberIds: [complainantD.userId, accused.userId], tag: "bd" }),
    seedDirectRoom({ memberIds: [complainantA.userId, otherAccused.userId], tag: "bu" }),
  ]);

  // One account, five complaints: two from the same person, one from another,
  // one another operator has already dismissed, one another operator has read
  // but not settled.
  const anchor = await seedReport({
    reporter: complainantA,
    reported: accused,
    room: roomA,
    reason: "harassment",
    details: `batch anchor ${marked("details")}`,
    ageMinutes: 6,
  });
  const alsoFromA = await seedReport({
    reporter: complainantA,
    reported: accused,
    room: roomA,
    reason: "spam",
    details: `batch second-from-a ${marked("details")}`,
    ageMinutes: 5,
  });
  const fromB = await seedReport({
    reporter: complainantB,
    reported: accused,
    room: roomB,
    reason: "scam",
    details: `batch from-b ${marked("details")}`,
    ageMinutes: 4,
  });
  const settledByOther = await seedReport({
    reporter: complainantC,
    reported: accused,
    room: roomC,
    reason: "spam",
    details: `batch settled ${marked("details")}`,
    ageMinutes: 3,
  });
  const reviewedByOther = await seedReport({
    reporter: complainantD,
    reported: accused,
    room: roomD,
    reason: "other",
    details: `batch reviewed ${marked("details")}`,
    ageMinutes: 2,
  });
  // A complaint about somebody else entirely. Nothing here may reach it.
  const unrelated = await seedReport({
    reporter: complainantA,
    reported: otherAccused,
    room: roomUnrelated,
    reason: "spam",
    details: `batch unrelated ${marked("details")}`,
    ageMinutes: 1,
  });

  const otherDismissal = await api(
    "PATCH",
    `/chat/admin/reports/${settledByOther.id}/status`,
    secondOperator.token,
    { status: "dismissed", note: `another operator's call ${marked("note")}` },
  );
  const otherReview = await api(
    "PATCH",
    `/chat/admin/reports/${reviewedByOther.id}/status`,
    secondOperator.token,
    { status: "reviewed", note: `still deciding ${marked("note")}` },
  );
  check(
    "the fixture's prior decisions were recorded by the other operator",
    otherDismissal.status === 200 && otherReview.status === 200,
    { otherDismissal: otherDismissal.status, otherReview: otherReview.status },
  );

  console.log("== nobody but an operator can batch a decision ==");
  for (const [label, caller, expected] of [
    ["an unauthenticated caller", { token: null }, 401],
    ["the reporter", complainantA, 403],
    ["the reported user", accused, 403],
  ]) {
    const attempt = await api(
      "POST",
      `/chat/admin/reports/${anchor.id}/status/batch`,
      caller.token,
      { status: "dismissed", note: "should never apply" },
    );
    check(`${label} cannot batch a decision`, attempt.status === expected, attempt);
    const row = await reportRow(anchor.id);
    check(
      `${label}'s refused batch changed nothing`,
      row.status === "open" && row.reviewer_user_id === null,
      row,
    );
  }

  console.log("== a malformed batch is refused ==");
  for (const [label, body, expected] of [
    ["reopening reports", { status: "open" }, 400],
    ["a missing state", {}, 400],
    ["an overlong note", { status: "dismissed", note: "x".repeat(2001) }, 400],
  ]) {
    const attempt = await api(
      "POST",
      `/chat/admin/reports/${anchor.id}/status/batch`,
      operator.token,
      body,
    );
    check(`${label} is rejected`, attempt.status === expected, attempt);
    const row = await reportRow(anchor.id);
    check(`${label} left every report untouched`, row.status === "open", row);
  }
  const unknownBatch = await api(
    "POST",
    `/chat/admin/reports/${randomUUID()}/status/batch`,
    operator.token,
    { status: "dismissed" },
  );
  check("an unknown report id is not found", unknownBatch.status === 404, unknownBatch);
  const malformedBatchId = await api(
    "POST",
    "/chat/admin/reports/not-a-uuid/status/batch",
    operator.token,
    { status: "dismissed" },
  );
  check("a malformed report id is not found", malformedBatchId.status === 404, malformedBatchId);

  console.log("== one decision settles every open report about the account ==");
  const batchNote = `same abuser, one call ${marked("note")}`;
  const batched = await api(
    "POST",
    `/chat/admin/reports/${anchor.id}/status/batch`,
    operator.token,
    { status: "actioned", note: batchNote },
  );
  check(
    "the batch reports how far it reached",
    batched.status === 200
      && batched.json.appliedCount === 3
      && batched.json.skippedCount === 2
      && batched.json.notifiedReporterCount === 2,
    batched,
  );
  check(
    "the batch returns the report it was recorded from",
    batched.json.report?.id === anchor.id
      && batched.json.report?.status === "actioned"
      && batched.json.report?.reviewerUserId === operator.userId
      && batched.json.report?.otherOpenReports === 0,
    batched.json.report,
  );

  const appliedRows = await Promise.all(
    [anchor.id, alsoFromA.id, fromB.id].map(async (id) => ({ id, row: await reportRow(id) })),
  );
  for (const { id, row } of appliedRows) {
    check(
      "each open report about the account keeps its own decision row",
      row.status === "actioned"
        && row.reviewer_user_id === operator.userId
        && !!row.reviewed_at
        && row.review_note === batchNote,
      { id, row },
    );
  }

  const skippedSettled = await reportRow(settledByOther.id);
  check(
    "a report another operator already settled keeps their decision",
    skippedSettled.status === "dismissed"
      && skippedSettled.reviewer_user_id === secondOperator.userId
      && skippedSettled.review_note === `another operator's call ${marked("note")}`,
    skippedSettled,
  );
  const skippedReviewed = await reportRow(reviewedByOther.id);
  check(
    "a report that had left the open queue is skipped, not settled",
    skippedReviewed.status === "reviewed"
      && skippedReviewed.reviewer_user_id === secondOperator.userId
      && skippedReviewed.review_note === `still deciding ${marked("note")}`,
    skippedReviewed,
  );
  const untouched = await reportRow(unrelated.id);
  check(
    "a report about a different account is untouched",
    untouched.status === "open" && untouched.reviewer_user_id === null,
    untouched,
  );

  console.log("== a batch tells each reporter once, in the usual words ==");
  const alertsA = await reviewNotificationsFor(complainantA.userId, { expected: 2, tries: 8 });
  check(
    "somebody who filed two of the batched reports is told once",
    alertsA.length === 1,
    alertsA.map((row) => row.dedupe_key),
  );
  check(
    "their alert is keyed to the report the operator acted from",
    alertsA[0]?.data?.chatReportId === anchor.id,
    alertsA[0]?.data,
  );
  const alertsB = await reviewNotificationsFor(complainantB.userId, { expected: 2, tries: 8 });
  check("the other reporter is told once", alertsB.length === 1, alertsB.length);
  const alertsC = await reviewNotificationsFor(complainantC.userId, { expected: 2, tries: 5 });
  check(
    "the reporter of the skipped settled report is not told again",
    alertsC.length === 1,
    alertsC.length,
  );
  const alertsD = await reviewNotificationsFor(complainantD.userId, { expected: 1, tries: 5 });
  check("the reporter of the skipped reviewed report is not told", alertsD.length === 0, alertsD);
  const accusedAlerts = await reviewNotificationsFor(accused.userId, { expected: 1, tries: 3 });
  check("the reported account is never told", accusedAlerts.length === 0, accusedAlerts);
  check(
    "a batched alert reads exactly like a single decision's alert",
    alertsA[0]?.title === alertsC[0]?.title && alertsA[0]?.body === alertsC[0]?.body,
    [alertsA[0]?.body, alertsC[0]?.body],
  );
  for (const row of [...alertsA, ...alertsB]) {
    const text = `${row.title} ${row.body}`;
    check(
      "a batched alert leaks no note, outcome or reported-account detail",
      /review/i.test(text)
        && ![FIXTURE_MARKER, "actioned", "dismissed", accused.name, accused.mobile]
          .some((needle) => text.toLowerCase().includes(String(needle).toLowerCase())),
      text,
    );
  }

  console.log("== a batch cannot be replayed, and does not reach later reports ==");
  const replay = await api(
    "POST",
    `/chat/admin/reports/${anchor.id}/status/batch`,
    operator.token,
    { status: "dismissed", note: "should never apply" },
  );
  check("a settled report cannot batch again", replay.status === 409, replay);
  const afterReplay = await reportRow(anchor.id);
  check(
    "the refused replay left the recorded decision alone",
    afterReplay.status === "actioned" && afterReplay.review_note === batchNote,
    afterReplay,
  );

  // Filed after the batch ran: a decision recorded before this complaint
  // existed cannot have judged it.
  const late = await seedReport({
    reporter: complainantB,
    reported: accused,
    room: roomB,
    reason: "harassment",
    details: `batch late ${marked("details")}`,
    ageMinutes: 0,
  });
  const lateRow = await reportRow(late.id);
  check(
    "a report filed after the batch is still open",
    lateRow.status === "open" && lateRow.reviewer_user_id === null,
    lateRow,
  );

  const lateBatch = await api(
    "POST",
    `/chat/admin/reports/${late.id}/status/batch`,
    operator.token,
    { status: "dismissed" },
  );
  check(
    "batching the late report alone moves only itself",
    lateBatch.status === 200
      && lateBatch.json.appliedCount === 1
      && lateBatch.json.skippedCount === 5
      && lateBatch.json.notifiedReporterCount === 1,
    lateBatch.json,
  );
  const lateSettled = await reportRow(late.id);
  check(
    "the late report keeps a note of its own when the batch carried none",
    lateSettled.status === "dismissed"
      && lateSettled.reviewer_user_id === operator.userId
      && lateSettled.review_note === null,
    lateSettled,
  );
  const alertsBAfterLate = await reviewNotificationsFor(complainantB.userId, {
    expected: 2,
    tries: 20,
  });
  check(
    "settling the later report is its own alert to that reporter",
    alertsBAfterLate.length === 2,
    alertsBAfterLate.map((row) => row.dedupe_key),
  );
}

// Two operators can be looking at the same abusive account in the same minute.
// The batch endpoint claims every report about that account in one id-ordered
// FOR UPDATE precisely so their decisions queue behind one another instead of
// deadlocking or each writing half of the account's reports. Only firing them
// at the same instant proves that: a lock taken row by row, or in a different
// order, passes every sequential check and fails in production as a 500.
async function concurrentBatchDecisionChecks({ operator }) {
  const secondOperator = await seedUser({ tag: "race-operator-2", role: "super_admin" });

  console.log("== two operators batch the same account at the same moment ==");
  const raceAccused = await seedUser({ tag: "race-accused" });
  const [raceA, raceB, raceC] = await Promise.all([
    seedUser({ tag: "race-a" }),
    seedUser({ tag: "race-b" }),
    seedUser({ tag: "race-c" }),
  ]);
  const [raceRoomA, raceRoomB, raceRoomC] = await Promise.all([
    seedDirectRoom({ memberIds: [raceA.userId, raceAccused.userId], tag: "ra" }),
    seedDirectRoom({ memberIds: [raceB.userId, raceAccused.userId], tag: "rb" }),
    seedDirectRoom({ memberIds: [raceC.userId, raceAccused.userId], tag: "rc" }),
  ]);
  // Three open complaints about one account. Two operators pick a different one
  // of them to act from, which is exactly how this happens for real: neither
  // knows the other is holding the same queue open.
  const raceAnchorOne = await seedReport({
    reporter: raceA,
    reported: raceAccused,
    room: raceRoomA,
    reason: "harassment",
    details: `race anchor one ${marked("details")}`,
    ageMinutes: 3,
  });
  const raceAnchorTwo = await seedReport({
    reporter: raceB,
    reported: raceAccused,
    room: raceRoomB,
    reason: "scam",
    details: `race anchor two ${marked("details")}`,
    ageMinutes: 2,
  });
  const raceSibling = await seedReport({
    reporter: raceC,
    reported: raceAccused,
    room: raceRoomC,
    reason: "spam",
    details: `race sibling ${marked("details")}`,
    ageMinutes: 1,
  });

  const raceNoteOne = `first operator's call ${marked("note")}`;
  const raceNoteTwo = `second operator's call ${marked("note")}`;
  const [batchOne, batchTwo] = await Promise.all([
    api(
      "POST",
      `/chat/admin/reports/${raceAnchorOne.id}/status/batch`,
      operator.token,
      { status: "actioned", note: raceNoteOne },
    ),
    api(
      "POST",
      `/chat/admin/reports/${raceAnchorTwo.id}/status/batch`,
      secondOperator.token,
      { status: "dismissed", note: raceNoteTwo },
    ),
  ]);
  for (const [label, result] of [["first", batchOne], ["second", batchTwo]]) {
    // A deadlock, or a serialisation failure from locking the rows in another
    // order, reaches the operator as the generic 500 of the error handler.
    check(
      `the ${label} concurrent batch finished without a deadlock`,
      result.status !== 500,
      result,
    );
  }
  const raceStatuses = [batchOne.status, batchTwo.status].sort();
  check(
    "one concurrent batch records the decision and the other is told it is already decided",
    raceStatuses[0] === 200 && raceStatuses[1] === 409,
    { first: batchOne.status, second: batchTwo.status },
  );

  const raceWinner = batchOne.status === 200
    ? { json: batchOne.json, operatorUserId: operator.userId, status: "actioned", note: raceNoteOne }
    : {
      json: batchTwo.json,
      operatorUserId: secondOperator.userId,
      status: "dismissed",
      note: raceNoteTwo,
    };
  check(
    "the batch that got there first still reached every open report about the account",
    raceWinner.json.appliedCount === 3 && raceWinner.json.skippedCount === 0,
    raceWinner.json,
  );

  const raceRows = await Promise.all(
    [raceAnchorOne.id, raceAnchorTwo.id, raceSibling.id].map(async (id) => ({
      id,
      row: await reportRow(id),
    })),
  );
  for (const { id, row } of raceRows) {
    check(
      "every report about the account ends with exactly one operator's decision on it",
      row.status === raceWinner.status
        && row.reviewer_user_id === raceWinner.operatorUserId
        && row.review_note === raceWinner.note
        && !!row.reviewed_at
        && row.decision_batch_id === raceWinner.json.batchId,
      { id, row },
    );
  }
  const { rows: raceBatchRows } = await pool.query(
    `SELECT id, operator_user_id, status FROM chat_report_decision_batches
     WHERE reported_user_id = $1`,
    [raceAccused.userId],
  );
  check(
    "the batch that lost the race left no half-written decision behind",
    raceBatchRows.length === 1 && raceBatchRows[0].id === raceWinner.json.batchId,
    raceBatchRows,
  );
  const raceItems = await decisionBatchItemRows(raceWinner.json.batchId);
  check(
    "the surviving batch holds one restore point per report, all from open",
    raceItems.length === 3 && raceItems.every((row) => row.previous_status === "open"),
    raceItems,
  );
  const raceAlerts = await Promise.all(
    [raceA, raceB, raceC].map((reporterUser) =>
      reviewNotificationsFor(reporterUser.userId, { expected: 2, tries: 8 }),
    ),
  );
  check(
    "each reporter hears once, not once per racing operator",
    raceAlerts.every((rows) => rows.length === 1),
    raceAlerts.map((rows) => rows.length),
  );

  console.log("== a single decision racing a batch about the same account ==");
  const soloAccused = await seedUser({ tag: "race-solo-accused" });
  const [soloA, soloB] = await Promise.all([
    seedUser({ tag: "race-solo-a" }),
    seedUser({ tag: "race-solo-b" }),
  ]);
  const [soloRoomA, soloRoomB] = await Promise.all([
    seedDirectRoom({ memberIds: [soloA.userId, soloAccused.userId], tag: "rsa" }),
    seedDirectRoom({ memberIds: [soloB.userId, soloAccused.userId], tag: "rsb" }),
  ]);
  const soloAnchor = await seedReport({
    reporter: soloA,
    reported: soloAccused,
    room: soloRoomA,
    reason: "harassment",
    details: `race solo anchor ${marked("details")}`,
    ageMinutes: 2,
  });
  const soloContested = await seedReport({
    reporter: soloB,
    reported: soloAccused,
    room: soloRoomB,
    reason: "spam",
    details: `race solo contested ${marked("details")}`,
    ageMinutes: 1,
  });

  // One operator judges a single report while another batches the whole
  // account: the batch holds locks on both rows, the single decision holds one
  // of them, and the contested report must end up with one decision, not two
  // halves of two.
  const soloBatchNote = `batching the account ${marked("note")}`;
  const soloSingleNote = `judging this one alone ${marked("note")}`;
  const [soloBatch, soloSingle] = await Promise.all([
    api(
      "POST",
      `/chat/admin/reports/${soloAnchor.id}/status/batch`,
      operator.token,
      { status: "actioned", note: soloBatchNote },
    ),
    api(
      "PATCH",
      `/chat/admin/reports/${soloContested.id}/status`,
      secondOperator.token,
      { status: "dismissed", note: soloSingleNote },
    ),
  ]);
  for (const [label, result] of [["batch", soloBatch], ["single decision", soloSingle]]) {
    check(
      `the concurrent ${label} finished without a deadlock`,
      result.status !== 500,
      result,
    );
  }
  // Nothing touches the report the batch was recorded from, so the batch
  // itself always lands whichever request wins the contested row.
  check(
    "the batch lands whichever request reached the contested report first",
    soloBatch.status === 200,
    soloBatch.json,
  );
  const soloSingleWon = soloSingle.status === 200;
  check(
    "the single decision either lands or is told the report is already decided",
    soloSingleWon || soloSingle.status === 409,
    soloSingle,
  );
  const soloContestedRow = await reportRow(soloContested.id);
  check(
    "the contested report carries exactly one operator's decision",
    soloSingleWon
      ? soloContestedRow.status === "dismissed"
        && soloContestedRow.reviewer_user_id === secondOperator.userId
        && soloContestedRow.review_note === soloSingleNote
        && soloContestedRow.decision_batch_id === null
      : soloContestedRow.status === "actioned"
        && soloContestedRow.reviewer_user_id === operator.userId
        && soloContestedRow.review_note === soloBatchNote
        && soloContestedRow.decision_batch_id === soloBatch.json.batchId,
    { soloSingleWon, soloContestedRow },
  );
  check(
    "the batch counts the contested report as applied or as skipped, never both",
    soloBatch.json.appliedCount === (soloSingleWon ? 1 : 2)
      && soloBatch.json.skippedCount === (soloSingleWon ? 1 : 0),
    { soloSingleWon, applied: soloBatch.json.appliedCount, skipped: soloBatch.json.skippedCount },
  );
  const soloItems = await decisionBatchItemRows(soloBatch.json.batchId);
  check(
    "the batch's restore points name exactly the reports it moved",
    soloItems.length === (soloSingleWon ? 1 : 2)
      && soloItems.some((row) => row.report_id === soloAnchor.id)
      && soloItems.some((row) => row.report_id === soloContested.id) === !soloSingleWon,
    { soloSingleWon, soloItems },
  );
  const soloAnchorRow = await reportRow(soloAnchor.id);
  check(
    "the report the batch was recorded from is settled by that batch",
    soloAnchorRow.status === "actioned"
      && soloAnchorRow.reviewer_user_id === operator.userId
      && soloAnchorRow.review_note === soloBatchNote
      && soloAnchorRow.decision_batch_id === soloBatch.json.batchId,
    soloAnchorRow,
  );
  const soloAlerts = await Promise.all(
    [soloA, soloB].map((reporterUser) =>
      reviewNotificationsFor(reporterUser.userId, { expected: 2, tries: 8 }),
    ),
  );
  check(
    "both reporters of the raced pair hear once",
    soloAlerts.every((rows) => rows.length === 1),
    soloAlerts.map((rows) => rows.length),
  );
}

// One click settles several people's complaints, so a misclick has to be
// recoverable — but only by the operator who made it, only for a short while,
// and never at the cost of somebody else's judgement or of the audit trail.
async function batchWithdrawalChecks({ operator }) {
  const secondOperator = await seedUser({ tag: "withdraw-operator-2", role: "super_admin" });

  console.log("== a settled batch can be taken back, and the alerts stand ==");
  const settledAccused = await seedUser({ tag: "withdraw-accused" });
  const [wa, wb] = await Promise.all([
    seedUser({ tag: "withdraw-a" }),
    seedUser({ tag: "withdraw-b" }),
  ]);
  const [roomWa, roomWb] = await Promise.all([
    seedDirectRoom({ memberIds: [wa.userId, settledAccused.userId], tag: "wa" }),
    seedDirectRoom({ memberIds: [wb.userId, settledAccused.userId], tag: "wb" }),
  ]);
  const settledAnchor = await seedReport({
    reporter: wa,
    reported: settledAccused,
    room: roomWa,
    reason: "harassment",
    details: `withdraw anchor ${marked("details")}`,
    ageMinutes: 4,
  });
  const settledSibling = await seedReport({
    reporter: wb,
    reported: settledAccused,
    room: roomWb,
    reason: "spam",
    details: `withdraw sibling ${marked("details")}`,
    ageMinutes: 3,
  });

  const settledBatchNote = `wrong account, sorry ${marked("note")}`;
  const settledBatch = await api(
    "POST",
    `/chat/admin/reports/${settledAnchor.id}/status/batch`,
    operator.token,
    { status: "dismissed", note: settledBatchNote },
  );
  const settledBatchId = settledBatch.json.batchId;
  check(
    "a batch hands back the handle it can be withdrawn by, and a deadline",
    settledBatch.status === 200
      && settledBatch.json.appliedCount === 2
      && typeof settledBatchId === "string"
      && Date.parse(settledBatch.json.withdrawableUntil) > Date.now(),
    settledBatch.json,
  );
  const batchRowBefore = await decisionBatchRow(settledBatchId);
  check(
    "the batch is written down with the operator who recorded it",
    batchRowBefore
      && batchRowBefore.operator_user_id === operator.userId
      && batchRowBefore.status === "dismissed"
      && batchRowBefore.withdrawn_at === null,
    batchRowBefore,
  );
  const itemsBefore = await decisionBatchItemRows(settledBatchId);
  check(
    "what each report looked like beforehand is recorded per report",
    itemsBefore.length === 2
      && itemsBefore.every(
        (row) =>
          row.previous_status === "open"
          && row.previous_reviewer_user_id === null
          && row.previous_review_note === null
          && row.restored_at === null,
      ),
    itemsBefore,
  );
  // The reporters were told a human finished with them. That is what must not
  // change when the operator takes the decision back.
  const alertsBefore = await Promise.all([
    reviewNotificationsFor(wa.userId, { expected: 1, tries: 20 }),
    reviewNotificationsFor(wb.userId, { expected: 1, tries: 20 }),
  ]);
  check(
    "both reporters were alerted by the batch",
    alertsBefore.every((rows) => rows.length === 1),
    alertsBefore.map((rows) => rows.length),
  );

  console.log("== only the operator who recorded a batch may withdraw it ==");
  for (const [label, caller, expected] of [
    ["an unauthenticated caller", { token: null }, 401],
    ["the reporter", wa, 403],
    ["the reported account", settledAccused, 403],
    ["another operator", secondOperator, 403],
  ]) {
    const attempt = await api(
      "POST",
      `/chat/admin/reports/batches/${settledBatchId}/withdraw`,
      caller.token,
      undefined,
    );
    check(`${label} cannot withdraw the batch`, attempt.status === expected, attempt);
  }
  const guardedAnchor = await reportRow(settledAnchor.id);
  const guardedBatch = await decisionBatchRow(settledBatchId);
  check(
    "the refused withdrawals changed nothing",
    guardedAnchor.status === "dismissed"
      && guardedAnchor.review_note === settledBatchNote
      && guardedBatch.withdrawn_at === null,
    { guardedAnchor, guardedBatch },
  );
  const unknownBatch = await api(
    "POST",
    `/chat/admin/reports/batches/${randomUUID()}/withdraw`,
    operator.token,
    undefined,
  );
  check("an unknown batch is not found", unknownBatch.status === 404, unknownBatch);
  const malformedBatch = await api(
    "POST",
    "/chat/admin/reports/batches/not-a-uuid/withdraw",
    operator.token,
    undefined,
  );
  check("a malformed batch id is not found", malformedBatch.status === 404, malformedBatch);

  const withdrawn = await api(
    "POST",
    `/chat/admin/reports/batches/${settledBatchId}/withdraw`,
    operator.token,
    undefined,
  );
  check(
    "the operator who recorded it can withdraw it, and is told what came back",
    withdrawn.status === 200
      && withdrawn.json.restoredCount === 2
      && withdrawn.json.skippedCount === 0
      && [settledAnchor.id, settledSibling.id].every((id) =>
        (withdrawn.json.restoredReportIds ?? []).includes(id),
      ),
    withdrawn.json,
  );
  for (const id of [settledAnchor.id, settledSibling.id]) {
    const row = await reportRow(id);
    check(
      "a withdrawn report is back exactly where it was, with no decision on it",
      row.status === "open"
        && row.reviewer_user_id === null
        && row.reviewed_at === null
        && row.review_note === null
        && row.decision_batch_id === null,
      { id, row },
    );
  }
  const withdrawnRow = await decisionBatchRow(settledBatchId);
  check(
    "the withdrawal is audited: who took it back, when, and how much it restored",
    withdrawnRow.withdrawn_by_user_id === operator.userId
      && typeof withdrawnRow.withdrawn_by_name === "string"
      && withdrawnRow.withdrawn_by_name.length > 0
      && !!withdrawnRow.withdrawn_at
      && withdrawnRow.restored_report_count === 2,
    withdrawnRow,
  );
  const itemsAfter = await decisionBatchItemRows(settledBatchId);
  check(
    "each restored report is named in the trail, and the batch's own record survives",
    itemsAfter.length === 2 && itemsAfter.every((row) => !!row.restored_at),
    itemsAfter,
  );
  const alertsAfter = await Promise.all([
    reviewNotificationsFor(wa.userId, { expected: 2, tries: 5 }),
    reviewNotificationsFor(wb.userId, { expected: 2, tries: 5 }),
  ]);
  check(
    "the reporters keep the one alert they were sent, and get no second one",
    alertsAfter.every((rows) => rows.length === 1)
      && alertsAfter[0][0].id === alertsBefore[0][0].id,
    alertsAfter.map((rows) => rows.length),
  );

  const replayed = await api(
    "POST",
    `/chat/admin/reports/batches/${settledBatchId}/withdraw`,
    operator.token,
    undefined,
  );
  check("a batch cannot be withdrawn twice", replayed.status === 409, replayed);
  const afterReplay = await decisionBatchRow(settledBatchId);
  check(
    "the refused second withdrawal left the first one's record alone",
    afterReplay.withdrawn_at.getTime() === withdrawnRow.withdrawn_at.getTime()
      && afterReplay.restored_report_count === 2,
    afterReplay,
  );

  console.log("== a withdrawal never resurrects another operator's decision ==");
  const sharedAccused = await seedUser({ tag: "withdraw-shared-accused" });
  const [wc, wd, we] = await Promise.all([
    seedUser({ tag: "withdraw-c" }),
    seedUser({ tag: "withdraw-d" }),
    seedUser({ tag: "withdraw-e" }),
  ]);
  const [roomWc, roomWd, roomWe] = await Promise.all([
    seedDirectRoom({ memberIds: [wc.userId, sharedAccused.userId], tag: "wc" }),
    seedDirectRoom({ memberIds: [wd.userId, sharedAccused.userId], tag: "wd" }),
    seedDirectRoom({ memberIds: [we.userId, sharedAccused.userId], tag: "we" }),
  ]);
  const sharedAnchor = await seedReport({
    reporter: wc,
    reported: sharedAccused,
    room: roomWc,
    reason: "harassment",
    details: `withdraw shared anchor ${marked("details")}`,
    ageMinutes: 3,
  });
  const sharedKept = await seedReport({
    reporter: wd,
    reported: sharedAccused,
    room: roomWd,
    reason: "spam",
    details: `withdraw shared kept ${marked("details")}`,
    ageMinutes: 2,
  });
  const sharedRestored = await seedReport({
    reporter: we,
    reported: sharedAccused,
    room: roomWe,
    reason: "other",
    details: `withdraw shared restored ${marked("details")}`,
    ageMinutes: 1,
  });

  const reviewBatchNote = `read them all ${marked("note")}`;
  const reviewBatch = await api(
    "POST",
    `/chat/admin/reports/${sharedAnchor.id}/status/batch`,
    operator.token,
    { status: "reviewed", note: reviewBatchNote },
  );
  check(
    "the review batch reached all three reports",
    reviewBatch.status === 200 && reviewBatch.json.appliedCount === 3,
    reviewBatch.json,
  );
  const secondOperatorNote = `my call now ${marked("note")}`;
  const takenOver = await api(
    "PATCH",
    `/chat/admin/reports/${sharedKept.id}/status`,
    secondOperator.token,
    { status: "actioned", note: secondOperatorNote },
  );
  check("another operator decided one of the batched reports", takenOver.status === 200, takenOver);
  const takenOverRow = await reportRow(sharedKept.id);
  check(
    "their decision detaches that report from the batch that moved it",
    takenOverRow.decision_batch_id === null,
    takenOverRow,
  );

  const partial = await api(
    "POST",
    `/chat/admin/reports/batches/${reviewBatch.json.batchId}/withdraw`,
    operator.token,
    undefined,
  );
  check(
    "the withdrawal restores only what is still its own",
    partial.status === 200
      && partial.json.restoredCount === 2
      && partial.json.skippedCount === 1
      && !(partial.json.restoredReportIds ?? []).includes(sharedKept.id),
    partial.json,
  );
  const keptRow = await reportRow(sharedKept.id);
  check(
    "the other operator's decision stands, untouched by the undo",
    keptRow.status === "actioned"
      && keptRow.reviewer_user_id === secondOperator.userId
      && keptRow.review_note === secondOperatorNote,
    keptRow,
  );
  for (const id of [sharedAnchor.id, sharedRestored.id]) {
    const row = await reportRow(id);
    check(
      "the reports still carrying the batch's decision are open again",
      row.status === "open" && row.reviewer_user_id === null && row.review_note === null,
      { id, row },
    );
  }
  const partialItems = await decisionBatchItemRows(reviewBatch.json.batchId);
  check(
    "the trail records which reports the withdrawal put back and which it left",
    partialItems.filter((row) => row.restored_at !== null).length === 2
      && partialItems.find((row) => row.report_id === sharedKept.id)?.restored_at === null,
    partialItems,
  );

  console.log("== the window to withdraw a batch closes ==");
  const staleAccused = await seedUser({ tag: "withdraw-stale-accused" });
  const staleReporter = await seedUser({ tag: "withdraw-stale-reporter" });
  const staleRoom = await seedDirectRoom({
    memberIds: [staleReporter.userId, staleAccused.userId],
    tag: "ws",
  });
  const staleReport = await seedReport({
    reporter: staleReporter,
    reported: staleAccused,
    room: staleRoom,
    reason: "spam",
    details: `withdraw stale ${marked("details")}`,
    ageMinutes: 1,
  });
  const staleBatch = await api(
    "POST",
    `/chat/admin/reports/${staleReport.id}/status/batch`,
    operator.token,
    { status: "dismissed", note: `old call ${marked("note")}` },
  );
  check("the stale fixture batch was recorded", staleBatch.status === 200, staleBatch.json);
  // Rather than waiting out the real window, age the batch past it.
  await pool.query(
    `UPDATE chat_report_decision_batches
     SET decided_at = now() - interval '1 hour' WHERE id = $1`,
    [staleBatch.json.batchId],
  );
  const tooLate = await api(
    "POST",
    `/chat/admin/reports/batches/${staleBatch.json.batchId}/withdraw`,
    operator.token,
    undefined,
  );
  check("a batch past its window cannot be withdrawn", tooLate.status === 409, tooLate);
  const staleRow = await reportRow(staleReport.id);
  const staleBatchRow = await decisionBatchRow(staleBatch.json.batchId);
  check(
    "the lapsed withdrawal left the decision and the trail alone",
    staleRow.status === "dismissed"
      && staleRow.decision_batch_id === staleBatch.json.batchId
      && staleBatchRow.withdrawn_at === null
      && staleBatchRow.restored_report_count === null,
    { staleRow, staleBatchRow },
  );
}

// The reporter's own list exists so somebody can check on a report they filed
// weeks ago instead of filing it again. It must show them their own reports and
// stop there: no other person's complaints, and none of the operator-only data
// the queue above carries.
async function reporterOwnReportChecks({
  reporter,
  reported,
  bystander,
  staff,
  owner,
  operator,
  room,
  reports,
}) {
  console.log("== a reporter sees the reports they filed ==");
  const mine = await api("GET", "/chat/reports/mine", reporter.token);
  check("the reporter can list their own reports", mine.status === 200, mine);
  const mineIds = (mine.json.reports ?? []).map((report) => report.id);
  check(
    "their list is exactly their own reports, newest first",
    mineIds.join(",") === [reports.newest.id, reports.middle.id, reports.oldest.id].join(","),
    mineIds,
  );
  const filed = (mine.json.reports ?? []).find((report) => report.id === reports.middle.id);
  check(
    "an entry names the conversation, the reason, their own note and when they filed it",
    !!filed
      && filed.reason === "harassment"
      && filed.details === `middle ${marked("details")}`
      && filed.room?.id === room.roomId
      && filed.room?.name === room.roomName
      && filed.room?.scope === "global_direct"
      && filed.messageId === room.messageId
      && !Number.isNaN(Date.parse(filed.createdAt)),
    filed,
  );

  console.log("== progress is waiting or finished, and nothing else ==");
  const stateById = new Map((mine.json.reports ?? []).map((report) => [report.id, report.state]));
  check(
    "an unsettled report reads as still in review",
    stateById.get(reports.middle.id) === "in_review",
    stateById.get(reports.middle.id),
  );
  check(
    "an actioned report and a dismissed report both read as closed",
    stateById.get(reports.oldest.id) === "closed"
      && stateById.get(reports.newest.id) === "closed",
    [stateById.get(reports.oldest.id), stateById.get(reports.newest.id)],
  );
  const fields = new Set((mine.json.reports ?? []).flatMap((report) => Object.keys(report)));
  check(
    "an entry carries no operator-only field",
    ["status", "reviewNote", "reviewerName", "reviewerUserId", "reviewedAt", "reportedUser", "reporter", "otherOpenReports"]
      .every((field) => !fields.has(field)),
    [...fields],
  );
  check(
    "the response body carries no decision, reviewer or reported-account detail",
    !bodyMentions(mine, [
      "actioned",
      "dismissed",
      "reviewNote",
      "reviewer",
      `looked into it ${marked("note")}`,
      `no action needed ${marked("note")}`,
      operator.name,
      reported.userId,
      reported.name,
      reported.mobile,
    ]),
    mine.json,
  );

  console.log("== one person's reports stay out of everyone else's list ==");
  // A fresh accused account, so this fixture cannot disturb the repeat-offender
  // tallies the queue checks assert on the shared one.
  const otherAccused = await seedUser({ tag: "mine-accused" });
  const otherRoom = await seedDirectRoom({
    memberIds: [bystander.userId, otherAccused.userId],
    tag: "mine-other",
  });
  const bystanderReport = await seedReport({
    reporter: bystander,
    reported: otherAccused,
    room: otherRoom,
    reason: "scam",
    details: `bystander ${marked("details")}`,
    ageMinutes: 5,
  });
  const bystanderList = await api("GET", "/chat/reports/mine", bystander.token);
  const bystanderIds = (bystanderList.json.reports ?? []).map((report) => report.id);
  check(
    "a second reporter sees only the report they filed",
    bystanderList.status === 200 && bystanderIds.join(",") === bystanderReport.id,
    bystanderIds,
  );
  const mineAgain = await api("GET", "/chat/reports/mine?limit=50", reporter.token);
  check(
    "the first reporter's list never picks up the second's report",
    !(mineAgain.json.reports ?? []).some((report) => report.id === bystanderReport.id),
    (mineAgain.json.reports ?? []).map((report) => report.id),
  );
  for (const [label, caller] of [
    ["the reported user", reported],
    ["shop staff", staff],
    ["the shop owner", owner],
    ["a platform operator", operator],
  ]) {
    const listed = await api("GET", "/chat/reports/mine", caller.token);
    check(
      `${label} reads none of the reporter's reports here`,
      listed.status === 200
        && !(listed.json.reports ?? []).some((report) =>
          [reports.oldest.id, reports.middle.id, reports.newest.id, bystanderReport.id]
            .includes(report.id)),
      listed.json,
    );
  }
  const anonymousMine = await api("GET", "/chat/reports/mine", null);
  check(
    "an unauthenticated caller reads no reports",
    anonymousMine.status === 401,
    anonymousMine,
  );

  console.log("== a reporter's list pages without losing or repeating rows ==");
  const paged = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const response = await api(
      "GET",
      `/chat/reports/mine?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      reporter.token,
    );
    if (response.status !== 200) {
      check("a reporter's list keeps paging", false, response);
      break;
    }
    check(
      `reporter page ${page + 1} honours the limit`,
      (response.json.reports ?? []).length <= 1,
      response.json.reports,
    );
    paged.push(...(response.json.reports ?? []).map((report) => report.id));
    cursor = response.json.nextCursor ?? undefined;
    if (!cursor) break;
  }
  check(
    "paging walks their own reports newest-first, exactly once each",
    paged.join(",") === [reports.newest.id, reports.middle.id, reports.oldest.id].join(","),
    paged,
  );
  for (const [label, query] of [
    ["a zero limit", "?limit=0"],
    ["an oversized limit", "?limit=500"],
    ["a non-numeric limit", "?limit=all"],
    ["a malformed cursor", "?cursor=not-a-cursor"],
  ]) {
    const refused = await api("GET", `/chat/reports/mine${query}`, reporter.token);
    check(`${label} is refused`, refused.status === 400, refused);
  }
}

// One abusive account attracting complaints from several different people is
// the case the queue exists for, and it is exactly the case a newest-first list
// with a status filter buries. These checks cover finding that account and
// seeing that the complaints are connected.
async function volumeChecks({ operator, priorOpenReport }) {
  const accused = await seedUser({ tag: "accused" });
  const [complainantA, complainantB] = await Promise.all([
    seedUser({ tag: "complainant-a" }),
    seedUser({ tag: "complainant-b" }),
  ]);
  const roomA = await seedDirectRoom({
    memberIds: [complainantA.userId, accused.userId],
    tag: "ra",
  });
  const roomB = await seedDirectRoom({
    memberIds: [complainantB.userId, accused.userId],
    tag: "rb",
  });

  // Three open complaints about one account, from two different people.
  const first = await seedReport({
    reporter: complainantA,
    reported: accused,
    room: roomA,
    reason: "harassment",
    details: `first ${marked("details")}`,
    ageMinutes: 9,
  });
  const second = await seedReport({
    reporter: complainantB,
    reported: accused,
    room: roomB,
    reason: "scam",
    details: `second ${marked("details")}`,
    ageMinutes: 8,
  });
  const third = await seedReport({
    reporter: complainantA,
    reported: accused,
    room: roomA,
    reason: "spam",
    details: `third ${marked("details")}`,
    ageMinutes: 7,
  });
  const repeatIds = [third.id, second.id, first.id];

  async function search(term, extra = "") {
    const response = await api(
      "GET",
      `/chat/admin/reports?limit=100&search=${encodeURIComponent(term)}${extra}`,
      operator.token,
    );
    return {
      status: response.status,
      json: response.json,
      ids: (response.json.reports ?? []).map((report) => report.id),
      reports: response.json.reports ?? [],
    };
  }

  console.log("== an operator can search the queue by either party ==");
  const byReportedName = await search(accused.name);
  check(
    "searching the reported user's name finds every report against them",
    byReportedName.status === 200
      && byReportedName.ids.join(",") === repeatIds.join(","),
    byReportedName.ids,
  );
  const byReporterName = await search(complainantB.name);
  check(
    "searching a reporter's name finds only what that person filed",
    byReporterName.ids.join(",") === second.id,
    byReporterName.ids,
  );
  const byReportedMobile = await search(accused.mobile);
  check(
    "searching the reported user's mobile finds the same reports",
    byReportedMobile.ids.join(",") === repeatIds.join(","),
    byReportedMobile.ids,
  );
  const spacedMobile = await search(
    `+91 ${accused.mobile.slice(0, 5)} ${accused.mobile.slice(5)}`,
  );
  check(
    "a mobile typed with a country code and spaces still matches",
    spacedMobile.ids.join(",") === repeatIds.join(","),
    spacedMobile.ids,
  );
  const byReporterMobile = await search(complainantA.mobile);
  check(
    "searching a reporter's mobile finds only their reports",
    byReporterMobile.ids.join(",") === [third.id, first.id].join(","),
    byReporterMobile.ids,
  );
  const partialName = await search(accused.name.slice(0, accused.name.length - 3));
  check(
    "a partial name still matches",
    partialName.ids.join(",") === repeatIds.join(","),
    partialName.ids,
  );

  console.log("== a search term is matched literally ==");
  const wildcard = await search("%");
  check(
    "a bare wildcard matches nothing rather than the whole queue",
    wildcard.status === 200 && wildcard.ids.length === 0,
    wildcard.ids,
  );
  const underscore = await search(`${accused.name}_`);
  check(
    "an underscore is not treated as a single-character wildcard",
    underscore.ids.length === 0,
    underscore.ids,
  );
  const namedDigit = await search(`Report ${marked("no-such-name")} 7`);
  check(
    "stray digits in a name search do not drag in every matching mobile",
    namedDigit.ids.length === 0,
    namedDigit.ids,
  );
  const noMatch = await search(`no-such-person-${marked("absent")}`);
  check("a term nobody matches returns an empty page", noMatch.ids.length === 0, noMatch.ids);
  const blank = await search("   ");
  check(
    "a blank term is treated as no search at all",
    blank.status === 200 && blank.ids.length > repeatIds.length,
    blank.ids.length,
  );
  const overlong = await search("x".repeat(65));
  check("an overlong term is refused", overlong.status === 400, overlong);

  console.log("== a term is read as a name or as a mobile, never as both ==");
  // A name carrying a long run of digits: a mobile search for those digits must
  // not answer with this account, and a name search for them must.
  const digitsInName = "0123456789";
  const digitNamed = await seedUser({ tag: "digit-named" });
  await pool.query(`UPDATE users SET name = $1 WHERE id = $2`, [
    `Digits ${digitsInName} ${marked("named")}`,
    digitNamed.userId,
  ]);
  const digitRoom = await seedDirectRoom({
    memberIds: [complainantA.userId, digitNamed.userId],
    tag: "rd",
  });
  const digitReport = await seedReport({
    reporter: complainantA,
    reported: digitNamed,
    room: digitRoom,
    reason: "spam",
    details: `digits ${marked("details")}`,
    ageMinutes: 6,
  });
  const asMobile = await search(digitsInName);
  check(
    "a run of digits searches mobiles only, not names that contain them",
    asMobile.status === 200 && !asMobile.ids.includes(digitReport.id),
    asMobile.ids,
  );
  const asName = await search(`Digits ${digitsInName}`);
  check(
    "the same digits inside a name term still find the account by name",
    asName.ids.includes(digitReport.id),
    asName.ids,
  );
  const tooShort = await search("12");
  check(
    "a term too short to be a mobile matches nothing rather than falling back to names",
    tooShort.status === 200 && tooShort.ids.length === 0,
    tooShort.ids,
  );
  const punctuationOnly = await search("+");
  check(
    "a term of punctuation alone matches nothing",
    punctuationOnly.status === 200 && punctuationOnly.ids.length === 0,
    punctuationOnly.ids,
  );

  console.log("== a report names how many other open reports share its target ==");
  check(
    "each open report against the same account counts the other two",
    byReportedName.reports.every((report) => report.otherOpenReports === 2),
    byReportedName.reports.map((report) => [report.id, report.otherOpenReports]),
  );
  const lonely = await api(
    "GET",
    `/chat/admin/reports?limit=100&search=${encodeURIComponent(complainantB.name)}`,
    operator.token,
  );
  const soleReport = (lonely.json.reports ?? [])[0];
  check(
    "the count excludes the report you are looking at",
    soleReport?.otherOpenReports === 2,
    soleReport,
  );
  const singleTarget = await api("GET", `/chat/admin/reports?limit=100&status=open`, operator.token);
  const unrelated = (singleTarget.json.reports ?? []).find(
    (report) => report.id === priorOpenReport.id,
  );
  check(
    "an account with only one open report against it shows no others",
    unrelated?.otherOpenReports === 0,
    unrelated,
  );

  console.log("== settling one report lowers the tally on the rest ==");
  const settled = await api(
    "PATCH",
    `/chat/admin/reports/${third.id}/status`,
    operator.token,
    { status: "dismissed" },
  );
  check(
    "the decided report reports its own remaining siblings",
    settled.status === 200 && settled.json.report?.otherOpenReports === 2,
    settled.json.report,
  );
  const afterSettlement = await search(accused.name, "&status=open");
  check(
    "the settled report leaves the open queue",
    afterSettlement.ids.join(",") === [second.id, first.id].join(","),
    afterSettlement.ids,
  );
  check(
    "the reports still open now count one fewer sibling",
    afterSettlement.reports.every((report) => report.otherOpenReports === 1),
    afterSettlement.reports.map((report) => [report.id, report.otherOpenReports]),
  );

  console.log("== drilling into one account shows only reports against it ==");
  // An account that has attracted complaints and has also filed one. A text
  // search for their name cannot answer "what else is open about this
  // account?": it would hand back the complaint they filed about someone else.
  const bothParties = await seedUser({ tag: "both-parties" });
  const bothRoom = await seedDirectRoom({
    memberIds: [complainantB.userId, bothParties.userId],
    tag: "rp",
  });
  const againstThem = await seedReport({
    reporter: complainantB,
    reported: bothParties,
    room: bothRoom,
    reason: "harassment",
    details: `against ${marked("details")}`,
    ageMinutes: 5,
  });
  const filedByThem = await seedReport({
    reporter: bothParties,
    reported: complainantB,
    room: bothRoom,
    reason: "inappropriate",
    details: `filed ${marked("details")}`,
    ageMinutes: 4,
  });
  async function aboutAccount(userId, extra = "") {
    const response = await api(
      "GET",
      `/chat/admin/reports?limit=100&reportedUserId=${encodeURIComponent(userId)}${extra}`,
      operator.token,
    );
    return {
      status: response.status,
      ids: (response.json.reports ?? []).map((report) => report.id),
      reports: response.json.reports ?? [],
      json: response.json,
    };
  }
  const byName = await search(bothParties.name);
  check(
    "a text search finds both what they filed and what was filed about them",
    byName.ids.includes(againstThem.id) && byName.ids.includes(filedByThem.id),
    byName.ids,
  );
  const aboutThem = await aboutAccount(bothParties.userId);
  check(
    "the account filter keeps the report they filed out",
    aboutThem.status === 200 && aboutThem.ids.join(",") === againstThem.id,
    aboutThem.ids,
  );
  const accusedAccount = await aboutAccount(accused.userId, "&status=open");
  check(
    "the account filter agrees with the tally shown on a report",
    accusedAccount.ids.join(",") === [second.id, first.id].join(","),
    accusedAccount.ids,
  );
  const accountPaged = [];
  let accountCursor;
  for (let page = 0; page < 5; page++) {
    const response = await api(
      "GET",
      `/chat/admin/reports?limit=1&status=open&reportedUserId=${accused.userId}`
        + `${accountCursor ? `&cursor=${encodeURIComponent(accountCursor)}` : ""}`,
      operator.token,
    );
    if (response.status !== 200) {
      check("an account's reports keep paging", false, response);
      break;
    }
    accountPaged.push(...(response.json.reports ?? []).map((report) => report.id));
    accountCursor = response.json.nextCursor ?? undefined;
    if (!accountCursor) break;
  }
  check(
    "an account's reports page newest-first like any other queue",
    accountPaged.join(",") === [second.id, first.id].join(","),
    accountPaged,
  );
  const malformedAccount = await aboutAccount("not-a-user-id");
  check(
    "a malformed account filter is refused",
    malformedAccount.status === 400,
    malformedAccount.json,
  );
  const unknownAccount = await aboutAccount(randomUUID());
  check(
    "an account nobody has reported returns an empty page",
    unknownAccount.status === 200 && unknownAccount.ids.length === 0,
    unknownAccount.ids,
  );

  console.log("== a searched queue pages newest-first without losing rows ==");
  const paged = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const response = await api(
      "GET",
      `/chat/admin/reports?limit=1&search=${encodeURIComponent(accused.mobile)}`
        + `${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      operator.token,
    );
    if (response.status !== 200) {
      check("a searched queue keeps paging", false, response);
      break;
    }
    check(
      `searched page ${page + 1} honours the limit`,
      (response.json.reports ?? []).length <= 1,
      response.json.reports,
    );
    paged.push(...(response.json.reports ?? []).map((report) => report.id));
    cursor = response.json.nextCursor ?? undefined;
    if (!cursor) break;
  }
  check(
    "a searched queue pages through exactly its own matches, newest first",
    paged.join(",") === repeatIds.join(","),
    paged,
  );
  const searchedAndFiltered = [];
  let filteredCursor;
  for (let page = 0; page < 10; page++) {
    const response = await api(
      "GET",
      `/chat/admin/reports?limit=1&status=open&search=${encodeURIComponent(accused.name)}`
        + `${filteredCursor ? `&cursor=${encodeURIComponent(filteredCursor)}` : ""}`,
      operator.token,
    );
    searchedAndFiltered.push(...(response.json.reports ?? []).map((report) => report.id));
    filteredCursor = response.json.nextCursor ?? undefined;
    if (!filteredCursor) break;
  }
  check(
    "a search combined with a status filter pages over the intersection only",
    searchedAndFiltered.join(",") === [second.id, first.id].join(","),
    searchedAndFiltered,
  );
}

async function main() {
  let child;
  try {
    child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
      env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
      stdio: ["ignore", "ignore", "inherit"],
    });
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      await sleep(1000);
      ready = await fetch(`${BASE}/healthz`).then((r) => r.ok).catch(() => false);
    }
    if (!ready) throw new Error("server did not start");
    await run();
  } finally {
    child?.kill("SIGTERM");
    try {
      await cleanupFixtures();
      await verifyFixtureCleanup();
    } finally {
      await pool.end();
    }
  }
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll chat report queue checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
