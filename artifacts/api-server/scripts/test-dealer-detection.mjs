// API-level tests for Automatic Dealer Detection During Phone Receiving:
// entering a mobile that exactly matches ONE active dealer's registered
// mobile must auto-link the repair (dealerDetectedByPhone=true), normal
// customer numbers stay unlinked, inactive dealers never match, explicit
// dealerId:null suppresses auto-link, manual dealerId still validates, and
// updating a dealer's mobile changes future detection.
// Usage: node scripts/run-isolated.mjs scripts/test-dealer-detection.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
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

const PORT = 5647;
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
      [`Detect Owner ${tag}`, `detect-${tag}-${n}@example.com`, String(9300000000 + n)],
    );
    const {
      rows: [shop],
    } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
      [user.id, `Detect Shop ${tag}`],
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

// Seed an extra user in an existing shop (staff / technician / portal role).
async function seedShopUser(shopId, role, dealerId = null) {
  const n = Math.floor(Math.random() * 1e6);
  const {
    rows: [user],
  } = await pool.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active, shop_id, dealer_id)
     VALUES ($1, $2, $3, 'x', $4, true, $5, $6) RETURNING id`,
    [`Detect ${role} ${n}`, `detect-${role}-${n}@example.com`, String(9400000000 + n), role, shopId, dealerId],
  );
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
    [token, user.id],
  );
  return { userId: user.id, token };
}

const DEALER_MOBILE = "9877001122";
const CUSTOMER_MOBILE = "9877009988";

const repairBase = (mobile, extra = {}) => ({
  customerName: "Walk-in",
  mobile,
  deviceType: "mobile",
  brand: "TestBrand",
  model: "T1",
  problem: "does not power on",
  repairCharge: 100,
  ...extra,
});

async function run(A, B) {
  // ── Seed a dealer in shop A ────────────────────────────────────────────
  const dc = await api("POST", "/dealers", A.token, {
    name: "ABC Mobile",
    shopName: "ABC Mobile Traders",
    mobile: DEALER_MOBILE,
  });
  check("create dealer", dc.status === 200 && dc.json.dealer?.id, dc);
  const dealer = dc.json.dealer;

  // ── /dealers/detect ─────────────────────────────────────────────────────
  const d1 = await api("GET", `/dealers/detect?mobile=${DEALER_MOBILE}`, A.token);
  check("detect finds the dealer by exact mobile", d1.status === 200 && d1.json.dealers?.length === 1 && d1.json.dealers[0].id === dealer.id, d1);
  const d2 = await api("GET", `/dealers/detect?mobile=${CUSTOMER_MOBILE}`, A.token);
  check("detect returns empty for a normal customer number", d2.status === 200 && d2.json.dealers?.length === 0, d2);
  const d3 = await api("GET", `/dealers/detect?mobile=98770`, A.token);
  check("detect ignores partial numbers", d3.status === 200 && d3.json.dealers?.length === 0, d3);
  const dB = await api("GET", `/dealers/detect?mobile=${DEALER_MOBILE}`, B.token);
  check("other shop cannot detect shop A's dealer", dB.status === 200 && dB.json.dealers?.length === 0, dB);

  // ── Case 1: dealer mobile → repair auto-linked server-side ─────────────
  const r1 = await api("POST", "/repairs", A.token, repairBase(DEALER_MOBILE));
  check("dealer mobile auto-links repair", r1.status === 200 && r1.json.repair?.dealerId === dealer.id, r1.json.repair);
  check("auto-linked repair has dealerDetectedByPhone", r1.json.repair?.dealerDetectedByPhone === true, r1.json.repair);
  check("dealerName snapshot saved", r1.json.repair?.dealerName === "ABC Mobile", r1.json.repair);

  // ── Case 2: normal customer number stays unlinked ───────────────────────
  const r2 = await api("POST", "/repairs", A.token, repairBase(CUSTOMER_MOBILE));
  check("customer mobile stays unlinked", r2.status === 200 && !r2.json.repair?.dealerId, r2.json.repair);

  // ── Case 6: same dealer number again → same dealer_id ──────────────────
  const r3 = await api("POST", "/repairs", A.token, repairBase(DEALER_MOBILE));
  check("repeat dealer mobile links same dealer_id", r3.status === 200 && r3.json.repair?.dealerId === dealer.id, r3.json.repair);

  // ── Removal before save: explicit dealerId:null suppresses auto-link ────
  const r4 = await api("POST", "/repairs", A.token, repairBase(DEALER_MOBILE, { dealerId: null }));
  check("explicit dealerId:null suppresses auto-link", r4.status === 200 && !r4.json.repair?.dealerId, r4.json.repair);

  // ── Manual dealerId still validated; flag only when mobile matches ──────
  const r5 = await api("POST", "/repairs", A.token, repairBase(CUSTOMER_MOBILE, { dealerId: dealer.id }));
  check("manual dealer link with non-dealer mobile: no phone flag", r5.status === 200 && r5.json.repair?.dealerId === dealer.id && !r5.json.repair?.dealerDetectedByPhone, r5.json.repair);
  const r6 = await api("POST", "/repairs", B.token, repairBase(CUSTOMER_MOBILE, { dealerId: dealer.id }));
  check("other shop cannot link shop A's dealer", r6.status === 400, r6);

  // ── Repairs appear in the dealer's list ─────────────────────────────────
  const lst = await api("GET", `/repairs?dealerId=${dealer.id}`, A.token);
  const ids = (lst.json.repairs ?? []).map((r) => r.id);
  check("auto-linked repairs appear under the dealer", ids.includes(r1.json.repair.id) && ids.includes(r3.json.repair.id) && ids.includes(r5.json.repair.id), ids);
  check("unlinked repairs do not appear under the dealer", !ids.includes(r2.json.repair.id) && !ids.includes(r4.json.repair.id), ids);

  // ── Case 7: dealer mobile updated → future detection uses new number ────
  const NEW_MOBILE = "9877005566";
  const up = await api("PATCH", `/dealers/${dealer.id}`, A.token, { mobile: NEW_MOBILE });
  check("update dealer mobile", up.status === 200 && up.json.dealer?.mobile === NEW_MOBILE, up);
  const d4 = await api("GET", `/dealers/detect?mobile=${DEALER_MOBILE}`, A.token);
  check("old number no longer detects", d4.json.dealers?.length === 0, d4);
  const r7 = await api("POST", "/repairs", A.token, repairBase(NEW_MOBILE));
  check("new number auto-links after profile update", r7.status === 200 && r7.json.repair?.dealerId === dealer.id && r7.json.repair?.dealerDetectedByPhone === true, r7.json.repair);

  // ── Manual link authorization (staff must NOT pick arbitrary dealers) ───
  const d2c = await api("POST", "/dealers", A.token, { name: "XYZ Repairs", mobile: "9877003344" });
  check("create second dealer", d2c.status === 200, d2c);
  const dealer2 = d2c.json.dealer;
  const staff = await seedShopUser(A.shopId, "staff");
  const sManual = await api("POST", "/repairs", staff.token, repairBase(CUSTOMER_MOBILE, { dealerId: dealer2.id }));
  check("staff manual dealer link -> 403 DEALER_LINK_PRIVILEGED", sManual.status === 403 && sManual.json.code === "DEALER_LINK_PRIVILEGED", sManual);
  const sAuto = await api("POST", "/repairs", staff.token, repairBase("9877003344"));
  check("staff intake with dealer mobile still auto-links", sAuto.status === 200 && sAuto.json.repair?.dealerId === dealer2.id && sAuto.json.repair?.dealerDetectedByPhone === true, sAuto.json.repair);
  const sPick = await api("POST", "/repairs", staff.token, repairBase("9877003344", { dealerId: dealer2.id }));
  check("staff supplying the phone-matched dealerId is accepted", sPick.status === 200 && sPick.json.repair?.dealerId === dealer2.id, sPick.json.repair);
  const sPatch = await api("PATCH", `/repairs/${sAuto.json.repair.id}`, staff.token, { dealerId: null });
  check("staff PATCH dealer link -> 403", sPatch.status === 403 && sPatch.json.code === "DEALER_LINK_PRIVILEGED", sPatch);

  // ── Two exact matches → no auto-assignment ──────────────────────────────
  // (dealersCreate dedupes same-mobile, so force the duplicate directly.)
  const DUP_MOBILE = "9877007788";
  await pool.query(
    `INSERT INTO dealers (shop_id, dealer_code, name, mobile) VALUES ($1, 'DLR-901', 'Dup One', $2), ($1, 'DLR-902', 'Dup Two', $2)`,
    [A.shopId, DUP_MOBILE],
  );
  const dDup = await api("GET", `/dealers/detect?mobile=${DUP_MOBILE}`, A.token);
  check("detect returns both duplicates", dDup.json.dealers?.length === 2, dDup);
  const rDup = await api("POST", "/repairs", A.token, repairBase(DUP_MOBILE));
  check("ambiguous match is NOT auto-assigned", rDup.status === 200 && !rDup.json.repair?.dealerId, rDup.json.repair);

  // ── Dealer-portal accounts: read-only, own-dealer scoped ────────────────
  const portal = await seedShopUser(A.shopId, "dealer_owner", dealer.id);
  const pCreate = await api("POST", "/repairs", portal.token, repairBase(CUSTOMER_MOBILE));
  check("portal account cannot create repairs", pCreate.status === 403, pCreate);
  const pDetect = await api("GET", `/dealers/detect?mobile=${DUP_MOBILE}`, portal.token);
  check("portal account cannot call detect", pDetect.status === 403, pDetect);
  const pList = await api("GET", "/repairs", portal.token);
  const foreign = (pList.json.repairs ?? []).filter((r) => r.dealerId !== dealer.id);
  check("portal list only shows own dealer's repairs", pList.status === 200 && foreign.length === 0, foreign);
  await cleanup(staff.userId).catch(() => {});
  await cleanup(portal.userId).catch(() => {});

  // ── Inactive dealers never match ─────────────────────────────────────────
  const off = await api("PATCH", `/dealers/${dealer.id}`, A.token, { isActive: false });
  check("deactivate dealer", off.status === 200, off);
  const d5 = await api("GET", `/dealers/detect?mobile=${NEW_MOBILE}`, A.token);
  check("inactive dealer is not detected", d5.json.dealers?.length === 0, d5);
  const r8 = await api("POST", "/repairs", A.token, repairBase(NEW_MOBILE));
  check("inactive dealer is not auto-linked", r8.status === 200 && !r8.json.repair?.dealerId, r8.json.repair);
}

async function main() {
  const [A, B] = [await seedTestShop("A"), await seedTestShop("B")];
  const child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
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
  console.log("\nAll dealer detection checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
