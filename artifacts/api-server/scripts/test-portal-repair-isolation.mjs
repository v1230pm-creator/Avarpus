// API integration checks for customer/dealer portal isolation.
// Usage: node scripts/run-isolated.mjs scripts/test-portal-repair-isolation.mjs
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dealerPortalContract from "../src/lib/dealerPortalContract.json" with { type: "json" };
import customerPortalContract from "../src/lib/customerPortalContract.json" with { type: "json" };

// Built server entry. scripts/run-isolated.mjs builds into a private per-run
// directory and passes it here so a concurrent `pnpm run build` rewriting
// ./dist cannot pull the bundle out from under this run.
const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";
import {
  customerPortalProfile,
  dealerPortalProfile,
  validatePortalContract,
} from "../src/lib/portalContractValidator.mjs";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5653;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FIXTURE_MARKER = `portal-isolation-${randomBytes(8).toString("hex")}`;
let failures = 0;

function marked(value) {
  return `${FIXTURE_MARKER}-${value}`;
}

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
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

async function seedShop(tag) {
  const suffix = randomBytes(5).toString("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [owner] } = await client.query(
      `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'x', 'dealer', true) RETURNING id`,
      [`Portal Owner ${marked(tag)}`, `${marked(`owner-${tag}`)}-${suffix}@example.com`, `8${suffix.slice(0, 9)}`],
    );
    const { rows: [shop] } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
      [owner.id, `Portal Shop ${marked(tag)}`],
    );
    await client.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, owner.id]);
    await client.query("COMMIT");
    return { ownerId: owner.id, shopId: shop.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedPortalUser({ shopId, role, tag, dealerId = null, customerId = null }) {
  const suffix = randomBytes(5).toString("hex");
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active, shop_id, dealer_id)
     VALUES ($1, $2, $3, 'x', $4, true, $5, $6) RETURNING id`,
    [`Portal ${marked(tag)}`, `${marked(tag)}-${suffix}@example.com`, `7${suffix.slice(0, 9)}`, role, shopId, dealerId],
  );
  if (customerId) {
    await pool.query(
      `INSERT INTO customer_users (user_id, customer_id, shop_id) VALUES ($1, $2, $3)`,
      [user.id, customerId, shopId],
    );
  }
  const token = randomBytes(32).toString("hex");
  const logoutToken = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $3, now() + interval '1 hour'), ($2, $3, now() + interval '1 hour')`,
    [token, logoutToken, user.id],
  );
  return { userId: user.id, token, logoutToken };
}

async function seedCustomer(shopId, tag) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO customers (shop_id, name, mobile) VALUES ($1, $2, $3) RETURNING id`,
    [shopId, `Customer ${marked(tag)}`, `91${randomBytes(4).toString("hex")}`],
  );
  return row.id;
}

async function seedDealer(shopId, tag) {
  const suffix = randomBytes(3).toString("hex");
  const { rows: [row] } = await pool.query(
    `INSERT INTO dealers (shop_id, dealer_code, name, mobile)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [shopId, `PORTAL-${marked(tag)}-${suffix}`, `Dealer ${marked(tag)}`, `92${randomBytes(4).toString("hex")}`],
  );
  return row.id;
}

async function seedRepair({ shopId, customerId, dealerId, tag }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO repairs (
       shop_id, repair_id, customer_id, customer_name, mobile, dealer_id, dealer_name,
       device_type, brand, model, problem, receive_date, expected_date,
       device_password, notes, receiving_signature_path, delivery_signature_path,
       technician_id, assigned_by_id, received_by_id, delivered_by_id, created_by_id, updated_by_id,
       diagnosis, work_performed, repair_charge
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       'mobile', 'PortalBrand', 'SafeModel', 'screen issue', '2026-09-07', '2026-09-10',
       'secret-pin', 'internal-only note', $8, $9,
       $10, $10, $10, $10, $10, $10,
       'safe diagnosis', 'safe work summary', 250
     ) RETURNING id`,
    [
      shopId, `PORTAL-${marked(tag)}-${randomBytes(3).toString("hex")}`, customerId,
      `Customer ${marked(tag)}`, `93${randomBytes(4).toString("hex")}`, dealerId, `Dealer ${marked(tag)}`,
      `/objects/uploads/${shopId}/receiving-secret.png`,
      `/objects/uploads/${shopId}/delivery-secret.png`,
      (await pool.query(`SELECT dealer_id FROM shops WHERE id = $1`, [shopId])).rows[0].dealer_id,
    ],
  );
  return row.id;
}

async function seedNotification({ shopId, userId, tag }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO notifications (shop_id, user_id, type, title, body, data)
     VALUES ($1, $2, 'portal-isolation', $3, $4, '{}'::jsonb) RETURNING id`,
    [shopId, userId, `Notification ${marked(tag)}`, `private-notification-${marked(tag)}`],
  );
  return row.id;
}

