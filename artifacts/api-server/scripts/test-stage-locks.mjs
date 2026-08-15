// API-level tests for stage-based service-field locking and the status
// transition graph:
//   - problem editable only at 'received'; diagnosis/workPerformed only in
//     the repairing stage; testing checklist writes only in the testing
//     stage. Locked-field changes -> 409 FIELD_LOCKED_STAGE.
//   - Statuses only move forward (or sideways within a stage). The single
//     authorized rewind is testing -> repairing when the stored checklist
//     has a failed item. Other rewinds -> 409 INVALID_STATUS_TRANSITION.
//   - Testing items saved as Pass stay immutable -> 409 TESTING_ITEM_LOCKED.
// Usage: pnpm run build && node scripts/test-stage-locks.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      [`Stage Dealer ${tag}`, `stagelock-${tag}-${n}@example.com`, String(9300000000 + n)],
    );
    const {
      rows: [shop],
    } = await client.query(
      `INSERT INTO shops (dealer_id, business_name) VALUES ($1, $2) RETURNING id`,
      [user.id, `Stage Shop ${tag}`],
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

async function createRepair(A) {
  const { status, json } = await api("POST", "/repairs", A.token, {
    customerName: "Stage Customer",
    mobile: "9177777777",
    deviceType: "mobile",
    brand: "BrandS",
    model: "S1",
    problem: "no power",
    repairCharge: 200,
  });
  check("create repair (received)", status === 200 && json.repair?.id, { status, json });
  return json.repair.id;
}

async function run(A) {
  // ── Stage 0: received — only problem editable ────────────────────────────
  const rep = await createRepair(A);

  let r = await api("PATCH", `/repairs/${rep}`, A.token, { problem: "no power at all" });
  check("received: problem edit -> 200", r.status === 200, r);

  r = await api("PATCH", `/repairs/${rep}`, A.token, { diagnosis: "too early" });
  check("received: diagnosis edit -> 409 FIELD_LOCKED_STAGE", r.status === 409 && r.json.code === "FIELD_LOCKED_STAGE", r);

  r = await api("POST", `/repairs/${rep}/testing`, A.token, { checklist: { display: true } });
  check("received: testing write -> 409 FIELD_LOCKED_STAGE", r.status === 409 && r.json.code === "FIELD_LOCKED_STAGE", r);

  // ── Stage 1: repairing — diagnosis/work editable, problem frozen ─────────
  r = await api("PATCH", `/repairs/${rep}`, A.token, { status: "repairing" });
  check("received -> repairing allowed", r.status === 200, r);

  r = await api("PATCH", `/repairs/${rep}`, A.token, { diagnosis: "dead board", workPerformed: "reflow" });
  check("repairing: diagnosis/work edit -> 200", r.status === 200, r);

  r = await api("PATCH", `/repairs/${rep}`, A.token, { problem: "changed later" });
  check("repairing: problem edit -> 409", r.status === 409 && r.json.code === "FIELD_LOCKED_STAGE", r);

  // Echoing the stored value back must NOT trip the lock (full-object PATCH).
  r = await api("PATCH", `/repairs/${rep}`, A.token, { problem: "no power at all", notes: "echo ok" });
  check("repairing: echoed unchanged problem -> 200", r.status === 200, r);

  r = await api("PATCH", `/repairs/${rep}`, A.token, { status: "received" });
  check("repairing -> received rewind -> 409", r.status === 409 && r.json.code === "INVALID_STATUS_TRANSITION", r);

  // ── Stage 2: testing — checklist editable, text fields frozen ────────────
  r = await api("PATCH", `/repairs/${rep}`, A.token, { status: "testing" });
  check("repairing -> testing allowed", r.status === 200, r);

  r = await api("PATCH", `/repairs/${rep}`, A.token, { workPerformed: "sneaky edit" });
  check("testing: workPerformed edit -> 409", r.status === 409 && r.json.code === "FIELD_LOCKED_STAGE", r);

  r = await api("POST", `/repairs/${rep}/testing`, A.token, { checklist: { display: true, touch: false } });
  check("testing: checklist write -> 200", r.status === 200, r);

  // Pass lock: display passed, cannot become fail.
  r = await api("POST", `/repairs/${rep}/testing`, A.token, { checklist: { display: false } });
  check("testing: pass -> fail rejected 409 TESTING_ITEM_LOCKED", r.status === 409 && r.json.code === "TESTING_ITEM_LOCKED", r);

  // Rewind with a failed item is the authorized return-to-repair path.
  r = await api("PATCH", `/repairs/${rep}`, A.token, { status: "repairing" });
  check("testing -> repairing with failed item allowed", r.status === 200, r);

  r = await api("PATCH", `/repairs/${rep}`, A.token, { workPerformed: "replaced touch panel" });
  check("back in repairing: work edit -> 200 again", r.status === 200, r);

  // ── Rewind without a failed test must be rejected ────────────────────────
  const rep2 = await createRepair(A);
  await api("PATCH", `/repairs/${rep2}`, A.token, { status: "repairing" });
  await api("PATCH", `/repairs/${rep2}`, A.token, { status: "testing" });
  r = await api("PATCH", `/repairs/${rep2}`, A.token, { status: "repairing" });
  check("testing -> repairing without failed item -> 409", r.status === 409 && r.json.code === "INVALID_STATUS_TRANSITION", r);

  // ── Later stages cannot rewind into editable stages ──────────────────────
  r = await api("PATCH", `/repairs/${rep2}`, A.token, { status: "ready" });
  check("testing -> ready allowed", r.status === 200, r);
  r = await api("PATCH", `/repairs/${rep2}`, A.token, { status: "testing" });
  check("ready -> testing rewind -> 409", r.status === 409 && r.json.code === "INVALID_STATUS_TRANSITION", r);
  r = await api("PATCH", `/repairs/${rep2}`, A.token, { status: "repairing" });
  check("ready -> repairing rewind -> 409", r.status === 409 && r.json.code === "INVALID_STATUS_TRANSITION", r);
  r = await api("POST", `/repairs/${rep2}/testing`, A.token, { checklist: { camera: true } });
  check("ready: checklist write -> 409", r.status === 409 && r.json.code === "FIELD_LOCKED_STAGE", r);

  // ── Race: testing-fail rewind vs concurrent checklist clear ─────────────
  // Fire "clear the only failed item" (POST /testing touch:true) and
  // "return to repairing" (PATCH status) at the same time, repeatedly.
  // Serialized correctly, at most one can win: if the checklist write lands
  // first there is no failed item so the rewind must 409; if the rewind
  // lands first the job left the testing stage so the checklist write must
  // 409. Both succeeding means the FOR UPDATE revalidation is broken.
  for (let i = 0; i < 5; i++) {
    const rr = await createRepair(A);
    await api("PATCH", `/repairs/${rr}`, A.token, { status: "repairing" });
    await api("PATCH", `/repairs/${rr}`, A.token, { status: "testing" });
    await api("POST", `/repairs/${rr}/testing`, A.token, { checklist: { touch: false } });
    const [clear, rewind] = await Promise.all([
      api("POST", `/repairs/${rr}/testing`, A.token, { checklist: { touch: true } }),
      api("PATCH", `/repairs/${rr}`, A.token, { status: "repairing" }),
    ]);
    const bothWon = clear.status === 200 && rewind.status === 200;
    check(`race ${i + 1}: fail-clear and rewind never both succeed`, !bothWon, { clear, rewind });
    const { json: st } = await api("GET", "/repairs", A.token);
    const repNow = (st.repairs ?? []).find((x) => x.id === rr) ?? {};
    const cl = repNow.testingChecklist ?? {};
    const consistent =
      (repNow.status === "repairing" && cl.touch === false) ||
      (["testing", "customer_approval"].includes(repNow.status) && cl.touch === true) ||
      (["testing", "customer_approval"].includes(repNow.status) && cl.touch === false && rewind.status !== 200 && clear.status !== 200);
    check(`race ${i + 1}: final state consistent`, consistent, { status: repNow.status, cl, clear: clear.status, rewind: rewind.status });
  }

  // ── Terminal statuses are frozen ─────────────────────────────────────────
  const rep3 = await createRepair(A);
  r = await api("PATCH", `/repairs/${rep3}`, A.token, { status: "cancelled" });
  check("received -> cancelled allowed", r.status === 200, r);
  r = await api("PATCH", `/repairs/${rep3}`, A.token, { status: "repairing" });
  check("cancelled -> repairing -> 409", r.status === 409 && r.json.code === "INVALID_STATUS_TRANSITION", r);
  // Dealer may restore a voided job, but only into locked statuses.
  r = await api("PATCH", `/repairs/${rep3}`, A.token, { status: "delivered" });
  check("dealer: cancelled -> delivered restore allowed", r.status === 200, r);

  // ── Estimate approvals cannot reopen locked stages ───────────────────────
  const rep4 = await createRepair(A);
  await api("PATCH", `/repairs/${rep4}`, A.token, { status: "repairing" });
  r = await api("POST", `/repairs/${rep4}/estimate-approvals`, A.token, { newAmount: 500, reason: "extra part" });
  check("repairing: estimate approval request -> 200", r.status === 200, r);
  // Deciding the approval must restore the exact pre-park stage (repairing),
  // never rewind further (e.g. to diagnosing) or reopen anything else.
  {
    const { json: lst } = await api("GET", "/repairs", A.token);
    const parked = (lst.repairs ?? []).find((x) => x.id === rep4);
    check("estimate request parks repair in customer_approval", parked?.status === "customer_approval", parked?.status);
  }
  {
    const { json: al } = await api("GET", `/repairs/${rep4}/estimate-approvals`, A.token);
    const pending = (al.estimateApprovals ?? []).find((x) => x.status === "pending");
    check("pending estimate approval listed", !!pending, al);
    if (pending) {
      const dec = await api("POST", `/estimate-approvals/${pending.id}/decide`, A.token, {
        decision: "approved",
        method: "dealer",
      });
      check("dealer decides estimate approval -> 200", dec.status === 200, dec);
      const { json: lst2 } = await api("GET", "/repairs", A.token);
      const after = (lst2.repairs ?? []).find((x) => x.id === rep4);
      check("decision restores pre-park stage (repairing)", after?.status === "repairing", after?.status);
    }
  }
  // customer_approval is NOT an authorized rewind source, even with a fail.
  const repCA = await createRepair(A);
  await api("PATCH", `/repairs/${repCA}`, A.token, { status: "repairing" });
  await api("PATCH", `/repairs/${repCA}`, A.token, { status: "testing" });
  await api("POST", `/repairs/${repCA}/testing`, A.token, { checklist: { speaker: false } });
  await api("PATCH", `/repairs/${repCA}`, A.token, { status: "customer_approval" });
  r = await api("PATCH", `/repairs/${repCA}`, A.token, { status: "repairing" });
  check("customer_approval -> repairing with fail -> 409", r.status === 409 && r.json.code === "INVALID_STATUS_TRANSITION", r);

  // Legacy approvals with NULL previous_status must not rewind the repair.
  const repLegacy = await createRepair(A);
  await api("PATCH", `/repairs/${repLegacy}`, A.token, { status: "repairing" });
  r = await api("POST", `/repairs/${repLegacy}/estimate-approvals`, A.token, { newAmount: 400, reason: "legacy" });
  check("legacy: estimate approval created", r.status === 200, r);
  const legacyApprovalId = r.json.estimateApproval?.id;
  await pool.query(`UPDATE estimate_approvals SET previous_status = NULL WHERE id = $1`, [legacyApprovalId]);
  r = await api("POST", `/estimate-approvals/${legacyApprovalId}/decide`, A.token, { decision: "rejected", method: "dealer" });
  check("legacy: decision -> 200", r.status === 200, r);
  {
    const { json: lst } = await api("GET", "/repairs", A.token);
    const after = (lst.repairs ?? []).find((x) => x.id === repLegacy);
    check("legacy: NULL previous_status leaves repair parked", after?.status === "customer_approval", after?.status);
  }

  const rep5 = await createRepair(A);
  await api("PATCH", `/repairs/${rep5}`, A.token, { status: "repairing" });
  await api("PATCH", `/repairs/${rep5}`, A.token, { status: "ready" });
  r = await api("POST", `/repairs/${rep5}/estimate-approvals`, A.token, { newAmount: 500, reason: "too late" });
  check("ready: estimate approval request -> 409", r.status === 409, r);
  r = await api("PATCH", `/repairs/${rep3}`, A.token, { status: "repairing" });
  check("restored delivered job cannot rewind -> 409", r.status === 409 && r.json.code === "INVALID_STATUS_TRANSITION", r);
}

async function main() {
  const A = await seedTestShop("A");
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
    await run(A);
  } finally {
    child.kill("SIGTERM");
    await cleanup(A.userId).catch((err) => console.error("cleanup failed:", err));
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll stage lock checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
