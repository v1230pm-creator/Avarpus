// API integration checks for chat delta sync and delivery acknowledgements.
//
// Proves: the sync feed is scoped to the caller's rooms, its cursor is
// monotonic and microsecond-safe, fresh rows are re-served rather than lost,
// acks are membership-gated, first-seen-only and idempotent, read implies
// delivered, the sender's per-message delivery summary prefers receipts over
// the legacy synced-app signal, and it degrades to that signal once the
// retention job has pruned the receipts.
//
// Usage: node scripts/run-isolated.mjs scripts/test-chat-sync.mjs
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";

const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5661;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FIXTURE_MARKER = `chat-sync-${randomBytes(8).toString("hex")}`;
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

async function seedUser(tag, { role = "customer", shopId = null } = {}) {
  const suffix = randomBytes(5).toString("hex");
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active, shop_id)
     VALUES ($1, $2, $3, 'x', $4, true, $5) RETURNING id`,
    [`Sync ${marked(tag)}`, `${marked(tag)}-${suffix}@example.com`, `7${suffix.slice(0, 9)}`, role, shopId],
  );
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [token, user.id],
  );
  return { userId: user.id, token, label: tag };
}

// A business shop owned by a fresh dealer account; both are marker-named.
async function seedShop(tag) {
  const owner = await seedUser(`owner-${tag}`, { role: "dealer" });
  const { rows: [shop] } = await pool.query(
    `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
    [owner.userId, `Sync shop ${marked(tag)}`],
  );
  await pool.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, owner.userId]);
  return { owner, shopId: shop.id };
}

async function seedShopRoom({ shopId, memberIds, tag }) {
  const { rows: [room] } = await pool.query(
    `INSERT INTO chat_rooms (shop_id, scope, kind, name, created_by_id, created_by_name)
     VALUES ($1, 'shop', 'customer', $2, $3, $4) RETURNING id`,
    [shopId, `Shop room ${marked(tag)}`, memberIds[0], `Sync ${marked(tag)}`],
  );
  await pool.query(
    `INSERT INTO chat_room_members (room_id, shop_id, user_id, joined_at)
     SELECT $1, $2, unnest($3::uuid[]), now() - interval '1 hour'`,
    [room.id, shopId, memberIds],
  );
  return room.id;
}

async function seedDirectRoom({ memberIds, tag, joinedAt = "now() - interval '1 hour'" }) {
  const { rows: [room] } = await pool.query(
    `INSERT INTO chat_rooms (shop_id, scope, kind, name, peer_key, created_by_id, created_by_name)
     VALUES (NULL, 'global_direct', 'direct', $1, $2, $3, $4) RETURNING id`,
    [`Direct room ${marked(tag)}`, [...memberIds].sort().join(":"), memberIds[0], `Sync ${marked(tag)}`],
  );
  await pool.query(
    // Joined an hour ago so backdated fixture messages fall inside membership.
    `INSERT INTO chat_room_members (room_id, shop_id, user_id, joined_at)
     SELECT $1, NULL, unnest($2::uuid[]), ${joinedAt}`,
    [room.id, memberIds],
  );
  return room.id;
}

// `at` is an SQL expression for created_at/updated_at (default: now()).
async function seedMessage({ roomId, senderId, body, at = "now()", kind = "text", objectPath = null }) {
  // Child rows must carry the room's shop id (enforced by a DB trigger).
  const { rows: [message] } = await pool.query(
    `INSERT INTO chat_messages (room_id, shop_id, sender_id, sender_name, kind, body, object_path, created_at, updated_at)
     SELECT r.id, r.shop_id, $2, $3, $4, $5, $6, ${at}, ${at} FROM chat_rooms r WHERE r.id = $1 RETURNING id`,
    [roomId, senderId, `Sync ${marked("sender")}`, kind, `${body}-${marked("msg")}`, objectPath],
  );
  return message.id;
}

async function receipt(messageId, userId) {
  const { rows: [row] } = await pool.query(
    `SELECT delivered_at, stored_at, updated_at FROM chat_message_receipts
     WHERE message_id = $1 AND user_id = $2`,
    [messageId, userId],
  );
  return row ?? null;
}

async function sync(token, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const suffix = search.toString();
  return api("GET", `/chat/sync${suffix ? `?${suffix}` : ""}`, token);
}

const ids = (result) => (result.json.messages ?? []).map((m) => m.id);

// ── Probes ──────────────────────────────────────────────────────────────────