async function seedStatus({ authorId, tag, kind = "text" }) {
  const objectPath = kind === "image"
    ? `/objects/uploads/status/${authorId}/${randomUUID()}`
    : null;
  const { rows: [row] } = await pool.query(
    `INSERT INTO status_updates (
       author_id, kind, body, object_path, mime_type, size_bytes, audience, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'contacts', now() + interval '1 hour')
     RETURNING id, object_path`,
    [
      authorId,
      kind,
      `private-status-${marked(tag)}`,
      objectPath,
      kind === "image" ? "image/jpeg" : null,
      kind === "image" ? 12 : null,
    ],
  );
  return { id: row.id, objectPath: row.object_path };
}

async function seedChatRoom({ shopId, memberIds, tag, scope = "shop" }) {
  const roomShopId = scope === "global_direct" ? null : shopId;
  const { rows: [room] } = await pool.query(
    `INSERT INTO chat_rooms (shop_id, scope, kind, name, created_by_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      roomShopId,
      scope,
      scope === "global_direct" ? "direct" : "customer",
      `Private room ${marked(tag)}`,
      memberIds[0],
      `Portal ${marked(tag)}`,
    ],
  );
  await pool.query(
    `INSERT INTO chat_room_members (room_id, shop_id, user_id)
     SELECT $1, $2, unnest($3::uuid[])`,
    [room.id, roomShopId, memberIds],
  );
  const storageScope = roomShopId ?? room.id;
  const { rows: [message] } = await pool.query(
    `INSERT INTO chat_messages (
       room_id, shop_id, sender_id, sender_name, kind, body, object_path
     ) VALUES ($1, $2, $3, $4, 'image', $5, $6) RETURNING id`,
    [
      room.id,
      roomShopId,
      memberIds[0],
      `Portal ${marked(tag)}`,
      `private-chat-${marked(tag)}`,
      `/objects/uploads/${storageScope}/chat/${room.id}/${randomBytes(8).toString("hex")}`,
    ],
  );
  return { roomId: room.id, messageId: message.id };
}

const forbiddenKeys = new Set([
  "mobile", "customerId", "dealerId", "devicePassword", "notes", "checklist",
  "receivingSignaturePath", "deliverySignaturePath", "technicianId", "assignedById",
  "receivedById", "deliveredById", "createdById", "updatedById", "testingConfirmedById",
  "objectPath", "uploadedByName", "createdByName", "updatedByName", "assignedByName",
  "receivedByName", "deliveredByName", "technicianName", "testingConfirmedByName",
]);

function leakedKeys(value, found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) found.push(key);
    leakedKeys(child, found);
  }
  return found;
}

async function verifyPortal(label, portal, ownId, sameShopForeignId, crossShopId) {
  const list = await api("GET", "/repairs", portal.token);
  const ids = (list.json.repairs ?? []).map((repair) => repair.id);
  check(`${label} lists only its own repair`, list.status === 200 && ids.length === 1 && ids[0] === ownId, list);
  check(`${label} list redacts sensitive fields`, leakedKeys(list.json).length === 0, leakedKeys(list.json));

  const own = await api("GET", `/repairs/${ownId}`, portal.token);
  check(`${label} can open its own repair`, own.status === 200 && own.json.repair?.id === ownId, own);
  check(`${label} detail redacts sensitive fields`, leakedKeys(own.json).length === 0, leakedKeys(own.json));

  for (const [scope, id] of [["same-shop foreign", sameShopForeignId], ["cross-shop", crossShopId]]) {
    const foreign = await api("GET", `/repairs/${id}`, portal.token);
    check(`${label} cannot open ${scope} repair`, foreign.status === 404 || foreign.status === 403, foreign);
  }

  const blocked = [
    ["POST", "/repairs", {}],
    ["PATCH", `/repairs/${ownId}`, { notes: "portal mutation" }],
    ["DELETE", `/repairs/${ownId}`],
    ["GET", `/repairs/${ownId}/photos`],
    ["GET", `/repairs/${ownId}/events`],
    ["GET", `/repairs/${ownId}/payments`],
    ["GET", `/repairs/${ownId}/parts`],
    ["GET", `/repairs/${ownId}/estimate-approvals`],
    ["POST", `/repairs/${ownId}/testing`, {}],
  ];
  for (const [method, pathname, body] of blocked) {
    const result = await api(method, pathname, portal.token, body);
    check(`${label} blocked from ${method} ${pathname}`, result.status === 403, result);
  }
}

function responseRevealsRepair(result, repairId) {
  return JSON.stringify(result.json).includes(repairId) || leakedKeys(result.json).length > 0;
}

async function verifyRevokedPortal(label, portal, repairId) {
  const list = await api("GET", "/repairs", portal.token);
  check(
    `${label} existing session cannot list repairs after link removal`,
    list.status === 403 && !responseRevealsRepair(list, repairId),
    list,
  );

  const detail = await api("GET", `/repairs/${repairId}`, portal.token);
  check(
    `${label} existing session cannot open repair after link removal`,
    (detail.status === 403 || detail.status === 404) && !responseRevealsRepair(detail, repairId),
    detail,
  );
}

function dealerPortalEndpointFamilies() {
  return validatePortalContract(dealerPortalContract, dealerPortalProfile).map((family) => {
    if (family.inactiveDealerExempt === true) {
      return null;
    }
    return [family.label, family.inactiveProbe.method, family.inactiveProbe.path, family.inactiveProbe.body];
  }).filter(Boolean);
}

async function verifyMessagingIsolation({ A, B, customerA1, customerA2, customerB }) {
  const [notificationA1, notificationA2, notificationB] = await Promise.all([
    seedNotification({ shopId: A.shopId, userId: customerA1.userId, tag: "A1" }),
    seedNotification({ shopId: A.shopId, userId: customerA2.userId, tag: "A2" }),
    seedNotification({ shopId: B.shopId, userId: customerB.userId, tag: "B" }),
  ]);

  const inboxA1 = await api("GET", "/notifications", customerA1.token);
  const inboxA1Ids = (inboxA1.json.notifications ?? []).map((item) => item.id);
  check(
    "notification inbox contains only the authenticated recipient's rows",
    inboxA1.status === 200
      && inboxA1Ids.includes(notificationA1)
      && !inboxA1Ids.includes(notificationA2)
      && !inboxA1Ids.includes(notificationB),
    inboxA1,
  );
  const foreignRead = await api(
    "POST",
    "/notifications/read",
    customerA1.token,
    { ids: [notificationA2, notificationB] },
  );
  const { rows: foreignNotifications } = await pool.query(
    `SELECT id, read_at FROM notifications WHERE id = ANY($1::uuid[])`,
    [[notificationA2, notificationB]],
  );
  check(
    "a customer cannot mark another user's notifications read",
    foreignRead.status === 200 && foreignNotifications.every((row) => row.read_at === null),
    { foreignRead, foreignNotifications },
  );

  const globalContactRoom = await seedChatRoom({
    shopId: A.shopId,
    memberIds: [customerA1.userId, customerA2.userId],
    tag: "personal-contact-A1-A2",
    scope: "global_direct",
  });
  const sameShopOutsider = await seedPortalUser({
    shopId: A.shopId,
    role: "customer",
    tag: "same-shop-outsider",
  });
  const contactRoom = await seedChatRoom({
    shopId: A.shopId,
    memberIds: [customerA1.userId, customerA2.userId],
    tag: "shop-A1-A2",
  });
  const [textStatus, mediaStatus] = await Promise.all([
    seedStatus({ authorId: customerA1.userId, tag: "A1" }),
    seedStatus({ authorId: customerA1.userId, tag: "A1-media", kind: "image" }),
  ]);
  const contactFeed = await api("GET", "/statuses", customerA2.token);
  const outsiderFeed = await api("GET", "/statuses", customerB.token);
  check(
    "an exact contact can list the author's status",
    contactFeed.status === 200 && JSON.stringify(contactFeed.json).includes(textStatus.id),
    contactFeed,
  );
  check(
    "a cross-shop non-contact cannot list another customer's status",
    outsiderFeed.status === 200
      && !JSON.stringify(outsiderFeed.json).includes(textStatus.id)
      && !JSON.stringify(outsiderFeed.json).includes(mediaStatus.id),
    outsiderFeed,
  );
  for (const [scope, portal] of [
    ["same-shop non-contact", sameShopOutsider],
    ["cross-shop non-contact", customerB],
  ]) {
    for (const [label, pathname, method, body] of [
      ["open", `/statuses/${textStatus.id}`, "GET"],
      ["record a view of", `/statuses/${textStatus.id}/view`, "POST", {}],
      ["list viewers for", `/statuses/${textStatus.id}/viewers`, "GET"],
      ["delete", `/statuses/${textStatus.id}`, "DELETE"],
      ["download media for", `/storage${mediaStatus.objectPath}`, "GET"],
    ]) {
      const result = await api(method, pathname, portal.token, body);
      check(`${scope} cannot ${label} a foreign status`, result.status === 404, result);
    }
  }

  for (const [roomScope, seededRoom] of [
    ["shop", contactRoom],
    ["global-direct", globalContactRoom],
  ]) {
    const roomDetail = await api("GET", `/chat/rooms/${seededRoom.roomId}`, customerA2.token);
    const memberMessages = await api(
      "GET",
      `/chat/rooms/${seededRoom.roomId}/messages`,
      customerA2.token,
    );
    check(
      `an exact room member can open the ${roomScope} room and its messages`,
      roomDetail.status === 200
        && memberMessages.status === 200
        && memberMessages.json.messages?.some((message) => message.id === seededRoom.messageId),
      { roomDetail, memberMessages },
    );
    for (const [scope, portal] of [
      ["same-shop non-member", sameShopOutsider],
      ["cross-shop non-member", customerB],
    ]) {
      const room = await api("GET", `/chat/rooms/${seededRoom.roomId}`, portal.token);
      const messages = await api("GET", `/chat/rooms/${seededRoom.roomId}/messages`, portal.token);
      const media = await api(
        "GET",
        `/chat/rooms/${seededRoom.roomId}/messages/${seededRoom.messageId}/media`,
        portal.token,
      );
      const upload = await api(
        "POST",
        `/chat/rooms/${seededRoom.roomId}/upload-url`,
        portal.token,
        { name: "private.jpg", size: 12, contentType: "image/jpeg" },
      );
      check(
        `${scope} cannot access a foreign ${roomScope} chat room, messages, or media`,
        [room, messages, media, upload].every((result) => result.status === 404),
        { room, messages, media, upload },
      );
    }
  }

  // Read access is only half the gate: customer rooms carry the same private
  // conversations as dealer rooms, so the write actions get the same proof.
  const customerNonMembers = [
    ["same-shop non-member customer", sameShopOutsider],
    ["cross-shop non-member customer", customerB],
  ];
  const customerRoomMemberIds = [customerA1.userId, customerA2.userId];
  const customerChatUserIds = [
    customerA1.userId,
    customerA2.userId,
    sameShopOutsider.userId,
    customerB.userId,
  ];

  // A reporter can read back the abuse reports they filed. That list is scoped
  // to its author and nothing else: another member of the very room that was
  // reported must not find it, and neither must an outsider.
  const filedReport = await api(
    "POST",
    `/chat/rooms/${globalContactRoom.roomId}/reports`,
    customerA1.token,
    { clientRequestId: randomUUID(), reason: "harassment" },
  );
  const ownReports = await api("GET", "/chat/reports/mine", customerA1.token);
  check(
    "a reporter reads back the report they filed",
    filedReport.status === 200
      && ownReports.status === 200
      && (ownReports.json.reports ?? []).some(
        (report) => report.id === filedReport.json.report?.id,
      ),
    { filedReport, ownReports },
  );
  for (const [scope, portal] of [
    ["the reported member of the same room", customerA2],
    ["a same-shop outsider", sameShopOutsider],
    ["a cross-shop outsider", customerB],
  ]) {
    const foreign = await api("GET", "/chat/reports/mine", portal.token);
    check(
      `${scope} cannot read another user's report`,
      foreign.status === 200
        && !JSON.stringify(foreign.json).includes(filedReport.json.report?.id ?? "missing-id"),
      foreign,
    );
  }

  try {
    await verifyRoomActions({
      portalKind: "customer",
      label: "shop",
      room: contactRoom,
      member: customerA2,
      roomMemberIds: customerRoomMemberIds,
      nonMembers: customerNonMembers,
      isDirect: false,
    });
    await verifyRoomActions({
      portalKind: "customer",
      label: "global-direct",
      room: globalContactRoom,
      member: customerA2,
      roomMemberIds: customerRoomMemberIds,
      nonMembers: customerNonMembers,
      isDirect: true,
    });
  } finally {
    // Drop the global direct room even if a request or query above threw: it
    // has no shop, and the cascade takes its members, message, preferences,
    // read state and reports with it. Blocks are not room-scoped, so the
    // sentinel and member-created rows are swept separately — and
    // independently, so a failure in one deletion cannot skip the other.
    await pool
      .query(`DELETE FROM chat_rooms WHERE id = $1`, [globalContactRoom.roomId])
      .catch((error) => console.error("customer direct room cleanup failed:", error));
    await pool
      .query(
        `DELETE FROM chat_blocks
         WHERE blocker_user_id = ANY($1::uuid[]) OR blocked_user_id = ANY($1::uuid[])`,
        [customerChatUserIds],
      )
      .catch((error) => console.error("customer chat block cleanup failed:", error));
  }
}

