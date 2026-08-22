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
 *   - Matrix provisioning is called first. If it fails → 503 MATRIX_UNAVAILABLE,
 *     zero DB writes. No null-providerRoomId rooms are ever created.
 *   - Idempotency: a clientRequestId that already maps to a room returns that
 *     room (which by definition already has a providerRoomId).
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
import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import {
  db,
  usersTable,
  customersTable,
  customerUsersTable,
  customerInvitesTable,
  dealersTable,
  chatRoomsTable,
  chatRoomMembersTable,
  chatMessagesTable,
  chatReadStateTable,
  chatProviderIdentitiesTable,
  type DbUser,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  chatCapabilities,
  livekitConfigured,
  livekitMintToken,
  matrixConfigured,
  matrixProvisionDirectRoom,
  matrixSendMessage,
  matrixUserIdForApp,
  matrixTxnId,
} from "../lib/chatProviders";
import { hashPassword, generateToken, sha256 } from "../lib/authUtils";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

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
  if (!shopId) return null;

  // Room must exist, be in the caller's shop, AND the caller must be a member.
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
        eq(chatRoomsTable.shopId, shopId),
        eq(chatRoomMembersTable.userId, user.id),
      ),
    )
    .limit(1);

  return row?.room ?? null;
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
      .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId)))
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
      shopId,
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
    const { token, name, password } = req.body ?? {};
    if (
      typeof token !== "string" || !token.trim() ||
      typeof name !== "string" || !name.trim() ||
      typeof password !== "string"
    ) {
      res.status(400).json({ message: "token, name and password are required" });
      return;
    }

    if (!validPassword(password)) {
      res.status(400).json({
        message: "Password must be 8+ characters with uppercase, lowercase and a number",
      });
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

    // Check no user account exists for this customer yet
    const [alreadyLinked] = await db
      .select({ id: customerUsersTable.id })
      .from(customerUsersTable)
      .where(eq(customerUsersTable.customerId, invite.customerId))
      .limit(1);
    if (alreadyLinked) {
      await db
        .update(customerInvitesTable)
        .set({ consumedAt: now })
        .where(eq(customerInvitesTable.id, invite.id));
      res.status(409).json({ message: "A user account already exists for this customer" });
      return;
    }

    // Synthesize email if the customer record lacks one
    const email = customer.email?.trim()
      ? customer.email.trim().toLowerCase()
      : `customer-${customer.id}@shop-${invite.shopId}.local`;

    // Check uniqueness of email/mobile in users table
    const { or } = await import("drizzle-orm");
    const clash = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(or(eq(usersTable.email, email), eq(usersTable.mobile, customer.mobile)))
      .limit(1);
    if (clash.length > 0) {
      res.status(409).json({ message: "An account with this email or mobile already exists" });
      return;
    }

    // Create user account + customer_users link + mark invite consumed — atomically
    const newUser = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(usersTable)
        .values({
          name: name.trim().slice(0, 120),
          email,
          mobile: customer.mobile,
          passwordHash: hashPassword(password),
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

      return created;
    });

    const { createSession, publicUser, recordLoginEvent } = await import("../lib/authUtils");
    const sessionToken = await createSession(newUser.id, false, null);
    await recordLoginEvent(newUser.id, "password", false, null);

    res.json({ token: sessionToken, user: publicUser(newUser) });
  }),
);

function validPassword(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length >= 8 &&
    /[A-Z]/.test(p) &&
    /[a-z]/.test(p) &&
    /[0-9]/.test(p)
  );
}

// ── Chat capabilities ─────────────────────────────────────────────────────────

router.get(
  "/chat/capabilities",
  requireAuth,
  (req, res) => {
    res.json(chatCapabilities());
  },
);

// ── Chat rooms ────────────────────────────────────────────────────────────────

router.get(
  "/chat/rooms",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const shopId = resolveShopId(me);
    if (!shopId) {
      res.json({ rooms: [] });
      return;
    }

    // Membership is required for EVERY role: only rooms the caller is an
    // explicit member of are returned. No shop-wide staff bypass.
    const rows = await db
      .select({ room: chatRoomsTable })
      .from(chatRoomsTable)
      .innerJoin(
        chatRoomMembersTable,
        eq(chatRoomsTable.id, chatRoomMembersTable.roomId),
      )
      .where(
        and(
          eq(chatRoomsTable.shopId, shopId),
          eq(chatRoomMembersTable.userId, me.id),
        ),
      )
      .orderBy(desc(chatRoomsTable.createdAt));

    res.json({ rooms: rows.map((r) => formatRoom(r.room)) });
  }),
);

