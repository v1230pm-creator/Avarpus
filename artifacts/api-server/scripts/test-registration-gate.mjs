// Integration test for the admin/dealer registration access-code gate.
// Usage: pnpm run build && node scripts/test-registration-gate.mjs
// Spawns the built server twice (with and without ADMIN_ACCESS_CODE) and
// asserts on POST /api/auth/register/start behavior for each role.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5641;
const CODE = "test-code-123";
const BASE = `http://localhost:${PORT}/api`;

let failures = 0;

function payload(extra = {}) {
  const n = Math.floor(Math.random() * 1e6);
  return {
    name: "Test User",
    businessName: "Test Biz",
    email: `gate-test-${n}@example.com`,
    mobile: String(9000000000 + n),
    password: "Passw0rdX",
    shopAddress: "1 Test St",
    ...extra,
  };
}

async function post(body) {
  const res = await fetch(`${BASE}/auth/register/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function check(label, cond, detail) {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label} — ${JSON.stringify(detail)}`);
  }
}

async function withServer(env, fn) {
  const child = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
    env: { ...process.env, PORT: String(PORT), ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then((r) => r.status > 0)
        .catch(() => false);
    }
    if (!up) throw new Error("server did not start");
    await fn();
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
  }
}

console.log("== With ADMIN_ACCESS_CODE configured ==");
await withServer({ ADMIN_ACCESS_CODE: CODE }, async () => {
  let r = await post(payload({ role: "super_admin", accessCode: "wrong" }));
  check("admin + wrong code -> 403", r.status === 403 && /access code/i.test(r.json.message), r);

  r = await post(payload({ role: "dealer" }));
  check("dealer + missing code -> 403", r.status === 403, r);

  r = await post(payload({ role: "super_admin", accessCode: CODE }));
  // Correct code passes the gate; 200 (OTP sent) or 502 (email provider rejects test address) both mean the gate opened.
  check("admin + correct code passes gate (200/502, not 403/503)", r.status === 200 || r.status === 502, r);

  r = await post(payload({ role: "dealer", accessCode: CODE }));
  check("dealer + correct code passes gate", r.status === 200 || r.status === 502, r);

  r = await post(payload());
  check("staff (reception) unaffected, no code needed", r.status === 200 || r.status === 502, r);
});

console.log("== Verify re-check: code rotated/unset between start and verify ==");
// Craft an in-flight elevated registration directly in the DB (as /start would
// under the OLD code), then attempt /verify while the server runs with a
// DIFFERENT (or no) code. The fingerprint re-check must reject it.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

function seedElevatedOtp(email, mobile, otp, oldCode) {
  const payload = JSON.stringify({
    name: "Rotated User",
    businessName: "Rotated Biz",
    email,
    mobile,
    passwordHash: "x",
    gstNumber: null,
    shopAddress: "1 Test St",
    role: "super_admin",
    accessCodeFingerprint: sha256hex(oldCode),
  });
  execFileSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c",
    `DELETE FROM otp_codes WHERE identifier='${email}';
     INSERT INTO otp_codes (identifier, purpose, code_hash, payload, expires_at)
     VALUES ('${email}', 'register', '${sha256hex(otp)}', '${payload}', now() + interval '10 minutes');`]);
}

async function verifyOtp(email, otp) {
  const res = await fetch(`${BASE}/auth/register/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: otp }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function userExists(email) {
  const out = execFileSync("psql", [process.env.DATABASE_URL, "-tAc",
    `SELECT count(*) FROM users WHERE email='${email}'`]).toString().trim();
  return out !== "0";
}

await withServer({ ADMIN_ACCESS_CODE: "rotated-new-code" }, async () => {
  const email = "gate-rotate@example.com";
  seedElevatedOtp(email, "9111111111", "123456", "old-code");
  const r = await verifyOtp(email, "123456");
  check("elevated verify after code rotation -> 403", r.status === 403, r);
  check("no elevated user created after rotation", !userExists(email), {});
});

await withServer({ ADMIN_ACCESS_CODE: "" }, async () => {
  const email = "gate-unset@example.com";
  seedElevatedOtp(email, "9111111112", "123456", "old-code");
  const r = await verifyOtp(email, "123456");
  check("elevated verify with code unset -> 503", r.status === 503, r);
  check("no elevated user created when unset", !userExists(email), {});
});

await withServer({ ADMIN_ACCESS_CODE: "same-code" }, async () => {
  const email = "gate-same@example.com";
  seedElevatedOtp(email, "9111111113", "123456", "same-code");
  const r = await verifyOtp(email, "123456");
  check("elevated verify with unchanged code -> 200", r.status === 200, r);
  check("elevated user created with unchanged code", userExists(email), {});
  execFileSync("psql", [process.env.DATABASE_URL, "-c", `DELETE FROM users WHERE email='${email}'`]);
});

console.log("== Without ADMIN_ACCESS_CODE (fails closed) ==");
await withServer({ ADMIN_ACCESS_CODE: "" }, async () => {
  let r = await post(payload({ role: "super_admin", accessCode: "anything" }));
  check("admin -> 503 disabled", r.status === 503, r);

  r = await post(payload({ role: "dealer" }));
  check("dealer -> 503 disabled", r.status === 503, r);

  r = await post(payload());
  check("staff still works", r.status === 200 || r.status === 502, r);
});

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All checks passed");
