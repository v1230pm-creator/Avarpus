// API-level tests for "Send to Dealer" transfer requests.
// Usage: node scripts/run-isolated.mjs scripts/test-dealer-transfers.mjs
//
// Seeds three throwaway shops (A = sender, B = receiver, C = unrelated), a
// reception staffer in A, a technician in B whose repairs_update toggle is
// off, and a dealer-portal login; spawns the built server and drives:
//   directory search -> offer -> receiver queue untouched -> decline ->
//   resend -> cancel -> resend -> accept (race-safe, idempotent) ->
//   linked rows / events / notifications -> access control.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
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

const PORT = 5674;
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function session(client, userId) {
  const token = randomBytes(32).toString("hex");
  await client.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
    [token, userId],
  );
  return token;
}

async function seedShop(client, label, mobile, tag, role = "dealer") {
  const { rows: [user] } = await client.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
    [`${label} Owner`, `xfer-${label.toLowerCase()}-${mobile}@example.com`, mobile, role],
  );
  const businessName = `${label} ${tag} Repairs`;
  const { rows: [shop] } = await client.query(
    `INSERT INTO shops (dealer_id, business_name, address) VALUES ($1, $2, 'Market Road') RETURNING id`,
    [user.id, businessName],
  );
  await client.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, user.id]);
  return { userId: user.id, shopId: shop.id, token: await session(client, user.id), mobile, businessName, ownerName: `${label} Owner` };
}

async function seedStaff(client, shopId, role, mobile) {
  const { rows: [user] } = await client.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active, shop_id)
     VALUES ($1, $2, $3, 'x', $4, true, $5) RETURNING id`,
    [`${role} staff`, `xfer-${role}-${mobile}@example.com`, mobile, role, shopId],
  );
  return { userId: user.id, token: await session(client, user.id) };
}

async function seed() {
  const n = Math.floor(Math.random() * 1e6);
  const tag = `T${n}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const A = await seedShop(client, "Sender", String(9400000000 + n), tag);
    const B = await seedShop(client, "Receiver", String(9410000000 + n), tag);
    const C = await seedShop(client, "Bystander", String(9420000000 + n), tag);
    // The platform super_admin also runs a real shop: it is a verified owner too.
    const D = await seedShop(client, "Platform", String(9470000000 + n), tag, "super_admin");
    const recA = await seedStaff(client, A.shopId, "reception", String(9430000000 + n));
    const techB = await seedStaff(client, B.shopId, "technician", String(9440000000 + n));
    // Portal login attached to A's shop: must never show up in the directory.
    const portal = await seedStaff(client, A.shopId, "dealer_owner", String(9450000000 + n));
    // Finance-only staff in B: no `repairs` feature, so no device details.
    const acctB = await seedStaff(client, B.shopId, "accountant", String(9460000000 + n));
    await client.query(`UPDATE users SET name = $2 WHERE id = $1`, [portal.userId, `Portal ${tag} Login`]);
    // Owner of B switches repairs_update OFF for technicians.
    await client.query(
      `INSERT INTO role_feature_settings (shop_id, role, features) VALUES ($1, 'technician', '{"repairs_update": false}'::jsonb)`,
      [B.shopId],
    );
    await client.query("COMMIT");
    return { A, B, C, D, recA, techB, portal, acctB, tag };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function cleanup(userIds) {
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
}

