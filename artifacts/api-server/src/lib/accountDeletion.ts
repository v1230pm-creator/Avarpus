import { and, count, eq, inArray, like, ne, notInArray, or, sql } from "drizzle-orm";
import {
  chatBlocksTable,
  chatContactMatchAttemptsTable,
  chatContactMatchGrantsTable,
  chatMessageHiddenTable,
  chatMessagesTable,
  chatProviderIdentitiesTable,
  chatReadStateTable,
  chatRoomMembersTable,
  chatRoomPreferencesTable,
  chatRoomsTable,
  customersTable,
  customerUsersTable,
  db,
  driveBackupConnectionsTable,
  driveBackupOauthStatesTable,
  driveBackupSettingsTable,
  notificationsTable,
  otpCodesTable,
  pendingUploadsTable,
  repairsTable,
  sessionsTable,
  shopMembershipsTable,
  shopsTable,
  statusUpdatesTable,
  statusViewersTable,
  trustedDeviceTrustsTable,
  userFeatureSettingsTable,
  usersTable,
  type DbUser,
} from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import { matrixConfigured, matrixLeaveRoomAs, matrixUserIdForApp } from "./chatProviders";
import { invalidateUserFeatureCache } from "./roleFeatures";
import { clearedWorkspaceMirror, workspaceMirror } from "./workspaceMirror";
import { resolveStorageSweepPolicy } from "./storageSweeps";

// ── Permanent account deletion ───────────────────────────────────────────────
// One Avarpus account (a `users` row) carries two independent layers:
//
//   Chat     — Matrix identity, room memberships, authored messages and their
//              attachments, statuses, blocks, contact grants, chat settings.
//   Business — the Shops this account is the registered owner of (deleted
//              whole: repairs, customers, khata, inventory, purchases, staff,
//              dealers, files…), its memberships in other people's Shops
//              (membership only — their business stays theirs), its
//              dealer-portal link, and the workspace mirror on the users row.
//
// `both` removes the users row itself afterwards, which cascades everything
// that is keyed by the account (sessions, push tokens, trusted devices, drive
// backup, notifications, …). The row's UUID is random and never reused, so
// the same mobile number later becomes a brand-new first-time account.
//
// Postgres is the source of truth. Object-storage files and Matrix room
// memberships are cleaned up after the transaction commits; a failure there is
// logged and leaves nothing reachable, because every row that pointed at the
// object or room is already gone.

export type AccountDeletionScope = "chat" | "business" | "both";

export type OwnedShopPreview = {
  id: string;
  businessName: string;
  otherMemberCount: number;
  repairCount: number;
  customerCount: number;
};

export type AccountDeletionPreview = {
  chat: { allowed: boolean; reason: string | null; conversationCount: number; statusCount: number };
  business: {
    allowed: boolean;
    reason: string | null;
    ownedShops: OwnedShopPreview[];
    membershipCount: number;
    dealerPortalLinked: boolean;
  };
};

export const SUPER_ADMIN_DELETE_BLOCKED =
  "Platform administrator accounts cannot be deleted from the app. Ask another administrator to remove this account.";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type Logger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

// Post-commit cleanup collected while the transaction runs.
type Cleanup = {
  // Individual object paths whose owning rows were deleted. Each is checked
  // for surviving references before removal (forwards copy objects, but a
  // legacy row may still share one).
  objectPaths: Set<string>;
  // Whole namespaces whose owning entity no longer exists.
  objectPrefixes: Set<string>;
  // Matrix rooms to leave as the account's virtual user.
  matrixRoomIds: Set<string>;
  matrixUserId: string | null;
};

function newCleanup(): Cleanup {
  return { objectPaths: new Set(), objectPrefixes: new Set(), matrixRoomIds: new Set(), matrixUserId: null };
}

export function scopeIncludesChat(scope: AccountDeletionScope): boolean {
  return scope === "chat" || scope === "both";
}