// Membership-scoped write actions on an existing room, ordered so a member's
// block is lifted again before the send and call probes, which would otherwise
// be refused for a blocked pair rather than allowed. `directOnly` marks the
// actions that need a direct peer, which only global direct rooms have.
// `capabilityCodes` lists the fail-closed responses a member may legitimately
// get in this environment: the seeded rooms have no provider room id, and no
// call service is configured. Every other action must genuinely succeed, so a
// member wrongly denied a database-only action still fails the check.
// Shared by the customer and dealer probes: both portals reach the same
// membership gate, so both must be proven against the same action set.
function roomWriteActions(roomId, messageId) {
  return [
    {
      action: "change preferences on",
      method: "PATCH",
      path: `/chat/rooms/${roomId}/preferences`,
      body: { isMuted: true },
    },
    {
      action: "mark read",
      method: "POST",
      path: `/chat/rooms/${roomId}/read`,
      body: { messageId },
    },
    {
      action: "report",
      method: "POST",
      path: `/chat/rooms/${roomId}/reports`,
      body: { clientRequestId: randomUUID(), reason: "spam" },
      directOnly: true,
    },
    {
      action: "block the peer in",
      method: "POST",
      path: `/chat/rooms/${roomId}/block`,
      body: {},
      directOnly: true,
    },
    {
      action: "unblock the peer in",
      method: "DELETE",
      path: `/chat/rooms/${roomId}/block`,
      body: {},
      directOnly: true,
    },
    {
      action: "send a message to",
      method: "POST",
      path: `/chat/rooms/${roomId}/messages`,
      body: { clientRequestId: randomUUID(), kind: "text", body: "isolation probe" },
      capabilityCodes: ["ROOM_NOT_PROVISIONED", "MATRIX_UNAVAILABLE"],
    },
    {
      action: "request a call token for",
      method: "POST",
      path: `/chat/rooms/${roomId}/call-token`,
      body: {},
      capabilityCodes: ["LIVEKIT_UNAVAILABLE"],
    },
  ];
}

