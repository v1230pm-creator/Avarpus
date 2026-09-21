// Integration test for permanent account deletion (Settings → Account →
// Delete Account). Usage: node scripts/run-isolated.mjs scripts/test-account-deletion.mjs
//
// Contract (see src/lib/accountDeletion.ts, src/routes/account.ts):
//   * every route acts only on the authenticated account; the re-auth code is
//     bound server-side to (account, scope) and a wrong code deletes nothing.
//   * chat: authored messages, memberships, identity, statuses, blocks go;
//     the other person's copy of a shared room survives with its peer key
//     released; the Business layer is untouched; every session is revoked.
//   * business: owned Shops are deleted whole, other members are repointed,
//     memberships in other people's Shops are removed without touching their
//     data; the account becomes a plain personal login; sessions revoked.
//   * both: the users row is gone and the mobile's pending codes with it.
//   * super_admin cannot delete business/both; customer-role accounts can
//     reach the routes (portal allowlist).
//
// The re-auth code is seeded directly into otp_codes so the run never sends
// a real SMS.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
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

const PORT = 5657;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label} — ${JSON.stringify(detail)}`);
  }
}

async function api(method, pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const run = randomBytes(3).toString("hex");
const created = { users: [], shops: [] };
let seq = 0;

async function seedUser(role, tag, extra = {}) {
  seq += 1;
  const mobile = String(9400000000 + (Math.floor(Math.random() * 90000) * 10) + seq);
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'x', $4, true) RETURNING id, mobile`,
    [`Del ${tag}`, `del-${tag}-${run}-${seq}@example.com`, mobile, role],
  );
  created.users.push(user.id);
  return { id: user.id, mobile: user.mobile, ...extra };
}