export function scopeIncludesBusiness(scope: AccountDeletionScope): boolean {
  return scope === "business" || scope === "both";
}

// ── Preview ──────────────────────────────────────────────────────────────────

export async function previewAccountDeletion(user: DbUser): Promise<AccountDeletionPreview> {
  const [[conversations], [statuses], ownedShops, [memberships]] = await Promise.all([
    db.select({ n: count() }).from(chatRoomMembersTable).where(eq(chatRoomMembersTable.userId, user.id)),
    db.select({ n: count() }).from(statusUpdatesTable).where(eq(statusUpdatesTable.authorId, user.id)),
    db.select({ id: shopsTable.id, businessName: shopsTable.businessName })
      .from(shopsTable).where(eq(shopsTable.dealerId, user.id)),
    db.select({ n: count() })
      .from(shopMembershipsTable)
      .innerJoin(shopsTable, eq(shopsTable.id, shopMembershipsTable.shopId))
      .where(and(eq(shopMembershipsTable.userId, user.id), ne(shopsTable.dealerId, user.id))),
  ]);
  const shops: OwnedShopPreview[] = [];
  for (const shop of ownedShops) {
    const [[others], [repairs], [customers]] = await Promise.all([
      db.select({ n: count() }).from(shopMembershipsTable)
        .where(and(eq(shopMembershipsTable.shopId, shop.id), ne(shopMembershipsTable.userId, user.id))),
      db.select({ n: count() }).from(repairsTable).where(eq(repairsTable.shopId, shop.id)),
      db.select({ n: count() }).from(customersTable).where(eq(customersTable.shopId, shop.id)),
    ]);
    shops.push({
      id: shop.id,
      businessName: shop.businessName,
      otherMemberCount: Number(others?.n ?? 0),
      repairCount: Number(repairs?.n ?? 0),
      customerCount: Number(customers?.n ?? 0),
    });
  }
  const businessBlocked = user.role === "super_admin" ? SUPER_ADMIN_DELETE_BLOCKED : null;
  return {
    chat: {
      allowed: true,
      reason: null,
      conversationCount: Number(conversations?.n ?? 0),
      statusCount: Number(statuses?.n ?? 0),
    },
    business: {
      allowed: !businessBlocked,
      reason: businessBlocked,
      ownedShops: shops,
      membershipCount: Number(memberships?.n ?? 0),
      dealerPortalLinked: !!user.dealerId,
    },
  };
}

// Why a scope is refused for this account, or null when it may proceed.
export function accountDeletionRefusal(user: DbUser, scope: AccountDeletionScope): string | null {
  if (scopeIncludesBusiness(scope) && user.role === "super_admin") return SUPER_ADMIN_DELETE_BLOCKED;
  return null;
}

// ── Chat layer ───────────────────────────────────────────────────────────────

async function resolveMatrixIdentity(tx: Tx, userId: string, cleanup: Cleanup): Promise<void> {
  const [identity] = await tx
    .select({ providerUserId: chatProviderIdentitiesTable.providerUserId })
    .from(chatProviderIdentitiesTable)
    .where(eq(chatProviderIdentitiesTable.userId, userId))
    .limit(1);
  if (identity) cleanup.matrixUserId = identity.providerUserId || matrixUserIdForApp(userId);
}