async function run() {
  const alice = await seedUser("alice");
  const bob = await seedUser("bob");
  const carol = await seedUser("carol");
  const dave = await seedUser("dave");
  const room = await seedDirectRoom({ memberIds: [alice.userId, bob.userId], tag: "ab" });
  const foreignRoom = await seedDirectRoom({ memberIds: [carol.userId, dave.userId], tag: "cd" });

  // Settled history: older than the settle lag so the cursor may pass it.
  const oldA = await seedMessage({ roomId: room, senderId: alice.userId, body: "old-a", at: "now() - interval '60 seconds'" });
  const oldForeign = await seedMessage({ roomId: foreignRoom, senderId: carol.userId, body: "old-foreign", at: "now() - interval '60 seconds'" });

  // ── Initial window and scoping ─────────────────────────────────────────
  const bobInitial = await sync(bob.token);
  check(
    "initial sync returns the recent window, a cursor and a backfill marker",
    bobInitial.status === 200
      && ids(bobInitial).includes(oldA)
      && typeof bobInitial.json.nextCursor === "string"
      && typeof bobInitial.json.backfillBefore === "string"
      && bobInitial.json.hasMore === false,
    bobInitial,
  );
  check(
    "initial sync never includes another pair's room",
    !ids(bobInitial).includes(oldForeign)
      && !(bobInitial.json.rooms ?? []).some((r) => r.id === foreignRoom),
    bobInitial.json,
  );
  check(
    "initial sync lists the room the caller is a member of",
    (bobInitial.json.rooms ?? []).some((r) => r.id === room),
    bobInitial.json.rooms,
  );
  const carolInitial = await sync(carol.token);
  check(
    "a member of a different room sees only their own room's messages",
    carolInitial.status === 200 && !ids(carolInitial).includes(oldA) && ids(carolInitial).includes(oldForeign),
    carolInitial,
  );

  const bobFollowUp = await sync(bob.token, { cursor: bobInitial.json.nextCursor });
  check(
    "a follow-up sync after a settled window returns nothing new",
    bobFollowUp.status === 200 && ids(bobFollowUp).length === 0 && bobFollowUp.json.backfillBefore === undefined,
    bobFollowUp,
  );

  // ── Room filter and cursor validation ──────────────────────────────────
  const foreignFilter = await sync(bob.token, { roomId: foreignRoom });
  const foreignFilterCarol = await sync(carol.token, { roomId: foreignRoom });
  check(
    "?roomId for a room the caller is not a member of is 404 (member gets 200)",
    foreignFilter.status === 404 && foreignFilterCarol.status === 200,
    { foreignFilter, foreignFilterCarol },
  );
  const bogus = await sync(bob.token, { cursor: "not-a-cursor" });
  const mismatch = await sync(bob.token, { cursor: bobInitial.json.nextCursor, roomId: room });
  check(
    "a garbage cursor and a cursor reused across room filters are both 400",
    bogus.status === 400 && bogus.json.code === "INVALID_CURSOR"
      && mismatch.status === 400 && mismatch.json.code === "CURSOR_ROOM_MISMATCH",
    { bogus, mismatch },
  );
  const carolRoomSync = await sync(carol.token, { roomId: foreignRoom, cursor: (await sync(carol.token, { roomId: foreignRoom })).json.nextCursor });
  check(
    "a room-filtered cursor round-trips",
    carolRoomSync.status === 200,
    carolRoomSync,
  );

  // ── Fresh rows: served now, cursor parks, nothing lost ─────────────────
  let cursor = bobFollowUp.json.nextCursor;
  const freshA = await seedMessage({ roomId: room, senderId: alice.userId, body: "fresh-a" });
  const first = await sync(bob.token, { cursor });
  const second = await sync(bob.token, { cursor: first.json.nextCursor });
  check(
    "a message younger than the settle lag is delivered immediately and re-served until it settles",
    ids(first).includes(freshA) && ids(second).includes(freshA),
    { first: ids(first), second: ids(second) },
  );
  check(
    "the cursor is monotonic even when nothing changed",
    first.json.nextCursor !== cursor || second.json.nextCursor !== cursor,
    { cursor, first: first.json.nextCursor, second: second.json.nextCursor },
  );

  // ── Microsecond-safe keyset paging ─────────────────────────────────────
  // Three settled rows at the exact same microsecond, paged one per call,
  // then a row exactly one microsecond after the last cursor row.
  const T = "date_trunc('second', now()) - interval '40 seconds' + interval '0.123456 seconds'";
  const tie1 = await seedMessage({ roomId: room, senderId: alice.userId, body: "tie-1", at: T });
  const tie2 = await seedMessage({ roomId: room, senderId: alice.userId, body: "tie-2", at: T });
  const tie3 = await seedMessage({ roomId: room, senderId: alice.userId, body: "tie-3", at: T });
  // These rows are timestamped before the previous cursor position, so start a
  // fresh room-filtered walk from the initial window to page through them.
  const walk = [];
  let walkCursor;
  let walkResult;
  for (let i = 0; i < 12; i++) {
    walkResult = await sync(bob.token, { roomId: room, limit: 1, cursor: walkCursor });
    walk.push(...ids(walkResult));
    walkCursor = walkResult.json.nextCursor;
    if (!walkResult.json.hasMore) break;
  }
  const tieSet = [tie1, tie2, tie3];
  check(
    "identical-timestamp rows page one per call with no gaps and no duplicates",
    tieSet.every((id) => walk.filter((seen) => seen === id).length === 1)
      && walk.filter((id) => id === oldA).length === 1,
    { walk },
  );
  const settledWalk = walk.slice();
  const plusOne = await seedMessage({ roomId: room, senderId: alice.userId, body: "plus-one", at: `${T} + interval '1 microsecond'` });
  const afterPlusOne = await sync(bob.token, { roomId: room, cursor: walkCursor });
  // The walk's cursor parked at the settle boundary (all settled rows were
  // consumed), so plusOne — 40 s old — is behind it. Re-walk from a cursor
  // positioned exactly on the tie rows instead: limit=1 from scratch stops
  // on tie3 (or one of its siblings), and the next page must surface plusOne.
  const exactWalk = [];
  let exactCursor;
  for (let i = 0; i < 12; i++) {
    const r = await sync(bob.token, { roomId: room, limit: 1, cursor: exactCursor });
    exactWalk.push(...ids(r));
    exactCursor = r.json.nextCursor;
    if (!r.json.hasMore) break;
  }
  check(
    "a row one microsecond after the cursor row is not skipped",
    exactWalk.includes(plusOne)
      && exactWalk.indexOf(plusOne) > Math.max(...tieSet.map((id) => exactWalk.indexOf(id)))
      && settledWalk.length + 1 === exactWalk.length,
    { exactWalk, afterPlusOne: ids(afterPlusOne) },
  );

  // ── Acknowledgements ───────────────────────────────────────────────────
  const media = await seedMessage({
    roomId: room,
    senderId: alice.userId,
    body: "photo",
    kind: "image",
    objectPath: `/objects/uploads/${room}/chat/${room}/${randomBytes(8).toString("hex")}`,
    at: "now() - interval '30 seconds'",
  });
  // Bob's own message: Alice can ack it, Bob cannot.
  const fromBob = await seedMessage({ roomId: room, senderId: bob.userId, body: "from-bob", at: "now() - interval '30 seconds'" });

  const foreignAck = await api("POST", "/chat/acks", carol.token, { acks: [{ messageId: oldA, state: "delivered" }] });
  const mixedAck = await api("POST", "/chat/acks", carol.token, {
    acks: [{ messageId: oldForeign, state: "delivered" }, { messageId: oldA, state: "delivered" }],
  });
  check(
    "a non-member cannot ack a foreign message, alone or mixed into a valid batch",
    foreignAck.status === 404 && mixedAck.status === 404
      && (await receipt(oldA, carol.userId)) === null
      && (await receipt(oldForeign, carol.userId)) === null,
    { foreignAck, mixedAck },
  );
  const bogusAck = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: randomUUID(), state: "delivered" }] });
  const emptyAck = await api("POST", "/chat/acks", bob.token, { acks: [] });
  const badState = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: oldA, state: "read" }] });
  check(
    "unknown ids are 404 and malformed bodies are 400",
    bogusAck.status === 404 && emptyAck.status === 400 && badState.status === 400,
    { bogusAck, emptyAck, badState },
  );

  const ownAck = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: fromBob, state: "delivered" }] });
  const textStored = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: oldA, state: "stored" }] });
  check(
    "own messages and stored-acks on text are ignored, not recorded",
    ownAck.status === 200 && ownAck.json.ignored?.[0]?.reason === "own_message" && ownAck.json.acknowledged.length === 0
      && textStored.status === 200 && textStored.json.ignored?.[0]?.reason === "no_media"
      && (await receipt(fromBob, bob.userId)) === null
      && (await receipt(oldA, bob.userId)) === null,
    { ownAck, textStored },
  );

  const ack1 = await api("POST", "/chat/acks", bob.token, {
    acks: [{ messageId: oldA, state: "delivered" }, { messageId: media, state: "delivered" }],
  });
  const r1 = await receipt(oldA, bob.userId);
  const m1 = await receipt(media, bob.userId);
  await sleep(50);
  const ack2 = await api("POST", "/chat/acks", bob.token, {
    acks: [{ messageId: oldA, state: "delivered" }, { messageId: media, state: "delivered" }],
  });
  const r2 = await receipt(oldA, bob.userId);
  check(
    "delivered acks record a first-seen time that a repeat never moves",
    ack1.status === 200 && ack1.json.acknowledged.length === 2
      && ack2.status === 200 && ack2.json.acknowledged.length === 2
      && r1 && r2 && r1.delivered_at.getTime() === r2.delivered_at.getTime()
      && r1.updated_at.getTime() === r2.updated_at.getTime()
      && r1.stored_at === null && m1?.stored_at === null,
    { ack1, ack2, r1, r2 },
  );

  const stored1 = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: media, state: "stored" }] });
  const s1 = await receipt(media, bob.userId);
  await sleep(50);
  const stored2 = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: media, state: "stored" }] });
  const s2 = await receipt(media, bob.userId);
  check(
    "a stored ack sets storedAt once (bumping updatedAt once) and keeps deliveredAt",
    stored1.status === 200 && stored2.status === 200
      && s1?.stored_at && s2?.stored_at
      && s1.stored_at.getTime() === s2.stored_at.getTime()
      && s1.updated_at.getTime() === s2.updated_at.getTime()
      && s1.updated_at.getTime() > m1.updated_at.getTime()
      && s1.delivered_at.getTime() === m1.delivered_at.getTime(),
    { s1, s2, m1 },
  );
  // A stored ack on a message never delivered before records both at once.
  const media2 = await seedMessage({
    roomId: room,
    senderId: alice.userId,
    body: "photo-2",
    kind: "image",
    objectPath: `/objects/uploads/${room}/chat/${room}/${randomBytes(8).toString("hex")}`,
    at: "now() - interval '30 seconds'",
  });
  const storedFirst = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: media2, state: "stored" }] });
  const sf = await receipt(media2, bob.userId);
  check(
    "stored implies delivered",
    storedFirst.status === 200 && sf?.delivered_at && sf?.stored_at,
    { storedFirst, sf },
  );

  // ── Lost acks: the one sanctioned reversal of `stored` ─────────────────
  // Bob's phone reports that its saved copy of `media` went missing while
  // the relay still holds the bytes: his stored mark is cleared (so the
  // purge waits for a fresh `stored`), updatedAt moves so the sender's sync
  // feed re-serves the receipt, deliveredAt never changes, and a later
  // `stored` sets a brand-new time. Repeats are no-ops; a lost ack on media
  // the relay already dropped is ignored as `relay_gone` and touches nothing;
  // text gets `no_media`; own messages `own_message`.
  const aliceSyncBeforeLost = await sync(alice.token);
  await sleep(50);
  const lost1 = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: media, state: "lost" }] });
  const l1 = await receipt(media, bob.userId);
  await sleep(50);
  const lost2 = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: media, state: "lost" }] });
  const l2 = await receipt(media, bob.userId);
  const aliceSyncAfterLost = await sync(alice.token, { cursor: aliceSyncBeforeLost.json.nextCursor });
  const lostReceipt = (aliceSyncAfterLost.json.receipts ?? []).find((r) => r.messageId === media && r.userId === bob.userId);
  const aliceAfterLost = new Map(((await api("GET", `/chat/rooms/${room}/messages`, alice.token)).json.messages ?? []).map((m) => [m.id, m]));
  check(
    "a lost ack clears the caller's stored mark once, bumps updatedAt, keeps deliveredAt and reaches the sender's feed",
    lost1.status === 200 && lost1.json.acknowledged.length === 1 && lost1.json.ignored.length === 0
      && lost2.status === 200 && lost2.json.acknowledged.length === 1
      && l1 && l1.stored_at === null && l1.updated_at.getTime() > s2.updated_at.getTime()
      && l1.delivered_at.getTime() === s2.delivered_at.getTime()
      && l2 && l2.stored_at === null && l2.updated_at.getTime() === l1.updated_at.getTime()
      && aliceSyncAfterLost.status === 200 && lostReceipt && lostReceipt.storedAt === null
      && typeof lostReceipt.deliveredAt === "string"
      && aliceAfterLost.get(media)?.delivery?.status === "delivered"
      && aliceAfterLost.get(media)?.delivery?.storedAt === undefined,
    { lost1, lost2, l1, l2, s2, lostReceipt, delivery: aliceAfterLost.get(media)?.delivery },
  );
  await sleep(50);
  const reStored = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: media, state: "stored" }] });
  const rs = await receipt(media, bob.userId);
  check(
    "a fresh stored ack after a loss records a new storedAt (later than the original) and bumps updatedAt again",
    reStored.status === 200 && reStored.json.acknowledged.length === 1
      && rs?.stored_at && rs.stored_at.getTime() > s2.stored_at.getTime()
      && rs.updated_at.getTime() > l2.updated_at.getTime()
      && rs.delivered_at.getTime() === s2.delivered_at.getTime(),
    { reStored, rs, s2, l2 },
  );
  // Same batch: `delivered` never overrides `stored`/`lost` listed alongside;
  // between `stored` and `lost` the later entry wins.
  const batched = await api("POST", "/chat/acks", bob.token, {
    acks: [
      { messageId: media, state: "lost" },
      { messageId: media, state: "delivered" },
      { messageId: media2, state: "lost" },
      { messageId: media2, state: "stored" },
    ],
  });
  const bMedia = await receipt(media, bob.userId);
  const bMedia2 = await receipt(media2, bob.userId);
  check(
    "batch precedence: delivered never overrides lost; the later of stored/lost wins",
    batched.status === 200 && batched.json.acknowledged.length === 2
      && bMedia?.stored_at === null && bMedia2?.stored_at && bMedia2.stored_at.getTime() === sf.stored_at.getTime(),
    { batched, bMedia, bMedia2 },
  );
  // Relay already dropped the bytes: nothing to protect, the receipt is left alone.
  await pool.query(`UPDATE chat_messages SET media_state = 'purged' WHERE id = $1`, [media2]);
  const lostGone = await api("POST", "/chat/acks", bob.token, {
    acks: [{ messageId: media2, state: "lost" }, { messageId: oldA, state: "lost" }, { messageId: fromBob, state: "lost" }],
  });
  const goneReceipt = await receipt(media2, bob.userId);
  await pool.query(`UPDATE chat_messages SET media_state = 'available' WHERE id = $1`, [media2]);
  check(
    "lost on purged media is ignored as relay_gone (receipt untouched); text is no_media; own messages own_message",
    lostGone.status === 200 && lostGone.json.acknowledged.length === 0
      && lostGone.json.ignored.find((i) => i.messageId === media2)?.reason === "relay_gone"
      && lostGone.json.ignored.find((i) => i.messageId === oldA)?.reason === "no_media"
      && lostGone.json.ignored.find((i) => i.messageId === fromBob)?.reason === "own_message"
      && goneReceipt?.stored_at && goneReceipt.stored_at.getTime() === bMedia2.stored_at.getTime()
      && goneReceipt.updated_at.getTime() === bMedia2.updated_at.getTime()
      && (await receipt(oldA, bob.userId))?.stored_at === null
      && (await receipt(fromBob, bob.userId)) === null,
    { lostGone, goneReceipt, bMedia2 },
  );
  // Leave `media` stored again so the sender-view checks below see storedAt.
  await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: media, state: "stored" }] });

  // ── Sender's view: receipts beat the legacy signal ─────────────────────
  const aliceList = await api("GET", `/chat/rooms/${room}/messages`, alice.token);
  const byId = new Map((aliceList.json.messages ?? []).map((m) => [m.id, m]));
  check(
    "the sender sees receipt-backed delivered/stored state per message",
    byId.get(oldA)?.delivery?.status === "delivered"
      && byId.get(oldA)?.delivery?.source === "receipts"
      && typeof byId.get(oldA)?.delivery?.deliveredAt === "string"
      && byId.get(media)?.delivery?.status === "delivered"
      && typeof byId.get(media)?.delivery?.storedAt === "string"
      && byId.get(media)?.mediaState === "available"
      && byId.get(oldA)?.mediaState === undefined
      && typeof byId.get(oldA)?.updatedAt === "string",
    { oldA: byId.get(oldA), media: byId.get(media) },
  );
  // freshA has no receipt; Bob's app synced after it was sent → legacy delivered.
  // tie rows predate Bob's last sync? No — they are 40 s old and Bob synced
  // since, so legacy also says delivered. Make a brand-new one Bob has not
  // synced past to observe "sent".
  const unseen = await seedMessage({ roomId: room, senderId: alice.userId, body: "unseen", at: "now() + interval '2 seconds'" });
  const aliceList2 = await api("GET", `/chat/rooms/${room}/messages`, alice.token);
  const byId2 = new Map((aliceList2.json.messages ?? []).map((m) => [m.id, m]));
  check(
    "without a receipt the legacy synced-app signal still decides delivered vs sent",
    byId2.get(freshA)?.delivery?.status === "delivered"
      && byId2.get(freshA)?.delivery?.source === "legacy"
      && byId2.get(freshA)?.delivery?.deliveredAt === undefined
      && byId2.get(unseen)?.delivery?.status === "sent"
      && byId2.get(unseen)?.delivery?.source === "legacy",
    { freshA: byId2.get(freshA), unseen: byId2.get(unseen) },
  );
  const bobList = await api("GET", `/chat/rooms/${room}/messages`, bob.token);
  // Alice's own list call above counted as her app syncing, so Bob's message
  // to her reads as legacy-delivered; only the summary's presence matters here.
  check(
    "recipients get no delivery summary for messages they did not send",
    (bobList.json.messages ?? []).filter((m) => m.senderId === alice.userId).every((m) => m.delivery === undefined)
      && (bobList.json.messages ?? []).find((m) => m.id === fromBob)?.delivery?.source === "legacy",
    bobList.json.messages?.map((m) => ({ id: m.id, delivery: m.delivery })),
  );

  // ── Pruned receipts: the summary falls back to the legacy signal ───────
  // The retention job (lib/chatReceiptRetention.ts) deletes receipt rows once
  // a message's relay lifecycle is settled and the receipt is old. Reproduce
  // its effect on messages Bob already acknowledged and check the sender's
  // view degrades instead of breaking: delivered comes from the synced-app
  // signal, stored simply disappears, the sync feed stops carrying the rows,
  // and a repeat ack after the prune is accepted as a fresh first-seen receipt.
  const prunedText = await seedMessage({ roomId: room, senderId: alice.userId, body: "pruned-text", at: "now() - interval '45 seconds'" });
  const prunedMedia = await seedMessage({
    roomId: room,
    senderId: alice.userId,
    body: "pruned-photo",
    kind: "image",
    objectPath: `/objects/uploads/${room}/chat/${room}/${randomBytes(8).toString("hex")}`,
    at: "now() - interval '45 seconds'",
  });
  const prunedAck = await api("POST", "/chat/acks", bob.token, {
    acks: [{ messageId: prunedText, state: "delivered" }, { messageId: prunedMedia, state: "stored" }],
  });
  const beforePrune = new Map(((await api("GET", `/chat/rooms/${room}/messages`, alice.token)).json.messages ?? []).map((m) => [m.id, m]));
  const { rowCount: prunedRows } = await pool.query(
    `DELETE FROM chat_message_receipts WHERE message_id = ANY($1::uuid[])`,
    [[prunedText, prunedMedia]],
  );
  const afterPrune = new Map(((await api("GET", `/chat/rooms/${room}/messages`, alice.token)).json.messages ?? []).map((m) => [m.id, m]));
  const aliceSyncAfterPrune = await sync(alice.token);
  check(
    "after receipts are pruned the sender's summary falls back to the legacy signal without stored/delivered times",
    prunedAck.status === 200 && prunedAck.json.acknowledged.length === 2 && prunedRows === 2
      && beforePrune.get(prunedText)?.delivery?.source === "receipts"
      && typeof beforePrune.get(prunedMedia)?.delivery?.storedAt === "string"
      && afterPrune.get(prunedText)?.delivery?.status === "delivered"
      && afterPrune.get(prunedText)?.delivery?.source === "legacy"
      && afterPrune.get(prunedText)?.delivery?.deliveredAt === undefined
      && afterPrune.get(prunedMedia)?.delivery?.status === "delivered"
      && afterPrune.get(prunedMedia)?.delivery?.source === "legacy"
      && afterPrune.get(prunedMedia)?.delivery?.storedAt === undefined
      && afterPrune.get(prunedMedia)?.mediaState === "available"
      && aliceSyncAfterPrune.status === 200
      && !(aliceSyncAfterPrune.json.receipts ?? []).some((r) => r.messageId === prunedText || r.messageId === prunedMedia),
    {
      prunedAck,
      prunedRows,
      before: { text: beforePrune.get(prunedText)?.delivery, media: beforePrune.get(prunedMedia)?.delivery },
      after: { text: afterPrune.get(prunedText)?.delivery, media: afterPrune.get(prunedMedia)?.delivery },
    },
  );
  const reAck = await api("POST", "/chat/acks", bob.token, { acks: [{ messageId: prunedText, state: "delivered" }] });
  const reAckReceipt = await receipt(prunedText, bob.userId);
  const afterReAck = new Map(((await api("GET", `/chat/rooms/${room}/messages`, alice.token)).json.messages ?? []).map((m) => [m.id, m]));
  check(
    "a repeat ack after the prune is recorded again as a first-seen receipt",
    reAck.status === 200 && reAck.json.acknowledged.length === 1
      && reAckReceipt?.delivered_at && reAckReceipt.stored_at === null
      && afterReAck.get(prunedText)?.delivery?.source === "receipts",
    { reAck, reAckReceipt, delivery: afterReAck.get(prunedText)?.delivery },
  );

  // ── Read implies delivered ─────────────────────────────────────────────
  const aliceCursorBeforeRead = (await sync(alice.token)).json.nextCursor;
  const read = await api("POST", `/chat/rooms/${room}/read`, bob.token, { messageId: freshA });
  const readReceipt = await receipt(freshA, bob.userId);
  const tieReceipt = await receipt(tie1, bob.userId);
  const ownAfterRead = await receipt(fromBob, bob.userId);
  check(
    "marking read records delivered receipts for the peer's messages, never for the reader's own",
    read.status === 200 && readReceipt?.delivered_at && tieReceipt?.delivered_at && ownAfterRead === null,
    { read, readReceipt, tieReceipt, ownAfterRead },
  );
  const aliceList3 = await api("GET", `/chat/rooms/${room}/messages`, alice.token);
  const freshAfterRead = (aliceList3.json.messages ?? []).find((m) => m.id === freshA);
  check(
    "the sender now sees read with a readAt",
    freshAfterRead?.delivery?.status === "read" && typeof freshAfterRead?.delivery?.readAt === "string",
    freshAfterRead,
  );

  // ── Streams: receipts, read states, hidden, preferences, tombstones ────
  const aliceDelta = await sync(alice.token, { cursor: aliceCursorBeforeRead });
  check(
    "the sender's sync carries the recipient's receipts and read state",
    aliceDelta.status === 200
      && (aliceDelta.json.receipts ?? []).some((r) => r.messageId === freshA && r.userId === bob.userId && r.storedAt === null)
      && (aliceDelta.json.receipts ?? []).some((r) => r.messageId === media && r.userId === bob.userId && typeof r.storedAt === "string")
      && (aliceDelta.json.readStates ?? []).some((r) => r.roomId === room && r.userId === bob.userId && r.lastReadMessageId === freshA),
    { receipts: aliceDelta.json.receipts, readStates: aliceDelta.json.readStates },
  );
  const carolDelta = await sync(carol.token, { cursor: carolInitial.json.nextCursor });
  check(
    "an outsider's sync carries none of that pair's receipts or read states",
    carolDelta.status === 200
      && (carolDelta.json.receipts ?? []).length === 0
      && (carolDelta.json.readStates ?? []).every((r) => r.roomId !== room),
    carolDelta.json,
  );

  const bobCursor = (await sync(bob.token)).json.nextCursor;
  const hide = await api("POST", `/chat/rooms/${room}/messages/delete`, bob.token, { messageIds: [tie2], scope: "me" });
  const pref = await api("PATCH", `/chat/rooms/${room}/preferences`, bob.token, { isMuted: true });
  const bobDelta = await sync(bob.token, { cursor: bobCursor });
  const aliceDelta2 = await sync(alice.token, { cursor: aliceDelta.json.nextCursor });
  check(
    "hide-for-me and preference changes reach only the caller's own sync",
    hide.status === 200 && pref.status === 200
      && (bobDelta.json.hidden ?? []).some((h) => h.messageId === tie2 && h.roomId === room)
      && (bobDelta.json.preferences ?? []).some((p) => p.roomId === room && p.isMuted === true && p.deletedAt === null)
      && !ids(bobDelta).includes(tie2)
      && (aliceDelta2.json.hidden ?? []).length === 0
      && (aliceDelta2.json.preferences ?? []).length === 0,
    { bob: bobDelta.json, alice: aliceDelta2.json },
  );

  // Tombstone: Alice's own recent message without a provider event needs no Matrix.
  const tomb = await api("POST", `/chat/rooms/${room}/messages/delete`, alice.token, { messageIds: [freshA], scope: "everyone" });
  const bobDelta2 = await sync(bob.token, { cursor: bobDelta.json.nextCursor });
  const tombstone = (bobDelta2.json.messages ?? []).find((m) => m.id === freshA);
  check(
    "delete-for-everyone bumps the message into the peer's sync as a tombstone",
    tomb.status === 200 && tombstone && typeof tombstone.deletedAt === "string" && tombstone.body === ""
      && new Date(tombstone.updatedAt) > new Date(tombstone.createdAt),
    { tomb, tombstone },
  );

  // Membership stream: a room joined after the cursor appears in `rooms`.
  const newRoom = await seedDirectRoom({ memberIds: [bob.userId, dave.userId], tag: "bd", joinedAt: "now()" });
  const bobDelta3 = await sync(bob.token, { cursor: bobDelta2.json.nextCursor });
  const carolDelta2 = await sync(carol.token, { cursor: carolDelta.json.nextCursor });
  check(
    "a newly joined room appears in the member's sync only",
    (bobDelta3.json.rooms ?? []).some((r) => r.id === newRoom)
      && !(carolDelta2.json.rooms ?? []).some((r) => r.id === newRoom),
    { bob: bobDelta3.json.rooms, carol: carolDelta2.json.rooms },
  );

  // ── Workspace change revokes every stream, stale membership or not ─────
  // A shop room stays visible only while the caller's CURRENT shop matches.
  // Once the owner's workspace moves away (shop_id cleared), the membership
  // row is still there but nothing about the room may reach the unfiltered
  // feed: not messages, not the peer's receipts or read state, not the
  // owner's own hides or preferences, not the room itself.
  const { owner, shopId } = await seedShop("s");
  const erin = await seedUser("erin", { role: "technician", shopId });
  const shopRoom = await seedShopRoom({ shopId, memberIds: [owner.userId, erin.userId], tag: "shop" });
  const shopMsg = await seedMessage({ roomId: shopRoom, senderId: owner.userId, body: "shop-msg", at: "now() - interval '30 seconds'" });
  const shopMsg2 = await seedMessage({ roomId: shopRoom, senderId: owner.userId, body: "shop-msg-2", at: "now() - interval '30 seconds'" });
  const ownerCursor = (await sync(owner.token, { cursor: (await sync(owner.token)).json.nextCursor })).json.nextCursor;
  const erinAck = await api("POST", "/chat/acks", erin.token, { acks: [{ messageId: shopMsg, state: "delivered" }] });
  const erinRead = await api("POST", `/chat/rooms/${shopRoom}/read`, erin.token, { messageId: shopMsg });
  const ownerHide = await api("POST", `/chat/rooms/${shopRoom}/messages/delete`, owner.token, { messageIds: [shopMsg2], scope: "me" });
  const ownerPref = await api("PATCH", `/chat/rooms/${shopRoom}/preferences`, owner.token, { isPinned: true });
  const ownerBefore = await sync(owner.token, { cursor: ownerCursor });
  const shopMembership = (json) => (json.rooms ?? []).some((r) => r.id === shopRoom);
  check(
    "while the workspace matches, the owner's feed carries the shop room's receipts, read state, hide and preference",
    erinAck.status === 200 && erinRead.status === 200 && ownerHide.status === 200 && ownerPref.status === 200
      && ownerBefore.status === 200
      && (ownerBefore.json.receipts ?? []).some((r) => r.messageId === shopMsg && r.userId === erin.userId)
      && (ownerBefore.json.readStates ?? []).some((r) => r.roomId === shopRoom && r.userId === erin.userId)
      && (ownerBefore.json.hidden ?? []).some((h) => h.messageId === shopMsg2)
      && (ownerBefore.json.preferences ?? []).some((p) => p.roomId === shopRoom && p.isPinned === true),
    { erinAck, erinRead, ownerHide, ownerPref, before: ownerBefore.json },
  );
  const initialWhileMember = await sync(owner.token);
  await pool.query(`UPDATE users SET shop_id = NULL WHERE id = $1`, [owner.userId]);
  const ownerAfter = await sync(owner.token, { cursor: ownerCursor });
  const ownerInitialAfter = await sync(owner.token);
  const ownerRoomAfter = await sync(owner.token, { roomId: shopRoom });
  const ownerAckAfter = await api("POST", "/chat/acks", owner.token, { acks: [{ messageId: shopMsg, state: "delivered" }] });
  const { rows: [{ n: staleMembership }] } = await pool.query(
    `SELECT count(*)::int AS n FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
    [shopRoom, owner.userId],
  );
  const touchesShopRoom = (json) =>
    ids({ json }).some((id) => id === shopMsg || id === shopMsg2)
    || (json.receipts ?? []).some((r) => r.roomId === shopRoom)
    || (json.readStates ?? []).some((r) => r.roomId === shopRoom)
    || (json.hidden ?? []).some((h) => h.roomId === shopRoom)
    || (json.preferences ?? []).some((p) => p.roomId === shopRoom)
    || shopMembership(json);
  check(
    "after the workspace moves away, the stale membership leaks nothing: no stream, no room filter, no acks",
    staleMembership === 1
      && shopMembership(initialWhileMember.json)
      && ownerAfter.status === 200 && !touchesShopRoom(ownerAfter.json)
      && ownerInitialAfter.status === 200 && !touchesShopRoom(ownerInitialAfter.json)
      && ownerRoomAfter.status === 404
      && ownerAckAfter.status === 404,
    { after: ownerAfter.json, initialAfter: ownerInitialAfter.json, ownerRoomAfter: ownerRoomAfter.status, ownerAckAfter },
  );
  // Presence side channel: syncing after revocation must not refresh the stale
  // membership, so the remaining member neither sees the owner online nor
  // gets a false legacy "delivered" on a message sent after revocation.
  const { rows: [{ last_synced_at: staleSyncBefore }] } = await pool.query(
    `SELECT last_synced_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
    [shopRoom, owner.userId],
  );
  await sleep(20);
  const afterRevocation = await seedMessage({ roomId: shopRoom, senderId: erin.userId, body: "after-revocation" });
  await sync(owner.token);
  await sync(owner.token, { cursor: ownerCursor });
  const { rows: [{ last_synced_at: staleSyncAfter }] } = await pool.query(
    `SELECT last_synced_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
    [shopRoom, owner.userId],
  );
  const erinList = await api("GET", `/chat/rooms/${shopRoom}/messages`, erin.token);
  const erinView = (erinList.json.messages ?? []).find((m) => m.id === afterRevocation);
  check(
    "syncing after revocation leaves the stale membership's presence untouched and the peer's message undelivered",
    String(staleSyncBefore) === String(staleSyncAfter)
      && erinView?.delivery?.status === "sent"
      && erinView?.delivery?.source === "legacy",
    { staleSyncBefore, staleSyncAfter, erinView },
  );

  // The peer whose workspace is unchanged still gets everything.
  const erinFeed = await sync(erin.token);
  check(
    "the member who still belongs to the shop keeps seeing the room",
    erinFeed.status === 200 && ids(erinFeed).includes(shopMsg) && shopMembership(erinFeed.json),
    erinFeed.json,
  );

  // Legacy room-list signal still works and receipts count when it is absent.
  const bobRooms = await api("GET", "/chat/rooms", bob.token);
  check(
    "the room list still answers for a client that never acks",
    bobRooms.status === 200 && (bobRooms.json.rooms ?? bobRooms.json ?? []).length >= 1,
    bobRooms.status,
  );
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanupFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1`, [`%${FIXTURE_MARKER}%`]);
    await client.query(`DELETE FROM shops WHERE business_name LIKE $1`, [`%${FIXTURE_MARKER}%`]);
    await client.query(`DELETE FROM users WHERE name LIKE $1 OR email LIKE $1`, [`%${FIXTURE_MARKER}%`]);
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
       SELECT 'rooms', count(*)::int FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1
       UNION ALL
       SELECT 'shops', count(*)::int FROM shops WHERE business_name LIKE $1
       UNION ALL
       SELECT 'messages', count(*)::int FROM chat_messages WHERE body LIKE $1 OR sender_name LIKE $1
       UNION ALL
       SELECT 'receipts', count(*)::int
       FROM chat_message_receipts r JOIN users u ON u.id = r.user_id
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
  console.log("\nAll chat sync checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