async function seedShop(owner, tag) {
  const { rows: [shop] } = await pool.query(
    `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
    [owner.id, `Del Shop ${tag} ${run}`],
  );
  created.shops.push(shop.id);
  await pool.query(
    `INSERT INTO shop_memberships (shop_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
    [shop.id, owner.id],
  );
  await pool.query(`UPDATE users SET shop_id = $1, role = 'dealer' WHERE id = $2`, [shop.id, owner.id]);
  await pool.query(
    `INSERT INTO customers (shop_id, name, mobile) VALUES ($1, $2, $3)`,
    [shop.id, `Cust ${tag}`, "9000000001"],
  );
  await pool.query(
    `INSERT INTO repairs (shop_id, repair_id, customer_name, mobile, device_type, brand, model, problem, receive_date, expected_date)
     VALUES ($1, $2, 'Cust', '9000000001', 'Mobile', 'X', 'Y', 'Dead', '2026-09-01', '2026-09-05')`,
    [shop.id, `DEL-${run}-${seq}`],
  );
  return shop.id;
}

async function addStaff(shopId, user, role = "technician") {
  await pool.query(
    `INSERT INTO shop_memberships (shop_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`,
    [shopId, user.id, role],
  );
  await pool.query(`UPDATE users SET shop_id = $1, role = $2 WHERE id = $3`, [shopId, role, user.id]);
}

async function seedSession(userId, withPush = false) {
  const token = randomBytes(32).toString("hex");
  const { rows: [session] } = await pool.query(
    `INSERT INTO sessions (token, user_id, device_info, expires_at)
     VALUES ($1, $2, 'Test device', '9999-12-31T23:59:59.999Z') RETURNING id`,
    [token, userId],
  );
  if (withPush) {
    await pool.query(
      `INSERT INTO push_tokens (token, user_id, session_id, platform)
       VALUES ($1, $2, $3, 'android')`,
      [`ExponentPushToken[${randomBytes(8).toString("hex")}]`, userId, session.id],
    );
  }
  return token;
}

async function seedDirectRoom(a, b) {
  const peerKey = [a.id, b.id].sort().join(":");
  const { rows: [room] } = await pool.query(
    `INSERT INTO chat_rooms (scope, kind, name, peer_key, provider_room_id)
     VALUES ('global_direct', 'customer', 'Direct', $1, $2) RETURNING id`,
    [peerKey, `!${run}${seq}:example.org`],
  );
  for (const u of [a, b]) {
    await pool.query(
      `INSERT INTO chat_room_members (room_id, user_id) VALUES ($1, $2)`,
      [room.id, u.id],
    );
  }
  for (const [sender, body] of [[a, "hello from a"], [b, "hello from b"], [a, "again from a"]]) {
    await pool.query(
      `INSERT INTO chat_messages (room_id, sender_id, sender_name, kind, body)
       VALUES ($1, $2, 'x', 'text', $3)`,
      [room.id, sender.id, body],
    );
  }
  return room.id;
}

async function seedChatExtras(user, peer) {
  await pool.query(
    `INSERT INTO chat_provider_identities (user_id, provider_user_id) VALUES ($1, $2)`,
    [user.id, `@avarpus_${user.id}:example.org`],
  );
  await pool.query(
    `INSERT INTO status_updates (author_id, kind, body, expires_at)
     VALUES ($1, 'text', 'my status', now() + interval '1 day')`,
    [user.id],
  );
  await pool.query(
    `INSERT INTO chat_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)`,
    [peer.id, user.id],
  );
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

// Seeds the re-auth code exactly as the OTP route binds it: account id, the
// chosen scope and the delivery identifier (see routes/account.ts).
async function seedCode(user, scope) {
  const code = String(100000 + Math.floor(Math.random() * 900000));
  await pool.query(
    `INSERT INTO otp_codes (identifier, purpose, code_hash, expires_at)
     VALUES ($1, 'account_delete', $2, now() + interval '10 minutes')`,
    [`${user.id}:${scope}:mobile:${user.mobile}`, sha256(code)],
  );
  return code;
}

async function one(sqlText, params) {
  const { rows } = await pool.query(sqlText, params);
  return rows[0] ?? null;
}
async function n(sqlText, params) {
  return Number((await one(sqlText, params)).n);
}

async function testChatScope() {
  console.log("chat scope");
  const a = await seedUser("customer", "chat-a");
  const c = await seedUser("customer", "chat-c");
  const shopA = await seedShop(a, "chat-a");
  const roomId = await seedDirectRoom(a, c);
  await seedChatExtras(a, c);
  const tokenA1 = await seedSession(a.id, true);
  const tokenA2 = await seedSession(a.id);

  const preview = await api("GET", "/auth/account/deletion", tokenA1);
  check("preview loads", preview.status === 200, preview);
  check("preview counts the conversation and status", preview.json.chat?.conversationCount === 1 && preview.json.chat?.statusCount === 1, preview.json.chat);
  check("preview lists the owned shop", preview.json.business?.ownedShops?.some((s) => s.id === shopA && s.repairCount === 1), preview.json.business);
  check("preview masks the verification target", typeof preview.json.verificationTarget === "string" && !preview.json.verificationTarget.includes(a.mobile.slice(0, 6)), preview.json.verificationTarget);

  const wrong = await api("POST", "/auth/account/deletion", tokenA1, { scope: "chat", code: "000000" });
  check("wrong code is rejected without killing the session", wrong.status === 400 && wrong.json?.code === "OTP_INVALID", wrong);
  check("wrong code deletes nothing", (await n(`SELECT count(*) n FROM chat_messages WHERE sender_id = $1`, [a.id])) === 2);

  const otherScopeCode = await seedCode(a, "both");
  const replay = await api("POST", "/auth/account/deletion", tokenA1, { scope: "chat", code: otherScopeCode });
  check("a code issued for another scope does not work", replay.status === 400, replay);

  // Chat-only state that lives outside rooms: a message notification and a
  // repair notification (the latter belongs to the business layer and stays).
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'chat_message', 'x', 'preview'), ($1, 'repair_created', 'x', 'r')`,
    [a.id],
  );

  const code = await seedCode(a, "chat");
  const done = await api("POST", "/auth/account/deletion", tokenA1, { scope: "chat", code });
  check("chat deletion succeeds", done.status === 200 && done.json.scope === "chat" && done.json.accountRemoved === false, done);

  check("chat notifications gone, business ones kept",
    (await n(`SELECT count(*) n FROM notifications WHERE user_id = $1 AND type = 'chat_message'`, [a.id])) === 0 &&
    (await n(`SELECT count(*) n FROM notifications WHERE user_id = $1 AND type = 'repair_created'`, [a.id])) === 1);
  check("leftover deletion codes for the account are spent", (await n(`SELECT count(*) n FROM otp_codes WHERE identifier LIKE $1`, [`${a.id}:%`])) === 0);

  check("authored messages are gone", (await n(`SELECT count(*) n FROM chat_messages WHERE sender_id = $1`, [a.id])) === 0);
  check("peer's own messages survive", (await n(`SELECT count(*) n FROM chat_messages WHERE sender_id = $1`, [c.id])) === 1);
  const room = await one(`SELECT peer_key FROM chat_rooms WHERE id = $1`, [roomId]);
  check("shared room survives for the peer with its pair key released", room && room.peer_key === null, room);
  check("membership removed", (await n(`SELECT count(*) n FROM chat_room_members WHERE user_id = $1`, [a.id])) === 0);
  check("peer keeps membership", (await n(`SELECT count(*) n FROM chat_room_members WHERE user_id = $1`, [c.id])) === 1);
  check("chat identity removed", (await n(`SELECT count(*) n FROM chat_provider_identities WHERE user_id = $1`, [a.id])) === 0);
  check("statuses removed", (await n(`SELECT count(*) n FROM status_updates WHERE author_id = $1`, [a.id])) === 0);
  check("blocks in either direction removed", (await n(`SELECT count(*) n FROM chat_blocks WHERE blocked_user_id = $1 OR blocker_user_id = $1`, [a.id])) === 0);
  check("business layer untouched", (await n(`SELECT count(*) n FROM shops WHERE id = $1`, [shopA])) === 1);
  const userRow = await one(`SELECT role, shop_id FROM users WHERE id = $1`, [a.id]);
  check("account row survives as a business login", userRow && userRow.shop_id === shopA && userRow.role === "dealer", userRow);
  check("all sessions revoked", (await n(`SELECT count(*) n FROM sessions WHERE user_id = $1`, [a.id])) === 0);
  check("push tokens gone with the sessions", (await n(`SELECT count(*) n FROM push_tokens WHERE user_id = $1`, [a.id])) === 0);
  const me = await api("GET", "/auth/me", tokenA2);
  check("other device is signed out", me.status === 401, me);
}

async function testBusinessScope() {
  console.log("business scope");
  const d = await seedUser("customer", "biz-d");
  const e = await seedUser("customer", "biz-e");
  const f = await seedUser("customer", "biz-f");
  const shopD = await seedShop(d, "biz-d");
  await addStaff(shopD, e);
  const shopF = await seedShop(f, "biz-f");
  await pool.query(
    `INSERT INTO shop_memberships (shop_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active')`,
    [shopF, d.id],
  );
  const peer = await seedUser("customer", "biz-peer");
  const roomId = await seedDirectRoom(d, peer);
  const tokenD = await seedSession(d.id);
  const tokenE = await seedSession(e.id);

  const code = await seedCode(d, "business");
  const done = await api("POST", "/auth/account/deletion", tokenD, { scope: "business", code });
  check("business deletion succeeds", done.status === 200 && done.json.scope === "business", done);
  check("owned shop deleted", (await n(`SELECT count(*) n FROM shops WHERE id = $1`, [shopD])) === 0);
  check("owned shop's repairs deleted", (await n(`SELECT count(*) n FROM repairs WHERE shop_id = $1`, [shopD])) === 0);
  const staff = await one(`SELECT role, shop_id FROM users WHERE id = $1`, [e.id]);
  check("staff of the deleted shop is repointed to no workspace", staff && staff.shop_id === null && staff.role === "customer", staff);
  const staffMe = await api("GET", "/auth/me", tokenE);
  check("staff of the deleted shop can still sign in as a personal account", staffMe.status === 200, staffMe);
  check("membership in someone else's shop removed", (await n(`SELECT count(*) n FROM shop_memberships WHERE user_id = $1`, [d.id])) === 0);
  check("someone else's shop untouched", (await n(`SELECT count(*) n FROM repairs WHERE shop_id = $1`, [shopF])) === 1);
  check("their owner's membership untouched", (await n(`SELECT count(*) n FROM shop_memberships WHERE shop_id = $1 AND user_id = $2`, [shopF, f.id])) === 1);
  const row = await one(`SELECT role, shop_id, dealer_id FROM users WHERE id = $1`, [d.id]);
  check("account becomes a plain personal login", row && row.shop_id === null && row.role === "customer" && row.dealer_id === null, row);
  check("chat layer untouched", (await n(`SELECT count(*) n FROM chat_messages WHERE sender_id = $1 AND room_id = $2`, [d.id, roomId])) === 2);
  check("sessions revoked", (await n(`SELECT count(*) n FROM sessions WHERE user_id = $1`, [d.id])) === 0);
}

async function testBothScope() {
  console.log("both scope");
  const g = await seedUser("customer", "both-g");
  const peer = await seedUser("customer", "both-peer");
  const shopG = await seedShop(g, "both-g");
  await seedDirectRoom(g, peer);
  await seedChatExtras(g, peer);
  const tokenG = await seedSession(g.id, true);
  await pool.query(
    `INSERT INTO otp_codes (identifier, purpose, code_hash, expires_at)
     VALUES ($1, 'login', 'x', now() + interval '10 minutes')`,
    [g.mobile],
  );

  const code = await seedCode(g, "both");
  const done = await api("POST", "/auth/account/deletion", tokenG, { scope: "both", code });
  check("both deletion succeeds", done.status === 200 && done.json.accountRemoved === true, done);
  check("users row gone", (await n(`SELECT count(*) n FROM users WHERE id = $1`, [g.id])) === 0);
  check("owned shop gone", (await n(`SELECT count(*) n FROM shops WHERE id = $1`, [shopG])) === 0);
  check("pending login codes for the mobile gone", (await n(`SELECT count(*) n FROM otp_codes WHERE identifier = $1`, [g.mobile])) === 0);
  check("peer's messages survive", (await n(`SELECT count(*) n FROM chat_messages WHERE sender_id = $1`, [peer.id])) === 1);
  const me = await api("GET", "/auth/me", tokenG);
  check("session is dead", me.status === 401, me);
}

async function testRefusals() {
  console.log("refusals & access");
  const admin = await seedUser("super_admin", "admin");
  const tokenAdmin = await seedSession(admin.id);
  const preview = await api("GET", "/auth/account/deletion", tokenAdmin);
  check("super_admin preview: business not allowed", preview.status === 200 && preview.json.business?.allowed === false, preview.json.business);
  const otp = await api("POST", "/auth/account/deletion/otp", tokenAdmin, { scope: "both" });
  check("super_admin cannot request a code for both", otp.status === 403, otp);
  const code = await seedCode(admin, "business");
  const exec = await api("POST", "/auth/account/deletion", tokenAdmin, { scope: "business", code });
  check("super_admin business deletion refused even with a valid code", exec.status === 403, exec);
  check("super_admin row intact", (await n(`SELECT count(*) n FROM users WHERE id = $1`, [admin.id])) === 1);

  const cust = await seedUser("customer", "cust");
  const tokenCust = await seedSession(cust.id);
  const custPreview = await api("GET", "/auth/account/deletion", tokenCust);
  check("customer-role account can reach the preview", custPreview.status === 200, custPreview);
  const bad = await api("POST", "/auth/account/deletion", tokenCust, { scope: "everything", code: "123456" });
  check("unknown scope is a 400", bad.status === 400, bad);
  const custWrong = await api("POST", "/auth/account/deletion", tokenCust, { scope: "both", code: "123456" });
  check("customer-role account reaches execution (wrong code → 400, not 403)", custWrong.status === 400, custWrong);
  const anon = await fetch(`${BASE}/auth/account/deletion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "both", code: "123456" }),
  });
  check("anonymous caller is rejected", anon.status === 401, anon.status);
}

async function main() {
  const child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${BASE}/healthz`).then((r) => r.status > 0).catch(() => false);
    }
    if (!up) throw new Error("server did not start");
    await testChatScope();
    await testBusinessScope();
    await testBothScope();
    await testRefusals();
  } finally {
    await pool.query(`DELETE FROM shops WHERE id = ANY($1::uuid[])`, [created.shops]).catch(() => undefined);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]).catch(() => undefined);
    child.kill("SIGTERM");
    await sleep(300);
    await pool.end();
  }
  if (failures) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("all account deletion checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
