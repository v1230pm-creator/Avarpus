import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appSettingsTable,
  appUpdatesTable,
  chatMessageReceiptsTable,
  chatMessagesTable,
  chatReportsTable,
  chatRoomMembersTable,
  chatRoomsTable,
  APP_MIN_SUPPORTED_BUILD_KEY,
  CHAT_RELAY_CLEANUP_ENABLED_KEY,
  db,
  usersTable,
} from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import { syncChatMediaPins } from "./chatMediaPins";
import { recordCriticalReleasePublished } from "./appMinimumBuild";
import {
  purgeRelayMediaForDeletedMessage,
  purgeRelayMediaForDeletedMessages,
  readChatRelayPolicy,
  readMinimumSupportedAppBuild,
  runChatRelayCleanup,
} from "./chatRelayCleanup";
import { CHAT_RELAY_MIN_APP_BUILD, type ChatRelayPolicy } from "./chatRelayPolicy";
import { StorageSweepsDisabledError, type StorageSweepPolicy } from "./storageSweeps";

const DAY_MS = 24 * 60 * 60 * 1000;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const policy: ChatRelayPolicy = { enabled: true, graceDays: 7, expiryDays: 30 };
// The fixtures below are this database's own objects, so the purge may run
// here even though the test process is not the production deployment.
const SWEEPS: StorageSweepPolicy = { enabled: true, reason: "OBJECT_STORAGE_SWEEPS=on" };

let senderId = "";
let recipientId = "";
let roomId = "";
let appUpdateId = "";
const messageIds: string[] = [];

type FakeFile = { getMetadata: () => Promise<[{ size?: number }]>; delete: () => Promise<void> };

/** Storage double keyed by object path; unknown paths behave as "not found". */
function fakeStorage(files: Record<string, FakeFile | Error>) {
  return vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockImplementation(
    async (objectPath: string) => {
      const entry = files[objectPath];
      if (!entry) throw new ObjectNotFoundError();
      if (entry instanceof Error) throw entry;
      return entry as never;
    },
  );
}

function liveFile(size: number, deleted = vi.fn(async () => {})): FakeFile & { deleted: typeof deleted } {
  return { getMetadata: async () => [{ size }], delete: deleted, deleted };
}

async function insertMedia(opts: {
  ageDays: number;
  stored?: boolean;
  deleted?: boolean;
  sizeBytes?: number;
}) {
  const objectPath = `/objects/uploads/global/chat/${roomId}/${randomUUID()}`;
  const createdAt = new Date(Date.now() - opts.ageDays * DAY_MS);
  const [message] = await db.insert(chatMessagesTable).values({
    roomId,
    senderId,
    senderName: "Relay Sender",
    kind: "image",
    body: "photo.jpg",
    objectPath,
    mimeType: "image/jpeg",
    sizeBytes: opts.sizeBytes ?? 1234,
    clientRequestId: `relay-${randomUUID()}`,
    deletedAt: opts.deleted ? createdAt : null,
    createdAt,
    updatedAt: createdAt,
  }).returning();
  messageIds.push(message.id);
  if (opts.stored) {
    await db.insert(chatMessageReceiptsTable).values({
      messageId: message.id,
      roomId,
      userId: recipientId,
      storedAt: new Date(),
    });
  }
  return { id: message.id, objectPath };
}

async function readState(id: string) {
  const [row] = await db
    .select({ mediaState: chatMessagesTable.mediaState, mediaPinned: chatMessagesTable.mediaPinned, objectPath: chatMessagesTable.objectPath })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.id, id));
  return row;
}