/**
 * Compute the deterministic peerKey for a one-to-one room: the two participant
 * app user IDs sorted ascending and joined with ":".
 */
function computePeerKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}

router.post(
  "/chat/rooms",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const shopId = resolveShopId(me);
    if (!shopId) {
      res.status(403).json({ message: "Your account is not linked to a shop" });
      return;
    }

    // Customers cannot create rooms
    if (me.role === "customer") {
      res.status(403).json({ message: "Customers cannot create chat rooms" });
      return;
    }

    const { name, kind, customerId, dealerId, clientRequestId } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "name is required" });
      return;
    }
    // Only one-to-one kinds are in scope. support/group are rejected.
    const validKinds = ["customer", "dealer"] as const;
    if (typeof kind !== "string" || !(validKinds as readonly string[]).includes(kind)) {
      res.status(400).json({
        message: "kind must be one of: customer, dealer (support/group not supported yet)",
      });
      return;
    }

    // ── Idempotency #1: clientRequestId ────────────────────────────────────
    if (typeof clientRequestId === "string" && clientRequestId.trim()) {
      const [existing] = await db
        .select()
        .from(chatRoomsTable)
        .where(
          and(
            eq(chatRoomsTable.shopId, shopId),
            eq(chatRoomsTable.clientRequestId, clientRequestId.trim()),
          ),
        )
        .limit(1);
      if (existing) {
        res.json({ room: formatRoom(existing), created: false });
        return;
      }
    }

    // ── Resolve the single target participant account (fail closed) ────────
    // targetUserId is the app user id of the OTHER participant.
    let targetUserId: string;
    let resolvedCustomerId: string | null = null;
    let resolvedDealerId: string | null = null;

    if (kind === "customer") {
      if (typeof customerId !== "string" || !customerId.trim()) {
        res.status(400).json({ message: "customerId is required for kind=customer" });
        return;
      }
      // Customer must belong to this shop
      const [cust] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(and(eq(customersTable.id, customerId), eq(customersTable.shopId, shopId)))
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
            eq(customerUsersTable.shopId, shopId),
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
      if (typeof dealerId !== "string" || !dealerId.trim()) {
        res.status(400).json({ message: "dealerId is required for kind=dealer" });
        return;
      }
      // Dealer must belong to this shop
      const [dealer] = await db
        .select({ id: dealersTable.id })
        .from(dealersTable)
        .where(and(eq(dealersTable.id, dealerId), eq(dealersTable.shopId, shopId)))
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
            eq(usersTable.shopId, shopId),
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

    // A one-to-one room with yourself is not allowed.
    if (targetUserId === me.id) {
      res.status(400).json({ message: "Cannot create a chat room with yourself" });
      return;
    }

    const peerKey = computePeerKey(me.id, targetUserId);

    // ── Idempotency #2: peerKey (independent of clientRequestId) ────────────
    const [existingByPeer] = await db
      .select()
      .from(chatRoomsTable)
      .where(
        and(eq(chatRoomsTable.shopId, shopId), eq(chatRoomsTable.peerKey, peerKey)),
      )
      .limit(1);
    if (existingByPeer) {
      res.json({ room: formatRoom(existingByPeer), created: false });
      return;
    }

    // ── Matrix is REQUIRED — fail closed before any DB write ───────────────
    if (!matrixConfigured()) {
      res.status(503).json({
        message: "Chat provider not configured. Room creation requires Matrix/ESS.",
        code: "MATRIX_UNAVAILABLE",
      });
      return;
    }

    // Load target's display name for provisioning.
    const [targetUser] = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId))
      .limit(1);
    if (!targetUser) {
      // Should not happen (we resolved it above) but fail closed.
      res.status(409).json({
        message: "Target account could not be resolved.",
        code: kind === "customer" ? "CUSTOMER_ACCOUNT_REQUIRED" : "DEALER_ACCOUNT_REQUIRED",
      });
      return;
    }

    // ── Provider provisioning (pure Application Service semantics) ──────────
    // A room is NOT persisted until the provider room is created AND both
    // virtual participants are ensured + joined AND the homeserver reports
    // EXACTLY the two expected Matrix IDs as joined members. Any failure —
    // including a membership mismatch (e.g. a leaked admin/provisioning
    // identity) — yields 503 with zero DB writes.
    //
    // The initiating participant (the creator, `me`) creates the private/direct
    // room via AS impersonation and invites exactly the target virtual user;
    // the target joins via AS impersonation. No admin identity ever becomes a
    // member. See matrixProvisionDirectRoom for the exact endpoints/ordering.
    let providerRoomId: string;
    let creatorMatrixUserId: string;
    let targetMatrixUserId: string;
    try {
      const provisioned = await matrixProvisionDirectRoom({
        name: name.trim(),
        topic: `Shop chat: ${name.trim()}`,
        initiator: { appUserId: me.id, displayName: me.name },
        target: { appUserId: targetUser.id, displayName: targetUser.name },
      });
      providerRoomId = provisioned.matrixRoomId;
      creatorMatrixUserId = provisioned.initiatorUserId;
      targetMatrixUserId = provisioned.targetUserId;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      console.error("[chat] Matrix room/participant provisioning failed:", (err as Error).message);
      res.status(503).json({
        message:
          code === "PROVIDER_UNAVAILABLE"
            ? "Chat provider not available. Room not created."
            : "Failed to provision room and participants on chat provider. Room not created.",
        code: "MATRIX_UNAVAILABLE",
      });
      return;
    }

    // ── Persist room + BOTH members + provider identities in ONE transaction ─
    let room: typeof chatRoomsTable.$inferSelect;
    try {
      room = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(chatRoomsTable)
          .values({
            shopId,
            kind: kind as "customer" | "dealer",
            name: name.trim().slice(0, 200),
            customerId: resolvedCustomerId,
            dealerId: resolvedDealerId,
            providerRoomId,
            peerKey,
            clientRequestId:
              typeof clientRequestId === "string" && clientRequestId.trim()
                ? clientRequestId.trim()
                : null,
            createdById: me.id,
            createdByName: me.name,
          })
          .returning();

        // Exactly two application members: creator + resolved target.
        await tx.insert(chatRoomMembersTable).values([
          { roomId: created.id, shopId, userId: me.id, role: "moderator" },
          { roomId: created.id, shopId, userId: targetUserId, role: "member" },
        ]);

        // Record provider identities (idempotent upsert on (user, provider)).
        await tx
          .insert(chatProviderIdentitiesTable)
          .values([
            { userId: me.id, shopId, provider: "matrix", providerUserId: creatorMatrixUserId },
            { userId: targetUserId, shopId, provider: "matrix", providerUserId: targetMatrixUserId },
          ])
          .onConflictDoNothing({
            target: [chatProviderIdentitiesTable.userId, chatProviderIdentitiesTable.provider],
          });

        return created;
      });
    } catch (err) {
      // A concurrent request may have won the peerKey race — return that room.
      const [raced] = await db
        .select()
        .from(chatRoomsTable)
        .where(
          and(eq(chatRoomsTable.shopId, shopId), eq(chatRoomsTable.peerKey, peerKey)),
        )
        .limit(1);
      if (raced) {
        res.json({ room: formatRoom(raced), created: false });
        return;
      }
      throw err;
    }

    res.json({ room: formatRoom(room), created: true });
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
    res.json({ room: formatRoom(room) });
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

    const limit = Math.min(
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || MAX_MESSAGES : MAX_MESSAGES,
      MAX_MESSAGES,
    );
    const before = typeof req.query.before === "string" ? req.query.before : undefined;

    let whereClause = and(
      eq(chatMessagesTable.roomId, roomId),
      eq(chatMessagesTable.shopId, room.shopId),
      isNull(chatMessagesTable.deletedAt),
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
      messages: messages.map(formatMessage),
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

    const { kind, body, objectPath, durationMs, clientRequestId } = req.body ?? {};

    // clientRequestId is required and must be a stable non-empty string.
    if (typeof clientRequestId !== "string" || !clientRequestId.trim()) {
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
      res.json({ message: formatMessage(existingMsg) });
      return;
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

    const validKinds = ["text", "image", "file", "audio"] as const;
    if (typeof kind !== "string" || !(validKinds as readonly string[]).includes(kind)) {
      res.status(400).json({ message: "kind must be one of: text, image, file, audio" });
      return;
    }
    if (typeof body !== "string" || !body.trim()) {
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
    if (kind === "image" || kind === "file" || kind === "audio") {
      if (typeof objectPath !== "string" || !objectPath.trim()) {
        res.status(400).json({ message: "objectPath is required for image/file/audio messages" });
        return;
      }
      const expectedPrefix = `uploads/${room.shopId}/chat/${roomId}/`;
      const normalizedPath = objectPath.replace(/^\/objects\//, "");
      if (!normalizedPath.startsWith(expectedPrefix)) {
        res.status(400).json({ message: "Invalid objectPath for this room" });
        return;
      }
      resolvedObjectPath = objectPath;
    }

    // Validate durationMs for audio (voice note): integer in [1, 600000].
    let resolvedDurationMs: number | null = null;
    if (kind === "audio") {
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
        body: body.trim().slice(0, 4000),
        url: resolvedObjectPath ?? undefined,
        // For voice notes, include Matrix content info.duration (milliseconds).
        info: resolvedDurationMs !== null ? { duration: resolvedDurationMs } : undefined,
        txnId,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (code === "PROVIDER_UNAVAILABLE") {
        res.status(503).json({
          message: "Chat provider not available. Messages cannot be sent at this time.",
          code: "MATRIX_UNAVAILABLE",
        });
      } else {
        console.error("[chat] Matrix sendMessage failed:", (err as Error).message);
        res.status(503).json({
          message: "Failed to deliver message to chat provider. Please try again.",
          code: "MATRIX_SEND_FAILED",
        });
      }
      return;
    }

    // ── Persist after successful Matrix delivery (idempotent on conflict) ────
    const inserted = await db
      .insert(chatMessagesTable)
      .values({
        roomId,
        shopId: room.shopId,
        senderId: me.id,
        senderName: me.name,
        kind: kind as "text" | "image" | "file" | "audio",
        body: body.trim().slice(0, 4000),
        objectPath: resolvedObjectPath,
        durationMs: resolvedDurationMs,
        providerEventId,
        clientRequestId: reqId,
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

    if (inserted.length > 0) {
      res.json({ message: formatMessage(inserted[0]) });
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
    res.json({ message: formatMessage(raced) });
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

    const { messageId } = req.body ?? {};
    if (typeof messageId !== "string") {
      res.status(400).json({ message: "messageId is required" });
      return;
    }

    // Verify the message belongs to this room
    const [message] = await db
      .select({ id: chatMessagesTable.id })
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.id, messageId),
          eq(chatMessagesTable.roomId, roomId),
          eq(chatMessagesTable.shopId, room.shopId),
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

    const { name, size, contentType } = req.body ?? {};
    if (
      typeof name !== "string" || !name.trim() ||
      typeof contentType !== "string" || !contentType.trim() ||
      typeof size !== "number" || size <= 0
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

    const shopId = room.shopId;

    // Sign directly under the chat sub-namespace so the signed URL key and the
    // returned objectPath refer to the exact same storage object.  No post-
    // signing path rewrite is performed.
    //
    // prefix validation in getObjectEntityUploadURLWithPrefix rejects any
    // traversal; shopId and roomId are already UUID-validated above.
    const { uploadURL, objectPath } =
      await objectStorageService.getObjectEntityUploadURLWithPrefix(
        `${shopId}/chat/${roomId}`,
      );

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

    // Fail closed: 503 when LiveKit credentials absent
    if (!livekitConfigured()) {
      res.status(503).json({
        message: "Call service not available. Please contact support.",
        code: "LIVEKIT_UNAVAILABLE",
      });
      return;
    }

    const livekitRoomName = `shop-${room.shopId.slice(0, 8)}-room-${roomId.slice(0, 8)}`;
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

    // Load the message — must belong to this room + shop, not deleted
    const [msg] = await db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.id, messageId),
          eq(chatMessagesTable.roomId, roomId),
          eq(chatMessagesTable.shopId, room.shopId),
          isNull(chatMessagesTable.deletedAt),
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
    const expectedPrefix = `/objects/uploads/${room.shopId}/chat/${roomId}/`;
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

function formatMessage(msg: typeof chatMessagesTable.$inferSelect) {
  return {
    id: msg.id,
    roomId: msg.roomId,
    shopId: msg.shopId,
    senderId: msg.senderId,
    senderName: msg.senderName,
    kind: msg.kind,
    body: msg.body,
    objectPath: msg.objectPath ?? undefined,
    durationMs: msg.durationMs ?? undefined,
    clientRequestId: msg.clientRequestId ?? undefined,
    deletedAt: msg.deletedAt?.toISOString() ?? undefined,
    createdAt: msg.createdAt.toISOString(),
  };
}

export default router;