async function deleteChatLayer(tx: Tx, userId: string, cleanup: Cleanup): Promise<void> {
  // Rooms the account belongs to, locked so a concurrent send/join in the same
  // room is ordered against this deletion.
  const memberRooms = await tx
    .select({ room: chatRoomsTable })
    .from(chatRoomMembersTable)
    .innerJoin(chatRoomsTable, eq(chatRoomsTable.id, chatRoomMembersTable.roomId))
    .where(eq(chatRoomMembersTable.userId, userId))
    .for("update", { of: chatRoomsTable });

  const roomsToDrop: string[] = [];
  const roomsToDetach: string[] = [];
  for (const { room } of memberRooms) {
    if (room.providerRoomId) cleanup.matrixRoomIds.add(room.providerRoomId);
    const [others] = await tx
      .select({ n: count() })
      .from(chatRoomMembersTable)
      .where(and(eq(chatRoomMembersTable.roomId, room.id), ne(chatRoomMembersTable.userId, userId)));
    const othersLeft = Number(others?.n ?? 0);
    // A personal conversation nobody else is left in dies with the account.
    // Shop-scoped rooms belong to the Shop (business layer) and are never
    // removed here, even when this account was their only member.
    if (room.scope === "global_direct" && othersLeft === 0) {
      roomsToDrop.push(room.id);
      cleanup.objectPrefixes.add(`uploads/global/chat/${room.id}/`);
    } else if (room.scope === "global_direct") {
      roomsToDetach.push(room.id);
    }
  }

  // Attachments of every message this account sent, wherever it sent them.
  const authored = await tx
    .select({ objectPath: chatMessagesTable.objectPath })
    .from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.senderId, userId), sql`${chatMessagesTable.objectPath} is not null`));
  for (const row of authored) if (row.objectPath) cleanup.objectPaths.add(row.objectPath);

  if (roomsToDrop.length) {
    // Cascades members, messages, preferences, read state, hidden markers.
    await tx.delete(chatRoomsTable).where(inArray(chatRoomsTable.id, roomsToDrop));
  }
  if (roomsToDetach.length) {
    // The other person keeps their copy of the conversation. Releasing the
    // pair key guarantees that a future conversation between the same two
    // accounts starts as a brand-new room rather than re-attaching this one
    // with its history.
    await tx.update(chatRoomsTable)
      .set({ peerKey: null })
      .where(and(inArray(chatRoomsTable.id, roomsToDetach), eq(chatRoomsTable.scope, "global_direct")));
  }

  // Authored messages are removed outright (not tombstoned): the sender no
  // longer exists as a chat participant, and `both` would cascade them anyway.
  await tx.delete(chatMessagesTable).where(eq(chatMessagesTable.senderId, userId));
  await tx.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.userId, userId));
  await tx.delete(chatRoomPreferencesTable).where(eq(chatRoomPreferencesTable.userId, userId));
  await tx.delete(chatReadStateTable).where(eq(chatReadStateTable.userId, userId));
  await tx.delete(chatMessageHiddenTable).where(eq(chatMessageHiddenTable.userId, userId));
  await tx.delete(chatBlocksTable).where(or(
    eq(chatBlocksTable.blockerUserId, userId),
    eq(chatBlocksTable.blockedUserId, userId),
  ));
  await tx.delete(chatContactMatchGrantsTable).where(or(
    eq(chatContactMatchGrantsTable.callerUserId, userId),
    eq(chatContactMatchGrantsTable.targetUserId, userId),
  ));
  await tx.delete(chatContactMatchAttemptsTable).where(eq(chatContactMatchAttemptsTable.userId, userId));

  // Personal Status: every update this account posted, plus its media.
  cleanup.objectPrefixes.add(`uploads/status/${userId}/`);
  await tx.delete(statusUpdatesTable).where(eq(statusUpdatesTable.authorId, userId));
  await tx.delete(statusViewersTable).where(eq(statusViewersTable.viewerUserId, userId));

  // In-flight chat/status/profile uploads that never became a message.
  const pending = await tx
    .delete(pendingUploadsTable)
    .where(eq(pendingUploadsTable.ownerUserId, userId))
    .returning({ objectPath: pendingUploadsTable.objectPath });
  for (const row of pending) cleanup.objectPaths.add(row.objectPath);

  // Chat-only account state that is not keyed by a room: in-app message
  // notifications (their previews would otherwise reappear after sign-in) and
  // the chat backup connection to Google Drive.
  await tx.delete(notificationsTable).where(and(
    eq(notificationsTable.userId, userId),
    inArray(notificationsTable.type, ["chat_message", "chat_report_reviewed"]),
  ));
  await tx.delete(driveBackupOauthStatesTable).where(eq(driveBackupOauthStatesTable.userId, userId));
  await tx.delete(driveBackupSettingsTable).where(eq(driveBackupSettingsTable.userId, userId));
  await tx.delete(driveBackupConnectionsTable).where(eq(driveBackupConnectionsTable.userId, userId));

  await tx.delete(chatProviderIdentitiesTable).where(eq(chatProviderIdentitiesTable.userId, userId));
}

