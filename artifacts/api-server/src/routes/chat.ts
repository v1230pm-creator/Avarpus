/**
 * Chat routes: rooms, messages, read markers, upload URLs, call tokens,
 * media download. Customer invite issuance and activation.
 *
 * Authorization rules (fail-closed):
 *   - All endpoints require authentication.
 *   - Customer users (role "customer") may only access rooms they are members of.
 *   - Dealer-portal users may only access rooms in their own dealer's shop.
 *   - Staff/dealer users may only access rooms in their own shop.
 *   - An unauthorized or absent room ID always returns 404 (never 403).
 *
 * Room creation policy (fail-closed):
 *   - Matrix MUST be configured. If not → 503 MATRIX_UNAVAILABLE, zero DB writes.
 *   - A memberless reservation protects each participant pair before Matrix
 *     work begins. It is never visible as a room. Ambiguous Matrix attempts
 *     retain that reservation rather than risk a duplicate remote room.
 *   - Matrix provisioning has a hard upper deadline (default 5 seconds,
 *     clamped to 100ms–10s with MATRIX_PROVISION_TIMEOUT_MS). The provider
 *     call runs outside a DB transaction so an outage cannot pin pool slots.
 *
 * Message delivery policy (fail-closed):
 *   - The Matrix send happens BEFORE the local DB write. If Matrix fails,
 *     no row is written and the caller receives 503.
 *   - The capabilities endpoint honestly reflects Matrix/LiveKit availability.
 *
 * Media download policy:
 *   - GET /chat/rooms/:roomId/messages/:messageId/media authorises room
 *     membership, verifies the message objectPath is under the chat namespace,
 *     and streams directly from object storage. Generic /storage/objects/* is
 *     NOT accessible to customer accounts.
 */

import { Readable } from "stream";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  customersTable,
  customerUsersTable,
  customerInvitesTable,
  dealersTable,
  chatRoomsTable,
  chatRoomMembersTable,
  chatRoomPreferencesTable,
  chatMessagesTable,
  chatMessageHiddenTable,
  chatBlocksTable,
  chatReportsTable,
  chatReadStateTable,
  chatProviderIdentitiesTable,
  chatContactMatchGrantsTable,
  chatContactMatchAttemptsTable,
  type DbUser,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { lockNormalizedMobiles } from "../lib/mobileIdentityLock";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  chatCapabilities,
  livekitConfigured,
  livekitMintToken,
  matrixConfigured,
  matrixProvisionDirectRoom,
  matrixProvisionTimeoutMs,
  matrixSendMessage,
  matrixRedactEvent,
  describeProviderError,
  matrixUserIdForApp,
  matrixTxnId,
} from "../lib/chatProviders";
import {
  AuthActivateInviteBody,
  ChatContactsMatchBody,
  ChatMarkReadBody,
  ChatMessagesDeleteBody,
  ChatMessagesSendBody,
  ChatMyReportListQueryParams,
  ChatReportsCreateBody,
  ChatRoomsCreateBody,
  ChatRoomsPreferencesUpdateBody,
  ChatUploadUrlBody,
} from "@workspace/api-zod";
import { generateToken, sha256 } from "../lib/authUtils";
import { notifyUser } from "../lib/notify";
import { parseBody, uuidParam } from "../lib/validate";
import {
  claimPendingUpload,
  CHAT_PROVIDER_SEND_TIMEOUT_MS,
  completePendingUpload,
  refreshPendingUploadClaim,
  registerPendingUpload,
  releasePendingUpload,
} from "../lib/pendingUploads";

const router: IRouter = Router();
router.param("id", uuidParam);
router.param("roomId", uuidParam);
router.param("messageId", uuidParam);
const objectStorageService = new ObjectStorageService();

class MatchGrantError extends Error {}
class BlockedPairError extends Error {}

const ROOM_PROVISION_POLL_MS = 25;
type ChatRoom = typeof chatRoomsTable.$inferSelect;

function directRoomProvisionKey(scope: "shop" | "global_direct", peerKey: string): string {
  return sha256(`matrix-direct-room:v1:${scope}:${peerKey}`);
}

function provisionLeaseUntil(): Date {
  return new Date(Date.now() + matrixProvisionTimeoutMs());
}

/**
 * Wait only for a reservation already owned by another request. Each poll is an
 * independent query, so waiting for Matrix never holds a transaction or a pool
 * connection. A ready room always has both members by the time it is returned.
 */
async function waitForProvisionedRoom(
  roomId: string,
  maxWaitMs = matrixProvisionTimeoutMs(),
): Promise<typeof chatRoomsTable.$inferSelect | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() <= deadline) {
    const [room] = await db
      .select()
      .from(chatRoomsTable)
      .where(eq(chatRoomsTable.id, roomId))
      .limit(1);
    if (!room) return null;
    if (room.providerRoomId) return room;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(ROOM_PROVISION_POLL_MS, remaining)));
  }
  return null;
}

async function directRoomParticipants(room: ChatRoom): Promise<{
  initiator: { appUserId: string; displayName: string };
  target: { appUserId: string; displayName: string };
} | null> {
  const participantIds = room.peerKey?.split(":") ?? [];
  if (
    participantIds.length !== 2 ||
    new Set(participantIds).size !== 2 ||
    !room.createdById ||
    !participantIds.includes(room.createdById)
  ) {
    return null;
  }
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(inArray(usersTable.id, participantIds));
  const byId = new Map(users.map((user) => [user.id, user]));
  const initiator = byId.get(room.createdById);
  const targetId = participantIds.find((id) => id !== room.createdById);
  const target = targetId ? byId.get(targetId) : null;
  if (!initiator || !target) return null;
  return {
    initiator: { appUserId: initiator.id, displayName: initiator.name },
    target: { appUserId: target.id, displayName: target.name },
  };
}

/**
 * Provision an already-claimed reservation. Finalization is fenced by the
 * current attempt ID, so a worker that outlives its lease cannot write over a
 * subsequent recovery attempt.
 */
async function provisionClaimedDirectRoom(room: ChatRoom): Promise<ChatRoom | null> {
  if (!room.provisionKey || !room.provisionAttemptId) return null;
  const participants = await directRoomParticipants(room);
  if (!participants) return null;

  try {
    const provisioned = await matrixProvisionDirectRoom({
      name: room.name,
      topic: `Shop chat: ${room.name}`,
      provisionKey: room.provisionKey,
      initiator: participants.initiator,
      target: participants.target,
    });
    return await db.transaction(async (tx) => {
      const [finalized] = await tx
        .update(chatRoomsTable)
        .set({
          providerRoomId: provisioned.matrixRoomId,
          provisionLeaseUntil: null,
        })
        .where(
          and(
            eq(chatRoomsTable.id, room.id),
            eq(chatRoomsTable.provisionAttemptId, room.provisionAttemptId!),
            isNull(chatRoomsTable.providerRoomId),
          ),
        )
        .returning();
      if (!finalized) {
        return null;
      }
      await tx.insert(chatRoomMembersTable).values([
        { roomId: finalized.id, shopId: finalized.shopId, userId: participants.initiator.appUserId, role: "moderator" },
        { roomId: finalized.id, shopId: finalized.shopId, userId: participants.target.appUserId, role: "member" },
      ]);
      await tx
        .insert(chatProviderIdentitiesTable)
        .values([
          {
            userId: participants.initiator.appUserId,
            shopId: finalized.shopId,
            provider: "matrix",
            providerUserId: provisioned.initiatorUserId,
          },
          {
            userId: participants.target.appUserId,
            shopId: finalized.shopId,
            provider: "matrix",
            providerUserId: provisioned.targetUserId,
          },
        ])
        .onConflictDoNothing({
          target: [chatProviderIdentitiesTable.userId, chatProviderIdentitiesTable.provider],
        });
      return finalized;
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    // Registration is the only stage that proves Matrix did not receive a
    // create request. Other failures retain the keyed reservation for recovery.
    if (code === "MATRIX_ENSURE_FAILED" || code === "MATRIX_ENSURE_TIMEOUT") {
      await db
        .delete(chatRoomsTable)
        .where(
          and(
            eq(chatRoomsTable.id, room.id),
            eq(chatRoomsTable.provisionAttemptId, room.provisionAttemptId),
            isNull(chatRoomsTable.providerRoomId),
          ),
        );
    }
    console.error("[chat] Matrix room/participant provisioning failed:", describeProviderError(err));
    return null;
  }
}

/**
 * Resume a reservation left behind by another request or a crashed process.
 * The local lease limits redundant calls; the Matrix alias derived from
 * provisionKey makes an expired-lease takeover safe across processes.
 */
async function recoverReservedDirectRoom(room: ChatRoom): Promise<ChatRoom | null> {
  if (room.providerRoomId) return room;
  if (!room.provisionKey) return null; // Legacy ambiguous reservations stay fenced.

  const leaseRemaining = room.provisionLeaseUntil
    ? Math.max(0, room.provisionLeaseUntil.getTime() - Date.now())
    : 0;
  if (leaseRemaining > 0) {
    const ready = await waitForProvisionedRoom(room.id, leaseRemaining);
    if (ready) return ready;
  }

  const attemptId = randomUUID();
  const [claimed] = await db
    .update(chatRoomsTable)
    .set({ provisionAttemptId: attemptId, provisionLeaseUntil: provisionLeaseUntil() })
    .where(
      and(
        eq(chatRoomsTable.id, room.id),
        isNull(chatRoomsTable.providerRoomId),
        or(
          isNull(chatRoomsTable.provisionLeaseUntil),
          lt(chatRoomsTable.provisionLeaseUntil, new Date()),
        ),
      ),
    )
    .returning();
  if (!claimed) {
    return waitForProvisionedRoom(room.id, ROOM_PROVISION_POLL_MS * 2);
  }
  return provisionClaimedDirectRoom(claimed);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type AuthedRequest = Request & { user: DbUser };

// Roles that belong to internal shop staff (dealer / reception / tech / etc.)
const SHOP_STAFF_ROLES = [
  "dealer",
  "reception",
  "technician",
  "store_manager",
  "accountant",
  "super_admin",
] as const;

function isShopStaff(role: string): boolean {
  return (SHOP_STAFF_ROLES as readonly string[]).includes(role);
}

function isDealerPortal(role: string): boolean {
  return role === "dealer_owner" || role === "dealer_staff";
}

/** Resolve the shopId for any user type. Returns null when missing. */
function resolveShopId(user: DbUser): string | null {
  return user.shopId ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify that `user` is authorised to access `roomId`. Membership is REQUIRED
 * for EVERY role — there is no shop-wide staff bypass. A room is only visible
 * to users who have a chat_room_members row for it (and it must be in their
 * shop). Returns the room row on success, null on failure. Never throws —
 * callers render 404.
 */
async function authorizeRoom(
  user: DbUser,
  roomId: string,
): Promise<typeof chatRoomsTable.$inferSelect | null> {
  const shopId = resolveShopId(user);

  // Global direct rooms are membership-only. All business rooms additionally
  // require the caller's shop, preventing global accounts from seeing business data.
  const [row] = await db
    .select({ room: chatRoomsTable })
    .from(chatRoomsTable)
    .innerJoin(
      chatRoomMembersTable,
      eq(chatRoomMembersTable.roomId, chatRoomsTable.id),
    )
    .where(
      and(
        eq(chatRoomsTable.id, roomId),
        or(
          eq(chatRoomsTable.scope, "global_direct"),
          shopId ? and(eq(chatRoomsTable.scope, "shop"), eq(chatRoomsTable.shopId, shopId)) : sql`false`,
        ),
        eq(chatRoomMembersTable.userId, user.id),
      ),
    )
    .limit(1);

  return row?.room ?? null;
}

function blockedPairCondition(userA: string, userB: string) {
  return or(
    and(
      eq(chatBlocksTable.blockerUserId, userA),
      eq(chatBlocksTable.blockedUserId, userB),
    ),
    and(
      eq(chatBlocksTable.blockerUserId, userB),
      eq(chatBlocksTable.blockedUserId, userA),
    ),
  );
}

async function getBlockState(userA: string, userB: string) {
  const blocks = await db
    .select({
      blockerUserId: chatBlocksTable.blockerUserId,
    })
    .from(chatBlocksTable)
    .where(blockedPairCondition(userA, userB));
  return {
    isBlocked: blocks.length > 0,
    blockedByMe: blocks.some((block) => block.blockerUserId === userA),
  };
}

async function getDirectPeerUserId(
  room: typeof chatRoomsTable.$inferSelect,
  viewerUserId: string,
): Promise<string | null> {
  if (room.scope !== "global_direct" || room.kind !== "direct") return null;
  const [peer] = await db
    .select({ userId: chatRoomMembersTable.userId })
    .from(chatRoomMembersTable)
    .where(
      and(
        eq(chatRoomMembersTable.roomId, room.id),
        ne(chatRoomMembersTable.userId, viewerUserId),
      ),
    )
    .limit(1);
  return peer?.userId ?? null;
}

async function getRoomRecipientUserIds(roomId: string, senderUserId: string): Promise<string[]> {
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
  return [...new Set(recipients.map((recipient) => recipient.userId))];
}

async function notifyRoomMessageRecipients(input: {
  roomId: string;
  shopId: string | null;
  messageId: string;
  senderId: string;
  senderName: string;
  preview: string;
}): Promise<void> {
  try {
    const recipientUserIds = await getRoomRecipientUserIds(input.roomId, input.senderId);
    for (const recipientUserId of recipientUserIds) {
      void notifyUser({
        userId: recipientUserId,
        shopId: input.shopId,
        type: "chat_message",
        title: `New message from ${input.senderName}`,
        body: input.preview.slice(0, 160),
        data: {
          roomId: input.roomId,
          messageId: input.messageId,
          senderId: input.senderId,
          senderName: input.senderName,
        },
        dedupeKey: `chat-message:${input.messageId}:${recipientUserId}`,
      });
    }
  } catch (error) {
    console.error("notifyRoomMessageRecipients failed:", error);
  }
}

// ── Customer invite issuance ──────────────────────────────────────────────────

const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

router.post(
  "/customers/:id/invite",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    // Only internal shop staff may issue invites
    if (!isShopStaff(me.role)) {
      res.status(403).json({ message: "Only shop staff may issue customer invites" });
      return;
    }
    const shopId = resolveShopId(me);
    if (!shopId) {
      res.status(403).json({ message: "Your account is not linked to a shop" });
      return;
    }

    const customerId = String(req.params.id ?? "");
    if (!UUID_RE.test(customerId)) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    // Load the customer — must belong to the caller's shop
    const [customer] = await db
      .select({ id: customersTable.id, shopId: customersTable.shopId })
      .from(customersTable)
      .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId!)))
      .limit(1);
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    // Check if this customer already has an active user account
    const [existingUser] = await db
      .select({ id: customerUsersTable.id })
      .from(customerUsersTable)
      .where(eq(customerUsersTable.customerId, customerId))
      .limit(1);
    if (existingUser) {
      res.status(409).json({ message: "This customer already has an active account" });
      return;
    }

    // Generate a cryptographically random token — only the hash is stored
    const rawToken = generateToken(); // 48 random bytes → hex string
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await db.insert(customerInvitesTable).values({
      shopId: shopId!,
      customerId,
      tokenHash,
      issuedById: me.id,
      issuedByName: me.name,
      expiresAt,
    });

    // Return the raw token ONCE. It is never stored and can never be re-retrieved.
    res.json({
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
      customerId,
    });
  }),
);

