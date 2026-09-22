import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appSettingsTable,
  chatMessageReceiptsTable,
  chatMessagesTable,
  chatRoomMembersTable,
  chatRoomsTable,
  CHAT_RECEIPT_PRUNE_LAST_RUN_KEY,
  db,
  usersTable,
} from "@workspace/db";
import {
  CHAT_RECEIPT_RETENTION_DAYS,
  pruneChatMessageReceipts,
} from "./chatReceiptRetention";

const DAY_MS = 24 * 60 * 60 * 1000;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let senderId = "";
let recipientId = "";
let roomId = "";
const messageIds: string[] = [];

type MessageOpts = {
  /** Age of the message and (by default) of its receipt, in days. */
  ageDays: number;
  /** Receipt age in days when it should differ from the message age. */
  receiptAgeDays?: number;
  media?: boolean;
  mediaState?: "available" | "purged" | "expired";
  pinned?: boolean;
  deleted?: boolean;
  /** Skip the receipt entirely. */
  withoutReceipt?: boolean;
};

async function insertMessage(opts: MessageOpts) {
  const createdAt = new Date(Date.now() - opts.ageDays * DAY_MS);
  const [message] = await db.insert(chatMessagesTable).values({
    roomId,
    senderId,
    senderName: "Receipt Sender",
    kind: opts.media ? "image" : "text",
    body: opts.media ? "photo.jpg" : `hello ${randomUUID()}`,
    objectPath: opts.media ? `/objects/uploads/global/chat/${roomId}/${randomUUID()}` : null,
    mimeType: opts.media ? "image/jpeg" : null,
    sizeBytes: opts.media ? 1234 : null,
    clientRequestId: `receipt-${randomUUID()}`,
    mediaState: opts.mediaState ?? "available",
    mediaPinned: opts.pinned ?? false,
    deletedAt: opts.deleted ? new Date() : null,
    createdAt,
    updatedAt: createdAt,
  }).returning();
  messageIds.push(message.id);
  if (!opts.withoutReceipt) {
    const receiptAt = new Date(Date.now() - (opts.receiptAgeDays ?? opts.ageDays) * DAY_MS);
    await db.insert(chatMessageReceiptsTable).values({
      messageId: message.id,
      roomId,
      userId: recipientId,
      deliveredAt: receiptAt,
      storedAt: opts.media ? receiptAt : null,
      updatedAt: receiptAt,
    });
  }
  return message.id;
}

async function hasReceipt(messageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: chatMessageReceiptsTable.id })
    .from(chatMessageReceiptsTable)
    .where(eq(chatMessageReceiptsTable.messageId, messageId));
  return rows.length > 0;
}

