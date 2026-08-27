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
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
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
import { ObjectStorageService } from "../lib/objectStorage";
import {
  chatCapabilities,
  livekitConfigured,
  livekitMintToken,
  matrixConfigured,
  matrixProvisionDirectRoom,
  matrixProvisionTimeoutMs,
  matrixSendMessage,
  matrixUserIdForApp,
  matrixTxnId,
} from "../lib/chatProviders";
import { generateToken, sha256 } from "../lib/authUtils";

const router: IRouter = Router();
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
    console.error("[chat] Matrix room/participant provisioning failed:", (err as Error).message);
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
    const { token, name } = req.body ?? {};
    if (
      typeof token !== "string" || !token.trim() ||
      typeof name !== "string" || !name.trim()
    ) {
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

      return created;
    });

    const { publicUser } = await import("../lib/authUtils");
    res.json({
      message: "Account activated. Sign in with a mobile OTP to continue.",
      user: publicUser(newUser),
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

router.get(
  "/chat/rooms",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const shopId = resolveShopId(me);
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
          or(
            eq(chatRoomsTable.scope, "global_direct"),
            shopId ? and(eq(chatRoomsTable.scope, "shop"), eq(chatRoomsTable.shopId, shopId)) : sql`false`,
          ),
          eq(chatRoomMembersTable.userId, me.id),
        ),
      )
      .orderBy(desc(chatRoomsTable.createdAt));

    res.json({
      rooms: await Promise.all(rows.map((r) => formatRoomForUser(r.room, me.id))),
    });
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

    // Accept a single phone string or a bounded array.
    const { phone, phones } = req.body ?? {};

    // Build the raw list from either input.
    let rawList: unknown[];
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
      .filter((p): p is string => typeof p === "string")
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

    const {
      name,
      kind,
      customerId,
      dealerId,
      targetUserId: bodyTargetUserId,
      matchToken,
      clientRequestId,
    } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "name is required" });
      return;
    }
    // Customers may only create kind=direct rooms.
    if (me.role === "customer" && kind !== "direct") {
      res.status(403).json({ message: "Customers may only create direct chat rooms (kind=direct)" });
      return;
    }
    // Only supported kinds.
    const validKinds = ["customer", "dealer", "direct"] as const;
    if (typeof kind !== "string" || !(validKinds as readonly string[]).includes(kind)) {
      res.status(400).json({
        message: "kind must be one of: customer, dealer, direct (support/group not supported yet)",
      });
      return;
    }
    if (kind !== "direct" && !shopId) {
      res.status(403).json({ message: "Your account is not linked to a shop" });
      return;
    }
    const roomScope = kind === "direct" ? "global_direct" as const : "shop" as const;

    // ── Idempotency #1: clientRequestId ────────────────────────────────────
    if (typeof clientRequestId === "string" && clientRequestId.trim()) {
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
        typeof bodyTargetUserId !== "string" ||
        !UUID_RE.test(bodyTargetUserId.trim()) ||
        typeof matchToken !== "string" ||
        !matchToken.trim()
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
      if (typeof customerId !== "string" || !customerId.trim()) {
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
      if (typeof dealerId !== "string" || !dealerId.trim()) {
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
                  eq(chatContactMatchGrantsTable.tokenHash, sha256(matchToken.trim())),
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
                  eq(chatContactMatchGrantsTable.tokenHash, sha256(matchToken.trim())),
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
          const tokenHash = sha256(matchToken.trim());
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
              eq(chatContactMatchGrantsTable.tokenHash, sha256(matchToken.trim())),
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

const CHAT_REPORT_REASONS = [
  "spam",
  "harassment",
  "scam",
  "inappropriate",
  "other",
] as const;

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

    const { clientRequestId, reason, messageId, details } = req.body ?? {};
    if (
      typeof clientRequestId !== "string" ||
      !clientRequestId.trim() ||
      clientRequestId.trim().length > 200
    ) {
      res.status(400).json({ message: "clientRequestId is required" });
      return;
    }
    if (
      typeof reason !== "string" ||
      !(CHAT_REPORT_REASONS as readonly string[]).includes(reason)
    ) {
      res.status(400).json({
        message: `reason must be one of: ${CHAT_REPORT_REASONS.join(", ")}`,
      });
      return;
    }
    if (
      messageId !== undefined &&
      (typeof messageId !== "string" || !UUID_RE.test(messageId))
    ) {
      res.status(400).json({ message: "messageId must be a valid message in this room" });
      return;
    }
    if (
      details !== undefined &&
      (typeof details !== "string" || details.trim().length > 1000)
    ) {
      res.status(400).json({ message: "details must be a string of at most 1000 characters" });
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
          details:
            typeof details === "string" && details.trim() ? details.trim() : null,
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

    // Load the message — must belong to this room + shop, not deleted
    const [msg] = await db
      .select()
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.id, messageId),
          eq(chatMessagesTable.roomId, roomId),
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
) {
  const base = formatRoom(room);
  if (room.kind !== "direct") return base;

  const [peer] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      profilePhoto: usersTable.profilePhoto,
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
    .limit(1);

  const blockState =
    room.scope === "global_direct" && peer
      ? await getBlockState(viewerUserId, peer.id)
      : { isBlocked: false, blockedByMe: false };
  return {
    ...base,
    name: peer?.name ?? base.name,
    peerUserId: peer?.id,
    profilePhoto: peer?.profilePhoto ?? undefined,
    ...blockState,
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