function memberReachedRoom(result, spec) {
  if (result.status === 200 || result.status === 204) return true;
  return result.status === 503 && (spec.capabilityCodes ?? []).includes(result.json?.code);
}

// The server resolves a direct peer as "any other member of the room", so a
// probe that watches only one of the two members can be evaded. Every block
// owned by the caller is counted, by identity, not just by total.
async function chatWriteState(roomId, userId) {
  const { rows: [state] } = await pool.query(
    `SELECT
       (SELECT count(*) FROM chat_messages WHERE room_id = $1 AND sender_id = $2) AS messages,
       (SELECT count(*) FROM chat_read_state WHERE room_id = $1 AND user_id = $2) AS read_state,
       (SELECT count(*) FROM chat_room_preferences WHERE room_id = $1 AND user_id = $2) AS preferences,
       (SELECT count(*) FROM chat_reports WHERE room_id = $1 AND reporter_user_id = $2) AS reports,
       (SELECT coalesce(
          array_agg(blocked_user_id::text ORDER BY blocked_user_id::text), ARRAY[]::text[])
        FROM chat_blocks WHERE blocker_user_id = $2) AS blocked_ids`,
    [roomId, userId],
  );
  return state;
}

async function verifyRoomActions({ portalKind, label, room, member, roomMemberIds, nonMembers, isDirect }) {
  for (const spec of roomWriteActions(room.roomId, room.messageId)) {
    if (spec.directOnly && !isDirect) continue;
    const result = await api(spec.method, spec.path, member.token, spec.body);
    check(
      `an exact ${portalKind} ${label} room member can ${spec.action} the room`,
      memberReachedRoom(result, spec),
      result,
    );
  }

  for (const [scope, portal] of nonMembers) {
    for (const spec of roomWriteActions(room.roomId, room.messageId)) {
      if (spec.directOnly && !isDirect) continue;
      const isUnblock = spec.method === "DELETE";
      // Rejecting an unblock only means something when there is a block to
      // destroy, so plant one against every member the server could resolve as
      // the peer and prove the refused call left all of them in place.
      const expectedBlockedIds = isUnblock
        ? [...roomMemberIds].map(String).sort()
        : [];
      if (isUnblock) {
        await pool.query(
          `INSERT INTO chat_blocks (blocker_user_id, blocked_user_id)
           SELECT $1, unnest($2::uuid[])
           ON CONFLICT DO NOTHING`,
          [portal.userId, roomMemberIds],
        );
      }

      const result = await api(spec.method, spec.path, portal.token, spec.body);
      check(
        `${scope} cannot ${spec.action} a foreign ${portalKind} ${label} room`,
        result.status === 404,
        result,
      );

      // Checked per action, not once at the end: a later action must not be
      // able to undo an unauthorized write made by an earlier one.
      const state = await chatWriteState(room.roomId, portal.userId);
      const blockedIds = [...state.blocked_ids].sort();
      check(
        `${scope} changed no chat rows by trying to ${spec.action} a foreign ${portalKind} ${label} room`,
        Number(state.messages) === 0
          && Number(state.read_state) === 0
          && Number(state.preferences) === 0
          && Number(state.reports) === 0
          && blockedIds.join(",") === expectedBlockedIds.join(","),
        { ...state, expectedBlockedIds },
      );

      if (isUnblock) {
        await pool.query(`DELETE FROM chat_blocks WHERE blocker_user_id = $1`, [portal.userId]);
      }
    }
  }
}

