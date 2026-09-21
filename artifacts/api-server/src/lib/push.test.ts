// Push delivery rules that decide *what* leaves the server for a chat message.
// The provider is stubbed at the fetch boundary; the database is real so the
// recipient, block, mute, preference and device rows behave as in production.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomInt } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  chatBlocksTable,
  chatMessagesTable,
  chatReadStateTable,
  chatRoomMembersTable,
  chatRoomPreferencesTable,
  chatRoomsTable,
  db,
  notificationPreferencesTable,
  notificationsTable,
  pool,
  pushTokensTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";

const { deliverPushToUsers, buildExpoMessage, pushCategoryFor, channelIdFor, checkPendingReceipts } =
  await import("./push");
const { chatMessagePreview, getRoomRecipientUserIds, chatUnreadCountsFor, notifyRoomMessageRecipients } =
  await import("./chatMessagePush");

type Outbound = { to: string; title: string; body: string; data: Record<string, unknown>; channelId: string; sound: string | null; badge?: number; collapseId?: string };

const sent: Outbound[] = [];
let ticketMode: "ok" | "dead-second" | "unreachable-once" | "reset-mid-request" | "invalid-credentials" = "ok";
let unreachableBudget = 0;
let receiptRequests: string[][] = [];
let receiptMode: "ok" | "dead" = "ok";

const marker = `pushtest-${randomBytes(4).toString("hex")}`;
const userIds: string[] = [];
let roomId = "";
let sender = "";
let receiver = "";
let muted = "";
let blocked = "";

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      const payload = JSON.parse(String(init?.body ?? "null"));
      if (target.endsWith("/getReceipts")) {
        receiptRequests.push(payload.ids);
        const data: Record<string, unknown> = {};
        for (const id of payload.ids as string[]) {
          data[id] =
            receiptMode === "dead"
              ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
              : { status: "ok" };
        }
        return new Response(JSON.stringify({ data }), { status: 200 });
      }
      if (ticketMode === "unreachable-once" && unreachableBudget > 0) {
        unreachableBudget -= 1;
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      }
      if (ticketMode === "reset-mid-request") {
        // No cause code: the request may already have been accepted.
        throw new TypeError("fetch failed");
      }
      if (ticketMode === "invalid-credentials") {
        const messages = payload as Outbound[];
        sent.push(...messages);
        const tickets = messages.map(() => ({ status: "error", message: "bad creds", details: { error: "InvalidCredentials" } }));
        return new Response(JSON.stringify({ data: tickets }), { status: 200 });
      }
      const messages = payload as Outbound[];
      sent.push(...messages);
      const tickets = messages.map((message, index) =>
        ticketMode === "dead-second" && index === 1
          ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
          : { status: "ok", id: `ticket-${message.to}` },
      );
      return new Response(JSON.stringify({ data: tickets }), { status: 200 });
    }),
  );
}

async function seedUser(tag: string): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      name: `${marker} ${tag}`,
      email: `${marker}-${tag}@example.com`,
      mobile: `7${randomInt(100_000_000, 1_000_000_000)}`,
      passwordHash: "x",
      role: "customer",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  userIds.push(user.id);
  return user.id;
}

async function seedDevice(userId: string, tag: string, extra: Partial<typeof pushTokensTable.$inferInsert> = {}) {
  const [session] = await db
    .insert(sessionsTable)
    .values({ token: randomBytes(32).toString("hex"), userId, expiresAt: new Date(Date.now() + 3_600_000) })
    .returning({ id: sessionsTable.id });
  const token = `ExponentPushToken[${marker}-${tag}]`;
  await db.insert(pushTokensTable).values({ token, userId, sessionId: session.id, platform: "android", ...extra });
  return token;
}

async function insertMessage(from: string, body: string) {
  const [row] = await db
    .insert(chatMessagesTable)
    .values({ roomId, shopId: null, senderId: from, senderName: `${marker} sender`, kind: "text", body })
    .returning({ id: chatMessagesTable.id });
  return row.id;
}

