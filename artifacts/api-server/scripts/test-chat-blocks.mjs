// API integration checks for direct-chat block enforcement.
//
// A block must make the conversation unusable for BOTH sides — the person who
// blocked and the person who was blocked — across every outbound channel
// (message, attachment upload, call token) and across a fresh room creation
// attempt for the same pair. Only the caller who owns a block row may lift it.
//
// Usage: node scripts/run-isolated.mjs scripts/test-chat-blocks.mjs
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Built server entry. scripts/run-isolated.mjs builds into a private per-run
// directory and passes it here so a concurrent `pnpm run build` rewriting
// ./dist cannot pull the bundle out from under this run.
const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5657;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FIXTURE_MARKER = `chat-blocks-${randomBytes(8).toString("hex")}`;
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

// ── Fixtures ────────────────────────────────────────────────────────────────

async function seedShop(tag) {
  const suffix = randomBytes(5).toString("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [owner] } = await client.query(
      `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'x', 'dealer', true) RETURNING id`,
      [
        `Block Owner ${marked(tag)}`,
        `${marked(`owner-${tag}`)}-${suffix}@example.com`,
        `8${suffix.slice(0, 9)}`,
      ],
    );
    const { rows: [shop] } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
      [owner.id, `Block Shop ${marked(tag)}`],
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

async function seedUser({ shopId, tag, role = "customer" }) {
  const suffix = randomBytes(5).toString("hex");
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active, shop_id)
     VALUES ($1, $2, $3, 'x', $4, true, $5) RETURNING id`,
    [
      `Block ${marked(tag)}`,
      `${marked(tag)}-${suffix}@example.com`,
      `7${suffix.slice(0, 9)}`,
      role,
      shopId,
    ],
  );
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [token, user.id],
  );
  return { userId: user.id, token, label: tag };
}

function peerKeyFor(userA, userB) {
  return [userA, userB].sort().join(":");
}

// Direct rooms are global: no shop, kind "direct", and a deterministic peer key
// so the room-creation endpoint recognises the pair as already having a room.
async function seedDirectRoom({ memberIds, tag }) {
  const { rows: [room] } = await pool.query(
    `INSERT INTO chat_rooms (shop_id, scope, kind, name, peer_key, created_by_id, created_by_name)
     VALUES (NULL, 'global_direct', 'direct', $1, $2, $3, $4) RETURNING id`,
    [
      `Direct room ${marked(tag)}`,
      peerKeyFor(memberIds[0], memberIds[1]),
      memberIds[0],
      `Block ${marked(tag)}`,
    ],
  );
  await pool.query(
    `INSERT INTO chat_room_members (room_id, shop_id, user_id)
     SELECT $1, NULL, unnest($2::uuid[])`,
    [room.id, memberIds],
  );
  const { rows: [message] } = await pool.query(
    `INSERT INTO chat_messages (room_id, shop_id, sender_id, sender_name, kind, body)
     VALUES ($1, NULL, $2, $3, 'text', $4) RETURNING id`,
    [room.id, memberIds[0], `Block ${marked(tag)}`, `history-${marked(tag)}`],
  );
  return { roomId: room.id, messageId: message.id, memberIds };
}

async function seedShopRoom({ shopId, memberIds, tag }) {
  const { rows: [room] } = await pool.query(
    `INSERT INTO chat_rooms (shop_id, scope, kind, name, created_by_id, created_by_name)
     VALUES ($1, 'shop', 'customer', $2, $3, $4) RETURNING id`,
    [shopId, `Shop room ${marked(tag)}`, memberIds[0], `Block ${marked(tag)}`],
  );
  await pool.query(
    `INSERT INTO chat_room_members (room_id, shop_id, user_id)
     SELECT $1, $2, unnest($3::uuid[])`,
    [room.id, shopId, memberIds],
  );
  return { roomId: room.id };
}

// A contact-match grant is what authorises creating a direct room. Seeding a
// valid one means a later CHAT_BLOCKED response cannot be mistaken for a
// missing authorization.
async function seedMatchGrant({ callerUserId, targetUserId }) {
  const token = randomUUID();
  await pool.query(
    `INSERT INTO chat_contact_match_grants (token_hash, caller_user_id, target_user_id, shop_id, expires_at)
     VALUES ($1, $2, $3, NULL, now() + interval '1 hour')`,
    [createHash("sha256").update(token).digest("hex"), callerUserId, targetUserId],
  );
  return token;
}

// ── Probes ──────────────────────────────────────────────────────────────────

// Outbound actions a block must stop. A permitted attempt must either really
// succeed (with the payload the client needs) or fail closed with one of the
// capability codes this environment can legitimately produce — the seeded rooms
// have no provider room and no call service is configured. Any other response
// counts as "not allowed", so a member wrongly refused by a 404 or a 500 still
// fails the check instead of being mistaken for proof that the block is off.
function outboundActions(roomId) {
  return [
    {
      action: "send a message",
      method: "POST",
      path: `/chat/rooms/${roomId}/messages`,
      body: () => ({ clientRequestId: randomUUID(), kind: "text", body: "block probe" }),
      succeeded: (result) => result.status === 200 && !!result.json?.message?.id,
      capabilityCodes: ["ROOM_NOT_PROVISIONED", "MATRIX_UNAVAILABLE", "MATRIX_SEND_FAILED"],
    },
    {
      action: "request an attachment upload URL",
      method: "POST",
      path: `/chat/rooms/${roomId}/upload-url`,
      body: () => ({ name: "probe.jpg", size: 12, contentType: "image/jpeg" }),
      succeeded: (result) =>
        result.status === 200
        && /^https?:\/\//.test(result.json?.uploadURL ?? "")
        && !!result.json?.objectPath,
      capabilityCodes: ["OBJECT_STORAGE_UNAVAILABLE"],
    },
    {
      action: "request a call token",
      method: "POST",
      path: `/chat/rooms/${roomId}/call-token`,
      body: () => ({}),
      succeeded: (result) => result.status === 200 && !!result.json?.token,
      capabilityCodes: ["LIVEKIT_UNAVAILABLE"],
    },
  ];
}

function actionWasAllowed(result, spec) {
  if (spec.succeeded(result)) return true;
  return result.status === 503 && spec.capabilityCodes.includes(result.json?.code);
}

async function probeOutbound(roomId, user) {
  const results = [];
  for (const spec of outboundActions(roomId)) {
    results.push({
      spec,
      result: await api(spec.method, spec.path, user.token, spec.body()),
    });
  }
  return results;
}

async function expectOutboundBlocked(label, roomId, user) {
  for (const { spec, result } of await probeOutbound(roomId, user)) {
    check(
      `${label} cannot ${spec.action}`,
      result.status === 403 && result.json?.code === "CHAT_BLOCKED",
      result,
    );
  }
}

async function expectOutboundAllowed(label, roomId, user) {
  for (const { spec, result } of await probeOutbound(roomId, user)) {
    check(
      `${label} may ${spec.action}`,
      actionWasAllowed(result, spec),
      result,
    );
  }
}

// An upload URL that is refused must also leave no reservation behind: a
// pending upload row would let the caller push bytes into the shared chat
// namespace even though the conversation is blocked.
async function pendingUploadCount(userId) {
  const { rows: [row] } = await pool.query(
    `SELECT count(*)::int AS total FROM pending_uploads WHERE owner_user_id = $1`,
    [userId],
  );
  return row.total;
}

async function blockRowsFor(userIds) {
  const { rows } = await pool.query(
    `SELECT blocker_user_id::text AS blocker, blocked_user_id::text AS blocked
     FROM chat_blocks
     WHERE blocker_user_id = ANY($1::uuid[]) OR blocked_user_id = ANY($1::uuid[])
     ORDER BY blocker, blocked`,
    [userIds],
  );
  return rows.map((row) => `${row.blocker}->${row.blocked}`);
}

async function messageCount(roomId) {
  const { rows: [row] } = await pool.query(
    `SELECT count(*)::int AS total FROM chat_messages WHERE room_id = $1`,
    [roomId],
  );
  return row.total;
}

async function createDirectRoomAttempt({ caller, target, tag }) {
  const matchToken = await seedMatchGrant({
    callerUserId: caller.userId,
    targetUserId: target.userId,
  });
  return api("POST", "/chat/rooms", caller.token, {
    name: `Recreated ${marked(tag)}`,
    kind: "direct",
    targetUserId: target.userId,
    matchToken,
    clientRequestId: randomUUID(),
  });
}

// ── Checks ──────────────────────────────────────────────────────────────────

async function run() {
  const shop = await seedShop("main");
  const [u1, u2, u3] = await Promise.all([
    seedUser({ shopId: shop.shopId, tag: "u1" }),
    seedUser({ shopId: shop.shopId, tag: "u2" }),
    seedUser({ shopId: shop.shopId, tag: "u3" }),
  ]);
  const pairIds = [u1.userId, u2.userId, u3.userId];
  const room = await seedDirectRoom({ memberIds: [u1.userId, u2.userId], tag: "u1-u2" });
  const bystanderRoom = await seedDirectRoom({
    memberIds: [u1.userId, u3.userId],
    tag: "u1-u3",
  });
  const shopRoom = await seedShopRoom({
    shopId: shop.shopId,
    memberIds: [u1.userId, u2.userId],
    tag: "shop",
  });

  console.log("== baseline: an unblocked pair can use the conversation ==");
  await expectOutboundAllowed("before any block u1", room.roomId, u1);
  await expectOutboundAllowed("before any block u2", room.roomId, u2);
  const baselineMessages = await messageCount(room.roomId);
  const baselinePendingUploads = {
    u1: await pendingUploadCount(u1.userId),
    u2: await pendingUploadCount(u2.userId),
  };

  console.log("== u1 blocks u2 ==");
  const blocked = await api("POST", `/chat/rooms/${room.roomId}/block`, u1.token, {});
  check(
    "block returns the caller's block state",
    blocked.status === 200 && blocked.json?.isBlocked === true && blocked.json?.blockedByMe === true,
    blocked,
  );
  check(
    "exactly one block row exists, owned by the blocker",
    (await blockRowsFor(pairIds)).join(",") === `${u1.userId}->${u2.userId}`,
    await blockRowsFor(pairIds),
  );

  await expectOutboundBlocked("the blocker u1", room.roomId, u1);
  await expectOutboundBlocked("the blocked contact u2", room.roomId, u2);

  check(
    "no message row was created by any blocked attempt",
    (await messageCount(room.roomId)) === baselineMessages,
    { baselineMessages, now: await messageCount(room.roomId) },
  );
  const pendingAfterBlock = {
    u1: await pendingUploadCount(u1.userId),
    u2: await pendingUploadCount(u2.userId),
  };
  check(
    "no upload reservation was created by any blocked attempt",
    pendingAfterBlock.u1 === baselinePendingUploads.u1
      && pendingAfterBlock.u2 === baselinePendingUploads.u2,
    { baselinePendingUploads, pendingAfterBlock },
  );

  const blockerView = await api("GET", `/chat/rooms/${room.roomId}`, u1.token);
  const blockedView = await api("GET", `/chat/rooms/${room.roomId}`, u2.token);
  check(
    "the blocker sees the room as blocked by itself",
    blockerView.json?.room?.isBlocked === true && blockerView.json?.room?.blockedByMe === true,
    blockerView,
  );
  check(
    "the blocked contact sees the room as blocked but not by itself",
    blockedView.json?.room?.isBlocked === true && blockedView.json?.room?.blockedByMe === false,
    blockedView,
  );

  const historyForBlocked = await api("GET", `/chat/rooms/${room.roomId}/messages`, u2.token);
  check(
    "a blocked contact keeps read access to existing history",
    historyForBlocked.status === 200
      && historyForBlocked.json.messages?.some((message) => message.id === room.messageId),
    historyForBlocked,
  );

  console.log("== the block is scoped to the pair and to direct chat ==");
  await expectOutboundAllowed("in an unrelated room u1", bystanderRoom.roomId, u1);
  await expectOutboundAllowed("in an unrelated room u3", bystanderRoom.roomId, u3);
  // A personal block must not silence the same two people in the shop's own
  // repair conversation, which is business record-keeping, not a friendship.
  await expectOutboundAllowed("in the shop room u1", shopRoom.roomId, u1);
  await expectOutboundAllowed("in the shop room u2", shopRoom.roomId, u2);

  console.log("== a blocked pair cannot open a fresh room to route around it ==");
  for (const [label, caller, target] of [
    ["the blocker u1", u1, u2],
    ["the blocked contact u2", u2, u1],
  ]) {
    const attempt = await createDirectRoomAttempt({ caller, target, tag: "bypass" });
    check(
      `${label} cannot create a new direct room with the blocked peer`,
      attempt.status === 403 && attempt.json?.code === "CHAT_BLOCKED",
      attempt,
    );
  }
  const { rows: extraRooms } = await pool.query(
    `SELECT count(*)::int AS total FROM chat_rooms WHERE peer_key = $1`,
    [peerKeyFor(u1.userId, u2.userId)],
  );
  check(
    "no second room exists for the blocked pair",
    extraRooms[0].total === 1,
    extraRooms[0],
  );

  console.log("== only the owner of a block may lift it ==");
  const victimUnblock = await api("DELETE", `/chat/rooms/${room.roomId}/block`, u2.token, {});
  check(
    "the blocked contact's unblock reports the conversation still blocked",
    victimUnblock.status === 200
      && victimUnblock.json?.isBlocked === true
      && victimUnblock.json?.blockedByMe === false,
    victimUnblock,
  );
  check(
    "the blocker's row survived the blocked contact's unblock",
    (await blockRowsFor(pairIds)).join(",") === `${u1.userId}->${u2.userId}`,
    await blockRowsFor(pairIds),
  );
  await expectOutboundBlocked("after a self-unblock attempt u2", room.roomId, u2);
  await expectOutboundBlocked("after the peer's unblock attempt u1", room.roomId, u1);

  console.log("== lifting a block restores the conversation ==");
  const lifted = await api("DELETE", `/chat/rooms/${room.roomId}/block`, u1.token, {});
  check(
    "the blocker's unblock clears the block state",
    lifted.status === 200 && lifted.json?.isBlocked === false && lifted.json?.blockedByMe === false,
    lifted,
  );
  check("no block rows remain", (await blockRowsFor(pairIds)).length === 0, await blockRowsFor(pairIds));
  await expectOutboundAllowed("after unblocking u1", room.roomId, u1);
  await expectOutboundAllowed("after unblocking u2", room.roomId, u2);

  console.log("== a block by the other side is enforced the same way ==");
  const reverseBlock = await api("POST", `/chat/rooms/${room.roomId}/block`, u2.token, {});
  check("the reverse block is recorded", reverseBlock.status === 200, reverseBlock);
  await expectOutboundBlocked("under the reverse block u2", room.roomId, u2);
  await expectOutboundBlocked("under the reverse block u1", room.roomId, u1);

  console.log("== with blocks on both sides, one lift is not enough ==");
  await api("POST", `/chat/rooms/${room.roomId}/block`, u1.token, {});
  check(
    "both directions are recorded",
    (await blockRowsFor(pairIds)).length === 2,
    await blockRowsFor(pairIds),
  );
  const partialLift = await api("DELETE", `/chat/rooms/${room.roomId}/block`, u1.token, {});
  check(
    "lifting one side still reports the conversation blocked",
    partialLift.status === 200
      && partialLift.json?.isBlocked === true
      && partialLift.json?.blockedByMe === false,
    partialLift,
  );
  await expectOutboundBlocked("while the peer's block stands u1", room.roomId, u1);
  await expectOutboundBlocked("while its own block stands u2", room.roomId, u2);
  await api("DELETE", `/chat/rooms/${room.roomId}/block`, u2.token, {});
  check(
    "clearing the last block empties the table for the pair",
    (await blockRowsFor(pairIds)).length === 0,
    await blockRowsFor(pairIds),
  );
  await expectOutboundAllowed("after both blocks are lifted u1", room.roomId, u1);

  console.log("== block controls are limited to direct conversations ==");
  for (const [label, method] of [["block", "POST"], ["unblock", "DELETE"]]) {
    const shopAttempt = await api(method, `/chat/rooms/${shopRoom.roomId}/block`, u1.token, {});
    check(`a shop room cannot be ${label}ed`, shopAttempt.status === 404, shopAttempt);
    // Checked here, not once at the end: a wrongly-enabled shop-scope block and
    // a wrongly-enabled shop-scope unblock would otherwise cancel each other out.
    check(
      `the refused shop-room ${label} wrote nothing`,
      (await blockRowsFor(pairIds)).length === 0,
      await blockRowsFor(pairIds),
    );
    const missing = await api(method, `/chat/rooms/${randomUUID()}/block`, u1.token, {});
    check(`${label} on an unknown room is not found`, missing.status === 404, missing);
    // A malformed id cannot be matched against the caller's memberships, so the
    // restricted-account guard refuses it before the route does. Either denial
    // is acceptable; silently accepting it is not.
    const malformed = await api(method, `/chat/rooms/not-a-uuid/block`, u1.token, {});
    check(
      `${label} on a malformed room id is denied`,
      malformed.status === 404 || malformed.status === 403,
      malformed,
    );
  }
  const outsiderBlock = await api("POST", `/chat/rooms/${room.roomId}/block`, u3.token, {});
  check(
    "a non-member cannot block inside someone else's direct room",
    outsiderBlock.status === 404,
    outsiderBlock,
  );
  check(
    "the refused non-member block wrote no row",
    (await blockRowsFor(pairIds)).length === 0,
    await blockRowsFor(pairIds),
  );

  // Refusing an unblock only means something when the caller owns a row that a
  // wrongly-enabled call would delete — the real handler removes rows by
  // blocker_user_id = caller. So every caller probed here owns one.
  console.log("== a refused unblock cannot destroy someone's block ==");
  await pool.query(
    `INSERT INTO chat_blocks (blocker_user_id, blocked_user_id)
     VALUES ($1, $2), ($2, $1), ($3, $1), ($3, $2) ON CONFLICT DO NOTHING`,
    [u1.userId, u2.userId, u3.userId],
  );
  const sentinel = (await blockRowsFor(pairIds)).join(",");
  for (const [label, caller, roomId] of [
    ["a non-member", u3, room.roomId],
    ["a blocker calling through the shop room", u1, shopRoom.roomId],
    ["a blocked contact calling through the shop room", u2, shopRoom.roomId],
  ]) {
    const refused = await api("DELETE", `/chat/rooms/${roomId}/block`, caller.token, {});
    check(`${label} cannot unblock through that room`, refused.status === 404, refused);
    check(
      `${label}'s refused unblock destroyed no block row`,
      (await blockRowsFor(pairIds)).join(",") === sentinel,
      { sentinel, now: await blockRowsFor(pairIds) },
    );
  }
  await pool.query(`DELETE FROM chat_blocks WHERE blocker_user_id = ANY($1::uuid[])`, [pairIds]);

  console.log("== a blocked pair with no room yet cannot start one ==");
  const [w1, w2] = await Promise.all([
    seedUser({ shopId: shop.shopId, tag: "w1" }),
    seedUser({ shopId: shop.shopId, tag: "w2" }),
  ]);
  await pool.query(
    `INSERT INTO chat_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)`,
    [w1.userId, w2.userId],
  );
  for (const [label, caller, target] of [
    ["the blocker", w1, w2],
    ["the blocked contact", w2, w1],
  ]) {
    const attempt = await createDirectRoomAttempt({ caller, target, tag: "fresh" });
    check(
      `${label} cannot open a first direct room with a blocked peer`,
      attempt.status === 403 && attempt.json?.code === "CHAT_BLOCKED",
      attempt,
    );
  }
  const { rows: [freshRooms] } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM chat_rooms WHERE peer_key = $1) AS rooms,
       (SELECT count(*)::int FROM chat_room_members WHERE user_id = ANY($2::uuid[])) AS memberships`,
    [peerKeyFor(w1.userId, w2.userId), [w1.userId, w2.userId]],
  );
  check(
    "the refused attempts created no room and no membership",
    freshRooms.rooms === 0 && freshRooms.memberships === 0,
    freshRooms,
  );
}

// ── Fixture lifecycle ───────────────────────────────────────────────────────

async function cleanupFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1`,
      [`%${FIXTURE_MARKER}%`],
    );
    await client.query(
      `DELETE FROM users WHERE name LIKE $1 OR email LIKE $1`,
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
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE u.name LIKE $1 OR u.email LIKE $1
       UNION ALL
       SELECT 'rooms', count(*)::int
       FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1
       UNION ALL
       SELECT 'messages', count(*)::int
       FROM chat_messages WHERE body LIKE $1 OR sender_name LIKE $1
       UNION ALL
       SELECT 'blocks', count(*)::int
       FROM chat_blocks b JOIN users u ON u.id = b.blocker_user_id
       WHERE u.name LIKE $1 OR u.email LIKE $1
       UNION ALL
       SELECT 'grants', count(*)::int
       FROM chat_contact_match_grants g JOIN users u ON u.id = g.caller_user_id
       WHERE u.name LIKE $1 OR u.email LIKE $1
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
    await run();
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
  console.log("\nAll chat block checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