async function verifyDealerMessagingIsolation({
  A,
  B,
  dealerOwnerA1,
  dealerStaffA1,
  dealerOwnerA2,
  dealerOwnerB,
}) {
  const [notificationA1, notificationA2, notificationB] = await Promise.all([
    seedNotification({ shopId: A.shopId, userId: dealerOwnerA1.userId, tag: "dealer-A1" }),
    seedNotification({ shopId: A.shopId, userId: dealerOwnerA2.userId, tag: "dealer-A2" }),
    seedNotification({ shopId: B.shopId, userId: dealerOwnerB.userId, tag: "dealer-B" }),
  ]);

  const inboxA1 = await api("GET", "/notifications", dealerOwnerA1.token);
  const inboxA1Ids = (inboxA1.json.notifications ?? []).map((item) => item.id);
  check(
    "dealer notification inbox contains only the authenticated recipient's rows",
    inboxA1.status === 200
      && inboxA1Ids.includes(notificationA1)
      && !inboxA1Ids.includes(notificationA2)
      && !inboxA1Ids.includes(notificationB),
    inboxA1,
  );
  const foreignRead = await api(
    "POST",
    "/notifications/read",
    dealerOwnerA1.token,
    { ids: [notificationA2, notificationB] },
  );
  const { rows: foreignNotifications } = await pool.query(
    `SELECT id, read_at FROM notifications WHERE id = ANY($1::uuid[])`,
    [[notificationA2, notificationB]],
  );
  check(
    "a dealer portal user cannot mark another dealer user's notifications read",
    foreignRead.status === 200 && foreignNotifications.every((row) => row.read_at === null),
    { foreignRead, foreignNotifications },
  );

  const dealerRoom = await seedChatRoom({
    shopId: A.shopId,
    memberIds: [dealerOwnerA1.userId, dealerStaffA1.userId],
    tag: "dealer-A1-owner-staff",
  });
  const roomDetail = await api("GET", `/chat/rooms/${dealerRoom.roomId}`, dealerStaffA1.token);
  const memberMessages = await api(
    "GET",
    `/chat/rooms/${dealerRoom.roomId}/messages`,
    dealerStaffA1.token,
  );
  const memberUpload = await api(
    "POST",
    `/chat/rooms/${dealerRoom.roomId}/upload-url`,
    dealerStaffA1.token,
    { name: "member.jpg", size: 12, contentType: "image/jpeg" },
  );
  let uploaded = false;
  if (memberUpload.status === 200 && memberUpload.json.uploadURL && memberUpload.json.objectPath) {
    const uploadResponse = await fetch(memberUpload.json.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: Buffer.alloc(12, 1),
    });
    uploaded = uploadResponse.ok;
    if (uploaded) {
      await pool.query(
        `UPDATE chat_messages SET object_path = $1 WHERE id = $2`,
        [memberUpload.json.objectPath, dealerRoom.messageId],
      );
    }
  }
  const memberMedia = await api(
    "GET",
    `/chat/rooms/${dealerRoom.roomId}/messages/${dealerRoom.messageId}/media`,
    dealerStaffA1.token,
  );
  check(
    "an exact dealer room member can open the room, messages, upload, and media endpoints",
    roomDetail.status === 200
      && memberMessages.status === 200
      && memberMessages.json.messages?.some((message) => message.id === dealerRoom.messageId)
      && memberUpload.status === 200
      && uploaded
      && memberMedia.status === 200,
    { roomDetail, memberMessages, memberMedia, memberUpload, uploaded },
  );

  const dealerNonMembers = [
    ["same-shop dealer non-member", dealerOwnerA2],
    ["cross-shop dealer non-member", dealerOwnerB],
  ];

  for (const [scope, portal] of dealerNonMembers) {
    const room = await api("GET", `/chat/rooms/${dealerRoom.roomId}`, portal.token);
    const messages = await api("GET", `/chat/rooms/${dealerRoom.roomId}/messages`, portal.token);
    const media = await api(
      "GET",
      `/chat/rooms/${dealerRoom.roomId}/messages/${dealerRoom.messageId}/media`,
      portal.token,
    );
    const upload = await api(
      "POST",
      `/chat/rooms/${dealerRoom.roomId}/upload-url`,
      portal.token,
      { name: "private.jpg", size: 12, contentType: "image/jpeg" },
    );
    check(
      `${scope} cannot access a foreign dealer chat room, messages, upload, or media`,
      [room, messages, media, upload].every((result) => result.status === 404),
      { room, messages, media, upload },
    );
  }

  // Global direct rooms are the only dealer rooms with a direct peer, so they
  // are the ones that exercise blocking, unblocking, and reporting.
  const dealerDirectRoom = await seedChatRoom({
    shopId: A.shopId,
    memberIds: [dealerOwnerA1.userId, dealerStaffA1.userId],
    tag: "dealer-A1-direct",
    scope: "global_direct",
  });

  const dealerRoomMemberIds = [dealerOwnerA1.userId, dealerStaffA1.userId];
  const dealerChatUserIds = [
    dealerOwnerA1.userId,
    dealerStaffA1.userId,
    dealerOwnerA2.userId,
    dealerOwnerB.userId,
  ];

  try {
    await verifyRoomActions({
      portalKind: "dealer",
      label: "shop",
      room: dealerRoom,
      member: dealerStaffA1,
      roomMemberIds: dealerRoomMemberIds,
      nonMembers: dealerNonMembers,
      isDirect: false,
    });
    await verifyRoomActions({
      portalKind: "dealer",
      label: "global-direct",
      room: dealerDirectRoom,
      member: dealerStaffA1,
      roomMemberIds: dealerRoomMemberIds,
      nonMembers: dealerNonMembers,
      isDirect: true,
    });
  } finally {
    // The global room has no shop and no owning user, so the shop-owner cleanup
    // at the end of the run never reaches it. Drop it here even if a request or
    // query above threw; the cascade takes its members, message, preferences,
    // read state and reports with it. Blocks are not room-scoped, so any
    // sentinel rows are swept separately — and independently, so a failure in
    // one deletion cannot skip the other.
    await pool
      .query(`DELETE FROM chat_rooms WHERE id = $1`, [dealerDirectRoom.roomId])
      .catch((error) => console.error("dealer direct room cleanup failed:", error));
    await pool
      .query(
        `DELETE FROM chat_blocks
         WHERE blocker_user_id = ANY($1::uuid[]) OR blocked_user_id = ANY($1::uuid[])`,
        [dealerChatUserIds],
      )
      .catch((error) => console.error("dealer chat block cleanup failed:", error));
  }
}