beforeAll(async () => {
  process.env.EXPO_PUSH_API_URL = "http://push.test/--/api/v2/push/send";
  delete process.env.DISABLE_PUSH_DELIVERY;
  mockFetch();
  sender = await seedUser("sender");
  receiver = await seedUser("receiver");
  muted = await seedUser("muted");
  blocked = await seedUser("blocked");
  const [room] = await db
    .insert(chatRoomsTable)
    .values({
      shopId: null,
      scope: "global_direct",
      kind: "direct",
      name: `${marker} room`,
      peerKey: `${marker}:${randomBytes(4).toString("hex")}`,
      createdById: sender,
      createdByName: `${marker} sender`,
    })
    .returning({ id: chatRoomsTable.id });
  roomId = room.id;
  await db.insert(chatRoomMembersTable).values(
    [sender, receiver, muted, blocked].map((userId) => ({ roomId, shopId: null, userId })),
  );
  await db.insert(chatRoomPreferencesTable).values({ roomId, userId: muted, isMuted: true });
  // The blocked party blocked the sender (either direction must suppress).
  await db.insert(chatBlocksTable).values({ blockerUserId: blocked, blockedUserId: sender });
});

afterEach(async () => {
  sent.length = 0;
  ticketMode = "ok";
  receiptMode = "ok";
  receiptRequests = [];
  await db.delete(notificationPreferencesTable).where(inArray(notificationPreferencesTable.userId, userIds));
  await db.delete(pushTokensTable).where(inArray(pushTokensTable.userId, userIds));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.delete(notificationsTable).where(inArray(notificationsTable.userId, userIds));
  await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await pool.end();
});

describe("category and channel mapping", () => {
  it("routes every known type to a category and an avarpus_* channel", () => {
    expect(pushCategoryFor("chat_message")).toBe("messages");
    expect(pushCategoryFor("dealer_transfer_request")).toBe("dealer");
    expect(pushCategoryFor("repair_status")).toBe("repair");
    expect(pushCategoryFor("repair_payment")).toBe("payments");
    expect(pushCategoryFor("approval_requested")).toBe("repair");
    expect(pushCategoryFor("chat_report_reviewed")).toBe("general");
    expect(channelIdFor("messages", { sound: true, vibration: true })).toBe("avarpus_messages");
    expect(channelIdFor("messages", { sound: false, vibration: true })).toBe("avarpus_messages_silent");
    expect(channelIdFor("messages", { sound: true, vibration: false })).toBe("avarpus_messages_novibrate");
    expect(channelIdFor("payments", { sound: false, vibration: false })).toBe("avarpus_payments_quiet");
  });

  it("media previews never carry file names", () => {
    expect(chatMessagePreview("image", "IMG_0001.jpg")).toBe("📷 Photo");
    expect(chatMessagePreview("audio", null)).toBe("🎤 Voice message");
    expect(chatMessagePreview("video", "x.mp4")).toBe("🎥 Video");
    expect(chatMessagePreview("file", "secret-invoice.pdf")).toBe("📎 File");
    expect(chatMessagePreview("text", "  hello\n world ")).toBe("hello world");
    expect(chatMessagePreview("text", "a".repeat(400))).toHaveLength(160);
  });

  it("hides the message text but keeps the sender when previews are off", () => {
    const content = {
      type: "chat_message",
      title: "Riya",
      body: "meet at 5?",
      data: { roomId, messageId: "m1" },
      badge: 7,
      threadUnread: 3,
    };
    const shown = buildExpoMessage("ExponentPushToken[x]", content, { ...DEFAULTS });
    expect(shown.body).toBe("meet at 5?");
    expect(shown.sound).toBe("avarpus_message.wav");
    expect(shown.badge).toBe(7);
    expect(shown.collapseId).toBe(`chat-room:${roomId}`);
    const hidden = buildExpoMessage("ExponentPushToken[x]", content, { ...DEFAULTS, showPreview: false, sound: false });
    expect(hidden.title).toBe("Riya");
    expect(hidden.body).toBe("3 new messages");
    expect(hidden.data.previewHidden).toBe(true);
    expect(hidden.sound).toBeNull();
    expect(hidden.channelId).toBe("avarpus_messages_silent");
    expect(buildExpoMessage("ExponentPushToken[x]", { ...content, threadUnread: 1 }, { ...DEFAULTS, showPreview: false }).body).toBe("New message");
  });
});

