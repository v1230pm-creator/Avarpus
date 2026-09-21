// ── Chat message notifications ───────────────────────────────────────────────
// Runs after a chat message row has been committed. Writes one inbox row per
// recipient and lets the push layer copy it to the recipient's devices. The
// message row is the record; nothing here can fail the send that produced it.
//
// Who is notified: every other member of the room, minus anyone who muted the
// room, minus anyone in a block relationship with the sender in either
// direction. The send route already refuses blocked direct sends, but this
// re-checks so a block created between the route's check and this hook, or a
// group room containing a blocked pair, still never buzzes the blocked party.

import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  chatBlocksTable,
  chatMessagesTable,
  chatReadStateTable,
  chatRoomMembersTable,
  chatRoomPreferencesTable,
  chatRoomsTable,
  db,
} from "@workspace/db";
import { notifyUser } from "./notify";

export const CHAT_MESSAGE_PREVIEW_LENGTH = 160;

export type ChatMessageKind = "text" | "image" | "video" | "audio" | "file" | string;

// The push/inbox body for a message. Media never leaks a file name into a lock
// screen; a text message carries its first characters.
export function chatMessagePreview(kind: ChatMessageKind, body: string | null | undefined): string {
  switch (kind) {
    case "image":
      return "📷 Photo";
    case "audio":
      return "🎤 Voice message";
    case "video":
      return "🎥 Video";
    case "file":
      return "📎 File";
    default: {
      const text = (body ?? "").replace(/\s+/g, " ").trim();
      return text.length > CHAT_MESSAGE_PREVIEW_LENGTH
        ? `${text.slice(0, CHAT_MESSAGE_PREVIEW_LENGTH - 1)}…`
        : text;
    }
  }
}

export async function getRoomRecipientUserIds(
  roomId: string,
  senderUserId: string,
): Promise<string[]> {
  const recipients = await db
    .select({ userId: chatRoomMembersTable.userId })
    .from(chatRoomMembersTable)
    .leftJoin(
      chatRoomPreferencesTable,
      and(
        eq(chatRoomPreferencesTable.roomId, chatRoomMembersTable.roomId),
        eq(chatRoomPreferencesTable.userId, chatRoomMembersTable.userId),
      ),
    )
    .where(
      and(
        eq(chatRoomMembersTable.roomId, roomId),
        ne(chatRoomMembersTable.userId, senderUserId),
        or(
          isNull(chatRoomPreferencesTable.id),
          eq(chatRoomPreferencesTable.isMuted, false),
        ),
      ),
    );
  const candidates = [...new Set(recipients.map((recipient) => recipient.userId))];
  if (candidates.length === 0) return [];

  const blocks = await db
    .select({
      blockerUserId: chatBlocksTable.blockerUserId,
      blockedUserId: chatBlocksTable.blockedUserId,
    })
    .from(chatBlocksTable)
    .where(
      or(
        and(
          eq(chatBlocksTable.blockerUserId, senderUserId),
          inArray(chatBlocksTable.blockedUserId, candidates),
        ),
        and(
          eq(chatBlocksTable.blockedUserId, senderUserId),
          inArray(chatBlocksTable.blockerUserId, candidates),
        ),
      ),
    );
  const blocked = new Set<string>();
  for (const block of blocks) {
    blocked.add(block.blockerUserId === senderUserId ? block.blockedUserId : block.blockerUserId);
  }
  return candidates.filter((userId) => !blocked.has(userId));
}

// Unread counts for one recipient: in this thread (for "3 new messages" when
// previews are off) and across the inbox (for the app icon badge). Mirrors the
// per-room formula the room list uses: incoming, not deleted, newer than the
// viewer's last read (or join) in that room. The badge counts customer and
// direct rooms — the same set the Chats tab badge counts — and skips rooms the
// viewer deleted from their inbox.
export async function chatUnreadCountsFor(
  userId: string,
  roomId: string,
): Promise<{ thread: number; total: number }> {
  const readState = db
    .select({
      roomId: chatReadStateTable.roomId,
      lastReadAt: chatReadStateTable.lastReadAt,
    })
    .from(chatReadStateTable)
    .where(eq(chatReadStateTable.userId, userId))
    .as("viewer_read_state");
  const rows = await db
    .select({
      roomId: chatMessagesTable.roomId,
      value: sql<number>`count(*)`,
    })
    .from(chatMessagesTable)
    .innerJoin(
      chatRoomMembersTable,
      and(
        eq(chatRoomMembersTable.roomId, chatMessagesTable.roomId),
        eq(chatRoomMembersTable.userId, userId),
      ),
    )
    .innerJoin(chatRoomsTable, eq(chatRoomsTable.id, chatMessagesTable.roomId))
    .leftJoin(readState, eq(readState.roomId, chatMessagesTable.roomId))
    .leftJoin(
      chatRoomPreferencesTable,
      and(
        eq(chatRoomPreferencesTable.roomId, chatMessagesTable.roomId),
        eq(chatRoomPreferencesTable.userId, userId),
      ),
    )
    .where(
      and(
        ne(chatMessagesTable.senderId, userId),
        isNull(chatMessagesTable.deletedAt),
        isNull(chatRoomPreferencesTable.deletedAt),
        inArray(chatRoomsTable.kind, ["customer", "direct"]),
        gte(
          chatMessagesTable.createdAt,
          sql`coalesce(${readState.lastReadAt}, ${chatRoomMembersTable.joinedAt})`,
        ),
      ),
    )
    .groupBy(chatMessagesTable.roomId);
  let thread = 0;
  let total = 0;
  for (const row of rows) {
    const n = Number(row.value ?? 0);
    total += n;
    if (row.roomId === roomId) thread = n;
  }
  return { thread, total };
}

export async function notifyRoomMessageRecipients(input: {
  roomId: string;
  shopId: string | null;
  messageId: string;
  senderId: string;
  senderName: string;
  preview: string;
}): Promise<void> {
  try {
    const recipientUserIds = await getRoomRecipientUserIds(input.roomId, input.senderId);
    await Promise.all(
      recipientUserIds.map(async (recipientUserId) => {
        const unread = await chatUnreadCountsFor(recipientUserId, input.roomId).catch(() => ({
          thread: 1,
          total: undefined as number | undefined,
        }));
        await notifyUser({
          userId: recipientUserId,
          shopId: input.shopId,
          type: "chat_message",
          // Title is the sender's display name, exactly as a messaging app
          // shows it; the body is the preview (or a neutral count when the
          // recipient hides previews — applied by the push layer).
          title: input.senderName,
          body: input.preview.slice(0, CHAT_MESSAGE_PREVIEW_LENGTH),
          data: {
            roomId: input.roomId,
            chatId: input.roomId,
            conversationId: input.roomId,
            messageId: input.messageId,
            senderId: input.senderId,
            receiverId: recipientUserId,
            senderName: input.senderName,
          },
          dedupeKey: `chat-message:${input.messageId}:${recipientUserId}`,
          badge: unread.total,
          threadUnread: unread.thread,
        });
      }),
    );
  } catch (error) {
    console.error("notifyRoomMessageRecipients failed:", error);
  }
}