async function verifyInactiveDealerPortal(label, portal) {
  for (const [family, method, pathname, body] of dealerPortalEndpointFamilies()) {
    const result = await api(method, pathname, portal.token, body);
    check(
      `${label} cannot use ${family} while dealer is inactive`,
      result.status === 403 && result.json.code === "DEALER_INACTIVE",
      result,
    );
  }

  const me = await api("GET", "/auth/me", portal.token);
  check(
    `${label} can still access auth self-service while dealer is inactive`,
    me.status === 200 && me.json.user?.id === portal.userId,
    me,
  );

  const sessions = await api("GET", "/auth/sessions", portal.token);
  check(
    `${label} can still list sessions while dealer is inactive`,
    sessions.status === 200 && sessions.json.sessions?.some((session) => session.current),
    sessions,
  );

  const logout = await api("POST", "/auth/logout", portal.logoutToken);
  check(`${label} can sign out while dealer is inactive`, logout.status === 200, logout);
  const signedOut = await api("GET", "/auth/me", portal.logoutToken);
  check(`${label} signed-out session is revoked`, signedOut.status === 401, signedOut);
}

async function verifyReactivatedDealerPortal(label, portal, repairId) {
  for (const [family, method, pathname, body] of dealerPortalEndpointFamilies()) {
    const result = await api(method, pathname, portal.token, body);
    const expectedRepair = family !== "repair history"
      || result.json.repairs?.some((repair) => repair.id === repairId);
    check(
      `${label} existing session regains ${family} after reactivation`,
      result.status === 200 && expectedRepair,
      result,
    );
  }
}