// ── Business layer ───────────────────────────────────────────────────────────

// Point an account's workspace mirror (users.shopId/role/…) at one of its
// remaining active memberships, or clear it when none is left. Mirrors the
// rule used by staff removal so the pointer never outlives the membership.
async function repointWorkspaceMirror(tx: Tx, userId: string, leavingShopIds: string[]): Promise<void> {
  const [remaining] = await tx
    .select({ membership: shopMembershipsTable, shop: shopsTable })
    .from(shopMembershipsTable)
    .innerJoin(shopsTable, eq(shopsTable.id, shopMembershipsTable.shopId))
    .where(and(
      eq(shopMembershipsTable.userId, userId),
      eq(shopMembershipsTable.status, "active"),
      ...(leavingShopIds.length ? [notInArray(shopMembershipsTable.shopId, leavingShopIds)] : []),
    ))
    .orderBy(
      sql`case when ${shopMembershipsTable.role} = 'owner' then 0 else 1 end`,
      sql`${shopMembershipsTable.createdAt} desc`,
    )
    .limit(1);
  await tx.update(usersTable)
    .set(remaining ? workspaceMirror(remaining.shop, remaining.membership.role) : clearedWorkspaceMirror())
    .where(eq(usersTable.id, userId));
}

async function deleteBusinessLayer(tx: Tx, userId: string, cleanup: Cleanup): Promise<{ affectedUserIds: string[] }> {
  const owned = await tx
    .select({ id: shopsTable.id })
    .from(shopsTable)
    .where(eq(shopsTable.dealerId, userId))
    .for("update");
  const ownedIds = owned.map((shop) => shop.id);
  const affected = new Set<string>();

  if (ownedIds.length) {
    // Everyone else who had this Shop selected as their workspace must be
    // repointed before the Shop disappears, or their users row would keep a
    // dangling shop_id that grants request-time authority to nothing.
    const members = await tx
      .select({ userId: shopMembershipsTable.userId })
      .from(shopMembershipsTable)
      .where(and(inArray(shopMembershipsTable.shopId, ownedIds), ne(shopMembershipsTable.userId, userId)));
    const pointing = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.shopId, ownedIds), ne(usersTable.id, userId)));
    for (const row of [...members, ...pointing]) affected.add("userId" in row ? row.userId : row.id);

    for (const shopId of ownedIds) cleanup.objectPrefixes.add(`uploads/${shopId}/`);
    // Shop-scoped chat rooms cascade with the Shop; make sure their Matrix
    // side is left too.
    const shopRooms = await tx
      .select({ providerRoomId: chatRoomsTable.providerRoomId })
      .from(chatRoomsTable)
      .where(and(inArray(chatRoomsTable.shopId, ownedIds), sql`${chatRoomsTable.providerRoomId} is not null`));
    for (const room of shopRooms) if (room.providerRoomId) cleanup.matrixRoomIds.add(room.providerRoomId);

    // Cascades: memberships, customers, repairs (+ photos, events, payments,
    // refunds, returns, parts), khata, inventory, stock movements, purchases,
    // finance entries, dealers, transfer requests, approvals, estimate
    // approvals, notifications, chat rooms/messages, feature settings, …
    await tx.delete(shopsTable).where(inArray(shopsTable.id, ownedIds));
  }

  // Memberships in Shops owned by other people: the membership goes, their
  // business data stays exactly as it is.
  await tx.delete(shopMembershipsTable).where(eq(shopMembershipsTable.userId, userId));
  await tx.delete(userFeatureSettingsTable).where(eq(userFeatureSettingsTable.userId, userId));
  // Customer-portal links to other Shops' customer records (their records,
  // only the link is ours).
  await tx.delete(customerUsersTable).where(eq(customerUsersTable.userId, userId));

  // The account becomes a plain personal (OTP) login that keeps its chats.
  const [before] = await tx.select({ companyLogo: usersTable.companyLogo }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  if (before?.companyLogo) cleanup.objectPaths.add(before.companyLogo);
  await tx.update(usersTable)
    .set({ ...clearedWorkspaceMirror(), dealerId: null, joinDate: null, companyLogo: null })
    .where(eq(usersTable.id, userId));

  for (const otherId of affected) {
    await repointWorkspaceMirror(tx, otherId, ownedIds);
  }
  return { affectedUserIds: [...affected] };
}

