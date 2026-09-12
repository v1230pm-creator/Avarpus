// Integration test for the public registration gate.
// Usage: node scripts/run-isolated.mjs scripts/test-registration-gate.mjs
//
// Current contract (see src/routes/auth.ts): public registration is limited
// to dealer roles. Staff, admin, and super_admin can never be requested
// publicly. Verify consumes the email OTP, provisions a dealer workspace,
// and never issues an authenticated session.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

// Built server entry. scripts/run-isolated.mjs builds into a private per-run
// directory and passes it here so a concurrent `pnpm run build` rewriting
// ./dist cannot pull the bundle out from under this run.
const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";

const PORT = 5641;
const BASE = `http://localhost:${PORT}/api`;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

let failures = 0;

function payload(extra = {}) {
  const n = Math.floor(Math.random() * 1e6);
  return {
    name: "Test User",
    businessName: "Test Biz",
    email: `gate-test-${n}@example.com`,
    mobile: String(9000000000 + n),
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
  const child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT), ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${BASE}/auth/otp/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile: "0000000000" }) })
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

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

// 200 = OTP sent; 502 = gate passed but the email provider rejected the test
// address (expected for @example.com). Both mean the request got past the
// role gate.
const passedGate = (r) => r.status === 200 || r.status === 502;

function userRole(email) {
  return execFileSync("psql", [process.env.DATABASE_URL, "-tAc",
    `SELECT role FROM users WHERE email='${email}'`]).toString().trim();
}

function seedRegisterOtp(email, otp, otpPayload) {
  execFileSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c",
    `DELETE FROM otp_codes WHERE identifier='${email}';
     INSERT INTO otp_codes (identifier, purpose, code_hash, payload, expires_at)
     VALUES ('${email}', 'register', '${sha256hex(otp)}', '${JSON.stringify(otpPayload).replace(/'/g, "''")}', now() + interval '10 minutes');`]);
}

async function verifyOtp(email, otp) {
  const res = await fetch(`${BASE}/auth/register/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: otp }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

await withServer({}, async () => {
  console.log("== /register/start role gate ==");
  let r = await post(payload({ role: "super_admin" }));
  check("super_admin -> 403 (never registrable)", r.status === 403, r);

  r = await post(payload({ role: "admin" }));
  check("admin -> 403 (never registrable)", r.status === 403, r);

  r = await post(payload({ role: "dealer" }));
  check("dealer passes gate (200/502)", passedGate(r), r);

  r = await post(payload());
  check("omitted role treated as dealer (200/502)", passedGate(r), r);

  r = await post(payload({ role: "dealer", businessName: "" }));
  check("dealer without businessName -> 400", r.status === 400, r);

  console.log("== staff registration is not public ==");
  r = await post(payload({ role: "reception" }));
  check("staff role -> 403", r.status === 403, r);

  r = await post(payload({ role: "reception", dealerMobile: "0000000001" }));
  check("staff role with dealer mobile -> 403", r.status === 403, r);

  console.log("== /register/verify never provisions elevated roles ==");
  // Even if an OTP payload were tampered to claim role=super_admin, dealer
  // provisioning forcibly sets role='dealer'.
  const email = `gate-verify-${Math.floor(Math.random() * 1e6)}@example.com`;
  const mobile = String(9200000000 + Math.floor(Math.random() * 1e6));
  seedRegisterOtp(email, "123456", {
    kind: "dealer",
    name: "Tampered User",
    businessName: "Tampered Biz",
    email,
    mobile,
    gstNumber: null,
    shopAddress: "1 Test St",
    role: "super_admin",
  });
  try {
    const v = await verifyOtp(email, "123456");
    check("tampered-role verify -> 200 (dealer provisioning)", v.status === 200, v);
    check("created user is a dealer, not super_admin", userRole(email) === "dealer", { role: userRole(email) });
    check("API response role is dealer", v.json?.user?.role === "dealer", v.json?.user);
    check("verify never issues a session", v.json?.token === undefined, v.json);
  } finally {
    execFileSync("psql", [process.env.DATABASE_URL, "-c", `DELETE FROM users WHERE email='${email}'`]);
    execFileSync("psql", [process.env.DATABASE_URL, "-c", `DELETE FROM otp_codes WHERE identifier='${email}'`]);
  }
});

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All checks passed");