async function run(A, B) {
  validatePortalContract(customerPortalContract, customerPortalProfile);
  const [customerA1, customerA2, customerB] = await Promise.all([
    seedCustomer(A.shopId, "A1"), seedCustomer(A.shopId, "A2"), seedCustomer(B.shopId, "B"),
  ]);
  const [dealerA1, dealerA2, dealerB] = await Promise.all([
    seedDealer(A.shopId, "A1"), seedDealer(A.shopId, "A2"), seedDealer(B.shopId, "B"),
  ]);
  const [repairA1, repairA2, repairB] = await Promise.all([
    seedRepair({ shopId: A.shopId, customerId: customerA1, dealerId: dealerA1, tag: "A1" }),
    seedRepair({ shopId: A.shopId, customerId: customerA2, dealerId: dealerA2, tag: "A2" }),
    seedRepair({ shopId: B.shopId, customerId: customerB, dealerId: dealerB, tag: "B" }),
  ]);
  const [
    customerPortal,
    customerPortalA2,
    customerPortalB,
    dealerOwnerPortal,
    dealerStaffPortal,
    dealerOwnerPortalA2,
    dealerOwnerPortalB,
  ] = await Promise.all([
    seedPortalUser({ shopId: A.shopId, role: "customer", tag: "customer", customerId: customerA1 }),
    seedPortalUser({ shopId: A.shopId, role: "customer", tag: "customer-a2", customerId: customerA2 }),
    seedPortalUser({ shopId: B.shopId, role: "customer", tag: "customer-b", customerId: customerB }),
    seedPortalUser({ shopId: A.shopId, role: "dealer_owner", tag: "dealer-owner", dealerId: dealerA1 }),
    seedPortalUser({ shopId: A.shopId, role: "dealer_staff", tag: "dealer-staff", dealerId: dealerA1 }),
    seedPortalUser({ shopId: A.shopId, role: "dealer_owner", tag: "dealer-owner-a2", dealerId: dealerA2 }),
    seedPortalUser({ shopId: B.shopId, role: "dealer_owner", tag: "dealer-owner-b", dealerId: dealerB }),
  ]);

  await verifyMessagingIsolation({
    A,
    B,
    customerA1: customerPortal,
    customerA2: customerPortalA2,
    customerB: customerPortalB,
  });
  await verifyDealerMessagingIsolation({
    A,
    B,
    dealerOwnerA1: dealerOwnerPortal,
    dealerStaffA1: dealerStaffPortal,
    dealerOwnerA2: dealerOwnerPortalA2,
    dealerOwnerB: dealerOwnerPortalB,
  });
  await verifyPortal("customer portal", customerPortal, repairA1, repairA2, repairB);
  const customerBalance = await api("GET", "/customers/me/khata", customerPortal.token);
  check(
    "customer balance resolves only from the authenticated customer link",
    customerBalance.status === 200
      && !JSON.stringify(customerBalance.json).includes(customerA2)
      && !JSON.stringify(customerBalance.json).includes(customerB),
    customerBalance,
  );
  await verifyPortal("dealer owner portal", dealerOwnerPortal, repairA1, repairA2, repairB);
  await verifyPortal("dealer staff portal", dealerStaffPortal, repairA1, repairA2, repairB);

  await pool.query(`UPDATE dealers SET is_active = false WHERE id = $1`, [dealerA1]);
  for (const [label, portal] of [
    ["dealer owner portal", dealerOwnerPortal],
    ["dealer staff portal", dealerStaffPortal],
  ]) {
    await verifyInactiveDealerPortal(label, portal);
  }
  const customerWhileDealerInactive = await api("GET", "/repairs", customerPortal.token);
  check(
    "customer portal remains available when the repair's dealer is inactive",
    customerWhileDealerInactive.status === 200
      && customerWhileDealerInactive.json.repairs?.[0]?.id === repairA1,
    customerWhileDealerInactive,
  );

  await pool.query(`UPDATE dealers SET is_active = true WHERE id = $1`, [dealerA1]);
  for (const [label, portal] of [
    ["dealer owner portal", dealerOwnerPortal],
    ["dealer staff portal", dealerStaffPortal],
  ]) {
    await verifyReactivatedDealerPortal(label, portal, repairA1);
  }

  await pool.query(`DELETE FROM customer_users WHERE user_id = $1`, [customerPortal.userId]);
  await verifyRevokedPortal("customer portal", customerPortal, repairA1);

  await pool.query(
    `UPDATE users SET dealer_id = NULL WHERE id = ANY($1::uuid[])`,
    [[dealerOwnerPortal.userId, dealerStaffPortal.userId]],
  );
  await verifyRevokedPortal("dealer owner portal", dealerOwnerPortal, repairA1);
  await verifyRevokedPortal("dealer staff portal", dealerStaffPortal, repairA1);
}