describe.sequential("Chat relay purge", () => {
  beforeAll(async () => {
    const [sender] = await db.insert(usersTable).values({
      name: "Relay Sender",
      email: `relay-sender-${suffix}@example.test`,
      mobile: `78${suffix.replace(/\D/g, "").slice(-8).padStart(8, "1")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    const [recipient] = await db.insert(usersTable).values({
      name: "Relay Recipient",
      email: `relay-recipient-${suffix}@example.test`,
      mobile: `77${suffix.replace(/\D/g, "").slice(-8).padStart(8, "2")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    senderId = sender.id;
    recipientId = recipient.id;
    const [room] = await db.insert(chatRoomsTable).values({
      scope: "global_direct",
      kind: "direct",
      name: "Relay purge test",
      createdById: sender.id,
      createdByName: sender.name,
    }).returning();
    roomId = room.id;
    await db.insert(chatRoomMembersTable).values([
      { roomId, userId: senderId },
      { roomId, userId: recipientId },
    ]);
    // A published critical release at the minimum build satisfies the guard.
    const [update] = await db.insert(appUpdatesTable).values({
      version: `9.${suffix.slice(-4)}.0`,
      buildNumber: CHAT_RELAY_MIN_APP_BUILD,
      updateType: "critical",
      status: "published",
      publishedAt: new Date(),
    }).returning();
    appUpdateId = update.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (messageIds.length) {
      await db.delete(chatMessagesTable).where(inArray(chatMessagesTable.id, messageIds));
    }
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    await db.delete(usersTable).where(inArray(usersTable.id, [senderId, recipientId]));
    await db.delete(appUpdatesTable).where(eq(appUpdatesTable.id, appUpdateId));
  });

  it("refuses to run where this database does not own the bucket, tombstones included", async () => {
    const gone = await insertMedia({ ageDays: 1, stored: false, deleted: true, sizeBytes: 900 });
    const file = liveFile(900);
    fakeStorage({ [gone.objectPath]: file });
    // The environment default outside a Replit deployment is "disabled";
    // a manual trigger must surface that instead of purging anything.
    await expect(
      runChatRelayCleanup({
        storageSweeps: { enabled: false, reason: "shared-bucket-outside-deployment" },
        policy,
        roomIds: [roomId],
      }),
    ).rejects.toBeInstanceOf(StorageSweepsDisabledError);
    expect(file.deleted).not.toHaveBeenCalled();
    expect((await readState(gone.id)).mediaState).toBe("available");
  });

  it("applies no lifecycle rule while the operator switch is off", async () => {
    const target = await insertMedia({ ageDays: 40, stored: true });
    const file = liveFile(500);
    fakeStorage({ [target.objectPath]: file });
    const result = await runChatRelayCleanup({
      storageSweeps: SWEEPS,
      policy: { ...policy, enabled: false },
      roomIds: [roomId],
    });
    expect(result.skipped).toBe("disabled");
    expect(result.purged + result.expired).toBe(0);
    expect(file.deleted).not.toHaveBeenCalled();
    expect((await readState(target.id)).mediaState).toBe("available");
  });

  it("still sweeps delete-for-everyone tombstones with the switch off (retry after a failed immediate delete)", async () => {
    const gone = await insertMedia({ ageDays: 1, stored: false, deleted: true, sizeBytes: 900 });
    // The immediate delete failed transiently: row stays available with its object.
    fakeStorage({ [gone.objectPath]: new Error("transient outage") });
    await purgeRelayMediaForDeletedMessage(gone.id);
    expect((await readState(gone.id)).mediaState).toBe("available");
    vi.restoreAllMocks();

    const file = liveFile(900);
    fakeStorage({ [gone.objectPath]: file });
    const result = await runChatRelayCleanup({
      storageSweeps: SWEEPS,
      policy: { ...policy, enabled: false },
      roomIds: [roomId],
    });
    expect(result.skipped).toBe("disabled");
    expect(result.tombstonesPurged).toBe(1);
    expect(result.bytesReclaimed).toBe(900);
    expect(file.deleted).toHaveBeenCalledOnce();
    expect((await readState(gone.id)).mediaState).toBe("purged");
  });

  it("removes a pinned-then-deleted message's relay copy as soon as the report is terminal, switch off", async () => {
    const reported = await insertMedia({ ageDays: 1, stored: false });
    const [report] = await db.insert(chatReportsTable).values({
      reporterUserId: recipientId,
      reportedUserId: senderId,
      roomId,
      messageId: reported.id,
      clientRequestId: `relay-report-${randomUUID()}`,
      reason: "inappropriate",
      status: "open",
    }).returning();
    await db.transaction((tx) => syncChatMediaPins(tx, [reported.id]));
    await db.update(chatMessagesTable).set({ deletedAt: new Date() }).where(eq(chatMessagesTable.id, reported.id));
    const file = liveFile(10);
    fakeStorage({ [reported.objectPath]: file });
    await purgeRelayMediaForDeletedMessage(reported.id);
    expect(file.deleted).not.toHaveBeenCalled();

    // Terminal decision: the pin sync reports the released message and the
    // route hands it straight to the tombstone purge — no switch involved.
    await db.update(chatReportsTable).set({ status: "actioned" }).where(eq(chatReportsTable.id, report.id));
    const released = await db.transaction((tx) => syncChatMediaPins(tx, [reported.id]));
    expect(released).toEqual([reported.id]);
    await purgeRelayMediaForDeletedMessages(released);
    expect(file.deleted).toHaveBeenCalledOnce();
    expect((await readState(reported.id)).mediaState).toBe("purged");
  });

  it("defaults to off when no operator setting exists", async () => {
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, CHAT_RELAY_CLEANUP_ENABLED_KEY));
    const stored = await readChatRelayPolicy();
    expect(stored).toEqual({ enabled: false, graceDays: 7, expiryDays: 30 });
  });

  it("purges media every recipient has stored once the grace period passed, and keeps fresh media", async () => {
    const ready = await insertMedia({ ageDays: 8, stored: true, sizeBytes: 2048 });
    const fresh = await insertMedia({ ageDays: 2, stored: true });
    const unstored = await insertMedia({ ageDays: 10, stored: false });
    const readyFile = liveFile(4096);
    const freshFile = liveFile(10);
    const unstoredFile = liveFile(10);
    fakeStorage({
      [ready.objectPath]: readyFile,
      [fresh.objectPath]: freshFile,
      [unstored.objectPath]: unstoredFile,
    });
    const result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId] });
    expect(result.skipped).toBeNull();
    expect(result.abortedError).toBeNull();
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(result.bytesReclaimed).toBeGreaterThanOrEqual(4096);
    expect(readyFile.deleted).toHaveBeenCalledOnce();
    expect(freshFile.deleted).not.toHaveBeenCalled();
    expect(unstoredFile.deleted).not.toHaveBeenCalled();
    expect((await readState(ready.id)).mediaState).toBe("purged");
    expect((await readState(fresh.id)).mediaState).toBe("available");
    expect((await readState(unstored.id)).mediaState).toBe("available");
  });

  it("expires undelivered media after the hard cap", async () => {
    const stale = await insertMedia({ ageDays: 31, stored: false });
    const file = liveFile(999);
    fakeStorage({ [stale.objectPath]: file });
    const result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId] });
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(file.deleted).toHaveBeenCalledOnce();
    expect((await readState(stale.id)).mediaState).toBe("expired");
  });

  it("pins media with an open report and releases it when the report is terminal", async () => {
    const reported = await insertMedia({ ageDays: 40, stored: true });
    const [report] = await db.insert(chatReportsTable).values({
      reporterUserId: recipientId,
      reportedUserId: senderId,
      roomId,
      messageId: reported.id,
      clientRequestId: `relay-report-${randomUUID()}`,
      reason: "inappropriate",
      status: "open",
    }).returning();
    await db.transaction((tx) => syncChatMediaPins(tx, [reported.id]));
    expect((await readState(reported.id)).mediaPinned).toBe(true);

    const file = liveFile(50);
    const spy = fakeStorage({ [reported.objectPath]: file });
    let result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId] });
    expect(result.abortedError).toBeNull();
    expect(file.deleted).not.toHaveBeenCalled();
    expect((await readState(reported.id)).mediaState).toBe("available");

    // Delete-for-everyone must not destroy evidence while the report is open.
    await db.update(chatMessagesTable).set({ deletedAt: new Date() }).where(eq(chatMessagesTable.id, reported.id));
    await purgeRelayMediaForDeletedMessage(reported.id);
    expect(file.deleted).not.toHaveBeenCalled();
    expect((await readState(reported.id)).mediaState).toBe("available");

    await db.update(chatReportsTable).set({ status: "dismissed" }).where(eq(chatReportsTable.id, report.id));
    await db.transaction((tx) => syncChatMediaPins(tx, [reported.id]));
    expect((await readState(reported.id)).mediaPinned).toBe(false);
    spy.mockRestore();
    fakeStorage({ [reported.objectPath]: file });
    result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId] });
    expect(result.abortedError).toBeNull();
    expect(file.deleted).toHaveBeenCalledOnce();
    expect((await readState(reported.id)).mediaState).toBe("purged");
  });

  it("removes the relay copy immediately on delete-for-everyone", async () => {
    const gone = await insertMedia({ ageDays: 0, stored: false, deleted: true });
    const file = liveFile(77);
    fakeStorage({ [gone.objectPath]: file });
    await purgeRelayMediaForDeletedMessage(gone.id);
    expect(file.deleted).toHaveBeenCalledOnce();
    const state = await readState(gone.id);
    expect(state.mediaState).toBe("purged");
    expect(state.objectPath).toBe(gone.objectPath);
  });

  it("refuses to purge a live message through the delete-for-everyone path", async () => {
    const live = await insertMedia({ ageDays: 40, stored: true });
    const file = liveFile(77);
    fakeStorage({ [live.objectPath]: file });
    await purgeRelayMediaForDeletedMessage(live.id);
    expect(file.deleted).not.toHaveBeenCalled();
    expect((await readState(live.id)).mediaState).toBe("available");
  });

  it("records an already-missing object as purged with nothing reclaimed", async () => {
    const orphan = await insertMedia({ ageDays: 9, stored: true, sizeBytes: 5000 });
    fakeStorage({});
    const result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId] });
    expect(result.alreadyGone).toBeGreaterThanOrEqual(1);
    expect(result.abortedError).toBeNull();
    expect((await readState(orphan.id)).mediaState).toBe("purged");
  });

  it("fails closed: an unexpected storage error leaves the row untouched and ends the run", async () => {
    const broken = await insertMedia({ ageDays: 9, stored: true });
    const later = await insertMedia({ ageDays: 8, stored: true });
    const laterFile = liveFile(20);
    fakeStorage({
      [broken.objectPath]: new Error("bucket unavailable"),
      [later.objectPath]: laterFile,
    });
    const result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId] });
    expect(result.abortedError).toContain(broken.objectPath);
    expect(result.failed).toBe(1);
    expect(laterFile.deleted).not.toHaveBeenCalled();
    expect((await readState(broken.id)).mediaState).toBe("available");
    expect((await readState(later.id)).mediaState).toBe("available");
  });

  it("skips the run when the published minimum build predates the device media store", async () => {
    await db.update(appUpdatesTable).set({ buildNumber: CHAT_RELAY_MIN_APP_BUILD - 1 }).where(eq(appUpdatesTable.id, appUpdateId));
    try {
      const otherCritical = await readMinimumSupportedAppBuild();
      // Another published critical release in this database may already satisfy
      // the guard; the check is only meaningful when this fixture is the newest.
      if (otherCritical !== null && otherCritical >= CHAT_RELAY_MIN_APP_BUILD) return;
      const target = await insertMedia({ ageDays: 40, stored: true });
      const file = liveFile(1);
      fakeStorage({ [target.objectPath]: file });
      const result = await runChatRelayCleanup({ storageSweeps: SWEEPS, policy, roomIds: [roomId] });
      expect(result.skipped).toBe("min_build_not_met");
      expect(file.deleted).not.toHaveBeenCalled();
      expect((await readState(target.id)).mediaState).toBe("available");
    } finally {
      await db.update(appUpdatesTable).set({ buildNumber: CHAT_RELAY_MIN_APP_BUILD }).where(eq(appUpdatesTable.id, appUpdateId));
    }
  });

  it("keeps the minimum build after a later optional release archives the critical one, and caps it on rollback", async () => {
    const before = await readMinimumSupportedAppBuild();
    const [optional] = await db.insert(appUpdatesTable).values({
      version: `9.${suffix.slice(-4)}.1`,
      buildNumber: CHAT_RELAY_MIN_APP_BUILD + 1,
      updateType: "optional",
      status: "published",
      publishedAt: new Date(),
    }).returning();
    const [recorded] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, APP_MIN_SUPPORTED_BUILD_KEY));
    try {
      // Publishing the optional build archives the critical one (as the route does).
      await db.update(appUpdatesTable).set({ status: "archived" }).where(eq(appUpdatesTable.id, appUpdateId));
      expect(await readMinimumSupportedAppBuild()).toBe(before);

      // The recorded floor never goes down...
      await db.transaction((tx) => recordCriticalReleasePublished(tx, CHAT_RELAY_MIN_APP_BUILD));
      await db.transaction((tx) => recordCriticalReleasePublished(tx, CHAT_RELAY_MIN_APP_BUILD - 5));
      const [afterRecord] = await db
        .select({ value: appSettingsTable.value })
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, APP_MIN_SUPPORTED_BUILD_KEY));
      expect(Number(afterRecord.value)).toBeGreaterThanOrEqual(CHAT_RELAY_MIN_APP_BUILD);

      // ...but a rollback to an older live build caps the effective minimum,
      // because fresh installs now land below the floor.
      await db.update(appUpdatesTable).set({ status: "archived" }).where(eq(appUpdatesTable.id, optional.id));
      await db.update(appUpdatesTable)
        .set({ status: "published", buildNumber: CHAT_RELAY_MIN_APP_BUILD - 1 })
        .where(eq(appUpdatesTable.id, appUpdateId));
      const others = await db
        .select({ buildNumber: appUpdatesTable.buildNumber })
        .from(appUpdatesTable)
        .where(eq(appUpdatesTable.status, "published"));
      const liveBuild = Math.max(...others.map((row) => row.buildNumber));
      const rolledBack = await readMinimumSupportedAppBuild();
      expect(rolledBack).not.toBeNull();
      expect(rolledBack!).toBeLessThanOrEqual(Math.max(liveBuild, CHAT_RELAY_MIN_APP_BUILD));
      if (liveBuild === CHAT_RELAY_MIN_APP_BUILD - 1) expect(rolledBack).toBe(CHAT_RELAY_MIN_APP_BUILD - 1);
    } finally {
      await db.delete(appUpdatesTable).where(eq(appUpdatesTable.id, optional.id));
      await db.update(appUpdatesTable)
        .set({ status: "published", buildNumber: CHAT_RELAY_MIN_APP_BUILD })
        .where(eq(appUpdatesTable.id, appUpdateId));
      if (recorded) {
        await db.update(appSettingsTable).set({ value: recorded.value }).where(eq(appSettingsTable.key, APP_MIN_SUPPORTED_BUILD_KEY));
      } else {
        await db.delete(appSettingsTable).where(eq(appSettingsTable.key, APP_MIN_SUPPORTED_BUILD_KEY));
      }
    }
  });
});