async function newRepair(token, overrides = {}) {
  const res = await api("POST", "/repairs", token, {
    customerName: "Walk-in Customer",
    mobile: "9191919191",
    deviceType: "mobile",
    brand: "Vivo",
    model: "Y21",
    imei: "867530912345678",
    color: "Blue",
    problem: "No charging",
    accessoriesList: ["Charger", "Cover"],
    priority: "urgent",
    ...overrides,
  });
  if (res.status !== 200) throw new Error(`POST /repairs -> ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.repair;
}

async function run({ A, B, C, D, recA, techB, portal, acctB, tag }) {
  // ── Directory search ──────────────────────────────────────────────────
  const byName = await api("GET", `/dealers/directory?q=${encodeURIComponent(tag)}`, A.token);
  const names = (byName.json.dealers ?? []).map((d) => d.shopId);
  check("directory by business name lists B and C, never the caller's own shop", byName.status === 200 && names.includes(B.shopId) && names.includes(C.shopId) && !names.includes(A.shopId), byName.json);
  check("directory never exposes owner mobiles", (byName.json.dealers ?? []).every((d) => !("ownerMobile" in d)), byName.json.dealers);
  const byPortal = await api("GET", `/dealers/directory?q=${encodeURIComponent(`Portal ${tag}`)}`, B.token);
  check("dealer-portal logins are not verified shop owners (not listed)", byPortal.status === 200 && (byPortal.json.dealers ?? []).length === 0, byPortal.json);
  const byMobile = await api("GET", `/dealers/directory?q=${B.mobile}`, A.token);
  check("exact owner mobile resolves the shop", byMobile.json.dealers?.length === 1 && byMobile.json.dealers[0].shopId === B.shopId && byMobile.json.dealers[0].matchedByMobile === true, byMobile.json);
  const byFormattedMobile = await api("GET", `/dealers/directory?q=${encodeURIComponent(`+91 ${B.mobile.slice(0, 5)} ${B.mobile.slice(5)}`)}`, A.token);
  check("owner mobile pasted as '+91 xxxxx xxxxx' still resolves the shop", byFormattedMobile.json.dealers?.length === 1 && byFormattedMobile.json.dealers[0].shopId === B.shopId, byFormattedMobile.json);
  const byPrefix = await api("GET", `/dealers/directory?q=${B.mobile.slice(0, 7)}`, A.token);
  check("a partial mobile never enumerates owners", byPrefix.status === 200 && (byPrefix.json.dealers ?? []).every((d) => d.shopId !== B.shopId), byPrefix.json);
  const bySuperMobile = await api("GET", `/dealers/directory?q=${D.mobile}`, A.token);
  check("a shop owned by the platform super_admin is a verified dealer (found by mobile)", bySuperMobile.json.dealers?.length === 1 && bySuperMobile.json.dealers[0].shopId === D.shopId, bySuperMobile.json);
  check("… and by business name", names.includes(D.shopId), byName.json);
  const lookupFormatted = await api("GET", `/dealers/lookup?mobile=${encodeURIComponent(`+91-${B.mobile}`)}`, A.token);
  check("legacy lookup accepts a formatted mobile", lookupFormatted.status === 200 && lookupFormatted.json.match?.shopId === B.shopId, lookupFormatted.json);
  const code = B.shopId.slice(0, 8);
  const byCode = await api("GET", `/dealers/directory?q=${code.toUpperCase()}`, A.token);
  check("Dealer ID (short code) resolves the shop", (byCode.json.dealers ?? []).some((d) => d.shopId === B.shopId && d.dealerCode === code.toUpperCase()), byCode.json);
  const selfMobile = await api("GET", `/dealers/directory?q=${A.mobile}`, A.token);
  check("own shop is excluded even by exact mobile", selfMobile.json.dealers?.length === 0, selfMobile.json);
  const portalDir = await api("GET", `/dealers/directory?q=${encodeURIComponent(tag)}`, portal.token);
  check("portal logins cannot search the directory", portalDir.status === 403, portalDir);
  const acctDir = await api("GET", `/dealers/directory?q=${encodeURIComponent(tag)}`, acctB.token);
  check("staff without the repairs feature cannot search the directory", acctDir.status === 403, acctDir);
  const techDir = await api("GET", `/dealers/directory?q=${A.mobile}`, techB.token);
  check("staff without repairs_update cannot probe owner mobiles via the directory", techDir.status === 403, techDir);
  const techLookup = await api("GET", `/dealers/lookup?mobile=${A.mobile}`, techB.token);
  check("staff without repairs_update cannot probe owner mobiles via legacy lookup", techLookup.status === 403, techLookup);
  const acctList = await api("GET", `/dealers/transfers`, acctB.token);
  check("staff without the repairs feature cannot list transfer requests", acctList.status === 403, acctList);

  // ── Offer: validations ────────────────────────────────────────────────
  const repair = await newRepair(A.token);
  const toSelf = await api("POST", `/repairs/${repair.id}/transfer`, A.token, { receiverShopId: A.shopId });
  check("cannot send to own shop", toSelf.status === 400, toSelf);
  const ghost = await api("POST", `/repairs/${repair.id}/transfer`, A.token, { receiverShopId: "00000000-0000-4000-8000-000000000000" });
  check("unknown receiver -> 404", ghost.status === 404, ghost);
  const notMine = await api("POST", `/repairs/${repair.id}/transfer`, C.token, { receiverShopId: B.shopId });
  check("another shop cannot send A's repair", notMine.status === 404, notMine);
  const tooLong = await api("POST", `/repairs/${repair.id}/transfer`, A.token, { receiverShopId: B.shopId, message: "x".repeat(600) });
  check("message length validated", tooLong.status === 400, tooLong);
  const techSend = await api("POST", `/repairs/${repair.id}/transfer`, techB.token, { receiverShopId: A.shopId });
  check("staff without repairs_update cannot send", techSend.status === 403 || techSend.status === 404, techSend);

  // ── Offer → receiver queue untouched → decline ────────────────────────
  const offer1 = await api("POST", `/repairs/${repair.id}/transfer`, recA.token, { receiverShopId: B.shopId, message: "Handle with care" });
  check("reception staff (repairs_update on) can send", offer1.status === 200 && offer1.json.request?.status === "pending", offer1);
  const req1 = offer1.json.request;
  check("request identifies both parties by shop/owner id", req1.sender?.shopId === A.shopId && req1.receiver?.shopId === B.shopId && req1.receiver.ownerName === B.ownerName, req1);
  check("sender view carries its own sourceRepairId", req1.sourceRepairId === repair.id && req1.side === "sender", req1);
  const acctGet = await api("GET", `/dealers/transfers/${req1.id}`, acctB.token);
  check("staff without the repairs feature cannot read a request's device details", acctGet.status === 403, acctGet);

  const dup = await api("POST", `/repairs/${repair.id}/transfer`, A.token, { receiverShopId: C.shopId });
  check("second offer while pending -> 409 TRANSFER_PENDING", dup.status === 409 && dup.json.code === "TRANSFER_PENDING", dup);

  const bQueue = await api("GET", "/repairs?limit=100", B.token);
  check("B's repair queue has NOTHING before accept", (bQueue.json.repairs ?? []).every((r) => r.sourceRepairId !== repair.id), { total: bQueue.json.total });
  const bIncoming = await api("GET", "/dealers/transfers?direction=incoming&status=pending", B.token);
  const incoming = (bIncoming.json.requests ?? []).find((r) => r.id === req1.id);
  check("B sees the pending request under Incoming", Boolean(incoming) && incoming.side === "receiver", bIncoming.json);
  check("receiver preview: device facts only, no sender customer / no source row id", incoming && incoming.device.imei === "867530912345678" && incoming.device.color === "Blue" && incoming.device.accessoriesList?.length === 2 && incoming.sourceRepairId === undefined && !JSON.stringify(incoming).includes("Walk-in Customer") && !JSON.stringify(incoming).includes("9191919191"), incoming);
  check("receiver preview omits empty fields (no storage/ram)", incoming && !("storage" in incoming.device) && !("ram" in incoming.device), incoming?.device);
  const cRead = await api("GET", `/dealers/transfers/${req1.id}`, C.token);
  check("unrelated shop C cannot read the request", cRead.status === 404, cRead);
  const aOutgoing = await api("GET", "/dealers/transfers?direction=outgoing", A.token);
  check("A sees it under Outgoing", (aOutgoing.json.requests ?? []).some((r) => r.id === req1.id && r.status === "pending"), aOutgoing.json);
  const aRow = await api("GET", `/repairs/${repair.id}`, A.token);
  check("A's own repair shows Waiting for B", aRow.json.repair?.transfer?.status === "pending" && aRow.json.repair.transfer.receiverBusinessName === B.businessName, aRow.json.repair?.transfer);
  const aList = await api("GET", `/repairs?status=received&limit=100`, A.token);
  check("A's repair list carries the transfer badge too", (aList.json.repairs ?? []).find((r) => r.id === repair.id)?.transfer?.status === "pending", aList.json.repairs?.find((r) => r.id === repair.id)?.transfer);
  const bNotif = await api("GET", "/notifications", B.token);
  check("B was notified of the incoming request", (bNotif.json.notifications ?? []).some((n) => n.type === "dealer_transfer_request" && n.data?.transferId === req1.id), bNotif.json.notifications?.map((n) => n.type));

  const techDecline = await api("POST", `/dealers/transfers/${req1.id}/decline`, techB.token, { reason: "no" });
  check("B's technician (repairs_update off) cannot decline", techDecline.status === 403, techDecline);
  const cDecline = await api("POST", `/dealers/transfers/${req1.id}/decline`, C.token, {});
  check("C cannot decline someone else's request", cDecline.status === 404, cDecline);
  const aDecline = await api("POST", `/dealers/transfers/${req1.id}/decline`, A.token);
  check("sender cannot decline its own request", aDecline.status === 404, aDecline);
  const declined = await api("POST", `/dealers/transfers/${req1.id}/decline`, B.token, { reason: "No spare parts this week" });
  check("B declines with a reason", declined.status === 200 && declined.json.request.status === "declined" && declined.json.request.declineReason === "No spare parts this week", declined);
  const declinedAgain = await api("POST", `/dealers/transfers/${req1.id}/decline`, B.token);
  check("declining twice is idempotent", declinedAgain.status === 200 && declinedAgain.json.request.status === "declined", declinedAgain);
  const acceptDeclined = await api("POST", `/dealers/transfers/${req1.id}/accept`, B.token);
  check("cannot accept after declining", acceptDeclined.status === 409 && acceptDeclined.json.code === "TRANSFER_NOT_PENDING", acceptDeclined);
  const aAfterDecline = await api("GET", `/repairs/${repair.id}`, A.token);
  check("A sees Declined on its original, untouched record", aAfterDecline.json.repair.transfer?.status === "declined" && aAfterDecline.json.repair.status === "received" && aAfterDecline.json.repair.customerName === "Walk-in Customer", aAfterDecline.json.repair);
  const bQueueAfterDecline = await api("GET", "/repairs?limit=100", B.token);
  check("decline created nothing in B", (bQueueAfterDecline.json.repairs ?? []).every((r) => r.sourceRepairId !== repair.id), { total: bQueueAfterDecline.json.total });
  const aNotif = await api("GET", "/notifications", A.token);
  check("A was notified of the decline", (aNotif.json.notifications ?? []).some((n) => n.type === "dealer_transfer_declined" && n.data?.repairId === repair.id), aNotif.json.notifications?.map((n) => n.type));

  // ── Resend → cancel → resend → accept ─────────────────────────────────
  const offer2 = await api("POST", `/repairs/${repair.id}/transfer`, A.token, { receiverShopId: C.shopId });
  check("after a decline the device can be offered again (to C)", offer2.status === 200 && offer2.json.request.status === "pending", offer2);
  const cCancel = await api("POST", `/dealers/transfers/${offer2.json.request.id}/cancel`, C.token);
  check("receiver cannot cancel the sender's request", cCancel.status === 404, cCancel);
  const cancelled = await api("POST", `/dealers/transfers/${offer2.json.request.id}/cancel`, A.token);
  check("A withdraws the pending request", cancelled.status === 200 && cancelled.json.request.status === "cancelled", cancelled);
  const acceptCancelled = await api("POST", `/dealers/transfers/${offer2.json.request.id}/accept`, C.token);
  check("C cannot accept a cancelled request", acceptCancelled.status === 409, acceptCancelled);
  const cIncoming = await api("GET", "/dealers/transfers?direction=incoming", C.token);
  check("C still sees the cancelled request in history (audit)", (cIncoming.json.requests ?? []).some((r) => r.id === offer2.json.request.id && r.status === "cancelled"), cIncoming.json);

  const offer3 = await api("POST", `/repairs/${repair.id}/transfer`, A.token, { receiverShopId: B.shopId, message: "Second attempt" });
  check("A re-offers to B", offer3.status === 200, offer3);
  const req3 = offer3.json.request;
  const techAccept = await api("POST", `/dealers/transfers/${req3.id}/accept`, techB.token);
  check("B's technician (repairs_update off) cannot accept", techAccept.status === 403, techAccept);
  const aAccept = await api("POST", `/dealers/transfers/${req3.id}/accept`, A.token);
  check("sender cannot accept its own request", aAccept.status === 404, aAccept);
  // Two simultaneous accepts from B: exactly one row must be created.
  const [r1, r2] = await Promise.all([
    api("POST", `/dealers/transfers/${req3.id}/accept`, B.token),
    api("POST", `/dealers/transfers/${req3.id}/accept`, B.token),
  ]);
  const okOnes = [r1, r2].filter((r) => r.status === 200);
  check("concurrent accepts: at least one succeeds, none creates a duplicate", okOnes.length >= 1 && [r1, r2].every((r) => r.status === 200 || r.status === 409), { r1: r1.status, r2: r2.status });
  const accepted = okOnes[0];
  const newRepairId = accepted.json.repair.id;
  const { rows: linkedRows } = await pool.query(`SELECT id FROM repairs WHERE source_repair_id = $1`, [repair.id]);
  check("exactly one receiving row exists for the source repair", linkedRows.length === 1 && linkedRows[0].id === newRepairId, linkedRows);
  const acceptAgain = await api("POST", `/dealers/transfers/${req3.id}/accept`, B.token);
  check("accepting again returns the same repair (idempotent)", acceptAgain.status === 200 && acceptAgain.json.repair?.id === newRepairId, acceptAgain);
  const cancelAccepted = await api("POST", `/dealers/transfers/${req3.id}/cancel`, A.token);
  check("sender cannot cancel after acceptance", cancelAccepted.status === 409, cancelAccepted);

  // ── Linked receiving row ──────────────────────────────────────────────
  const r = accepted.json.repair;
  check("receiving row imports saved fields only", r.imei === "867530912345678" && r.color === "Blue" && r.priority === "urgent" && r.accessoriesList?.length === 2 && r.storage === undefined && r.problem === "No charging", r);
  check("receiving row's customer is the sending SHOP, not A's end customer", r.customerName === `${A.businessName} (Dealer)` && r.mobile === A.mobile, r);
  check("received-from / received-by / source link recorded", r.sourceDealerShopId === A.shopId && r.sourceRepairId === repair.id && r.receivedByName === `${B.ownerName}` && r.sourceDealerReceivedAt, r);
  check("status starts at received, no receipt gate left", r.status === "received", r);
  const bDetail = await api("GET", `/repairs/${newRepairId}`, B.token);
  check("B's repair detail shows the sender's original ticket", bDetail.json.repair?.sourceRepairTicket === repair.repairId && bDetail.json.repair.sourceReceiveDate === repair.receiveDate, bDetail.json.repair);
  const bQueueAfter = await api("GET", "/repairs?status=received&limit=100", B.token);
  check("now (and only now) the device is in B's Received list", (bQueueAfter.json.repairs ?? []).some((x) => x.id === newRepairId), { total: bQueueAfter.json.total });
  const aAfter = await api("GET", `/repairs/${repair.id}`, A.token);
  check("A's original row: intact, transfer=accepted with linked repair + live status", aAfter.json.repair.customerName === "Walk-in Customer" && aAfter.json.repair.transfer?.status === "accepted" && aAfter.json.repair.transfer.resultRepairId === newRepairId && aAfter.json.repair.transfer.resultStatus === "received", aAfter.json.repair.transfer);
  const again = await api("POST", `/repairs/${repair.id}/transfer`, A.token, { receiverShopId: C.shopId });
  check("while B holds the device it cannot be sent elsewhere (TRANSFER_ACTIVE)", again.status === 409 && again.json.code === "TRANSFER_ACTIVE", again);

  const work = await api("PATCH", `/repairs/${newRepairId}`, B.token, { status: "repairing" });
  check("B can start work immediately (no second acceptance step)", work.status === 200, work);
  const aSync = await api("GET", `/repairs/${repair.id}`, A.token);
  check("A's badge follows B's live status", aSync.json.repair.transfer?.resultStatus === "repairing", aSync.json.repair.transfer);
  const aNotif2 = await api("GET", "/notifications", A.token);
  check("A was notified of acceptance", (aNotif2.json.notifications ?? []).some((n) => n.type === "dealer_transfer_accepted" && n.data?.repairId === newRepairId), aNotif2.json.notifications?.map((n) => n.type));

  // ── Shared transaction view + timelines ───────────────────────────────
  const shared = await api("GET", `/dealers/transactions/${newRepairId}`, A.token);
  check("A opens the shared transaction as sender", shared.status === 200 && shared.json.side === "sender" && shared.json.acceptance === "received", shared.json);
  const sentEvent = (shared.json.events ?? []).find((e) => e.action === "dealer_sent");
  check("shared timeline: dealer_sent at request time by the sender, then accepted + received", sentEvent && sentEvent.userName === A.ownerName && sentEvent.createdAt === req3.createdAt && shared.json.events.some((e) => e.action === "dealer_transfer_accepted") && shared.json.events.some((e) => e.action === "dealer_received"), shared.json.events);
  const aTimeline = await api("GET", `/repairs/${repair.id}/events`, A.token);
  const acts = (aTimeline.json.events ?? []).map((e) => e.action);
  check("A's original record keeps the full audit trail", acts.includes("dealer_transfer_sent") && acts.includes("dealer_transfer_declined") && acts.includes("dealer_transfer_cancelled") && acts.includes("dealer_transfer_accepted"), acts);
  const bTimeline = await api("GET", `/repairs/${newRepairId}/events`, B.token);
  check("B's record starts with the acceptance", (bTimeline.json.events ?? []).some((e) => e.action === "dealer_transfer_accepted" && e.details?.sourceTicket === repair.repairId), bTimeline.json.events);
  const bLedger = await api("GET", "/dealers/transactions/ledger", B.token);
  check("khata: A now appears as B's dealer party", bLedger.status === 200 && (bLedger.json.parties ?? []).some((p) => p.shopId === A.shopId), bLedger.json);

  // ── Closed repairs cannot be sent ─────────────────────────────────────
  const closed = await newRepair(A.token, { imei: undefined });
  await api("PATCH", `/repairs/${closed.id}`, A.token, { status: "cancelled" });
  const sendClosed = await api("POST", `/repairs/${closed.id}/transfer`, A.token, { receiverShopId: B.shopId });
  check("a cancelled/delivered repair cannot be sent", sendClosed.status === 409 && sendClosed.json.code === "REPAIR_CLOSED", sendClosed);

  // ── Legacy direct-create route is gone ────────────────────────────────
  const legacy = await api("POST", "/dealers/transactions", A.token, { receiverShopId: B.shopId, deviceType: "mobile", brand: "x", model: "y", problem: "z", expectedDate: "2030-01-01" });
  check("re-typing a device form is no longer a way to create a repair in another shop", legacy.status === 404 || legacy.status === 405, legacy);
}

async function main() {
  const seeded = await seed();
  const child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${BASE}/healthz`).then((r) => r.status > 0).catch(() => false);
    }
    if (!up) throw new Error("server did not start");
    await run(seeded);
  } finally {
    child.kill("SIGTERM");
    await cleanup([
      seeded.A.userId, seeded.B.userId, seeded.C.userId, seeded.D.userId,
      seeded.recA.userId, seeded.techB.userId, seeded.portal.userId, seeded.acctB.userId,
    ]).catch((err) => console.error("cleanup failed:", err));
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll dealer transfer checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