// ── Whole account ────────────────────────────────────────────────────────────

async function deleteUserRow(tx: Tx, user: DbUser, cleanup: Cleanup): Promise<void> {
  cleanup.objectPrefixes.add(`uploads/profiles/${user.id}/`);
  if (user.profilePhoto) cleanup.objectPaths.add(user.profilePhoto);
  if (user.companyLogo) cleanup.objectPaths.add(user.companyLogo);
  // Outstanding one-time codes bound to this identity must not survive into
  // the next account that uses the same number.
  // Login codes are keyed by the raw mobile/email; deletion re-auth codes by
  // `<userId>:<scope>:<channel>` (routes/account.ts).
  await tx.delete(otpCodesTable).where(or(
    eq(otpCodesTable.identifier, user.mobile),
    eq(otpCodesTable.identifier, user.email),
    like(otpCodesTable.identifier, `${user.id}:%`),
  ));
  // Cascades: sessions (and with them push tokens), trusted-device trusts,
  // login events, notifications, notification preferences, drive backup
  // connection/settings, user devices, chat blocks/reports authored, …
  await tx.delete(usersTable).where(eq(usersTable.id, user.id));
}

// Revoke every session of the account. Trusted-device generations are revoked
// too so an Android reinstall cannot recover a session for a deleted layer.
async function revokeEverySession(tx: Tx, userId: string): Promise<void> {
  await tx.update(trustedDeviceTrustsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(trustedDeviceTrustsTable.userId, userId), sql`${trustedDeviceTrustsTable.revokedAt} is null`));
  await tx.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  // Any other deletion re-auth code issued to this account is spent with it.
  await tx.delete(otpCodesTable).where(like(otpCodesTable.identifier, `${userId}:%`));
}

export type AccountDeletionOutcome = {
  scope: AccountDeletionScope;
  accountRemoved: boolean;
};

export async function executeAccountDeletion(
  user: DbUser,
  scope: AccountDeletionScope,
  log: Logger,
): Promise<AccountDeletionOutcome> {
  const refusal = accountDeletionRefusal(user, scope);
  if (refusal) throw Object.assign(new Error(refusal), { code: "ACCOUNT_DELETE_FORBIDDEN" });

  const cleanup = newCleanup();
  const affected = await db.transaction(async (tx) => {
    // Serialize with any concurrent deletion of the same account and with
    // workspace operations that lock the users row.
    const [locked] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, user.id)).for("update");
    if (!locked) throw Object.assign(new Error("Account not found"), { code: "ACCOUNT_GONE" });

    const touched = new Set<string>();
    await resolveMatrixIdentity(tx, user.id, cleanup);
    if (scopeIncludesChat(scope)) await deleteChatLayer(tx, user.id, cleanup);
    if (scopeIncludesBusiness(scope)) {
      const { affectedUserIds } = await deleteBusinessLayer(tx, user.id, cleanup);
      for (const id of affectedUserIds) touched.add(id);
    }
    if (scope === "both") {
      await deleteUserRow(tx, user, cleanup);
    } else {
      await revokeEverySession(tx, user.id);
    }
    return [...touched];
  });

  invalidateUserFeatureCache(user.id);
  for (const id of affected) invalidateUserFeatureCache(id);

  await runPostCommitCleanup(cleanup, log);
  log.info(
    {
      scope,
      objectPaths: cleanup.objectPaths.size,
      objectPrefixes: cleanup.objectPrefixes.size,
      matrixRooms: cleanup.matrixRoomIds.size,
    },
    "Account deletion committed",
  );
  return { scope, accountRemoved: scope === "both" };
}

