// API-level tests for the linked dealer-to-dealer transaction system.
// Usage: node scripts/run-isolated.mjs scripts/test-dealer-transactions.mjs
//
// Seeds three throwaway shops (A = repairing, B = sending, C = unrelated) plus
// a technician in shop A, spawns the built server and drives the flow over
// HTTP:
//   B sends device -> A must accept before work -> A repairs + bills ->
//   both ledgers agree at every step -> payments -> void -> refund ->
//   reverse-direction transaction stays independent -> C sees nothing.
// All seeded rows are removed at the end (users cascade to shop -> data).
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

const PORT = 5673;
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

async function seedShop(client, label, mobile) {
  const {
    rows: [user],
  } = await client.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'x', 'dealer', true) RETURNING id`,
    [`${label} Owner`, `d2d-${label.toLowerCase()}-${mobile}@example.com`, mobile],
  );
  const {
    rows: [shop],
  } = await client.query(
    `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
    [user.id, `${label} Mobile Care`],
  );
  await client.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, user.id]);
  const token = randomBytes(32).toString("hex");
  await client.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
    [token, user.id],
  );
  return { userId: user.id, shopId: shop.id, token, mobile, businessName: `${label} Mobile Care` };
}

async function seedStaff(client, shopId, role, mobile) {
  const {
    rows: [user],
  } = await client.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active, shop_id)
     VALUES ($1, $2, $3, 'x', $4, true, $5) RETURNING id`,
    [`${role} staff`, `d2d-${role}-${mobile}@example.com`, mobile, role, shopId],
  );
  const token = randomBytes(32).toString("hex");
  await client.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
    [token, user.id],
  );
  return { userId: user.id, token };
}

async function seed() {
  const n = Math.floor(Math.random() * 1e6);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const A = await seedShop(client, "Alpha", String(9300000000 + n));
    const B = await seedShop(client, "Beta", String(9310000000 + n));
    const C = await seedShop(client, "Gamma", String(9320000000 + n));
    const techA = await seedStaff(client, A.shopId, "technician", String(9330000000 + n));
    await client.query("COMMIT");
    return { A, B, C, techA };
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

async function ledgerParty(token, shopId, direction) {
  const { status, json } = await api("GET", "/dealers/transactions/ledger", token);
  if (status !== 200) throw new Error(`GET ledger -> ${status} ${JSON.stringify(json)}`);
  return json.parties.find((p) => p.shopId === shopId && p.direction === direction) ?? null;
}

async function bothSides(A, B, repairId) {
  const a = await api("GET", `/dealers/transactions/${repairId}`, A.token);
  const b = await api("GET", `/dealers/transactions/${repairId}`, B.token);
  return { a: a.json, b: b.json, aStatus: a.status, bStatus: b.status };
}

async function run({ A, B, C, techA }) {
  // 1–2) Both shops exist (seeded). 3) B looks A up explicitly and sends a device.
  const lookup = await api("GET", `/dealers/lookup?mobile=${A.mobile}`, B.token);
  check("B resolves A by owner mobile (explicit receiver choice)", lookup.status === 200 && lookup.json.match?.shopId === A.shopId, lookup);

  // B already holds the device as ITS OWN repair (walk-in customer). It is
  // offered to A with Send to Dealer; A's queue stays empty until A accepts.
  const own = await api("POST", "/repairs", B.token, {
    customerName: "Beta Walk-in",
    mobile: "9198989898",
    deviceType: "mobile",
    brand: "Samsung",
    model: "Galaxy A15",
    imei: "356789012345678",
    problem: "Display broken",
  });
  check("B records the device as its own repair first", own.status === 200 && own.json.repair?.id, own);
  const sourceId = own.json.repair.id;
  const offer = await api("POST", `/repairs/${sourceId}/transfer`, B.token, { receiverShopId: A.shopId });
  check("B offers the existing repair to A (pending request)", offer.status === 200 && offer.json.request?.status === "pending", offer);
  const aBefore = await api("GET", "/repairs?limit=100", A.token);
  check("nothing appears in A's repair list before acceptance", !(aBefore.json.repairs ?? []).some((r) => r.sourceRepairId === sourceId), { count: aBefore.json.total });
  const bWaiting = await api("GET", `/repairs/${sourceId}`, B.token);
  check("B's own row says waiting for A", bWaiting.json.repair?.transfer?.status === "pending" && bWaiting.json.repair.transfer.receiverShopId === A.shopId, bWaiting.json.repair?.transfer);
  const bAccept = await api("POST", `/dealers/transfers/${offer.json.request.id}/accept`, B.token);
  check("sender cannot accept on A's behalf", bAccept.status === 404, bAccept);
  const accepted = await api("POST", `/dealers/transfers/${offer.json.request.id}/accept`, A.token);
  check("A accepts: repair row created in A's shop", accepted.status === 200 && accepted.json.repair?.id && accepted.json.repair.sourceRepairId === sourceId, accepted);
  const txId = accepted.json.repair.id;
  check("shared transaction code assigned", typeof accepted.json.repair.transactionCode === "string" && accepted.json.repair.transactionCode.startsWith("DT-"), accepted.json.repair);
  check("saved device facts imported (IMEI), sender's customer NOT imported", accepted.json.repair.imei === "356789012345678" && accepted.json.repair.customerName === `${B.businessName} (Dealer)` && accepted.json.repair.mobile === B.mobile, accepted.json.repair);

  // 5–6) Appears in A's normal repair list with Source Dealer = B.
  const aRepairs = await api("GET", "/repairs?limit=100", A.token);
  const inList = (aRepairs.json.repairs ?? []).find((r) => r.id === txId);
  check("device appears in A's normal repair list", Boolean(inList), { status: aRepairs.status });
  check("Source Dealer = B on A's repair row", inList?.sourceDealerShopId === B.shopId && inList?.sourceDealerBusinessName === B.businessName, inList);
  check("A's row carries the sender's original ticket", inList?.sourceRepairTicket === own.json.repair.repairId, inList);

  // Both sides read the same transaction; C is not a party.
  let sides = await bothSides(A, B, txId);
  check("A reads as receiver, B as sender", sides.a.side === "receiver" && sides.b.side === "sender", { a: sides.a.side, b: sides.b.side });
  check("both sides see the same transaction code", sides.a.transactionCode === sides.b.transactionCode, sides);
  const cView = await api("GET", `/dealers/transactions/${txId}`, C.token);
  check("unrelated shop C cannot read the transaction", cView.status === 404, cView);
  const cRepair = await api("GET", `/repairs/${txId}`, C.token);
  check("unrelated shop C cannot read it as a repair either", cRepair.status === 404 || cRepair.status === 403, cRepair);

  // 4) Accepting IS the receipt confirmation; the legacy receive call is a no-op.
  const receivedAgain = await api("POST", `/dealers/transactions/${txId}/receive`, A.token);
  check("legacy receive after accept is idempotent", receivedAgain.status === 200 && receivedAgain.json.repair.sourceDealerReceivedAt === accepted.json.repair.sourceDealerReceivedAt, receivedAgain);
  check("acceptance = received on both sides", sides.a.acceptance === "received" && sides.b.acceptance === "received", sides);
  check("timeline shows dealer_sent then dealer_received", sides.b.events?.some((e) => e.action === "dealer_sent") && sides.b.events?.some((e) => e.action === "dealer_received"), sides.b.events);

  // 7) A repairs the device through the normal workflow.
  const s1 = await api("PATCH", `/repairs/${txId}`, A.token, { status: "repairing" });
  check("A starts repair after acceptance", s1.status === 200, s1);
  await api("PATCH", `/repairs/${txId}`, A.token, { diagnosis: "Display panel cracked", workPerformed: "Display replaced" });
  await api("PATCH", `/repairs/${txId}`, A.token, { status: "testing" });
  await api("POST", `/repairs/${txId}/testing`, A.token, { checklist: { display: true, touch: true }, confirm: true });

  // Bill is not posted until ready: neither side has a balance yet.
  const bill = await api("PATCH", `/repairs/${txId}`, A.token, { repairCharge: 1000 });
  check("A sets ₹1,000 charge", bill.status === 200, bill);
  sides = await bothSides(A, B, txId);
  check("bill not posted before ready (both sides billed=0, liveTotal=1000)", sides.a.financials.billed === 0 && sides.b.financials.billed === 0 && sides.b.financials.liveTotal === 1000, { a: sides.a.financials, b: sides.b.financials });
  const prePost = await ledgerParty(B.token, A.shopId, "payable");
  check("B already lists A as supplier with one open job but ₹0 due", prePost?.billed === 0 && prePost.balance === 0 && prePost.openRepairCount === 1, prePost);

  // 9) Ready → bill posts. 8) B is notified of status moves.
  const ready = await api("PATCH", `/repairs/${txId}`, A.token, { status: "ready" });
  check("A marks ready", ready.status === 200, ready);
  sides = await bothSides(A, B, txId);
  check("bill ₹1,000 posted on both sides", sides.a.financials.billed === 1000 && sides.b.financials.billed === 1000 && sides.a.financials.balance === 1000 && sides.b.financials.balance === 1000, { a: sides.a.financials, b: sides.b.financials });
  const bNotifs = await api("GET", "/notifications", B.token);
  const statusNotifs = (bNotifs.json.notifications ?? []).filter((x) => x.type === "dealer_transaction_status");
  check("B received status notifications (received + ready …)", statusNotifs.length >= 2 && statusNotifs.every((x) => x.data?.dealerTransaction === true), statusNotifs.map((x) => x.title));

  // 10–11) B sees A under Suppliers with ₹1,000 payable; A sees B as receivable.
  let payable = await ledgerParty(B.token, A.shopId, "payable");
  let receivable = await ledgerParty(A.token, B.shopId, "receivable");
  check("B: A listed as supplier, ₹1,000 due", payable?.role === "supplier" && payable.billed === 1000 && payable.paid === 0 && payable.balance === 1000, payable);
  check("A: B listed as customer/receivable ₹1,000", receivable?.role === "customer" && receivable.billed === 1000 && receivable.balance === 1000, receivable);
  const bTotals = await api("GET", "/dealers/transactions/ledger", B.token);
  check("B ledger totals: payable 1000, receivable 0", bTotals.json.totals?.payable === 1000 && bTotals.json.totals?.receivable === 0, bTotals.json.totals);

  // 12–13) ₹400 cash recorded by A → both sides show ₹600 remaining.
  const p1 = await api("POST", `/repairs/${txId}/payments`, A.token, { amount: 400, method: "Cash", kind: "partial" });
  check("A records ₹400 cash", p1.status === 200 && p1.json.payment?.id, p1);
  sides = await bothSides(A, B, txId);
  check("both sides: paid 400, balance 600", sides.a.financials.paid === 400 && sides.b.financials.paid === 400 && sides.a.financials.balance === 600 && sides.b.financials.balance === 600, { a: sides.a.financials, b: sides.b.financials });
  check("B sees the same payment row A recorded", sides.b.payments.length === 1 && sides.b.payments[0].id === p1.json.payment.id && sides.b.payments[0].method === "Cash", sides.b.payments);
  const payNotifs = (await api("GET", "/notifications", B.token)).json.notifications.filter((x) => x.type === "dealer_transaction_payment");
  check("B notified about the payment", payNotifs.length === 1, payNotifs.map((x) => x.title));

  // 16) Ledger entries with plain-language directions, every entry addressable.
  const bLedger = await api("GET", `/dealers/transactions/ledger/${A.shopId}?direction=payable`, B.token);
  const aLedger = await api("GET", `/dealers/transactions/ledger/${B.shopId}?direction=receivable`, A.token);
  check("B ledger: bill (you_owe) then payment (you_paid), running 1000 → 600", bLedger.json.entries?.map((e) => `${e.kind}:${e.direction}:${e.runningBalance}`).join(",") === "bill:you_owe:1000,payment:you_paid:600", bLedger.json.entries);
  check("A ledger: bill (they_owe_you) then payment (you_received), running 1000 → 600", aLedger.json.entries?.map((e) => `${e.kind}:${e.direction}:${e.runningBalance}`).join(",") === "bill:they_owe_you:1000,payment:you_received:600", aLedger.json.entries);
  check("ledger entries reference the shared transaction", bLedger.json.entries.every((e) => e.repairId === txId && e.transactionCode === sides.b.transactionCode), bLedger.json.entries);
  const cLedger = await api("GET", `/dealers/transactions/ledger/${A.shopId}?direction=payable`, C.token);
  check("C (no transactions with A) gets 404, not A's owner contact", cLedger.status === 404 && !cLedger.json.party, cLedger.json);

  // 14–15) ₹600 UPI → both sides ₹0.
  const p2 = await api("POST", `/repairs/${txId}/payments`, A.token, { amount: 600, method: "UPI", kind: "final", referenceNo: "UTR123456" });
  check("A records ₹600 UPI", p2.status === 200, p2);
  sides = await bothSides(A, B, txId);
  check("both sides: paid 1000, balance 0", sides.a.financials.paid === 1000 && sides.b.financials.paid === 1000 && sides.a.financials.balance === 0 && sides.b.financials.balance === 0, { a: sides.a.financials, b: sides.b.financials });
  payable = await ledgerParty(B.token, A.shopId, "payable");
  check("B supplier summary: billed 1000 / paid 1000 / due 0", payable.billed === 1000 && payable.paid === 1000 && payable.balance === 0, payable);
  const upi = sides.b.payments.find((p) => p.method === "UPI");
  check("UPI payment carries its reference on the sender side", upi?.referenceNo === "UTR123456", upi);

  // 19–20) Void the ₹400 with audit history → both sides ₹400 due.
  const v = await api("POST", `/repairs/${txId}/payments/${p1.json.payment.id}/void`, A.token, { reason: "Recorded against wrong job" });
  check("A voids the ₹400 payment", v.status === 200 && v.json.payment?.voidedAt, v);
  sides = await bothSides(A, B, txId);
  check("after void: both sides paid 600, balance 400", sides.a.financials.paid === 600 && sides.b.financials.paid === 600 && sides.a.financials.balance === 400 && sides.b.financials.balance === 400, { a: sides.a.financials, b: sides.b.financials });
  const voided = sides.b.payments.find((p) => p.id === p1.json.payment.id);
  check("voided payment stays visible to B with who/when/why", voided?.voidedAt && voided.voidedByName && voided.voidReason === "Recorded against wrong job", voided);
  const bLedger2 = await api("GET", `/dealers/transactions/ledger/${A.shopId}?direction=payable`, B.token);
  check("B ledger keeps the void as a zero-value audit entry; running ends at 400", bLedger2.json.entries.some((e) => e.kind === "void" && e.direction === "voided") && bLedger2.json.entries.at(-1).runningBalance === 400, bLedger2.json.entries);
  receivable = await ledgerParty(A.token, B.shopId, "receivable");
  payable = await ledgerParty(B.token, A.shopId, "payable");
  check("summaries agree after void: A receivable 400 == B payable 400", receivable.balance === 400 && payable.balance === 400, { receivable, payable });

  // 21) Refund: a paid refund is a separate row; both sides reflect it.
  const {
    rows: [ret],
  } = await pool.query(
    `INSERT INTO repair_returns (shop_id, repair_id, return_id, return_date, reason, complaint, status)
     VALUES ($1, $2, 'RET-T1', to_char(now(), 'YYYY-MM-DD'), 'refund_requested', 'Display flicker', 'refund_approved') RETURNING id`,
    [A.shopId, txId],
  );
  await pool.query(
    `INSERT INTO refunds (shop_id, repair_id, return_id, amount, original_paid, method, status, reason, paid_by_name, paid_at)
     VALUES ($1, $2, $3, 100, 600, 'Cash', 'paid', 'Partial goodwill refund', 'Alpha Owner', now())`,
    [A.shopId, txId, ret.id],
  );
  sides = await bothSides(A, B, txId);
  check("refund visible on both sides with amount/method/reason", sides.a.refunds.length === 1 && sides.b.refunds.length === 1 && sides.b.refunds[0].amount === 100 && sides.b.refunds[0].reason === "Partial goodwill refund", sides.b.refunds);
  check("refund adjusts both balances identically (400 + 100 = 500)", sides.a.financials.refunded === 100 && sides.b.financials.refunded === 100 && sides.a.financials.balance === 500 && sides.b.financials.balance === 500, { a: sides.a.financials, b: sides.b.financials });
  const bLedger3 = await api("GET", `/dealers/transactions/ledger/${A.shopId}?direction=payable`, B.token);
  check("B ledger shows refund_to_you entry", bLedger3.json.entries.some((e) => e.kind === "refund" && e.direction === "refund_to_you"), bLedger3.json.entries);

  // 18) Only saved fields are present — no null/empty placeholders in JSON.
  const hasEmpty = Object.entries(sides.b.repair).filter(([, v]) => v === null || v === "" || v === "N/A");
  check("sender projection carries no null/empty/N-A values", hasEmpty.length === 0, hasEmpty);
  check("imported IMEI present, unset serial omitted (not blank)", sides.b.repair.imei === "356789012345678" && !("serialNumber" in sides.b.repair), Object.keys(sides.b.repair));

  // 24) Staff permissions: A's technician has no payments feature → no ledger.
  const techLedger = await api("GET", "/dealers/transactions/ledger", techA.token);
  check("technician without payments feature cannot read the dealer ledger", techLedger.status === 403, techLedger);
  const techTx = await api("GET", `/dealers/transactions/${txId}`, techA.token);
  check("technician of the repairing shop can still see the transaction", techTx.status === 200, techTx.status);
  check(
    "technician without payments feature sees no money on the transaction",
    techTx.status === 200 && !("financials" in techTx.json) && !("payments" in techTx.json) && !("refunds" in techTx.json)
      && Array.isArray(techTx.json.events) && techTx.json.events.every((e) => e.action !== "payment_recorded" && e.action !== "payment_voided"),
    Object.keys(techTx.json),
  );
  check("timeline events carry the declared repairId and userRole", sides.a.events.every((e) => e.repairId === txId && typeof e.userRole === "string" && e.userRole.length > 0), sides.a.events);

  // 25–26) Reverse direction: A sends a device to B — an independent ledger.
  const revOwn = await api("POST", "/repairs", A.token, {
    customerName: "Alpha Walk-in",
    mobile: "9197979797",
    deviceType: "mobile",
    brand: "Redmi",
    model: "Note 12",
    problem: "Battery drain",
  });
  const revOffer = await api("POST", `/repairs/${revOwn.json.repair.id}/transfer`, A.token, { receiverShopId: B.shopId });
  const revAccepted = await api("POST", `/dealers/transfers/${revOffer.json.request.id}/accept`, B.token);
  const rev = { status: revAccepted.status, json: revAccepted.json };
  check("A sends a device to B (roles swap)", rev.status === 200 && rev.json.repair?.id, rev);
  const revId = rev.json.repair.id;
  await api("PATCH", `/repairs/${revId}`, B.token, { status: "repairing" });
  await api("PATCH", `/repairs/${revId}`, B.token, { diagnosis: "Battery worn", workPerformed: "Battery replaced", repairCharge: 250 });
  await api("PATCH", `/repairs/${revId}`, B.token, { status: "testing" });
  await api("POST", `/repairs/${revId}/testing`, B.token, { checklist: { battery: true }, confirm: true });
  const revReady = await api("PATCH", `/repairs/${revId}`, B.token, { status: "ready" });
  check("B bills A ₹250 on the reverse job", revReady.status === 200, revReady);
  const aParties = (await api("GET", "/dealers/transactions/ledger", A.token)).json;
  const aPayable = aParties.parties.find((p) => p.shopId === B.shopId && p.direction === "payable");
  const aReceivable = aParties.parties.find((p) => p.shopId === B.shopId && p.direction === "receivable");
  check("A sees B twice: as customer (receivable 500) AND as supplier (payable 250), never netted", aReceivable?.balance === 500 && aPayable?.balance === 250 && aPayable.role === "supplier" && aReceivable.role === "customer", aParties.parties);
  check("A totals keep directions apart (receivable 500 / payable 250)", aParties.totals.receivable === 500 && aParties.totals.payable === 250, aParties.totals);
  const bParties = (await api("GET", "/dealers/transactions/ledger", B.token)).json;
  check("B mirrors it exactly (payable 500 / receivable 250)", bParties.totals.payable === 500 && bParties.totals.receivable === 250, bParties.totals);

  // Guard rails on the ledger routes themselves.
  const selfLedger = await api("GET", `/dealers/transactions/ledger/${A.shopId}?direction=payable`, A.token);
  check("a shop has no ledger with itself", selfLedger.status === 400, selfLedger);
  const badDir = await api("GET", `/dealers/transactions/ledger/${B.shopId}?direction=sideways`, A.token);
  check("direction is validated", badDir.status === 400, badDir);
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
    await cleanup([seeded.A.userId, seeded.B.userId, seeded.C.userId, seeded.techA.userId]).catch((err) =>
      console.error("cleanup failed:", err),
    );
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll dealer-to-dealer transaction checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