// ── Customer invite activation ────────────────────────────────────────────────

router.post(
  "/auth/activate-invite",
  asyncHandler(async (req, res) => {
    const body = parseBody(AuthActivateInviteBody, req, res);
    if (!body) return;
    const { token, name } = body;
    if (!token.trim() || !name.trim()) {
      res.status(400).json({ message: "token and name are required" });
      return;
    }

    const tokenHash = sha256(token.trim());
    const now = new Date();

    // Look up the invite by hash
    const [invite] = await db
      .select()
      .from(customerInvitesTable)
      .where(eq(customerInvitesTable.tokenHash, tokenHash))
      .limit(1);

    if (!invite) {
      res.status(404).json({ message: "Invite not found or already used" });
      return;
    }
    if (invite.consumedAt) {
      res.status(410).json({ message: "This invite has already been used" });
      return;
    }
    if (invite.expiresAt < now) {
      res.status(410).json({ message: "This invite has expired" });
      return;
    }

    // Load the customer to derive email/mobile for the user account
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, invite.customerId))
      .limit(1);
    if (!customer) {
      res.status(410).json({ message: "The associated customer no longer exists" });
      return;
    }

    // Synthesize email if the customer record lacks one
    const email = customer.email?.trim()
      ? customer.email.trim().toLowerCase()
      : `customer-${customer.id}@shop-${invite.shopId}.local`;

    // Every ownership check runs under the same per-mobile advisory lock the
    // OTP path takes, so a concurrent OTP claim of this number cannot slip
    // between a precheck and the insert. A row already linked, or a mobile
    // already owned by an account outside this shop, ends the invite.
    type ActivationOutcome =
      | { kind: "activated"; user: typeof usersTable.$inferSelect }
      | { kind: "row_linked" }
      | { kind: "mobile_taken" };
    const outcome = await db.transaction(async (tx): Promise<ActivationOutcome> => {
      await lockNormalizedMobiles(tx, customer.mobile);

      const [alreadyLinked] = await tx
        .select({ id: customerUsersTable.id })
        .from(customerUsersTable)
        .where(eq(customerUsersTable.customerId, invite.customerId))
        .limit(1);
      if (alreadyLinked) {
        await tx.update(customerInvitesTable).set({ consumedAt: now }).where(eq(customerInvitesTable.id, invite.id));
        return { kind: "row_linked" };
      }

      const [clash] = await tx
        .select()
        .from(usersTable)
        .where(or(eq(usersTable.email, email), eq(usersTable.mobile, customer.mobile)))
        .limit(1);
      if (clash) {
        // The same person already signed in with this number on this shop
        // (the OTP path may have linked a duplicate row first): attach this
        // row to that account instead of stranding it. Any other owner of the
        // number or email is a hard stop.
        const sameShopCustomer =
          clash.mobile === customer.mobile && clash.isActive
          && clash.role === "customer" && clash.shopId === invite.shopId;
        if (!sameShopCustomer) return { kind: "mobile_taken" };
        await tx.insert(customerUsersTable)
          .values({ userId: clash.id, customerId: invite.customerId, shopId: invite.shopId })
          .onConflictDoNothing();
        await tx.update(customerInvitesTable).set({ consumedAt: now }).where(eq(customerInvitesTable.id, invite.id));
        return { kind: "activated", user: clash };
      }

      const [created] = await tx
        .insert(usersTable)
        .values({
          name: name.trim().slice(0, 120),
          email,
          mobile: customer.mobile,
          passwordHash: null,
          role: "customer",
          shopId: invite.shopId,
          isActive: true,
        })
        .returning();

      await tx.insert(customerUsersTable).values({
        userId: created.id,
        customerId: invite.customerId,
        shopId: invite.shopId,
      });

      await tx
        .update(customerInvitesTable)
        .set({ consumedAt: now })
        .where(eq(customerInvitesTable.id, invite.id));

      return { kind: "activated", user: created };
    });

    if (outcome.kind === "row_linked") {
      res.status(409).json({ message: "A user account already exists for this customer" });
      return;
    }
    if (outcome.kind === "mobile_taken") {
      res.status(409).json({ message: "An account with this email or mobile already exists" });
      return;
    }

    const { publicUser } = await import("../lib/authUtils");
    res.json({
      message: "Account activated. Sign in with a mobile OTP to continue.",
      user: publicUser(outcome.user),
    });
  }),
);

// ── Chat capabilities ─────────────────────────────────────────────────────────

router.get(
  "/chat/capabilities",
  requireAuth,
  (req, res) => {
    res.json(chatCapabilities());
  },
);

// ── Chat rooms ────────────────────────────────────────────────────────────────

async function listChatRoomsForCaller(req: AuthedRequest, archived: boolean) {
    const me = (req as AuthedRequest).user;
    const shopId = resolveShopId(me);
    const syncedAt = new Date();
    await db
      .update(chatRoomMembersTable)
      .set({ lastSyncedAt: syncedAt })
      .where(eq(chatRoomMembersTable.userId, me.id));
    // Membership is required for EVERY role: only rooms the caller is an
    // explicit member of are returned. No shop-wide staff bypass.
    const rows = await db
      .select({
        room: chatRoomsTable,
        joinedAt: chatRoomMembersTable.joinedAt,
        preference: chatRoomPreferencesTable,
      })
      .from(chatRoomsTable)
      .innerJoin(
        chatRoomMembersTable,
        eq(chatRoomsTable.id, chatRoomMembersTable.roomId),
      )
      .leftJoin(
        chatRoomPreferencesTable,
        and(
          eq(chatRoomPreferencesTable.roomId, chatRoomsTable.id),
          eq(chatRoomPreferencesTable.userId, me.id),
        ),
      )
      .where(
        and(
          or(
            eq(chatRoomsTable.scope, "global_direct"),
            shopId ? and(eq(chatRoomsTable.scope, "shop"), eq(chatRoomsTable.shopId, shopId)) : sql`false`,
          ),
          eq(chatRoomMembersTable.userId, me.id),
          isNull(chatRoomPreferencesTable.deletedAt),
          archived
            ? eq(chatRoomPreferencesTable.isArchived, true)
            : or(
                isNull(chatRoomPreferencesTable.id),
                eq(chatRoomPreferencesTable.isArchived, false),
              ),
        ),
      )
      .orderBy(desc(chatRoomsTable.createdAt));

    const rooms = await Promise.all(
      rows.map((row) => formatRoomSummaryForUser(row.room, me.id, row.joinedAt, row.preference)),
    );
    rooms.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const aDate = a.lastMessage?.createdAt ?? a.createdAt;
      const bDate = b.lastMessage?.createdAt ?? b.createdAt;
      return bDate.localeCompare(aDate);
    });
    return rooms;
}

router.get(
  "/chat/rooms",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ rooms: await listChatRoomsForCaller(req as AuthedRequest, false) });
  }),
);

router.get(
  "/chat/rooms/archived",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ rooms: await listChatRoomsForCaller(req as AuthedRequest, true) });
  }),
);

