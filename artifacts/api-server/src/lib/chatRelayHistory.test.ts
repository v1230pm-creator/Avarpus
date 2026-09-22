import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import {
  appUpdatesTable,
  chatMessagesTable,
  chatRelayRunsTable,
  chatRoomMembersTable,
  chatRoomsTable,
  db,
  usersTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { runChatRelayCleanup, type ChatRelayCleanupResult } from "./chatRelayCleanup";
import { CHAT_RELAY_MIN_APP_BUILD, type ChatRelayPolicy } from "./chatRelayPolicy";
import {
  CHAT_RELAY_HISTORY_DAYS,
  CHAT_RELAY_HISTORY_MAX_RUNS,
  measureRelayHeld,
  pruneChatRelayRuns,
  readChatRelayHistory,
  recordChatRelayRun,
} from "./chatRelayHistory";
import { StorageSweepsDisabledError, type StorageSweepPolicy } from "./storageSweeps";

const DAY_MS = 24 * 60 * 60 * 1000;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Synthetic rows carry this in aborted_error so cleanup can find every one.
const MARKER = `history-fixture-${suffix}`;
const policy: ChatRelayPolicy = { enabled: true, graceDays: 7, expiryDays: 30 };
// The fixtures below are this database's own objects, so the purge may run
// here even though the test process is not the production deployment.
const SWEEPS: StorageSweepPolicy = { enabled: true, reason: "OBJECT_STORAGE_SWEEPS=on" };

let senderId = "";
let recipientId = "";
let roomId = "";
let appUpdateId = "";
const messageIds: string[] = [];
const runAts: Date[] = [];

/** A unique run timestamp; every run this file triggers is deleted by it afterwards. */
function uniqueRunAt(): Date {
  const at = new Date(Date.now() - runAts.length * 1000 - Math.floor(Math.random() * 500));
  runAts.push(at);
  return at;
}

function fakeResult(overrides: Partial<ChatRelayCleanupResult> = {}): ChatRelayCleanupResult {
  return {
    ranAt: uniqueRunAt().toISOString(),
    skipped: null,
    skippedReason: null,
    policy,
    examined: 12,
    purged: 5,
    expired: 2,
    alreadyGone: 1,
    tombstonesPurged: 3,
    kept: 2,
    raced: 0,
    failed: 0,
    bytesReclaimed: 123_456,
    abortedError: null,
    ...overrides,
  };
}

async function insertMedia(opts: {
  sizeBytes: number | null;
  pinned?: boolean;
  state?: "available" | "purged" | "expired";
}) {
  const [message] = await db.insert(chatMessagesTable).values({
    roomId,
    senderId,
    senderName: "History Sender",
    kind: "image",
    body: "photo.jpg",
    objectPath: `/objects/uploads/global/chat/${roomId}/${randomUUID()}`,
    mimeType: "image/jpeg",
    sizeBytes: opts.sizeBytes,
    mediaPinned: opts.pinned ?? false,
    mediaState: opts.state ?? "available",
    clientRequestId: `history-${randomUUID()}`,
  }).returning();
  messageIds.push(message.id);
  return message;
}

async function rowsAt(at: Date) {
  return db.select().from(chatRelayRunsTable).where(eq(chatRelayRunsTable.ranAt, at));
}

describe.sequential("Chat relay run history", () => {
  beforeAll(async () => {
    const [sender] = await db.insert(usersTable).values({
      name: "History Sender",
      email: `relay-history-sender-${suffix}@example.test`,
      mobile: `76${suffix.replace(/\D/g, "").slice(-8).padStart(8, "3")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    const [recipient] = await db.insert(usersTable).values({
      name: "History Recipient",
      email: `relay-history-recipient-${suffix}@example.test`,
      mobile: `75${suffix.replace(/\D/g, "").slice(-8).padStart(8, "4")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    senderId = sender.id;
    recipientId = recipient.id;
    const [room] = await db.insert(chatRoomsTable).values({
      scope: "global_direct",
      kind: "direct",
      name: "Relay history test",
      createdById: sender.id,
      createdByName: sender.name,
    }).returning();
    roomId = room.id;
    await db.insert(chatRoomMembersTable).values([
      { roomId, userId: senderId },
      { roomId, userId: recipientId },
    ]);
    // A published critical release at the minimum build satisfies the guard,
    // so a whole-relay run reaches the point where it records itself.
    const [update] = await db.insert(appUpdatesTable).values({
      version: `9.${suffix.slice(-4)}.5`,
      buildNumber: CHAT_RELAY_MIN_APP_BUILD,
      updateType: "critical",
      status: "published",
      publishedAt: new Date(),
    }).returning();
    appUpdateId = update.id;
    // Nothing in this file may touch real storage.
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockImplementation(async () => {
      throw new Error("storage must not be reached by history tests");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockImplementation(async () => {
      throw new Error("storage must not be reached by history tests");
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (runAts.length) {
      await db.delete(chatRelayRunsTable).where(inArray(chatRelayRunsTable.ranAt, runAts));
    }
    await db.delete(chatRelayRunsTable).where(like(chatRelayRunsTable.abortedError, `%${MARKER}%`));
    if (messageIds.length) {
      await db.delete(chatMessagesTable).where(inArray(chatMessagesTable.id, messageIds));
    }
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    await db.delete(usersTable).where(inArray(usersTable.id, [senderId, recipientId]));
    await db.delete(appUpdatesTable).where(eq(appUpdatesTable.id, appUpdateId));
  });

  it("measures what the relay still holds: available objects, known bytes, unknown sizes and pinned evidence", async () => {
    const before = await measureRelayHeld();
    await insertMedia({ sizeBytes: 4321 });
    await insertMedia({ sizeBytes: null });
    await insertMedia({ sizeBytes: 100, pinned: true });
    await insertMedia({ sizeBytes: 999, state: "purged" });
    await insertMedia({ sizeBytes: 888, state: "expired" });
    const after = await measureRelayHeld();
    expect(after.objects - before.objects).toBe(3);
    expect(after.bytes - before.bytes).toBe(4421);
    expect(after.unknownSizeObjects - before.unknownSizeObjects).toBe(1);
    expect(after.pinnedObjects - before.pinnedObjects).toBe(1);
    expect(after.pinnedBytes - before.pinnedBytes).toBe(100);
  });

  it("records a run with its counters, policy and relay snapshot, and reads it back newest first", async () => {
    const older = fakeResult({ bytesReclaimed: 10 });
    const newer = fakeResult({
      ranAt: new Date(new Date(older.ranAt).getTime() + 500).toISOString(),
      skipped: "min_build_not_met",
      skippedReason: "blocked",
      purged: 0,
      expired: 0,
      bytesReclaimed: 0,
    });
    runAts.push(new Date(newer.ranAt));
    expect(await recordChatRelayRun(older, { trigger: "scheduled" })).toBe(true);
    expect(await recordChatRelayRun(newer, { trigger: "manual" })).toBe(true);

    const held = await measureRelayHeld();
    const history = await readChatRelayHistory();
    expect(history.windowDays).toBe(CHAT_RELAY_HISTORY_DAYS);
    expect(history.maxRuns).toBe(CHAT_RELAY_HISTORY_MAX_RUNS);
    expect(history.held).toEqual(held);
    expect(history.runs.length).toBeLessThanOrEqual(CHAT_RELAY_HISTORY_MAX_RUNS);
    for (let i = 1; i < history.runs.length; i += 1) {
      expect(new Date(history.runs[i - 1].ranAt).getTime()).toBeGreaterThanOrEqual(
        new Date(history.runs[i].ranAt).getTime(),
      );
    }

    const olderIndex = history.runs.findIndex((run) => run.ranAt === older.ranAt);
    const newerIndex = history.runs.findIndex((run) => run.ranAt === newer.ranAt);
    expect(olderIndex).toBeGreaterThan(-1);
    expect(newerIndex).toBeGreaterThan(-1);
    expect(newerIndex).toBeLessThan(olderIndex);

    const stored = history.runs[olderIndex];
    expect(stored).toMatchObject({
      trigger: "scheduled",
      skipped: null,
      graceDays: policy.graceDays,
      expiryDays: policy.expiryDays,
      examined: 12,
      purged: 5,
      expired: 2,
      alreadyGone: 1,
      tombstonesPurged: 3,
      kept: 2,
      raced: 0,
      failed: 0,
      bytesReclaimed: 10,
      abortedError: null,
    });
    expect(stored.heldObjects).toBe(held.objects);
    expect(stored.heldBytes).toBe(held.bytes);
    expect(history.runs[newerIndex]).toMatchObject({ trigger: "manual", skipped: "min_build_not_met" });
  });

  it("records whole-relay purge runs with their trigger but never room-scoped ones", async () => {
    const scoped = uniqueRunAt();
    const scopedResult = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId], now: scoped, trigger: "manual" });
    expect(scopedResult.abortedError).toBeNull();
    expect(await rowsAt(scoped)).toHaveLength(0);

    // maxRows 0 walks no message rows, so the whole-relay run is pure bookkeeping.
    const whole = uniqueRunAt();
    const wholeResult = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, maxRows: 0, now: whole, trigger: "manual" });
    expect(wholeResult.skipped).toBeNull();
    expect(wholeResult.examined).toBe(0);
    const [recorded] = await rowsAt(whole);
    expect(recorded).toBeDefined();
    expect(recorded.trigger).toBe("manual");
    expect(recorded.graceDays).toBe(policy.graceDays);
    expect(recorded.heldObjects).not.toBeNull();

    const timer = uniqueRunAt();
    await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, maxRows: 0, now: timer });
    expect((await rowsAt(timer))[0]?.trigger).toBe("scheduled");
  });

  it("leaves no record for a switched-off run that found nothing to do", async () => {
    const idle = uniqueRunAt();
    const result = await runChatRelayCleanup({
      storageSweeps: SWEEPS,
      policy: { ...policy, enabled: false },
      maxRows: 0,
      now: idle,
    });
    expect(result.skipped).toBe("disabled");
    expect(await rowsAt(idle)).toHaveLength(0);
  });

  it("never lets a history failure abort or alter a purge run", async () => {
    const originalInsert = db.insert.bind(db);
    vi.spyOn(db, "insert").mockImplementation(((table: unknown) => {
      if (table === chatRelayRunsTable) throw new Error("history table unavailable");
      return originalInsert(table as never);
    }) as typeof db.insert);

    const at = uniqueRunAt();
    const result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, maxRows: 0, now: at, trigger: "manual" });
    expect(result.skipped).toBeNull();
    expect(result.abortedError).toBeNull();
    expect(result.failed).toBe(0);
    expect(await rowsAt(at)).toHaveLength(0);
    expect(await recordChatRelayRun(fakeResult(), { trigger: "manual" })).toBe(false);
  });

  it("still records the run when the relay measurement itself fails", async () => {
    vi.spyOn(db, "execute").mockRejectedValue(new Error("aggregate timed out"));
    const result = fakeResult();
    expect(await recordChatRelayRun(result, { trigger: "scheduled" })).toBe(true);
    vi.restoreAllMocks();
    const [row] = await rowsAt(new Date(result.ranAt));
    expect(row.heldObjects).toBeNull();
    expect(row.heldBytes).toBeNull();
    expect(row.bytesReclaimed).toBe(result.bytesReclaimed);
  });

  it("prunes runs past the retention window and beyond the row cap, newest kept", async () => {
    const now = Date.now();
    const stale = new Date(now - (CHAT_RELAY_HISTORY_DAYS + 1) * DAY_MS);
    // Inside the window but older than any real row: the cap trims these first.
    const base = now - (CHAT_RELAY_HISTORY_DAYS - 2) * DAY_MS;
    const overflow = 5;
    const synthetic = Array.from({ length: CHAT_RELAY_HISTORY_MAX_RUNS + overflow }, (_, index) => ({
      ranAt: new Date(base + index * 1000),
      trigger: "scheduled",
      skipped: null,
      graceDays: 7,
      expiryDays: 30,
      bytesReclaimed: index,
      abortedError: MARKER,
    }));
    await db.insert(chatRelayRunsTable).values([
      { ...synthetic[0], ranAt: stale, bytesReclaimed: -1 },
      ...synthetic,
    ]);

    const capped = await readChatRelayHistory();
    expect(capped.runs).toHaveLength(CHAT_RELAY_HISTORY_MAX_RUNS);
    expect(capped.runs.some((run) => new Date(run.ranAt).getTime() === stale.getTime())).toBe(false);

    const removed = await pruneChatRelayRuns();
    expect(removed).toBeGreaterThanOrEqual(overflow + 1);
    const remaining = await db
      .select({ ranAt: chatRelayRunsTable.ranAt })
      .from(chatRelayRunsTable)
      .where(like(chatRelayRunsTable.abortedError, `%${MARKER}%`));
    expect(remaining.some((row) => row.ranAt.getTime() === stale.getTime())).toBe(false);
    const total = await db.select({ id: chatRelayRunsTable.id }).from(chatRelayRunsTable);
    expect(total.length).toBeLessThanOrEqual(CHAT_RELAY_HISTORY_MAX_RUNS);
    // The oldest synthetic rows went; the newest synthetic rows are the survivors.
    const survivors = remaining.map((row) => row.ranAt.getTime()).sort((a, b) => a - b);
    expect(survivors.at(-1)).toBe(synthetic.at(-1)!.ranAt.getTime());
    expect(survivors[0]).toBeGreaterThan(synthetic[0].ranAt.getTime());
  });
});