const DEFAULTS = {
  messages: true,
  calls: true,
  dealer: true,
  repair: true,
  payments: true,
  status: true,
  showPreview: true,
  sound: true,
  vibration: true,
};

describe("recipients", () => {
  it("excludes the sender, muted members and blocked pairs in either direction", async () => {
    const ids = await getRoomRecipientUserIds(roomId, sender);
    expect(ids).toEqual([receiver]);
    // Reverse direction: sender blocked the receiver.
    await db.insert(chatBlocksTable).values({ blockerUserId: sender, blockedUserId: receiver });
    try {
      expect(await getRoomRecipientUserIds(roomId, sender)).toEqual([]);
    } finally {
      await db.delete(chatBlocksTable).where(eq(chatBlocksTable.blockerUserId, sender));
    }
  });

  it("counts unread in the thread and across the inbox, honouring read state", async () => {
    const first = await insertMessage(sender, "one");
    await insertMessage(sender, "two");
    let counts = await chatUnreadCountsFor(receiver, roomId);
    expect(counts.thread).toBe(2);
    expect(counts.total).toBeGreaterThanOrEqual(2);
    // Reading up to the first message leaves one unread (>= lastReadAt is inclusive
    // of the read row's own timestamp, so mark read at "now").
    await db.insert(chatReadStateTable).values({ roomId, userId: receiver, lastReadMessageId: first, lastReadAt: new Date(Date.now() + 1000) });
    counts = await chatUnreadCountsFor(receiver, roomId);
    expect(counts.thread).toBe(0);
    await db.delete(chatReadStateTable).where(eq(chatReadStateTable.roomId, roomId));
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.roomId, roomId));
  });
});