router.patch(
  "/chat/rooms/:roomId/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId) || !(await authorizeRoom(me, roomId))) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const body = parseBody(ChatRoomsPreferencesUpdateBody, req, res);
    if (!body) return;
    const allowed = ["isPinned", "isMuted", "isArchived"] as const;
    const supplied = allowed.filter((key) => body[key] !== undefined);
    if (!supplied.length || Object.keys(req.body ?? {}).some((key) => !allowed.includes(key as typeof allowed[number]))) {
      res.status(400).json({ message: "Supply at least one valid preference" });
      return;
    }
    const changes = Object.fromEntries(supplied.map((key) => [key, body[key]]));
    const [preference] = await db
      .insert(chatRoomPreferencesTable)
      .values({ roomId, userId: me.id, ...changes, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [chatRoomPreferencesTable.roomId, chatRoomPreferencesTable.userId],
        set: { ...changes, updatedAt: new Date(), deletedAt: null },
      })
      .returning();
    res.json({ preferences: formatRoomPreference(preference) });
  }),
);

router.delete(
  "/chat/rooms/:roomId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId) || !(await authorizeRoom(me, roomId))) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const now = new Date();
    await db
      .insert(chatRoomPreferencesTable)
      .values({ roomId, userId: me.id, deletedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [chatRoomPreferencesTable.roomId, chatRoomPreferencesTable.userId],
        set: { deletedAt: now, updatedAt: now },
      });
    res.status(204).end();
  }),
);

/**
 * Compute the deterministic peerKey for a one-to-one room: the two participant
 * app user IDs sorted ascending and joined with ":".
 */
function computePeerKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}

/**
 * Normalize an Indian mobile number to a canonical 10-digit string.
 * Accepts: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX (10 digits).
 * Returns null if the number does not match any recognized format.
 */
function normalizeIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

// ── Contact match endpoint ─────────────────────────────────────────────────────
//
// Privacy-safe, exact-match lookup of active users by normalized
// Indian phone number. Never exposes a browseable directory. Does NOT reveal
// whether a number is unregistered — unmatched numbers are simply omitted.
// Returns only active users whose exact number was supplied, excluding self.
// Accessible to ALL authenticated roles including customers (allowlisted in
// customerPortal.ts).