// ── Post-commit cleanup ──────────────────────────────────────────────────────

const objectStorageService = new ObjectStorageService();
const MATRIX_LEAVE_TIMEOUT_MS = 8_000;

async function objectStillReferenced(objectPath: string): Promise<boolean> {
  const [[message], [status], [profile]] = await Promise.all([
    db.select({ id: chatMessagesTable.id }).from(chatMessagesTable)
      .where(eq(chatMessagesTable.objectPath, objectPath)).limit(1),
    db.select({ id: statusUpdatesTable.id }).from(statusUpdatesTable)
      .where(eq(statusUpdatesTable.objectPath, objectPath)).limit(1),
    db.select({ id: usersTable.id }).from(usersTable)
      .where(or(eq(usersTable.profilePhoto, objectPath), eq(usersTable.companyLogo, objectPath))).limit(1),
  ]);
  return !!(message || status || profile);
}

async function runPostCommitCleanup(cleanup: Cleanup, log: Logger): Promise<void> {
  // Object deletes only where this database owns the shared bucket: a row
  // copied between environments (or a shop namespace with the same id) could
  // still be live elsewhere. Elsewhere the rows are gone and the objects stay
  // as unreferenced, unreadable orphans.
  const storageSweeps = resolveStorageSweepPolicy();
  if (!storageSweeps.enabled) {
    if (cleanup.objectPaths.size || cleanup.objectPrefixes.size) {
      log.warn(
        { reason: storageSweeps.reason, objectPaths: cleanup.objectPaths.size, objectPrefixes: cleanup.objectPrefixes.size },
        "Account deletion: object cleanup skipped (storage sweeps disabled in this environment)",
      );
    }
  } else {
    for (const objectPath of cleanup.objectPaths) {
      if (!objectPath.startsWith("/objects/")) continue;
      // Anything inside a namespace being removed wholesale is covered below.
      if ([...cleanup.objectPrefixes].some((prefix) => objectPath.startsWith(`/objects/${prefix}`))) continue;
      try {
        if (await objectStillReferenced(objectPath)) continue;
        const file = await objectStorageService.getObjectEntityFile(objectPath);
        await file.delete({ ignoreNotFound: true });
      } catch (err) {
        if (err instanceof ObjectNotFoundError) continue;
        log.warn({ err, objectPath }, "Account deletion: could not remove object");
      }
    }
    for (const prefix of cleanup.objectPrefixes) {
      try {
        const files = await objectStorageService.listObjectEntityFiles(prefix);
        for (const { file } of files) {
          await file.delete({ ignoreNotFound: true }).catch((err: unknown) => {
            log.warn({ err, prefix }, "Account deletion: could not remove object under prefix");
          });
        }
      } catch (err) {
        log.warn({ err, prefix }, "Account deletion: could not list object prefix");
      }
    }
  }
  if (cleanup.matrixUserId && cleanup.matrixRoomIds.size && matrixConfigured()) {
    for (const roomId of cleanup.matrixRoomIds) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MATRIX_LEAVE_TIMEOUT_MS);
      try {
        await matrixLeaveRoomAs(roomId, cleanup.matrixUserId, controller.signal);
      } catch (err) {
        log.warn({ err: String(err), roomId }, "Account deletion: Matrix leave failed");
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