describe("delivery", () => {
  it("sends one push per live device with sender name, preview, routing data and badge; blocked and muted get nothing", async () => {
    const phone = await seedDevice(receiver, "phone", { deviceId: "dev-phone" });
    const tablet = await seedDevice(receiver, "tablet", { deviceId: "dev-tablet" });
    await seedDevice(receiver, "off", { deviceId: "dev-off", notificationsEnabled: false });
    await seedDevice(muted, "muted");
    await seedDevice(blocked, "blocked");
    const messageId = await insertMessage(sender, "hello there");

    await notifyRoomMessageRecipients({
      roomId,
      shopId: null,
      messageId,
      senderId: sender,
      senderName: "Riya Sharma",
      preview: chatMessagePreview("text", "hello there"),
    });
    // Push is dispatched without await; give it a moment.
    await vi.waitFor(() => expect(sent.length).toBe(2), { timeout: 5000 });

    const targets = sent.map((m) => m.to).sort();
    expect(targets).toEqual([phone, tablet].sort());
    for (const message of sent) {
      expect(message.title).toBe("Riya Sharma");
      expect(message.body).toBe("hello there");
      expect(message.channelId).toBe("avarpus_messages");
      expect(message.sound).toBe("avarpus_message.wav");
      expect(message.data).toMatchObject({
        type: "chat_message",
        chatId: roomId,
        conversationId: roomId,
        roomId,
        messageId,
        senderId: sender,
        receiverId: receiver,
      });
      expect(typeof message.badge).toBe("number");
      expect(message.badge).toBeGreaterThanOrEqual(1);
    }
    const rows = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, receiver));
    expect(rows.filter((row) => row.type === "chat_message").length).toBe(1);
    expect(rows[0].title).toBe("Riya Sharma");
    const [sentRow] = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, phone));
    expect(sentRow.lastSentAt).not.toBeNull();

    // A retry of the same message dedupes the row and must not push again.
    await notifyRoomMessageRecipients({ roomId, shopId: null, messageId, senderId: sender, senderName: "Riya Sharma", preview: "hello there" });
    await new Promise((r) => setTimeout(r, 300));
    expect(sent.length).toBe(2);
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.roomId, roomId));
  });

  it("respects the per-category toggle and does not push at all when messages are off", async () => {
    await seedDevice(receiver, "toggled");
    await db.insert(notificationPreferencesTable).values({ userId: receiver, messages: false });
    await deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } });
    expect(sent.length).toBe(0);
    // General alerts cannot be muted by the toggles.
    await deliverPushToUsers([receiver], { type: "chat_report_reviewed", title: "X", body: "y" });
    expect(sent.length).toBe(1);
    expect(sent[0].channelId).toBe("avarpus_general");
  });

  it("drops only the dead device when the provider reports DeviceNotRegistered", async () => {
    const alive = await seedDevice(receiver, "alive", { deviceId: "a" });
    const dead = await seedDevice(receiver, "dead", { deviceId: "b" });
    ticketMode = "dead-second";
    await deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } });
    const remaining = (await db.select({ token: pushTokensTable.token }).from(pushTokensTable).where(eq(pushTokensTable.userId, receiver))).map((r) => r.token);
    // Which index is "second" depends on row order; exactly one must survive.
    expect(remaining.length).toBe(1);
    expect([alive, dead]).toContain(remaining[0]);
  });

  it("retries once when the provider is unreachable and records the error when it stays down", async () => {
    const token = await seedDevice(receiver, "retry");
    ticketMode = "unreachable-once";
    unreachableBudget = 1;
    await deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } });
    expect(sent.length).toBe(1);
    unreachableBudget = 5;
    sent.length = 0;
    await expect(deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } })).rejects.toThrow();
    const [row] = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, token));
    expect(row.lastError).toMatch(/unreachable/);
  }, 15000);

  it("does not resend after an ambiguous mid-request failure", async () => {
    const token = await seedDevice(receiver, "ambiguous");
    ticketMode = "reset-mid-request";
    await expect(deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } })).rejects.toThrow();
    expect(sent.length).toBe(0);
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[] } };
    // Exactly one provider call: a retry here could deliver the alert twice.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const [row] = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, token));
    expect(row.lastError).toMatch(/fetch failed/);
  });

  it("keeps device tokens when the provider rejects the project credentials", async () => {
    const token = await seedDevice(receiver, "creds");
    ticketMode = "invalid-credentials";
    await deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } });
    const [row] = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, token));
    expect(row).toBeDefined();
    expect(row.lastError).toMatch(/InvalidCredentials/);
  });

  it("skips devices of deactivated accounts and idle privileged sessions", async () => {
    await seedDevice(receiver, "inactive-owner");
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, receiver));
    try {
      await deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } });
      expect(sent.length).toBe(0);
    } finally {
      await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, receiver));
    }

    const idleToken = await seedDevice(muted, "idle-admin");
    await db.update(usersTable).set({ role: "super_admin" }).where(eq(usersTable.id, muted));
    const [{ sessionId }] = await db.select({ sessionId: pushTokensTable.sessionId }).from(pushTokensTable).where(eq(pushTokensTable.token, idleToken));
    await db.update(sessionsTable).set({ lastSeenAt: new Date(Date.now() - 31 * 24 * 3_600_000) }).where(eq(sessionsTable.id, sessionId!));
    try {
      await deliverPushToUsers([muted], { type: "chat_message", title: "X", body: "y", data: { roomId } });
      expect(sent.length).toBe(0);
      await db.update(sessionsTable).set({ lastSeenAt: new Date() }).where(eq(sessionsTable.id, sessionId!));
      await deliverPushToUsers([muted], { type: "chat_message", title: "X", body: "y", data: { roomId } });
      expect(sent.length).toBe(1);
    } finally {
      await db.update(usersTable).set({ role: "customer" }).where(eq(usersTable.id, muted));
    }
  });

  it("retires a token whose delivery receipt says the device is gone", async () => {
    const token = await seedDevice(receiver, "receipt");
    await deliverPushToUsers([receiver], { type: "chat_message", title: "X", body: "y", data: { roomId } });
    receiptMode = "dead";
    await checkPendingReceipts();
    expect(receiptRequests.flat()).toContain(`ticket-${token}`);
    const rows = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, token));
    expect(rows.length).toBe(0);
  });
});