describe.sequential("Chat receipt retention", () => {
  beforeAll(async () => {
    const [sender] = await db.insert(usersTable).values({
      name: "Receipt Sender",
      email: `receipt-sender-${suffix}@example.test`,
      mobile: `76${suffix.replace(/\D/g, "").slice(-8).padStart(8, "1")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    const [recipient] = await db.insert(usersTable).values({
      name: "Receipt Recipient",
      email: `receipt-recipient-${suffix}@example.test`,
      mobile: `75${suffix.replace(/\D/g, "").slice(-8).padStart(8, "2")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    senderId = sender.id;
    recipientId = recipient.id;
    const [room] = await db.insert(chatRoomsTable).values({
      scope: "global_direct",
      kind: "direct",
      name: "Receipt retention test",
      createdById: sender.id,
      createdByName: sender.name,
    }).returning();
    roomId = room.id;
    await db.insert(chatRoomMembersTable).values([
      { roomId, userId: senderId },
      { roomId, userId: recipientId },
    ]);
  });

  afterAll(async () => {
    if (messageIds.length) {
      await db.delete(chatMessagesTable).where(inArray(chatMessagesTable.id, messageIds));
    }
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    await db.delete(usersTable).where(inArray(usersTable.id, [senderId, recipientId]));
  });

  it("drops aged receipts on text and on settled media, keeps everything the relay purge or a fresh sender still needs", async () => {
    const old = CHAT_RECEIPT_RETENTION_DAYS + 5;
    const agedText = await insertMessage({ ageDays: old });
    const agedPurged = await insertMessage({ ageDays: old, media: true, mediaState: "purged" });
    const agedExpired = await insertMessage({ ageDays: old, media: true, mediaState: "expired" });
    // Relay copy still available: the purge decides from this receipt.
    const agedAvailable = await insertMessage({ ageDays: old, media: true, mediaState: "available" });
    // Pinned evidence keeps its receipts (state stays available while pinned).
    const agedPinned = await insertMessage({ ageDays: old, media: true, mediaState: "available", pinned: true });
    // Within the window: a sender device may still be waiting to sync it.
    const freshText = await insertMessage({ ageDays: 3 });
    const freshPurged = await insertMessage({ ageDays: 3, media: true, mediaState: "purged" });
    // Old message, receipt written recently by the read backfill: protected
    // by the receipt's own age, not the message's.
    const lateRead = await insertMessage({ ageDays: old, receiptAgeDays: 2 });
    // Just past the window is old enough.
    const boundary = await insertMessage({ ageDays: CHAT_RECEIPT_RETENTION_DAYS + 1 });
    const justInside = await insertMessage({ ageDays: CHAT_RECEIPT_RETENTION_DAYS - 1 });

    const result = await pruneChatMessageReceipts({ roomIds: [roomId] });

    expect(result.retentionDays).toBe(CHAT_RECEIPT_RETENTION_DAYS);
    expect(result.deleted).toBe(4);
    expect(result.aged).toBe(4);
    expect(result.tombstoned).toBe(0);
    expect(result.capped).toBe(false);

    expect(await hasReceipt(agedText)).toBe(false);
    expect(await hasReceipt(agedPurged)).toBe(false);
    expect(await hasReceipt(agedExpired)).toBe(false);
    expect(await hasReceipt(boundary)).toBe(false);

    expect(await hasReceipt(agedAvailable)).toBe(true);
    expect(await hasReceipt(agedPinned)).toBe(true);
    expect(await hasReceipt(freshText)).toBe(true);
    expect(await hasReceipt(freshPurged)).toBe(true);
    expect(await hasReceipt(lateRead)).toBe(true);
    expect(await hasReceipt(justInside)).toBe(true);
  });

  it("drops receipts on delete-for-everyone tombstones at any age, unless the relay copy is still available", async () => {
    const freshTombText = await insertMessage({ ageDays: 0, deleted: true });
    const freshTombPurged = await insertMessage({ ageDays: 0, media: true, mediaState: "purged", deleted: true });
    // Tombstone whose relay copy has not been removed yet (e.g. pinned under a
    // report, or the immediate delete failed and the sweep has not caught up).
    const tombStillAvailable = await insertMessage({ ageDays: 0, media: true, mediaState: "available", deleted: true });

    const result = await pruneChatMessageReceipts({ roomIds: [roomId] });

    expect(result.deleted).toBe(2);
    expect(result.tombstoned).toBe(2);
    expect(result.aged).toBe(0);
    expect(await hasReceipt(freshTombText)).toBe(false);
    expect(await hasReceipt(freshTombPurged)).toBe(false);
    expect(await hasReceipt(tombStillAvailable)).toBe(true);
  });

  it("walks in bounded batches and reports when it stops at the per-run cap", async () => {
    const old = CHAT_RECEIPT_RETENTION_DAYS + 10;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await insertMessage({ ageDays: old }));

    const capped = await pruneChatMessageReceipts({ roomIds: [roomId], batchSize: 2, maxRows: 3 });
    expect(capped.deleted).toBe(3);
    expect(capped.batches).toBe(2);
    expect(capped.capped).toBe(true);

    const rest = await pruneChatMessageReceipts({ roomIds: [roomId], batchSize: 2 });
    expect(rest.deleted).toBe(2);
    expect(rest.capped).toBe(false);
    for (const id of ids) expect(await hasReceipt(id)).toBe(false);

    const idle = await pruneChatMessageReceipts({ roomIds: [roomId] });
    expect(idle.deleted).toBe(0);
    expect(idle.batches).toBe(0);
  });

  it("honours a custom retention window and rejects nonsense", async () => {
    const twenty = await insertMessage({ ageDays: 20 });
    const five = await insertMessage({ ageDays: 5 });
    const result = await pruneChatMessageReceipts({ roomIds: [roomId], retentionDays: 10 });
    expect(result.retentionDays).toBe(10);
    expect(await hasReceipt(twenty)).toBe(false);
    expect(await hasReceipt(five)).toBe(true);

    await expect(pruneChatMessageReceipts({ roomIds: [roomId], retentionDays: 0 })).rejects.toThrow();
    await expect(pruneChatMessageReceipts({ roomIds: [roomId], retentionDays: 1.5 })).rejects.toThrow();
  });

  it("re-created receipts on a settled message age out again instead of being refused", async () => {
    // A late `stored` ack after a prune inserts a fresh row; it is harmless and
    // simply falls under the same rule once it is old enough.
    const settled = await insertMessage({ ageDays: CHAT_RECEIPT_RETENTION_DAYS + 3, media: true, mediaState: "purged" });
    await pruneChatMessageReceipts({ roomIds: [roomId] });
    expect(await hasReceipt(settled)).toBe(false);
    await db.insert(chatMessageReceiptsTable).values({ messageId: settled, roomId, userId: recipientId, storedAt: new Date() });
    await pruneChatMessageReceipts({ roomIds: [roomId] });
    expect(await hasReceipt(settled)).toBe(true);
  });

  it("records a whole-table run for operators but not a room-scoped one", async () => {
    const [before] = await db
      .select({ value: appSettingsTable.value, updatedAt: appSettingsTable.updatedAt })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, CHAT_RECEIPT_PRUNE_LAST_RUN_KEY));
    const scoped = await pruneChatMessageReceipts({ roomIds: [roomId] });
    const [afterScoped] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, CHAT_RECEIPT_PRUNE_LAST_RUN_KEY));
    expect(afterScoped?.value ?? null).toBe(before?.value ?? null);

    // A whole-table run against the shared database: cap it so the test stays
    // cheap, then check the record reflects this run.
    const whole = await pruneChatMessageReceipts({ maxRows: 1, batchSize: 1 });
    const [afterWhole] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, CHAT_RECEIPT_PRUNE_LAST_RUN_KEY));
    expect(afterWhole).toBeDefined();
    const recorded = JSON.parse(afterWhole!.value);
    expect(recorded.ranAt).toBe(whole.ranAt);
    expect(recorded.deleted).toBe(whole.deleted);
    expect(scoped.deleted).toBe(0);
  });
});