async function cleanupFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM chat_rooms
       WHERE name LIKE $1 OR created_by_name LIKE $1`,
      [`%${FIXTURE_MARKER}%`],
    );
    await client.query(
      `DELETE FROM users
       WHERE name LIKE $1 OR email LIKE $1`,
      [`%${FIXTURE_MARKER}%`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verifyFixtureCleanup() {
  const pattern = `%${FIXTURE_MARKER}%`;
  const { rows } = await pool.query(
    `SELECT source, row_count
     FROM (
       SELECT 'users' AS source, count(*)::int AS row_count
       FROM users WHERE name LIKE $1 OR email LIKE $1
       UNION ALL
       SELECT 'sessions', count(*)::int
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE u.name LIKE $1 OR u.email LIKE $1
       UNION ALL
       SELECT 'notifications', count(*)::int
       FROM notifications WHERE title LIKE $1 OR body LIKE $1
       UNION ALL
       SELECT 'statuses', count(*)::int
       FROM status_updates WHERE body LIKE $1 OR object_path LIKE $1
       UNION ALL
       SELECT 'rooms', count(*)::int
       FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1
       UNION ALL
       SELECT 'messages', count(*)::int
       FROM chat_messages WHERE body LIKE $1 OR sender_name LIKE $1 OR object_path LIKE $1
     ) fixture_rows
     WHERE row_count > 0`,
    [pattern],
  );
  if (rows.length > 0) {
    throw new Error(`fixture cleanup left marked rows: ${JSON.stringify(rows)}`);
  }
  console.log(`  PASS fixture cleanup removed marker ${FIXTURE_MARKER}`);
}

async function main() {
  let child;
  try {
    const [A, B] = await Promise.all([seedShop("A"), seedShop("B")]);
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
    await run(A, B);
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
  console.log("\nAll portal isolation checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});