// API-level tests proving cross-shop isolation: a user from shop B must be
// rejected (404/400) when reading or writing shop A's customers, repairs,
// photos, timeline events, parts, inventory items, purchases, finance
// entries, returns/refunds, and approval requests — and list endpoints must
// never leak another shop's rows.
// Usage: pnpm run build && node scripts/test-shop-isolation.mjs
//
// Seeds two throwaway dealer shops directly in the database (same pattern as
// test-customer-balances.mjs), spawns the built server, and drives the API
// over HTTP. All seeded rows are removed at the end (deleting the users
// cascades to shops -> customers/repairs/photos/events/sessions).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve `pg` through the db workspace package (pnpm keeps deps local).
const dbPkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../lib/db");
const require = createRequire(path.join(dbPkgDir, "package.json"));
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const PORT = 5643;
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
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function seedTestShop(tag) {
  const n = Math.floor(Math.random() * 1e6);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'x', 'dealer', true) RETURNING id`,
      [`Isolation Dealer ${tag}`, `isolation-${tag}-${n}@example.com`, String(9200000000 + n)],
    );
    const {
      rows: [shop],
    } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
      [user.id, `Isolation Shop ${tag}`],
    );
    await client.query(`UPDATE users SET shop_id = $1 WHERE id = $2`, [shop.id, user.id]);
    const token = randomBytes(32).toString("hex");
    await client.query(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [token, user.id],
    );
    await client.query("COMMIT");
    return { userId: user.id, shopId: shop.id, token };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function cleanup(userId) {
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function run(A, B) {
  // ── Seed shop A's data through the API (as shop A) ───────────────────────
  const { status: cs, json: cj } = await api("POST", "/customers", A.token, {
    name: "Shop A Customer",
    mobile: "9188888888",
  });
  check("shop A creates its customer", cs === 200 && cj.customer?.id, { cs, cj });
  const custA = cj.customer.id;

  const { status: rs, json: rj } = await api("POST", "/repairs", A.token, {
    customerId: custA,
    customerName: "Shop A Customer",
    mobile: "9188888888",
    deviceType: "mobile",
    brand: "BrandA",
    model: "A1",
    problem: "screen cracked",
    repairCharge: 300,
  });
  check("shop A creates its repair", rs === 200 && rj.repair?.id, { rs, rj });
  const repA = rj.repair.id;

  // Sanity: shop A can see and edit its own rows.
  const own = await api("PATCH", `/customers/${custA}`, A.token, { address: "A street" });
  check("shop A can patch its own customer", own.status === 200, own);
  const ownR = await api("PATCH", `/repairs/${repA}`, A.token, { notes: "own note" });
  check("shop A can patch its own repair", ownR.status === 200, ownR);
  const ownEv = await api("GET", `/repairs/${repA}/events`, A.token);
  check("shop A can read its repair timeline", ownEv.status === 200 && (ownEv.json.events ?? []).length > 0, ownEv);

  // ── List endpoints must not leak shop A's rows to shop B ─────────────────
  const bl = await api("GET", "/customers", B.token);
  check(
    "shop B customer list excludes shop A's customer",
    bl.status === 200 && !(bl.json.customers ?? []).some((c) => c.id === custA),
    bl,
  );
  const brl = await api("GET", "/repairs", B.token);
  check(
    "shop B repair list excludes shop A's repair",
    brl.status === 200 && !(brl.json.repairs ?? []).some((r) => r.id === repA),
    brl,
  );

  // ── Cross-shop writes on customers ────────────────────────────────────────
  const xc = await api("PATCH", `/customers/${custA}`, B.token, { name: "HACKED" });
  check("shop B PATCH shop A customer -> 404", xc.status === 404, xc);

  // Linking a repair to another shop's customer must be rejected.
  const xr = await api("POST", "/repairs", B.token, {
    customerId: custA,
    customerName: "Shop A Customer",
    mobile: "9188888888",
    deviceType: "mobile",
    brand: "X",
    model: "X",
    problem: "cross-shop link attempt",
  });
  check("shop B POST repair linked to shop A customer -> 400", xr.status === 400, xr);

  // ── Cross-shop reads/writes on repairs and their sub-resources ───────────
  const xp = await api("PATCH", `/repairs/${repA}`, B.token, { status: "cancelled", notes: "HACKED" });
  check("shop B PATCH shop A repair -> 404", xp.status === 404, xp);

  const xph = await api("GET", `/repairs/${repA}/photos`, B.token);
  check("shop B GET shop A repair photos -> 404", xph.status === 404, xph);

  const xphp = await api("POST", `/repairs/${repA}/photos`, B.token, {
    kind: "front",
    objectPath: `uploads/${B.shopId}/fake.jpg`,
  });
  check("shop B POST photo on shop A repair -> 404", xphp.status === 404, xphp);

  const xev = await api("GET", `/repairs/${repA}/events`, B.token);
  check("shop B GET shop A repair timeline -> 404", xev.status === 404, xev);

  const xpt = await api("GET", `/repairs/${repA}/parts`, B.token);
  check("shop B GET shop A repair parts -> 404", xpt.status === 404, xpt);

  const xptp = await api("POST", `/repairs/${repA}/parts`, B.token, {
    partName: "HACK part",
    quantity: 1,
    unitCost: 10,
  });
  check("shop B POST part on shop A repair -> 400/404", xptp.status === 404 || xptp.status === 400, xptp);

  // ── Verify nothing was mutated by the rejected attempts ──────────────────
  const after = await api("GET", "/customers", A.token);
  const cAfter = (after.json.customers ?? []).find((c) => c.id === custA);
  check("shop A customer unchanged after attacks", cAfter?.name === "Shop A Customer", cAfter);
  const afterR = await api("GET", "/repairs", A.token);
  const rAfter = (afterR.json.repairs ?? []).find((r) => r.id === repA);
  check(
    "shop A repair unchanged after attacks",
    rAfter && rAfter.status !== "cancelled" && rAfter.notes !== "HACKED",
    rAfter,
  );

  // ── Inventory ─────────────────────────────────────────────────────────────
  const inv = await api("POST", "/inventory", A.token, {
    name: "Shop A Screen",
    brand: "BrandA",
    category: "spare_part",
    quantity: 5,
    purchasePrice: 100,
    sellingPrice: 150,
  });
  check("shop A creates its inventory item", inv.status === 200 && inv.json.item?.id, inv);
  const invA = inv.json.item.id;

  const binv = await api("GET", "/inventory", B.token);
  check(
    "shop B inventory list excludes shop A's item",
    binv.status === 200 && !(binv.json.items ?? []).some((i) => i.id === invA),
    binv,
  );
  const xinv = await api("PATCH", `/inventory/${invA}`, B.token, { name: "HACKED", quantity: 0 });
  check("shop B PATCH shop A inventory item -> 404", xinv.status === 404, xinv);

  // ── Purchases ─────────────────────────────────────────────────────────────
  const pur = await api("POST", "/purchases", A.token, {
    supplier: "Shop A Supplier",
    itemName: "Shop A Purchase Item",
    quantity: 2,
    purchasePrice: 50,
    total: 100,
  });
  check("shop A creates its purchase", pur.status === 200 && pur.json.purchase?.id, pur);
  const purA = pur.json.purchase.id;

  const bpur = await api("GET", "/purchases", B.token);
  check(
    "shop B purchase list excludes shop A's purchase",
    bpur.status === 200 && !(bpur.json.purchases ?? []).some((p) => p.id === purA),
    bpur,
  );
  const xpur = await api("PATCH", `/purchases/${purA}`, B.token, { supplier: "HACKED", total: 0 });
  check("shop B PATCH shop A purchase -> 404", xpur.status === 404, xpur);

  // ── Finance ───────────────────────────────────────────────────────────────
  const fin = await api("POST", "/finance", A.token, {
    type: "expense",
    category: "Rent",
    amount: 500,
    description: "Shop A rent",
  });
  check("shop A creates its finance entry", fin.status === 200 && fin.json.entry?.id, fin);
  const finA = fin.json.entry.id;

  const bfin = await api("GET", "/finance", B.token);
  check(
    "shop B finance list excludes shop A's entry",
    bfin.status === 200 && !(bfin.json.entries ?? []).some((e) => e.id === finA),
    bfin,
  );
  const xfin = await api("PATCH", `/finance/${finA}`, B.token, { amount: 0, category: "HACKED" });
  check("shop B PATCH shop A finance entry -> 404", xfin.status === 404, xfin);

  // ── Returns & refunds ─────────────────────────────────────────────────────
  // A return case requires a delivered repair — mark shop A's repair
  // delivered directly in the DB (delivery OTP flow is out of scope here).
  await pool.query(`UPDATE repairs SET status = 'delivered', delivery_date = CURRENT_DATE WHERE id = $1`, [repA]);

  const xret = await api("POST", `/repairs/${repA}/returns`, B.token, {
    reason: "same_problem",
    complaint: "cross-shop return attempt",
  });
  check("shop B POST return on shop A repair -> 404", xret.status === 404, xret);

  const ret = await api("POST", `/repairs/${repA}/returns`, A.token, {
    reason: "same_problem",
    complaint: "device stopped working again",
  });
  check("shop A opens a return case", ret.status === 200 && ret.json.return?.id, ret);
  const retA = ret.json.return.id;

  const bret = await api("GET", "/returns", B.token);
  check(
    "shop B returns list excludes shop A's case",
    bret.status === 200 && !(bret.json.returns ?? []).some((r) => r.id === retA),
    bret,
  );
  const xretg = await api("GET", `/returns/${retA}`, B.token);
  check("shop B GET shop A return -> 404", xretg.status === 404, xretg);
  const xretp = await api("PATCH", `/returns/${retA}`, B.token, { status: "inspection", notes: "HACKED" });
  check("shop B PATCH shop A return -> 404", xretp.status === 404, xretp);
  const xretpart = await api("POST", `/returns/${retA}/parts`, B.token, {
    partName: "HACK part",
    quantity: 1,
    unitCost: 10,
  });
  check("shop B POST part on shop A return -> 404", xretpart.status === 404, xretpart);
  const xrefund = await api("POST", `/returns/${retA}/refunds`, B.token, {
    amount: 50,
    reason: "cross-shop refund attempt",
  });
  check("shop B POST refund on shop A return -> 404", xrefund.status === 404, xrefund);

  // Shop A (dealer) requests a refund — auto-approved for dealers.
  const ref = await api("POST", `/returns/${retA}/refunds`, A.token, {
    amount: 100,
    reason: "customer compensation",
  });
  check("shop A creates its refund", ref.status === 200 && ref.json.refund?.id, ref);
  const refA = ref.json.refund.id;

  const bref = await api("GET", "/refunds", B.token);
  check(
    "shop B refund list excludes shop A's refund",
    bref.status === 200 && !(bref.json.refunds ?? []).some((r) => r.id === refA),
    bref,
  );
  const xrefa = await api("POST", `/refunds/${refA}/approve`, B.token);
  check("shop B approve shop A refund -> 404", xrefa.status === 404, xrefa);
  const xrefr = await api("POST", `/refunds/${refA}/reject`, B.token, { reason: "HACK" });
  check("shop B reject shop A refund -> 404", xrefr.status === 404, xrefr);
  const xrefm = await api("POST", `/refunds/${refA}/mark-paid`, B.token, { referenceNo: "HACK-1" });
  check("shop B mark-paid shop A refund -> 404", xrefm.status === 404, xrefm);

  // ── Approval requests ─────────────────────────────────────────────────────
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const apr = await api("POST", "/approvals", A.token, {
    recordType: "finance",
    mode: "create",
    payload: { type: "expense", category: "Misc", amount: 10 },
    requestedDate: yesterday,
    reason: "backdated entry",
  });
  check("shop A creates its approval request", apr.status === 200 && apr.json.approval?.id, apr);
  const aprA = apr.json.approval.id;

  const bapr = await api("GET", "/approvals", B.token);
  check(
    "shop B approvals list excludes shop A's request",
    bapr.status === 200 && !(bapr.json.approvals ?? []).some((a) => a.id === aprA),
    bapr,
  );
  const xapra = await api("POST", `/approvals/${aprA}/approve`, B.token);
  check("shop B approve shop A approval -> 404", xapra.status === 404, xapra);
  const xaprr = await api("POST", `/approvals/${aprA}/reject`, B.token, { reason: "HACK" });
  check("shop B reject shop A approval -> 404", xaprr.status === 404, xaprr);

  // ── Verify nothing was mutated by the rejected cross-shop attempts ────────
  const invAfter = await api("GET", "/inventory", A.token);
  const iAfter = (invAfter.json.items ?? []).find((i) => i.id === invA);
  check("shop A inventory item unchanged after attacks", iAfter?.name === "Shop A Screen" && iAfter?.quantity === 5, iAfter);
  const purAfter = await api("GET", "/purchases", A.token);
  const pAfter = (purAfter.json.purchases ?? []).find((p) => p.id === purA);
  check("shop A purchase unchanged after attacks", pAfter?.supplier === "Shop A Supplier" && pAfter?.total === 100, pAfter);
  const finAfter = await api("GET", "/finance", A.token);
  const fAfter = (finAfter.json.entries ?? []).find((e) => e.id === finA);
  check("shop A finance entry unchanged after attacks", fAfter?.amount === 500 && fAfter?.category === "Rent", fAfter);
  const retAfter = await api("GET", `/returns/${retA}`, A.token);
  check(
    "shop A return unchanged after attacks",
    retAfter.status === 200 && retAfter.json.return?.notes !== "HACKED" && (retAfter.json.parts ?? []).length === 0,
    retAfter.json.return,
  );
  const aprAfter = await api("GET", "/approvals", A.token);
  const aAfter = (aprAfter.json.approvals ?? []).find((a) => a.id === aprA);
  check("shop A approval request still pending after attacks", aAfter?.status === "pending", aAfter);
}

async function main() {
  const [A, B] = [await seedTestShop("A"), await seedTestShop("B")];
  const child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${BASE}/healthz`)
        .then((r) => r.status > 0)
        .catch(() => false);
    }
    if (!up) throw new Error("server did not start");
    await run(A, B);
  } finally {
    child.kill("SIGTERM");
    await cleanup(A.userId).catch((err) => console.error("cleanup A failed:", err));
    await cleanup(B.userId).catch((err) => console.error("cleanup B failed:", err));
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll shop isolation checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