router.post(
  "/chat/contacts/match",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const shopId = resolveShopId(me);

    // Account every lookup attempt in PostgreSQL so limits apply across API
    // instances and also cover requests that produce no matches.
    const now = new Date();
    const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
    const retentionStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const ipHashKey = process.env.SESSION_SECRET;
    if (!ipHashKey) {
      throw new Error("SESSION_SECRET is required for contact-match abuse protection");
    }
    const ipHash = sha256(`chat-contact-match-ip:v1:${ipHashKey}:${ip}`);
    const limited = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`chat_match_user:${me.id}`}))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`chat_match_ip:${ipHash}`}))`);

      // Opportunistic bounded-retention cleanup; never remove records still
      // relevant to the active rate-limit window.
      await tx.execute(sql`
        DELETE FROM chat_contact_match_attempts
        WHERE id IN (
          SELECT id FROM chat_contact_match_attempts
          WHERE created_at < ${retentionStart}
          ORDER BY created_at
          LIMIT 500
        )
      `);
      await tx.execute(sql`
        DELETE FROM chat_contact_match_grants
        WHERE id IN (
          SELECT id FROM chat_contact_match_grants
          WHERE expires_at < ${new Date(now.getTime() - 60 * 60 * 1000)}
          ORDER BY expires_at
          LIMIT 500
        )
      `);

      const [[userCount], [ipCount]] = await Promise.all([
        tx
          .select({ value: sql<number>`count(*)::int` })
          .from(chatContactMatchAttemptsTable)
          .where(
            and(
              eq(chatContactMatchAttemptsTable.userId, me.id),
              sql`${chatContactMatchAttemptsTable.createdAt} >= ${windowStart}`,
            ),
          ),
        tx
          .select({ value: sql<number>`count(*)::int` })
          .from(chatContactMatchAttemptsTable)
          .where(
            and(
              eq(chatContactMatchAttemptsTable.ipHash, ipHash),
              sql`${chatContactMatchAttemptsTable.createdAt} >= ${windowStart}`,
            ),
          ),
      ]);
      if ((userCount?.value ?? 0) >= 10 || (ipCount?.value ?? 0) >= 20) return true;
      await tx.insert(chatContactMatchAttemptsTable).values({ userId: me.id, ipHash });
      return false;
    });
    if (limited) {
      res.status(429).json({ message: "Too many contact checks. Please try again later." });
      return;
    }

    const body = parseBody(ChatContactsMatchBody, req, res);
    if (!body) return;

    // Accept a single phone string or a bounded array.
    const { phone, phones } = body;

    // Build the raw list from either input.
    let rawList: string[];
    if (typeof phone === "string") {
      rawList = [phone];
    } else if (Array.isArray(phones)) {
      rawList = phones;
    } else {
      res.status(400).json({
        message: "Provide 'phone' (single string) or 'phones' (array of strings)",
      });
      return;
    }

    // Bounded: reject oversized payloads.
    const MAX_PHONES = 50;
    if (rawList.length > MAX_PHONES) {
      res.status(400).json({
        message: `Too many numbers. Maximum ${MAX_PHONES} per request.`,
      });
      return;
    }

    // Normalize each entry; skip any that don't parse as Indian mobile.
    const normalized = rawList
      .map(normalizeIndianMobile)
      .filter((p): p is string => p !== null);

    if (normalized.length === 0) {
      res.json({ contacts: [] });
      return;
    }

    // Query: active exact-phone users in the explicit global direct scope,
    // excluding the caller. Never expose unregistered numbers.
    const rows = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        mobile: usersTable.mobile,
        role: usersTable.role,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.isActive, true),
          inArray(usersTable.mobile, normalized),
        ),
      );

    // Exclude self and either side of a blocked pair. A block therefore also
    // prevents issuing a fresh direct-room proof for that peer.
    const candidates = rows.filter((u) => u.id !== me.id);
    const candidateIds = candidates.map((u) => u.id);
    const blockedRows = candidateIds.length
      ? await db
          .select({
            blockerUserId: chatBlocksTable.blockerUserId,
            blockedUserId: chatBlocksTable.blockedUserId,
          })
          .from(chatBlocksTable)
          .where(
            or(
              and(
                eq(chatBlocksTable.blockerUserId, me.id),
                inArray(chatBlocksTable.blockedUserId, candidateIds),
              ),
              and(
                eq(chatBlocksTable.blockedUserId, me.id),
                inArray(chatBlocksTable.blockerUserId, candidateIds),
              ),
            ),
          )
      : [];
    const blockedIds = new Set(
      blockedRows.map((block) =>
        block.blockerUserId === me.id ? block.blockedUserId : block.blockerUserId,
      ),
    );
    const matched = candidates.filter((user) => !blockedIds.has(user.id));
    const grantExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const contacts = await db.transaction(async (tx) => {
      const issued = matched.map((u) => ({ user: u, rawToken: generateToken() }));
      if (issued.length) {
        await tx.insert(chatContactMatchGrantsTable).values(
          issued.map(({ user, rawToken }) => ({
            tokenHash: sha256(rawToken),
            callerUserId: me.id,
            targetUserId: user.id,
            shopId: null,
            expiresAt: grantExpiresAt,
          })),
        );
      }
      return issued.map(({ user: u, rawToken }) => ({
        userId: u.id,
        name: u.name,
        // Return the mobile only if the caller supplied that exact number — we
        // echo it back so the client can correlate the result. The server never
        // volunteers numbers the caller did not already know.
        mobile: u.mobile,
        role: u.role,
        matchToken: rawToken,
      }));
    });

    res.json({ contacts });
  }),
);

router.post(
  "/chat/rooms",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const shopId = resolveShopId(me);

    const body = parseBody(ChatRoomsCreateBody, req, res);
    if (!body) return;
    const {
      name,
      kind,
      customerId,
      dealerId,
      targetUserId: bodyTargetUserId,
      matchToken,
      clientRequestId,
    } = body;
    const matchTokenValue = matchToken?.trim() ?? "";
    if (!name.trim()) {
      res.status(400).json({ message: "name is required" });
      return;
    }
    // Restricted customer/dealer-portal accounts may only create direct rooms.
    if ((me.role === "customer" || isDealerPortal(me.role)) && kind !== "direct") {
      res.status(403).json({ message: "This account may only create direct chat rooms (kind=direct)" });
      return;
    }
    if (kind !== "direct" && !shopId) {
      res.status(403).json({ message: "Your account is not linked to a shop" });
      return;
    }
    const roomScope = kind === "direct" ? "global_direct" as const : "shop" as const;

    // ── Idempotency #1: clientRequestId ────────────────────────────────────
    if (clientRequestId?.trim()) {
      const [existing] = await db
        .select()
        .from(chatRoomsTable)
        .where(
          and(
            eq(chatRoomsTable.scope, roomScope),
            eq(chatRoomsTable.clientRequestId, clientRequestId.trim()),
          ),
        )
        .limit(1);
      if (existing) {
        const [membership] = await db
          .select({ roomId: chatRoomMembersTable.roomId })
          .from(chatRoomMembersTable)
          .where(
            and(
              eq(chatRoomMembersTable.roomId, existing.id),
              eq(chatRoomMembersTable.userId, me.id),
            ),
          )
          .limit(1);
        if (!membership) {
          // A retry from the request that owns an in-flight reservation is
          // allowed to wait for its own room. The reservation has no members
          // yet, so treating it as a normal room would incorrectly return 404.
          if (!existing.providerRoomId && existing.createdById === me.id) {
            const provisioned = await recoverReservedDirectRoom(existing);
            if (provisioned) {
              res.json({ room: await formatRoomForUser(provisioned, me.id), created: false });
            } else {
              res.status(503).json({
                message: "Chat provider is still unavailable. Room not created.",
                code: "MATRIX_UNAVAILABLE",
              });
            }
            return;
          }
          // Do not disclose room/provider details to a same-shop user that
          // reused another participant's client request ID.
          res.status(404).json({ message: "Room not found" });
          return;
        }
        if (!existing.providerRoomId) {
          const provisioned = await recoverReservedDirectRoom(existing);
          if (!provisioned) {
            res.status(503).json({
              message: "Chat provider is still unavailable. Room not created.",
              code: "MATRIX_UNAVAILABLE",
            });
            return;
          }
          res.json({ room: await formatRoomForUser(provisioned, me.id), created: false });
          return;
        }
        res.json({ room: await formatRoomForUser(existing, me.id), created: false });
        return;
      }
    }

    // ── Resolve the single target participant account (fail closed) ────────
    // targetUserId is the app user id of the OTHER participant.
    let targetUserId: string;
    let resolvedCustomerId: string | null = null;
    let resolvedDealerId: string | null = null;

    if (kind === "direct") {
      // Both values must originate from exact contact matching. Keep all proof
      // failures generic so arbitrary IDs cannot be used as a user oracle.
      if (
        bodyTargetUserId === undefined ||
        !UUID_RE.test(bodyTargetUserId.trim()) ||
        !matchTokenValue
      ) {
        res.status(403).json({ message: "Direct chat authorization is invalid or expired." });
        return;
      }
      const tid = bodyTargetUserId.trim();
      if (tid === me.id) {
        res.status(403).json({ message: "Direct chat authorization is invalid or expired." });
        return;
      }
      targetUserId = tid;
    } else if (kind === "customer") {
      if (!customerId?.trim()) {
        res.status(400).json({ message: "customerId is required for kind=customer" });
        return;
      }
      // Customer must belong to this shop
      const [cust] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId!)))
        .limit(1);
      if (!cust) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      // Exactly one active customer user link is required.
      const links = await db
        .select({ userId: customerUsersTable.userId })
        .from(customerUsersTable)
        .innerJoin(usersTable, eq(usersTable.id, customerUsersTable.userId))
        .where(
          and(
            eq(customerUsersTable.customerId, customerId),
            eq(customerUsersTable.shopId, shopId!),
            eq(usersTable.isActive, true),
          ),
        );
      if (links.length !== 1) {
        res.status(409).json({
          message:
            "This customer does not have an active app account yet. Send an activation invite first.",
          code: "CUSTOMER_ACCOUNT_REQUIRED",
        });
        return;
      }
      targetUserId = links[0].userId;
      resolvedCustomerId = customerId;
    } else {
      // kind === "dealer"
      if (!dealerId?.trim()) {
        res.status(400).json({ message: "dealerId is required for kind=dealer" });
        return;
      }
      // Dealer must belong to this shop
      const [dealer] = await db
        .select({ id: dealersTable.id })
        .from(dealersTable)
        .where(and(eq(dealersTable.id, dealerId), eq(dealersTable.shopId, shopId!)))
        .limit(1);
      if (!dealer) {
        res.status(404).json({ message: "Dealer not found" });
        return;
      }
      // Resolve one active dealer-portal target deterministically:
      //   - prefer the single dealer_owner
      //   - else the single dealer_staff
      //   - none → 409 DEALER_ACCOUNT_REQUIRED
      //   - multiple equally eligible → 409 DEALER_ACCOUNT_AMBIGUOUS
      const portalUsers = await db
        .select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.dealerId, dealerId),
            eq(usersTable.shopId, shopId!),
            eq(usersTable.isActive, true),
          ),
        );
      const owners = portalUsers.filter((u) => u.role === "dealer_owner");
      const staff = portalUsers.filter((u) => u.role === "dealer_staff");

      if (owners.length === 1) {
        targetUserId = owners[0].id;
      } else if (owners.length > 1) {
        res.status(409).json({
          message: "Multiple dealer owner accounts exist; cannot pick one automatically.",
          code: "DEALER_ACCOUNT_AMBIGUOUS",
        });
        return;
      } else if (staff.length === 1) {
        targetUserId = staff[0].id;
      } else if (staff.length > 1) {
        res.status(409).json({
          message: "Multiple dealer staff accounts exist; cannot pick one automatically.",
          code: "DEALER_ACCOUNT_AMBIGUOUS",
        });
        return;
      } else {
        res.status(409).json({
          message: "This dealer has no active portal account yet.",
          code: "DEALER_ACCOUNT_REQUIRED",
        });
        return;
      }
      resolvedDealerId = dealerId;
    }

    // A one-to-one room with yourself is not allowed (extra guard for non-direct paths).
    if (targetUserId === me.id) {
      res.status(400).json({ message: "Cannot create a chat room with yourself" });
      return;
    }

    const peerKey = computePeerKey(me.id, targetUserId);

    // ── Idempotency #2: peerKey (independent of clientRequestId) ────────────
    // A completed room remains available even while Matrix is down: no new
    // provider work is required to return an already-authorized local room.
    const [existingByPeer] = await db
      .select()
      .from(chatRoomsTable)
      .where(
        and(eq(chatRoomsTable.scope, roomScope), eq(chatRoomsTable.peerKey, peerKey)),
      )
      .limit(1);
    if (existingByPeer) {
      const [members, boundGrant] = await Promise.all([
        db
          .select({ userId: chatRoomMembersTable.userId })
          .from(chatRoomMembersTable)
          .where(
            and(
              eq(chatRoomMembersTable.roomId, existingByPeer.id),
              inArray(chatRoomMembersTable.userId, [me.id, targetUserId]),
            ),
          ),
        kind === "direct"
          ? db
              .select({ id: chatContactMatchGrantsTable.id })
              .from(chatContactMatchGrantsTable)
              .where(
                and(
                  eq(chatContactMatchGrantsTable.tokenHash, sha256(matchTokenValue)),
                  eq(chatContactMatchGrantsTable.callerUserId, me.id),
                  eq(chatContactMatchGrantsTable.targetUserId, targetUserId),
                  or(isNull(chatContactMatchGrantsTable.shopId), eq(chatContactMatchGrantsTable.shopId, shopId!)),
                ),
              )
              .limit(1)
          : Promise.resolve([{ id: "not-required" }]),
      ]);
      if (kind === "direct" && boundGrant.length !== 1) {
        res.status(403).json({ message: "Direct chat authorization is invalid or expired." });
        return;
      }
      if (kind === "direct") {
        const [block] = await db
          .select({ id: chatBlocksTable.id })
          .from(chatBlocksTable)
          .where(blockedPairCondition(me.id, targetUserId))
          .limit(1);
        if (block) {
          res.status(403).json({
            message: "This conversation is blocked.",
            code: "CHAT_BLOCKED",
          });
          return;
        }
      }
      if (existingByPeer.providerRoomId && members.length === 2) {
        res.json({ room: await formatRoomForUser(existingByPeer, me.id), created: false });
        return;
      }
      if (!existingByPeer.providerRoomId) {
        const provisioned = await recoverReservedDirectRoom(existingByPeer);
        if (provisioned) {
          res.json({ room: await formatRoomForUser(provisioned, me.id), created: false });
        } else {
          res.status(503).json({
            message: "Chat provider is still unavailable. Room not created.",
            code: "MATRIX_UNAVAILABLE",
          });
        }
        return;
      }
    }

    if (!matrixConfigured()) {
      res.status(503).json({
        message: "Chat provider not available. Room not created.",
        code: "MATRIX_UNAVAILABLE",
      });
      return;
    }

    // ── Durable pair reservation, then provider provisioning ─────────────────
    // The partial unique peer-key index is the cross-instance mutex. We commit
    // a memberless, null-provider reservation in a short transaction before
    // calling Matrix. Thus concurrent callers reuse the same reservation while
    // no database connection is retained during the provider wait.
    let reservation: {
      room: typeof chatRoomsTable.$inferSelect;
      created: boolean;
      targetName?: string;
    };
    try {
      reservation = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(chatRoomsTable)
          .where(
            and(eq(chatRoomsTable.scope, roomScope), eq(chatRoomsTable.peerKey, peerKey)),
          )
          .limit(1);
        if (existing) {
          if (kind === "direct") {
            const [boundGrant] = await tx
              .select({ id: chatContactMatchGrantsTable.id })
              .from(chatContactMatchGrantsTable)
              .where(
                and(
                  eq(chatContactMatchGrantsTable.tokenHash, sha256(matchTokenValue)),
                  eq(chatContactMatchGrantsTable.callerUserId, me.id),
                  eq(chatContactMatchGrantsTable.targetUserId, targetUserId),
                  or(isNull(chatContactMatchGrantsTable.shopId), eq(chatContactMatchGrantsTable.shopId, shopId!)),
                ),
              )
              .limit(1);
            if (!boundGrant) throw new MatchGrantError();
            const [block] = await tx
              .select({ id: chatBlocksTable.id })
              .from(chatBlocksTable)
              .where(blockedPairCondition(me.id, targetUserId))
              .limit(1);
            if (block) throw new BlockedPairError();
          }
          return { room: existing, created: false };
        }

        if (kind === "direct") {
          const tokenHash = sha256(matchTokenValue);
          const [grant] = await tx
            .select({ id: chatContactMatchGrantsTable.id })
            .from(chatContactMatchGrantsTable)
            .where(
              and(
                eq(chatContactMatchGrantsTable.tokenHash, tokenHash),
                eq(chatContactMatchGrantsTable.callerUserId, me.id),
                eq(chatContactMatchGrantsTable.targetUserId, targetUserId),
                or(isNull(chatContactMatchGrantsTable.shopId), eq(chatContactMatchGrantsTable.shopId, shopId!)),
                isNull(chatContactMatchGrantsTable.consumedAt),
                sql`${chatContactMatchGrantsTable.expiresAt} > ${new Date()}`,
              ),
            )
            .limit(1);
          if (!grant) throw new MatchGrantError();
          const consumed = await tx
            .update(chatContactMatchGrantsTable)
            .set({ consumedAt: new Date() })
            .where(
              and(
                eq(chatContactMatchGrantsTable.id, grant.id),
                isNull(chatContactMatchGrantsTable.consumedAt),
              ),
            )
            .returning({ id: chatContactMatchGrantsTable.id });
          if (consumed.length !== 1) throw new MatchGrantError();
          const [block] = await tx
            .select({ id: chatBlocksTable.id })
            .from(chatBlocksTable)
            .where(blockedPairCondition(me.id, targetUserId))
            .limit(1);
          if (block) throw new BlockedPairError();
        }

        const [targetUser] = await tx
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.id, targetUserId),
               kind === "direct" ? sql`true` : eq(usersTable.shopId, shopId!),
              eq(usersTable.isActive, true),
            ),
          )
          .limit(1);
        if (!targetUser) {
          if (kind === "direct") throw new MatchGrantError();
          throw new Error("Resolved chat target is no longer active");
        }

        const [newRoom] = await tx
          .insert(chatRoomsTable)
          .values({
            shopId: kind === "direct" ? null : shopId!,
            scope: roomScope,
            kind: kind as "customer" | "dealer" | "direct",
            name: name.trim().slice(0, 200),
            customerId: resolvedCustomerId,
            dealerId: resolvedDealerId,
            // This is only a reservation. It gains members and becomes visible
            // atomically after Matrix confirms the exact two-person room.
            providerRoomId: null,
            peerKey,
            provisionKey: directRoomProvisionKey(roomScope, peerKey),
            provisionAttemptId: randomUUID(),
            provisionLeaseUntil: provisionLeaseUntil(),
            clientRequestId:
              typeof clientRequestId === "string" && clientRequestId.trim()
                ? clientRequestId.trim()
                : null,
            createdById: me.id,
            createdByName: me.name,
          })
          .returning();
        return { room: newRoom, created: true, targetName: targetUser.name };
      });
    } catch (err) {
      // A concurrent transaction can consume the same direct proof just before
      // it inserts the reservation. If that happened, resume the reservation
      // instead of incorrectly rejecting the second caller.
      const [raced] = await db
        .select()
        .from(chatRoomsTable)
        .where(
          and(eq(chatRoomsTable.scope, roomScope), eq(chatRoomsTable.peerKey, peerKey)),
        )
        .limit(1);
      if (raced && kind === "direct") {
        const [boundGrant] = await db
          .select({ id: chatContactMatchGrantsTable.id })
          .from(chatContactMatchGrantsTable)
          .where(
            and(
              eq(chatContactMatchGrantsTable.tokenHash, sha256(matchTokenValue)),
              eq(chatContactMatchGrantsTable.callerUserId, me.id),
              eq(chatContactMatchGrantsTable.targetUserId, targetUserId),
              or(isNull(chatContactMatchGrantsTable.shopId), eq(chatContactMatchGrantsTable.shopId, shopId!)),
            ),
          )
          .limit(1);
        const [block] = await db
          .select({ id: chatBlocksTable.id })
          .from(chatBlocksTable)
          .where(blockedPairCondition(me.id, targetUserId))
          .limit(1);
        if (block) {
          res.status(403).json({
            message: "This conversation is blocked.",
            code: "CHAT_BLOCKED",
          });
          return;
        }
        if (boundGrant) {
          reservation = { room: raced, created: false };
        } else {
          res.status(403).json({ message: "Direct chat authorization is invalid or expired." });
          return;
        }
      } else if (err instanceof BlockedPairError) {
        res.status(403).json({
          message: "This conversation is blocked.",
          code: "CHAT_BLOCKED",
        });
        return;
      } else if (err instanceof MatchGrantError) {
        res.status(403).json({ message: "Direct chat authorization is invalid or expired." });
        return;
      } else if (raced) {
        reservation = { room: raced, created: false };
      } else {
        throw err;
      }
    }

    if (!reservation.created) {
      const room = reservation.room.providerRoomId
        ? reservation.room
        : await recoverReservedDirectRoom(reservation.room);
      if (!room) {
        res.status(503).json({
          message: "Chat provider is still unavailable. Room not created.",
          code: "MATRIX_UNAVAILABLE",
        });
        return;
      }
      res.json({ room: await formatRoomForUser(room, me.id), created: false });
      return;
    }

    const room = await provisionClaimedDirectRoom(reservation.room);
    if (!room) {
      res.status(503).json({
        message: "Failed to provision room and participants on chat provider. Room not created.",
        code: "MATRIX_UNAVAILABLE",
      });
      return;
    }

    res.json({ room: await formatRoomForUser(room, me.id), created: true });
  }),
);

router.get(
  "/chat/rooms/:roomId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    await db
      .update(chatRoomMembersTable)
      .set({ lastSyncedAt: new Date() })
      .where(
        and(
          eq(chatRoomMembersTable.roomId, roomId),
          eq(chatRoomMembersTable.userId, me.id),
        ),
      );
    res.json({ room: await formatRoomForUser(room, me.id) });
  }),
);

// ── Global direct-chat safety controls ───────────────────────────────────────

router.post(
  "/chat/rooms/:roomId/block",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    const peerUserId = room ? await getDirectPeerUserId(room, me.id) : null;
    if (!room || !peerUserId) {
      res.status(404).json({ message: "Room not found" });
      return;
    }

    await db
      .insert(chatBlocksTable)
      .values({ blockerUserId: me.id, blockedUserId: peerUserId })
      .onConflictDoNothing({
        target: [chatBlocksTable.blockerUserId, chatBlocksTable.blockedUserId],
      });

    res.json(await getBlockState(me.id, peerUserId));
  }),
);

router.delete(
  "/chat/rooms/:roomId/block",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    const peerUserId = room ? await getDirectPeerUserId(room, me.id) : null;
    if (!room || !peerUserId) {
      res.status(404).json({ message: "Room not found" });
      return;
    }

    await db
      .delete(chatBlocksTable)
      .where(
        and(
          eq(chatBlocksTable.blockerUserId, me.id),
          eq(chatBlocksTable.blockedUserId, peerUserId),
        ),
      );

    res.json(await getBlockState(me.id, peerUserId));
  }),
);

router.post(
  "/chat/rooms/:roomId/reports",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    const peerUserId = room ? await getDirectPeerUserId(room, me.id) : null;
    if (!room || !peerUserId) {
      res.status(404).json({ message: "Room not found" });
      return;
    }

    const body = parseBody(ChatReportsCreateBody, req, res);
    if (!body) return;
    const { clientRequestId, reason, messageId, details } = body;
    if (!clientRequestId.trim()) {
      res.status(400).json({ message: "clientRequestId is required" });
      return;
    }
    if (
      messageId !== undefined &&
      !UUID_RE.test(messageId)
    ) {
      res.status(400).json({ message: "messageId must be a valid message in this room" });
      return;
    }
    if (messageId) {
      const [message] = await db
        .select({ id: chatMessagesTable.id })
        .from(chatMessagesTable)
        .where(
          and(
            eq(chatMessagesTable.id, messageId),
            eq(chatMessagesTable.roomId, roomId),
          ),
        )
        .limit(1);
      if (!message) {
        res.status(400).json({ message: "messageId must be a valid message in this room" });
        return;
      }
    }

    const requestId = clientRequestId.trim();
    const outcome = await db.transaction(async (tx) => {
      // Serialize report creation per reporter so concurrent requests cannot
      // race past the daily abuse cap.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${me.id}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(chatReportsTable)
        .where(
          and(
            eq(chatReportsTable.reporterUserId, me.id),
            eq(chatReportsTable.clientRequestId, requestId),
          ),
        )
        .limit(1);
      if (existing) return { report: existing, rateLimited: false };

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recent] = await tx
        .select({ total: count() })
        .from(chatReportsTable)
        .where(
          and(
            eq(chatReportsTable.reporterUserId, me.id),
            gte(chatReportsTable.createdAt, dayAgo),
          ),
        );
      if (Number(recent?.total ?? 0) >= 5) {
        return { report: null, rateLimited: true };
      }

      const [created] = await tx
        .insert(chatReportsTable)
        .values({
          reporterUserId: me.id,
          reportedUserId: peerUserId,
          roomId,
          messageId: messageId ?? null,
          clientRequestId: requestId,
          reason,
          details: details?.trim() ? details.trim() : null,
        })
        .returning();
      return { report: created, rateLimited: false };
    });
    if (outcome.rateLimited || !outcome.report) {
      res.status(429).json({
        message: "Report limit reached. Please try again later.",
        code: "CHAT_REPORT_RATE_LIMITED",
      });
      return;
    }
    const report = outcome.report;

    res.json({
      report: {
        id: report.id,
        roomId: report.roomId,
        messageId: report.messageId ?? undefined,
        reason: report.reason,
        createdAt: report.createdAt.toISOString(),
      },
    });
  }),
);

// ── The reporter's own record of what they reported ──────────────────────────
// A report is otherwise invisible to the person who filed it once the one-off
// "we reviewed it" notification is gone, which is what makes people report the
// same account again. This read gives them back their own submissions and
// nothing else. It is deliberately NOT a second door into the operator queue in
// chatReports.ts: it is filtered to the caller's own rows, and it returns none
// of the reviewer identity, review note, or accused-account data that queue
// carries. Both terminal decisions look identical here — the reporter learns a
// human finished, never what happened to the other account.
const MY_REPORTS_PAGE = 25;

// Reviewers move a report open → reviewed → actioned|dismissed. Only the
// terminal decisions close the loop for the reporter; "reviewed" is an internal
// staging step and still reads as waiting.
const MY_REPORT_SETTLED_STATUSES = ["actioned", "dismissed"] as const;

function encodeMyReportCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
  ).toString("base64url");
}

function decodeMyReportCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
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
  "/chat/reports/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;

    const parsed = ChatMyReportListQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid report list filters" });
      return;
    }
    const limit = parsed.data.limit ?? MY_REPORTS_PAGE;
    const cursor = parsed.data.cursor;
    const after = cursor ? decodeMyReportCursor(cursor) : null;
    if (cursor && !after) {
      res.status(400).json({ message: "Invalid report list cursor" });
      return;
    }

    const rows = await db
      .select({
        id: chatReportsTable.id,
        reason: chatReportsTable.reason,
        details: chatReportsTable.details,
        status: chatReportsTable.status,
        createdAt: chatReportsTable.createdAt,
        messageId: chatReportsTable.messageId,
        roomId: chatReportsTable.roomId,
        roomName: chatRoomsTable.name,
        roomScope: chatRoomsTable.scope,
      })
      .from(chatReportsTable)
      .innerJoin(chatRoomsTable, eq(chatRoomsTable.id, chatReportsTable.roomId))
      .where(
        and(
          // The only scope this endpoint has. Every other filter is paging.
          eq(chatReportsTable.reporterUserId, me.id),
          ...(after
            ? [
              sql`(${chatReportsTable.createdAt}, ${chatReportsTable.id}) < (${after.createdAt}, ${after.id}::uuid)`,
            ]
            : []),
        ),
      )
      .orderBy(desc(chatReportsTable.createdAt), desc(chatReportsTable.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    res.json({
      reports: page.map((row) => ({
        id: row.id,
        reason: row.reason,
        details: row.details ?? null,
        createdAt: row.createdAt.toISOString(),
        room: {
          id: row.roomId,
          // The conversation as the reporter already sees it in their own chat
          // list — no account details are resolved for this list.
          name: row.roomName ?? null,
          scope: row.roomScope ?? null,
        },
        messageId: row.messageId ?? null,
        state: (MY_REPORT_SETTLED_STATUSES as readonly string[]).includes(
          row.status,
        )
          ? "closed"
          : "in_review",
      })),
      nextCursor: hasMore ? encodeMyReportCursor(page[page.length - 1]!) : null,
    });
  }),
);

// ── Chat messages ─────────────────────────────────────────────────────────────

const MAX_MESSAGES = 50;

router.get(
  "/chat/rooms/:roomId/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    await db
      .update(chatRoomMembersTable)
      .set({ lastSyncedAt: new Date() })
      .where(
        and(
          eq(chatRoomMembersTable.roomId, roomId),
          eq(chatRoomMembersTable.userId, me.id),
        ),
      );

    const limit = Math.min(
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || MAX_MESSAGES : MAX_MESSAGES,
      MAX_MESSAGES,
    );
    const before = typeof req.query.before === "string" ? req.query.before : undefined;

    // Tombstones (deleted for everyone) stay in the transcript so every member
    // sees "Message deleted"; rows the caller hid ("delete for me") are dropped.
    let whereClause = and(
      eq(chatMessagesTable.roomId, roomId),
      notHiddenForUser(me.id),
    );

    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        whereClause = and(whereClause, lt(chatMessagesTable.createdAt, beforeDate));
      }
    }

    // Fetch limit+1 to detect if there are more
    const rows = await db
      .select()
      .from(chatMessagesTable)
      .where(whereClause)
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit);

    res.json({
      messages: await formatMessagesWithQuotes(messages, me.id),
      hasMore,
    });
  }),
);

/**
 * Send a message to a room. Idempotent on clientRequestId.
 *
 * Delivery policy (Matrix-first, fail-closed, idempotent):
 *  1. clientRequestId is REQUIRED and must be stable across retries.
 *  2. If a message with (roomId, senderId, clientRequestId) already exists,
 *     return it WITHOUT a second provider send (idempotent replay).
 *  3. The room MUST have a providerRoomId. If absent → 503.
 *  4. The Matrix send uses a deterministic txnId derived from
 *     roomId+senderId+clientRequestId so concurrent retries collapse to a
 *     single Matrix event. The send happens BEFORE the local DB write; on
 *     failure no row is written and the caller receives 503.
 *  5. If the local insert hits the unique (room,sender,clientRequestId)
 *     conflict (a concurrent retry won the race), return the existing row.
 */
router.post(
  "/chat/rooms/:roomId/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const directPeerUserId = await getDirectPeerUserId(room, me.id);
    if (directPeerUserId) {
      const blockState = await getBlockState(me.id, directPeerUserId);
      if (blockState.isBlocked) {
        res.status(403).json({
          message: "This conversation is blocked.",
          code: "CHAT_BLOCKED",
        });
        return;
      }
    }

    const parsedBody = parseBody(ChatMessagesSendBody, req, res);
    if (!parsedBody) return;
    const {
      kind,
      body: messageBody,
      objectPath,
      durationMs,
      clientRequestId,
      replyToMessageId,
      forwardOf,
    } = parsedBody;

    // clientRequestId is required and must be a stable non-empty string.
    if (!clientRequestId.trim()) {
      res.status(400).json({ message: "clientRequestId is required" });
      return;
    }
    const reqId = clientRequestId.trim().slice(0, 200);

    // ── Idempotent replay: return the existing message if present ───────────
    const [existingMsg] = await db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.roomId, roomId),
          eq(chatMessagesTable.senderId, me.id),
          eq(chatMessagesTable.clientRequestId, reqId),
        ),
      )
      .limit(1);
    if (existingMsg) {
      const [formatted] = await formatMessagesWithQuotes([existingMsg], me.id);
      res.json({ message: formatted });
      return;
    }

    // ── Forward source (copied content) ─────────────────────────────────────
    // The caller must be a member of the source room and must still be able
    // to see the source message. Nothing about the source row is trusted
    // from the client beyond its identity.
    let forwardSource: { room: typeof chatRoomsTable.$inferSelect; message: ChatMessageRow } | null = null;
    if (forwardOf) {
      if (replyToMessageId) {
        res.status(400).json({ message: "replyToMessageId cannot be combined with forwardOf" });
        return;
      }
      if (objectPath !== undefined || durationMs !== undefined) {
        res.status(400).json({ message: "objectPath and durationMs are derived from the source when forwarding" });
        return;
      }
      if (!UUID_RE.test(forwardOf.roomId) || !UUID_RE.test(forwardOf.messageId)) {
        res.status(404).json({ message: "Source message not found" });
        return;
      }
      const sourceRoom = await authorizeRoom(me, forwardOf.roomId);
      if (!sourceRoom) {
        res.status(404).json({ message: "Source message not found" });
        return;
      }
      const [sourceMessage] = await db
        .select()
        .from(chatMessagesTable)
        .where(
          and(
            eq(chatMessagesTable.id, forwardOf.messageId),
            eq(chatMessagesTable.roomId, sourceRoom.id),
            isNull(chatMessagesTable.deletedAt),
            notHiddenForUser(me.id),
          ),
        )
        .limit(1);
      if (!sourceMessage) {
        res.status(404).json({ message: "Source message not found" });
        return;
      }
      if (!["text", "image", "file", "audio"].includes(sourceMessage.kind)) {
        res.status(400).json({ message: "This message cannot be forwarded" });
        return;
      }
      if (sourceMessage.kind !== kind) {
        res.status(400).json({ message: "kind must match the source message" });
        return;
      }
      forwardSource = { room: sourceRoom, message: sourceMessage };
    }

    // ── Reply target (same room, still visible to the caller) ───────────────
    let replyTarget: ChatMessageRow | null = null;
    if (replyToMessageId) {
      if (!UUID_RE.test(replyToMessageId)) {
        res.status(404).json({ message: "Replied message not found" });
        return;
      }
      const [target] = await db
        .select()
        .from(chatMessagesTable)
        .where(
          and(
            eq(chatMessagesTable.id, replyToMessageId),
            eq(chatMessagesTable.roomId, roomId),
            isNull(chatMessagesTable.deletedAt),
            notHiddenForUser(me.id),
          ),
        )
        .limit(1);
      if (!target) {
        res.status(404).json({ message: "Replied message not found" });
        return;
      }
      replyTarget = target;
    }

    // ── Provider readiness check ────────────────────────────────────────────
    if (!room.providerRoomId) {
      res.status(503).json({
        message: "Chat room is not yet provisioned on the messaging provider. Please try again shortly.",
        code: "ROOM_NOT_PROVISIONED",
      });
      return;
    }
    if (!matrixConfigured()) {
      res.status(503).json({
        message: "Chat provider not available. Messages cannot be sent at this time.",
        code: "MATRIX_UNAVAILABLE",
      });
      return;
    }

    // Forwarded content comes from the source row, never from the request.
    const effectiveBody = forwardSource
      ? forwardSource.message.body
      : messageBody.trim().slice(0, 4000);
    if (!effectiveBody.trim()) {
      res.status(400).json({ message: "body is required" });
      return;
    }

    // durationMs is applicable ONLY to audio. Reject it for other kinds so
    // malformed / non-applicable metadata never gets silently stored.
    if (kind !== "audio" && durationMs !== undefined && durationMs !== null) {
      res.status(400).json({ message: "durationMs is only valid for kind=audio" });
      return;
    }

    // Validate objectPath for media messages (image/file/audio).
    let resolvedObjectPath: string | null = null;
    /** Server-owned copy created for a forward; deleted again if delivery fails. */
    let forwardedCopyPath: string | null = null;
    if (forwardSource) {
      const { room: sourceRoom, message: sourceMessage } = forwardSource;
      if (sourceMessage.objectPath) {
        const sourcePrefix = `/objects/uploads/${chatStorageScope(sourceRoom)}/chat/${sourceRoom.id}/`;
        if (!sourceMessage.objectPath.startsWith(sourcePrefix)) {
          res.status(404).json({ message: "Source message not found" });
          return;
        }
        try {
          const sourceFile = await objectStorageService.getObjectEntityFile(sourceMessage.objectPath);
          const [metadata] = await sourceFile.getMetadata();
          const [bytes] = await sourceFile.download();
          forwardedCopyPath = await objectStorageService.saveObjectEntityWithPrefix(
            `${chatStorageScope(room)}/chat/${roomId}`,
            bytes,
            (metadata.contentType as string | undefined) || "application/octet-stream",
          );
        } catch (error) {
          req.log.warn({ err: error }, "Forward source attachment unavailable");
          res.status(400).json({
            message: "The original attachment is no longer available.",
            code: "CHAT_MEDIA_EXPIRED",
          });
          return;
        }
        resolvedObjectPath = forwardedCopyPath;
      }
    } else if (kind === "image" || kind === "file" || kind === "audio") {
      if (typeof objectPath !== "string" || !objectPath.trim()) {
        res.status(400).json({ message: "objectPath is required for image/file/audio messages" });
        return;
      }
      const expectedPrefix = `uploads/${chatStorageScope(room)}/chat/${roomId}/`;
      const normalizedPath = objectPath.replace(/^\/objects\//, "");
      if (!normalizedPath.startsWith(expectedPrefix)) {
        res.status(400).json({ message: "Invalid objectPath for this room" });
        return;
      }
      resolvedObjectPath = objectPath;
    }

    // Validate durationMs for audio (voice note): integer in [1, 600000].
    let resolvedDurationMs: number | null = null;
    if (forwardSource) {
      resolvedDurationMs = forwardSource.message.durationMs ?? null;
    } else if (kind === "audio") {
      if (
        typeof durationMs !== "number" ||
        !Number.isInteger(durationMs) ||
        durationMs < 1 ||
        durationMs > 600000
      ) {
        res.status(400).json({
          message: "durationMs is required for kind=audio and must be an integer between 1 and 600000",
        });
        return;
      }
      resolvedDurationMs = durationMs;
    }

    let mediaClaimToken: string | null = null;
    if (resolvedObjectPath && !forwardedCopyPath) {
      const claim = await claimPendingUpload({
        objectPath: resolvedObjectPath,
        ownerUserId: me.id,
        purpose: "chat",
      });
      if (!claim) {
        res.status(400).json({
          message: "Uploaded attachment is invalid, busy, or does not belong to this account",
        });
        return;
      }
      mediaClaimToken = claim.token;
      try {
        await objectStorageService.getObjectEntityFile(resolvedObjectPath);
      } catch {
        await releasePendingUpload({
          objectPath: resolvedObjectPath,
          ownerUserId: me.id,
          purpose: "chat",
          token: mediaClaimToken,
        });
        res.status(400).json({
          message: "Uploaded attachment is no longer available. Please upload it again.",
          code: "CHAT_MEDIA_EXPIRED",
        });
        return;
      }
      const renewed = await refreshPendingUploadClaim({
        objectPath: resolvedObjectPath,
        ownerUserId: me.id,
        purpose: "chat",
        token: mediaClaimToken,
      });
      if (!renewed) {
        res.status(409).json({
          message: "Attachment processing expired. Please try again.",
          code: "CHAT_MEDIA_CLAIM_EXPIRED",
        });
        return;
      }
    }

    const msgtype: "m.text" | "m.image" | "m.file" | "m.audio" =
      kind === "image"
        ? "m.image"
        : kind === "file"
          ? "m.file"
          : kind === "audio"
            ? "m.audio"
            : "m.text";

    // Sender's deterministic Matrix user ID.
    const senderMatrixUserId = matrixUserIdForApp(me.id);
    // Deterministic transaction id — same across retries → single Matrix event.
    const txnId = matrixTxnId(roomId, me.id, reqId);

    // ── Matrix send (must succeed before any DB write) ──────────────────────
    let providerEventId: string;
    try {
      providerEventId = await matrixSendMessage({
        matrixRoomId: room.providerRoomId,
        senderUserId: senderMatrixUserId,
        msgtype,
        body: effectiveBody,
        url: resolvedObjectPath ?? undefined,
        // For voice notes, include Matrix content info.duration (milliseconds).
        info: resolvedDurationMs !== null ? { duration: resolvedDurationMs } : undefined,
        inReplyToEventId: replyTarget?.providerEventId ?? undefined,
        txnId,
        signal: AbortSignal.timeout(CHAT_PROVIDER_SEND_TIMEOUT_MS),
      });
    } catch (err) {
      if (resolvedObjectPath && mediaClaimToken) {
        await releasePendingUpload({
          objectPath: resolvedObjectPath,
          ownerUserId: me.id,
          purpose: "chat",
          token: mediaClaimToken,
        }).catch(() => undefined);
      }
      if (forwardedCopyPath) {
        await objectStorageService
          .getObjectEntityFile(forwardedCopyPath)
          .then((file) => file.delete())
          .catch(() => undefined);
      }
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (code === "PROVIDER_UNAVAILABLE") {
        res.status(503).json({
          message: "Chat provider not available. Messages cannot be sent at this time.",
          code: "MATRIX_UNAVAILABLE",
        });
      } else {
        console.error("[chat] Matrix sendMessage failed:", describeProviderError(err));
        res.status(503).json({
          message: "Failed to deliver message to chat provider. Please try again.",
          code: "MATRIX_SEND_FAILED",
        });
      }
      return;
    }

    if (resolvedObjectPath && mediaClaimToken) {
      const renewed = await refreshPendingUploadClaim({
        objectPath: resolvedObjectPath,
        ownerUserId: me.id,
        purpose: "chat",
        token: mediaClaimToken,
      });
      if (!renewed) {
        res.status(409).json({
          message: "Attachment processing expired. Please retry this message.",
          code: "CHAT_MEDIA_CLAIM_EXPIRED",
        });
        return;
      }
    }

    // ── Persist after successful Matrix delivery (idempotent on conflict) ────
    const inserted = await db
      .insert(chatMessagesTable)
      .values({
        roomId,
        shopId: room.shopId,
        senderId: me.id,
        senderName: me.name,
        kind,
        body: effectiveBody,
        objectPath: resolvedObjectPath,
        durationMs: resolvedDurationMs,
        providerEventId,
        clientRequestId: reqId,
        replyToMessageId: replyTarget?.id ?? null,
        forwarded: forwardSource !== null,
      })
      .onConflictDoNothing({
        target: [
          chatMessagesTable.roomId,
          chatMessagesTable.senderId,
          chatMessagesTable.clientRequestId,
        ],
        // Match the partial unique index predicate so Postgres uses it as the
        // conflict arbiter (the index is WHERE client_request_id IS NOT NULL).
        where: isNotNull(chatMessagesTable.clientRequestId),
      })
      .returning();

    if (resolvedObjectPath && mediaClaimToken && inserted.length > 0) {
      await completePendingUpload({
        objectPath: resolvedObjectPath,
        ownerUserId: me.id,
        purpose: "chat",
        token: mediaClaimToken,
      }).catch((error) => {
        req.log.warn({ err: error }, "Attached chat upload claim cleanup failed");
      });
    }

    if (inserted.length > 0) {
      const message = inserted[0];
      const preview =
        message.kind === "image"
          ? "Photo"
          : message.kind === "audio"
            ? "Voice message"
            : message.kind === "file"
              ? `Attachment: ${message.body}`
              : message.body;
      void notifyRoomMessageRecipients({
        roomId,
        shopId: room.shopId,
        messageId: message.id,
        senderId: me.id,
        senderName: me.name,
        preview,
      });
      const [formatted] = await formatMessagesWithQuotes([message], me.id);
      res.json({ message: formatted });
      return;
    }

    // Conflict: a concurrent retry inserted first — return the existing row.
    const [raced] = await db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.roomId, roomId),
          eq(chatMessagesTable.senderId, me.id),
          eq(chatMessagesTable.clientRequestId, reqId),
        ),
      )
      .limit(1);
    if (resolvedObjectPath && mediaClaimToken) {
      const finishClaim = raced?.objectPath === resolvedObjectPath
        ? completePendingUpload
        : releasePendingUpload;
      await finishClaim({
        objectPath: resolvedObjectPath,
        ownerUserId: me.id,
        purpose: "chat",
        token: mediaClaimToken,
      }).catch((error) => {
        req.log.warn({ err: error }, "Raced chat upload claim cleanup failed");
      });
    }
    if (forwardedCopyPath && raced?.objectPath !== forwardedCopyPath) {
      await objectStorageService
        .getObjectEntityFile(forwardedCopyPath)
        .then((file) => file.delete())
        .catch(() => undefined);
    }
    const [formattedRaced] = await formatMessagesWithQuotes([raced], me.id);
    res.json({ message: formattedRaced });
  }),
);

/**
 * Delete messages.
 *
 *  scope=me       — caller-specific hide. Any visible message in the room
 *                   qualifies; nothing shared changes.
 *  scope=everyone — only the sender may do this, and only within
 *                   CHAT_DELETE_FOR_EVERYONE_WINDOW_MS of sending; older
 *                   messages can only be deleted for me. The Matrix event is
 *                   redacted first (fail-closed, like sends); the row then
 *                   becomes a tombstone that stays in every member's transcript
 *                   with no body and unreachable media.
 */
/** Sender's window for retracting a message from every member's transcript. */
export const CHAT_DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000;

router.post(
  "/chat/rooms/:roomId/messages/delete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const parsedBody = parseBody(ChatMessagesDeleteBody, req, res);
    if (!parsedBody) return;
    const { scope } = parsedBody;
    const messageIds = [...new Set(parsedBody.messageIds.map((id) => id.trim()))];
    if (messageIds.some((id) => !UUID_RE.test(id))) {
      res.status(404).json({ message: "Message not found" });
      return;
    }

    const rows = await db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          inArray(chatMessagesTable.id, messageIds),
          eq(chatMessagesTable.roomId, roomId),
          notHiddenForUser(me.id),
        ),
      );
    if (rows.length !== messageIds.length) {
      res.status(404).json({ message: "Message not found" });
      return;
    }

    if (scope === "me") {
      await db
        .insert(chatMessageHiddenTable)
        .values(rows.map((row) => ({ messageId: row.id, userId: me.id })))
        .onConflictDoNothing();
      res.json({ deletedIds: rows.map((row) => row.id) });
      return;
    }

    // scope=everyone
    if (rows.some((row) => row.senderId !== me.id)) {
      res.status(403).json({
        message: "You can only delete your own messages for everyone.",
        code: "CHAT_DELETE_NOT_SENDER",
      });
      return;
    }
    const live = rows.filter((row) => row.deletedAt === null);
    // Evaluated server-side against the stored send time — the client's clock
    // and its cached copy of the message are never trusted for the cutoff.
    const cutoff = Date.now() - CHAT_DELETE_FOR_EVERYONE_WINDOW_MS;
    if (live.some((row) => row.createdAt.getTime() < cutoff)) {
      res.status(403).json({
        message: "Messages older than 24 hours can only be deleted for you.",
        code: "CHAT_DELETE_WINDOW_EXPIRED",
      });
      return;
    }
    const needsRedaction = live.filter((row) => !!row.providerEventId);
    if (needsRedaction.length > 0) {
      if (!room.providerRoomId || !matrixConfigured()) {
        res.status(503).json({
          message: "Chat provider not available. Messages cannot be deleted at this time.",
          code: "MATRIX_UNAVAILABLE",
        });
        return;
      }
      const senderMatrixUserId = matrixUserIdForApp(me.id);
      for (const row of needsRedaction) {
        try {
          await matrixRedactEvent({
            matrixRoomId: room.providerRoomId,
            senderUserId: senderMatrixUserId,
            eventId: row.providerEventId!,
            txnId: matrixTxnId(roomId, me.id, `redact:${row.id}`),
            signal: AbortSignal.timeout(CHAT_PROVIDER_SEND_TIMEOUT_MS),
          });
        } catch (err) {
          console.error("[chat] Matrix redact failed:", describeProviderError(err));
          res.status(503).json({
            message: "Failed to delete the message on the chat provider. Please try again.",
            code: "MATRIX_REDACT_FAILED",
          });
          return;
        }
        // Tombstone each event as soon as its redaction succeeds so a later
        // failure in the batch never leaves a redacted event looking live.
        await db
          .update(chatMessagesTable)
          .set({ deletedAt: new Date() })
          .where(and(eq(chatMessagesTable.id, row.id), isNull(chatMessagesTable.deletedAt)));
      }
    }
    const withoutEvent = live.filter((row) => !row.providerEventId);
    if (withoutEvent.length > 0) {
      await db
        .update(chatMessagesTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            inArray(chatMessagesTable.id, withoutEvent.map((row) => row.id)),
            isNull(chatMessagesTable.deletedAt),
          ),
        );
    }
    res.json({ deletedIds: rows.map((row) => row.id) });
  }),
);

// ── Read markers ──────────────────────────────────────────────────────────────

router.post(
  "/chat/rooms/:roomId/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Room not found" });
      return;
    }

    const body = parseBody(ChatMarkReadBody, req, res);
    if (!body) return;
    const { messageId } = body;

    // Verify the message belongs to this room
    const [message] = await db
      .select({ id: chatMessagesTable.id })
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.id, messageId),
          eq(chatMessagesTable.roomId, roomId),
          isNull(chatMessagesTable.deletedAt),
        ),
      )
      .limit(1);
    if (!message) {
      res.status(404).json({ message: "Message not found in this room" });
      return;
    }

    // Upsert read state
    await db
      .insert(chatReadStateTable)
      .values({
        roomId,
        shopId: room.shopId,
        userId: me.id,
        lastReadMessageId: messageId,
        lastReadAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [chatReadStateTable.roomId, chatReadStateTable.userId],
        set: {
          lastReadMessageId: messageId,
          lastReadAt: new Date(),
        },
      });

    res.json({ message: "Read marker updated" });
  }),
);

// ── Upload URL ────────────────────────────────────────────────────────────────

// Allowed MIME types for chat uploads
const CHAT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  // Expo SDK 54 HIGH_QUALITY recorder outputs M4A/AAC on native devices,
  // reported as audio/mp4 (iOS) / audio/x-m4a / audio/aac.
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
]);
const CHAT_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

router.post(
  "/chat/rooms/:roomId/upload-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Room not found" });
      return;
    }

    const directPeerUserId = await getDirectPeerUserId(room, me.id);
    if (directPeerUserId) {
      const blockState = await getBlockState(me.id, directPeerUserId);
      if (blockState.isBlocked) {
        res.status(403).json({
          message: "This conversation is blocked.",
          code: "CHAT_BLOCKED",
        });
        return;
      }
    }

    const body = parseBody(ChatUploadUrlBody, req, res);
    if (!body) return;
    const { name, size, contentType } = body;
    if (
      !name.trim() ||
      !contentType.trim() ||
      size <= 0
    ) {
      res.status(400).json({ error: "Missing or invalid required fields: name, size, contentType" });
      return;
    }

    if (!CHAT_ALLOWED_TYPES.has(contentType.trim().toLowerCase())) {
      res.status(400).json({ error: `Content type not allowed: ${contentType}` });
      return;
    }

    if (size > CHAT_MAX_SIZE) {
      res.status(400).json({ error: `File size exceeds maximum allowed (${CHAT_MAX_SIZE / 1024 / 1024} MB)` });
      return;
    }

    const storageScope = chatStorageScope(room);

    // Sign directly under the chat sub-namespace so the signed URL key and the
    // returned objectPath refer to the exact same storage object.  No post-
    // signing path rewrite is performed.
    //
    // prefix validation in getObjectEntityUploadURLWithPrefix rejects any
    // traversal; shopId and roomId are already UUID-validated above.
    const { uploadURL, objectPath } =
      await objectStorageService.getObjectEntityUploadURLWithPrefix(
         `${storageScope}/chat/${roomId}`,
      );
    await registerPendingUpload({
      objectPath,
      ownerUserId: me.id,
      purpose: "chat",
    });

    res.json({ uploadURL, objectPath });
  }),
);

// ── Call tokens ───────────────────────────────────────────────────────────────

router.post(
  "/chat/rooms/:roomId/call-token",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    if (!UUID_RE.test(roomId)) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Room not found" });
      return;
    }
    const directPeerUserId = await getDirectPeerUserId(room, me.id);
    if (directPeerUserId) {
      const blockState = await getBlockState(me.id, directPeerUserId);
      if (blockState.isBlocked) {
        res.status(403).json({
          message: "This conversation is blocked.",
          code: "CHAT_BLOCKED",
        });
        return;
      }
    }

    // Fail closed: 503 when LiveKit credentials absent
    if (!livekitConfigured()) {
      res.status(503).json({
        message: "Call service not available. Please contact support.",
        code: "LIVEKIT_UNAVAILABLE",
      });
      return;
    }

    const livekitRoomName = `${room.scope === "global_direct" ? "global" : `shop-${room.shopId!.slice(0, 8)}`}-room-${roomId.slice(0, 8)}`;
    const token = livekitMintToken({
      roomName: livekitRoomName,
      participantIdentity: me.id,
      participantName: me.name,
    });

    res.json({
      token,
      url: process.env.LIVEKIT_URL!,
      roomName: livekitRoomName,
      expiresIn: 3600,
    });
  }),
);

// ── Chat media download ───────────────────────────────────────────────────────

/**
 * GET /chat/rooms/:roomId/messages/:messageId/media
 *
 * Authenticated download of a chat media attachment. Authorizes room membership,
 * verifies message ownership (belongs to the room, correct shop), checks the
 * objectPath is a media kind (image/file) with a non-null path under the expected
 * uploads/<shopId>/chat/<roomId>/ namespace, then streams from object storage.
 *
 * Returns 404 for any auth or path failure — never 403 — to prevent enumeration.
 * Customer accounts CANNOT use /storage/objects/* — this is the ONLY download
 * path available to them for chat media.
 */
router.get(
  "/chat/rooms/:roomId/messages/:messageId/media",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const roomId = String(req.params.roomId ?? "");
    const messageId = String(req.params.messageId ?? "");

    if (!UUID_RE.test(roomId) || !UUID_RE.test(messageId)) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    const room = await authorizeRoom(me, roomId);
    if (!room) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    // Load the message — must belong to this room + shop, not deleted, and
    // not hidden by the caller ("delete for me" also removes media access).
    const [msg] = await db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.id, messageId),
          eq(chatMessagesTable.roomId, roomId),
          isNull(chatMessagesTable.deletedAt),
          notHiddenForUser(me.id),
        ),
      )
      .limit(1);

    if (!msg) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    // Must be a media kind (image / file / audio)
    if (msg.kind !== "image" && msg.kind !== "file" && msg.kind !== "audio") {
      res.status(404).json({ message: "Not found" });
      return;
    }

    // objectPath must be set and under the correct chat namespace
    if (!msg.objectPath) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const expectedPrefix = `/objects/uploads/${chatStorageScope(room)}/chat/${roomId}/`;
    if (!msg.objectPath.startsWith(expectedPrefix)) {
      // Path doesn't match chat namespace — treat as not found
      res.status(404).json({ message: "Not found" });
      return;
    }

    // Stream from object storage
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(msg.objectPath);
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        Readable.fromWeb(
          response.body as unknown as import("stream/web").ReadableStream<Uint8Array>,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      const { ObjectNotFoundError } = await import("../lib/objectStorage");
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ message: "Not found" });
        return;
      }
      throw err;
    }
  }),
);

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatRoom(room: typeof chatRoomsTable.$inferSelect) {
  return {
    id: room.id,
    shopId: room.shopId,
    scope: room.scope,
    kind: room.kind,
    name: room.name,
    customerId: room.customerId ?? undefined,
    dealerId: room.dealerId ?? undefined,
    providerRoomId: room.providerRoomId ?? undefined,
    peerKey: room.peerKey ?? undefined,
    isArchived: room.isArchived,
    createdById: room.createdById ?? undefined,
    createdByName: room.createdByName ?? undefined,
    createdAt: room.createdAt.toISOString(),
  };
}

function chatStorageScope(room: typeof chatRoomsTable.$inferSelect): string {
  return room.scope === "global_direct" ? "global" : room.shopId!;
}

async function formatRoomForUser(
  room: typeof chatRoomsTable.$inferSelect,
  viewerUserId: string,
  suppliedPreference?: typeof chatRoomPreferencesTable.$inferSelect | null,
) {
  const base = formatRoom(room);

  const [[peer], [storedPreference]] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        mobile: usersTable.mobile,
        profilePhoto: usersTable.profilePhoto,
        lastSyncedAt: chatRoomMembersTable.lastSyncedAt,
      })
      .from(chatRoomMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, chatRoomMembersTable.userId))
      .where(
        and(
          eq(chatRoomMembersTable.roomId, room.id),
          ne(chatRoomMembersTable.userId, viewerUserId),
          eq(usersTable.isActive, true),
        ),
      )
      .limit(1),
    suppliedPreference === undefined
      ? db
          .select()
          .from(chatRoomPreferencesTable)
          .where(
            and(
              eq(chatRoomPreferencesTable.roomId, room.id),
              eq(chatRoomPreferencesTable.userId, viewerUserId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  const preference = suppliedPreference === undefined ? storedPreference : suppliedPreference;

  const blockState =
    room.scope === "global_direct" && peer
      ? await getBlockState(viewerUserId, peer.id)
      : { isBlocked: false, blockedByMe: false };
  return {
    ...base,
    name: peer?.name ?? base.name,
    peerUserId: peer?.id,
    peerMobile: peer?.mobile ?? undefined,
    profilePhoto: peer?.profilePhoto ?? undefined,
    peerOnline:
      !!peer?.lastSyncedAt &&
      peer.lastSyncedAt.getTime() >= Date.now() - 20_000,
    peerLastSeenAt: peer?.lastSyncedAt?.toISOString(),
    ...blockState,
    ...formatRoomPreference(preference),
  };
}

function formatRoomPreference(preference: typeof chatRoomPreferencesTable.$inferSelect | null | undefined) {
  return {
    isPinned: preference?.isPinned ?? false,
    isMuted: preference?.isMuted ?? false,
    isArchived: preference?.isArchived ?? false,
    updatedAt: (preference?.updatedAt ?? new Date(0)).toISOString(),
  };
}

type ChatMessageRow = typeof chatMessagesTable.$inferSelect;

type ChatMessageQuote = {
  id: string;
  senderId: string;
  senderName: string;
  kind: string;
  body: string;
  deleted: boolean;
};

/** SQL predicate: the message row is not hidden ("deleted for me") by userId. */
function notHiddenForUser(userId: string) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(chatMessageHiddenTable)
      .where(
        and(
          eq(chatMessageHiddenTable.messageId, chatMessagesTable.id),
          eq(chatMessageHiddenTable.userId, userId),
        ),
      ),
  );
}

/**
 * Format a message row for API responses. A tombstone ("deleted for everyone")
 * keeps its kind and timestamps but never exposes its body or media: the
 * original text stays in the row for moderation only.
 */
function formatMessage(msg: ChatMessageRow, replyTo?: ChatMessageQuote | null) {
  const deleted = msg.deletedAt !== null && msg.deletedAt !== undefined;
  return {
    id: msg.id,
    roomId: msg.roomId,
    shopId: msg.shopId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    kind: msg.kind,
    body: deleted ? "" : msg.body,
    objectPath: deleted ? undefined : msg.objectPath ?? undefined,
    durationMs: deleted ? undefined : msg.durationMs ?? undefined,
    clientRequestId: msg.clientRequestId ?? undefined,
    replyTo: deleted ? undefined : replyTo ?? undefined,
    forwarded: msg.forwarded ? true : undefined,
    deletedAt: msg.deletedAt?.toISOString() ?? undefined,
    createdAt: msg.createdAt.toISOString(),
  };
}

/**
 * Build reply snapshots for a batch of rows. A quoted message the viewer can no
 * longer see (deleted for everyone, or hidden by the viewer) is reported as
 * deleted so the client renders a neutral placeholder rather than the text.
 */
async function formatMessagesWithQuotes(rows: ChatMessageRow[], viewerUserId: string) {
  const quotedIds = [...new Set(rows.map((r) => r.replyToMessageId).filter((id): id is string => !!id))];
  const quotes = new Map<string, ChatMessageQuote>();
  if (quotedIds.length > 0) {
    const quotedRows = await db
      .select({
        id: chatMessagesTable.id,
        senderId: chatMessagesTable.senderId,
        senderName: chatMessagesTable.senderName,
        kind: chatMessagesTable.kind,
        body: chatMessagesTable.body,
        deletedAt: chatMessagesTable.deletedAt,
        hidden: sql<boolean>`EXISTS (
          SELECT 1 FROM ${chatMessageHiddenTable}
          WHERE ${chatMessageHiddenTable.messageId} = ${chatMessagesTable.id}
            AND ${chatMessageHiddenTable.userId} = ${viewerUserId}
        )`,
      })
      .from(chatMessagesTable)
      .where(inArray(chatMessagesTable.id, quotedIds));
    for (const q of quotedRows) {
      const gone = q.deletedAt !== null || q.hidden === true;
      quotes.set(q.id, {
        id: q.id,
        senderId: q.senderId,
        senderName: q.senderName,
        kind: q.kind,
        body: gone ? "" : q.body,
        deleted: gone,
      });
    }
  }
  return rows.map((row) => {
    const quote = row.replyToMessageId ? quotes.get(row.replyToMessageId) : undefined;
    return formatMessage(
      row,
      row.replyToMessageId
        ? quote ?? {
            id: row.replyToMessageId,
            senderId: "",
            senderName: "",
            kind: "text",
            body: "",
            deleted: true,
          }
        : undefined,
    );
  });
}

async function formatRoomSummaryForUser(
  room: typeof chatRoomsTable.$inferSelect,
  viewerUserId: string,
  viewerJoinedAt: Date,
  preference?: typeof chatRoomPreferencesTable.$inferSelect | null,
) {
  const [
    base,
    [lastMessage],
    [viewerReadState],
    [peerMember],
    [peerReadState],
  ] = await Promise.all([
    formatRoomForUser(room, viewerUserId, preference),
    db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.roomId, room.id),
          isNull(chatMessagesTable.deletedAt),
          notHiddenForUser(viewerUserId),
        ),
      )
      .orderBy(desc(chatMessagesTable.createdAt))
      .limit(1),
    db
      .select({ lastReadAt: chatReadStateTable.lastReadAt })
      .from(chatReadStateTable)
      .where(
        and(
          eq(chatReadStateTable.roomId, room.id),
          eq(chatReadStateTable.userId, viewerUserId),
        ),
      )
      .limit(1),
    db
      .select({
        userId: chatRoomMembersTable.userId,
        lastSyncedAt: chatRoomMembersTable.lastSyncedAt,
      })
      .from(chatRoomMembersTable)
      .where(
        and(
          eq(chatRoomMembersTable.roomId, room.id),
          ne(chatRoomMembersTable.userId, viewerUserId),
        ),
      )
      .orderBy(desc(chatRoomMembersTable.lastSyncedAt))
      .limit(1),
    db
      .select({
        userId: chatReadStateTable.userId,
        lastReadAt: chatReadStateTable.lastReadAt,
      })
      .from(chatReadStateTable)
      .where(
        and(
          eq(chatReadStateTable.roomId, room.id),
          ne(chatReadStateTable.userId, viewerUserId),
        ),
      )
      .orderBy(desc(chatReadStateTable.lastReadAt))
      .limit(1),
  ]);

  const unreadSince = viewerReadState?.lastReadAt ?? viewerJoinedAt;
  const [unread] = await db
    .select({ value: count() })
    .from(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.roomId, room.id),
        ne(chatMessagesTable.senderId, viewerUserId),
        isNull(chatMessagesTable.deletedAt),
        gte(chatMessagesTable.createdAt, unreadSince),
      ),
    );

  let lastMessageStatus: "sent" | "delivered" | "read" | undefined;
  if (lastMessage?.senderId === viewerUserId) {
    if (peerReadState?.lastReadAt && peerReadState.lastReadAt >= lastMessage.createdAt) {
      lastMessageStatus = "read";
    } else if (peerMember?.lastSyncedAt && peerMember.lastSyncedAt >= lastMessage.createdAt) {
      lastMessageStatus = "delivered";
    } else {
      lastMessageStatus = "sent";
    }
  }

  return {
    ...base,
    ...formatRoomPreference(preference),
    unreadCount: Number(unread?.value ?? 0),
    lastMessage: lastMessage ? formatMessage(lastMessage) : undefined,
    lastMessageStatus,
  };
}

export default router;
