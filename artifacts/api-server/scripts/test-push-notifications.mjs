// API integration checks for push delivery of notification rows.
//
// The point of push is that a time-sensitive alert reaches someone who has
// closed the app. Four things have to hold at once: a device can bind a token
// to its own signed-in session, an outcome the server already wrote to the
// inbox goes out to that device with exactly the inbox wording and nothing
// more, a push provider that is slow or broken never touches the mutation that
// produced the alert, and a token stops receiving anything the moment its
// session ends — by sign-out, by revocation, or because the device is dead.
//
// The push provider is replaced with a local stub, so no real device is
// contacted and the exact outbound payload can be asserted.
//
// Usage: node scripts/run-isolated.mjs scripts/test-push-notifications.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
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

const PORT = 5671;
const PUSH_STUB_PORT = 5672;
const BASE = `http://localhost:${PORT}/api`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FIXTURE_MARKER = `push-${randomBytes(8).toString("hex")}`;
let failures = 0;

function marked(value) {
  return `${FIXTURE_MARKER}-${value}`;
}

function fixtureMobile(leadingDigit) {
  return `${leadingDigit}${String(randomInt(100_000_000, 1_000_000_000))}`;
}

function expoToken(tag) {
  return `ExponentPushToken[${FIXTURE_MARKER}-${tag}]`;
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

// ── Push provider stub ──────────────────────────────────────────────────────
// Records every outbound message and can be switched into the failure shapes
// a real provider produces: a delayed reply, an HTTP error, and a ticket that
// reports the installation as gone.

const pushStub = {
  messages: [],
  mode: "ok", // 'ok' | 'slow' | 'http-error' | 'device-not-registered'
  delayMs: 0,
  reset() {
    this.messages = [];
    this.mode = "ok";
    this.delayMs = 0;
  },
  // Only messages this run created — the dev database may hold other tokens.
  mine() {
    return this.messages.filter((message) => String(message.to).includes(FIXTURE_MARKER));
  },
  async waitForToken(token, { tries = 40 } = {}) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const found = this.messages.filter((message) => message.to === token);
      if (found.length > 0) return found;
      await sleep(100);
    }
    return [];
  },
};

function startPushStub() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", async () => {
      let parsed = [];
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = [];
      }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      pushStub.messages.push(...messages);
      if (pushStub.mode === "slow") await sleep(pushStub.delayMs);
      if (pushStub.mode === "http-error") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }));
        return;
      }
      const tickets = messages.map(() =>
        pushStub.mode === "device-not-registered"
          ? {
              status: "error",
              message: "device is not registered",
              details: { error: "DeviceNotRegistered" },
            }
          : { status: "ok", id: randomUUID() },
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: tickets }));
    });
  });
  return new Promise((resolve) => server.listen(PUSH_STUB_PORT, () => resolve(server)));
}

// ── Fixtures ────────────────────────────────────────────────────────────────

async function seedUser({ tag, role = "customer" }) {
  const suffix = randomBytes(5).toString("hex");
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, email, mobile, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'x', $4, true) RETURNING id`,
    [`Push ${marked(tag)}`, `${marked(tag)}-${suffix}@example.com`, fixtureMobile(7), role],
  );
  const token = await seedSession(user.id);
  return { userId: user.id, token, label: tag };
}

async function seedSession(userId) {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [token, userId],
  );
  return token;
}

async function seedDirectRoom({ memberIds, tag }) {
  const { rows: [room] } = await pool.query(
    `INSERT INTO chat_rooms (shop_id, scope, kind, name, peer_key, created_by_id, created_by_name)
     VALUES (NULL, 'global_direct', 'direct', $1, $2, $3, $4) RETURNING id`,
    [
      `Push room ${marked(tag)}`,
      [...memberIds].sort().join(":"),
      memberIds[0],
      `Push ${marked(tag)}`,
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
    [room.id, memberIds[1], `Push ${marked(tag)}`, `reported-${marked(tag)}`],
  );
  return { roomId: room.id, messageId: message.id };
}

async function seedReport({ reporter, reported, room, tag }) {
  const { rows: [report] } = await pool.query(
    `INSERT INTO chat_reports
       (reporter_user_id, reported_user_id, room_id, message_id, client_request_id, reason, details)
     VALUES ($1, $2, $3, $4, $5, 'abuse', $6) RETURNING id`,
    [
      reporter.userId,
      reported.userId,
      room.roomId,
      room.messageId,
      marked(randomUUID()),
      marked(tag),
    ],
  );
  return report.id;
}

async function pushTokenRows(userId) {
  const { rows } = await pool.query(
    `SELECT token, user_id, session_id, platform, device_info FROM push_tokens WHERE user_id = $1`,
    [userId],
  );
  return rows;
}

async function pushTokenRow(token) {
  const { rows } = await pool.query(
    `SELECT token, user_id, session_id FROM push_tokens WHERE token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

async function waitForTokenGone(token, { tries = 40 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (!(await pushTokenRow(token))) return true;
    await sleep(100);
  }
  return false;
}

// Notifications are written before the request returns, but push is dispatched
// without being awaited. Poll rather than race either one.
async function reviewNotification(userId, { tries = 40 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const { rows } = await pool.query(
      `SELECT id, title, body, data FROM notifications
        WHERE user_id = $1 AND type = 'chat_report_reviewed'
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (rows.length > 0) return rows[0];
    await sleep(100);
  }
  return null;
}

// ── Checks ──────────────────────────────────────────────────────────────────

async function run() {
  const [operator, reporter, reported, stranger] = await Promise.all([
    seedUser({ tag: "operator", role: "super_admin" }),
    seedUser({ tag: "reporter" }),
    seedUser({ tag: "reported" }),
    seedUser({ tag: "stranger" }),
  ]);
  const room = await seedDirectRoom({ memberIds: [reporter.userId, reported.userId], tag: "r1" });

  console.log("\nDevice registration");
  const token = expoToken("device-1");
  check(
    "anonymous device cannot register a token",
    (await api("POST", "/push/tokens", null, { token, platform: "android" })).status === 401,
  );
  check(
    "a token that is not an Expo push token is rejected",
    (await api("POST", "/push/tokens", reporter.token, { token: "not-a-token", platform: "android" }))
      .status === 400,
  );
  check(
    "an unknown platform is rejected",
    (await api("POST", "/push/tokens", reporter.token, { token, platform: "desktop" })).status === 400,
  );

  const registered = await api("POST", "/push/tokens", reporter.token, {
    token,
    platform: "android",
    deviceInfo: `Android · ${marked("pixel")}`,
  });
  check("a signed-in device registers its token", registered.status === 200, registered.json);
  const row = await pushTokenRow(token);
  check("the token is stored against the caller", row?.user_id === reporter.userId, row);
  check("the token is bound to a session", Boolean(row?.session_id), row);
  check(
    "re-registering the same device does not create a second row",
    (await api("POST", "/push/tokens", reporter.token, { token, platform: "android" })).status === 200
      && (await pushTokenRows(reporter.userId)).length === 1,
  );

  console.log("\nOne handset, one live token");
  const rotatedFrom = expoToken("rotate-a");
  const rotatedTo = expoToken("rotate-b");
  const deviceId = marked("handset-1");
  const withDevice = await api("POST", "/push/tokens", reporter.token, {
    token: rotatedFrom,
    platform: "android",
    deviceId,
    appVersion: "1.0.8 (17)",
  });
  check("a device may report its installation id and app build", withDevice.status === 200, withDevice.json);
  const { rows: [deviceRow] } = await pool.query(
    `SELECT device_id, app_version, notifications_enabled, last_seen_at FROM push_tokens WHERE token = $1`,
    [rotatedFrom],
  );
  check(
    "installation id, app build and enabled state are stored",
    deviceRow?.device_id === deviceId && deviceRow?.app_version === "1.0.8 (17)" && deviceRow?.notifications_enabled === true,
    deviceRow,
  );
  await api("POST", "/push/tokens", reporter.token, { token: rotatedTo, platform: "android", deviceId });
  check(
    "a rotated token retires the same handset's previous token",
    (await pushTokenRow(rotatedFrom)) == null && (await pushTokenRow(rotatedTo)) != null,
  );
  check(
    "the handset's original registration is untouched by the rotation",
    (await pushTokenRow(token)) != null,
  );
  const devices = await api("GET", "/push/devices", reporter.token);
  check(
    "the account can list its devices without seeing raw tokens",
    devices.status === 200
      && devices.json.devices.length === 2
      && devices.json.devices.every((d) => typeof d.tokenSuffix === "string" && d.tokenSuffix.length === 4 && !("token" in d))
      && devices.json.devices.every((d) => d.current === true),
    devices.json,
  );
  check(
    "another account never sees these devices",
    (await api("GET", "/push/devices", stranger.token)).json.devices?.length === 0,
  );
  await api("POST", "/push/tokens", reporter.token, { token: rotatedTo, platform: "android", deviceId, notificationsEnabled: false });
  await api("POST", "/push/tokens/unregister", reporter.token, { token: rotatedTo });

  console.log("\nNotification preferences");
  const defaults = await api("GET", "/notifications/preferences", reporter.token);
  check(
    "preferences default to everything on",
    defaults.status === 200 && Object.values(defaults.json.preferences).every((v) => v === true)
      && Object.keys(defaults.json.preferences).sort().join(",")
        === "calls,dealer,messages,payments,repair,showPreview,sound,status,vibration",
    defaults.json,
  );
  const updated = await api("PUT", "/notifications/preferences", reporter.token, { showPreview: false, sound: false });
  check(
    "a partial update changes only the named keys",
    updated.status === 200 && updated.json.preferences.showPreview === false
      && updated.json.preferences.sound === false && updated.json.preferences.messages === true,
    updated.json,
  );
  check(
    "a non-boolean preference is rejected",
    (await api("PUT", "/notifications/preferences", reporter.token, { sound: "loud" })).status === 400,
  );
  check(
    "preferences are per account",
    (await api("GET", "/notifications/preferences", stranger.token)).json.preferences.sound === true,
  );
  check(
    "anonymous callers cannot read preferences",
    (await api("GET", "/notifications/preferences", null)).status === 401,
  );
  await api("PUT", "/notifications/preferences", reporter.token, { showPreview: true, sound: true });

  console.log("\nTest notification");
  pushStub.reset();
  const testSend = await api("POST", "/push/test", reporter.token);
  check("a signed-in account can send itself a test push", testSend.status === 200 && testSend.json.deviceCount === 1, testSend.json);
  const testDelivered = await pushStub.waitForToken(token);
  check(
    "the test push reaches the device on the general channel",
    testDelivered.length === 1 && testDelivered[0].channelId === "avarpus_general" && testDelivered[0].data?.type === "push_test",
    testDelivered,
  );
  let limited = null;
  for (let i = 0; i < 6 && !limited; i++) {
    const attempt = await api("POST", "/push/test", reporter.token);
    if (attempt.status === 429) limited = attempt;
  }
  check("test pushes are rate limited", limited?.status === 429, limited?.json);
  await sleep(500);

  console.log("\nA settled report reaches a closed app");
  pushStub.reset();
  const firstReport = await seedReport({ reporter, reported, room, tag: "first" });
  const decision = await api("PATCH", `/chat/admin/reports/${firstReport}/status`, operator.token, {
    status: "dismissed",
  });
  check("the operator's decision is recorded", decision.status === 200, decision.json);

  const notification = await reviewNotification(reporter.userId);
  check("the reporter still gets an in-app row", notification != null);
  const delivered = await pushStub.waitForToken(token);
  check("the reporter's device is pushed", delivered.length === 1, delivered);
  const message = delivered[0] ?? {};
  check(
    "the push says exactly what the inbox row says",
    message.title === notification?.title && message.body === notification?.body,
    { push: { title: message.title, body: message.body }, row: notification },
  );
  check(
    "the push body stays outcome-neutral",
    typeof message.body === "string" && !/dismiss|action|ban|suspend|penal/i.test(message.body),
    message.body,
  );
  const rowDataKeys = new Set(Object.keys(notification?.data ?? {}));
  const extraKeys = Object.keys(message.data ?? {}).filter(
    (key) => key !== "type" && !rowDataKeys.has(key),
  );
  check("the push payload carries no detail the row lacks", extraKeys.length === 0, extraKeys);
  check(
    "no other device is pushed",
    pushStub.mine().every((sent) => sent.to === token),
    pushStub.mine().map((sent) => sent.to),
  );

  console.log("\nPush never gets in the way of the decision");
  pushStub.reset();
  pushStub.mode = "slow";
  pushStub.delayMs = 4000;
  const slowReport = await seedReport({ reporter, reported, room, tag: "slow" });
  const startedAt = Date.now();
  const slowDecision = await api(
    "PATCH",
    `/chat/admin/reports/${slowReport}/status`,
    operator.token,
    { status: "actioned" },
  );
  const elapsed = Date.now() - startedAt;
  check("a slow push provider does not delay the decision", elapsed < 1500, { elapsed });
  check("the decision still succeeds", slowDecision.status === 200, slowDecision.json);
  await sleep(pushStub.delayMs + 500);

  pushStub.reset();
  pushStub.mode = "http-error";
  const brokenReport = await seedReport({ reporter, reported, room, tag: "broken" });
  const brokenDecision = await api(
    "PATCH",
    `/chat/admin/reports/${brokenReport}/status`,
    operator.token,
    { status: "dismissed" },
  );
  check("a failing push provider does not fail the decision", brokenDecision.status === 200);
  check("the in-app row is still written", (await reviewNotification(reporter.userId)) != null);
  await pushStub.waitForToken(token, { tries: 20 });
  check("a provider outage does not discard the device", (await pushTokenRow(token)) != null);

  console.log("\nDead and re-used devices");
  pushStub.reset();
  pushStub.mode = "device-not-registered";
  const goneReport = await seedReport({ reporter, reported, room, tag: "gone" });
  const goneDecision = await api(
    "PATCH",
    `/chat/admin/reports/${goneReport}/status`,
    operator.token,
    { status: "dismissed" },
  );
  check("the decision succeeds for an uninstalled device", goneDecision.status === 200);
  check("a token the provider reports as gone is dropped", await waitForTokenGone(token));

  pushStub.reset();
  const sharedToken = expoToken("shared-device");
  await api("POST", "/push/tokens", reporter.token, { token: sharedToken, platform: "android" });
  await api("POST", "/push/tokens", stranger.token, { token: sharedToken, platform: "android" });
  const movedRow = await pushTokenRow(sharedToken);
  check(
    "a device signed in to another account stops carrying the first account's alerts",
    movedRow?.user_id === stranger.userId && (await pushTokenRows(reporter.userId)).length === 0,
    movedRow,
  );

  console.log("\nTokens end with the session");
  const signOutToken = expoToken("sign-out");
  const signOutSession = await seedSession(reporter.userId);
  await api("POST", "/push/tokens", signOutSession, { token: signOutToken, platform: "android" });
  check("the sign-out device is registered", (await pushTokenRow(signOutToken)) != null);
  check(
    "signing out drops the device token",
    (await api("POST", "/auth/logout", signOutSession)).status === 200
      && (await pushTokenRow(signOutToken)) == null,
  );

  const revokedToken = expoToken("revoked");
  const revokedSession = await seedSession(reporter.userId);
  const survivingSession = await seedSession(reporter.userId);
  await api("POST", "/push/tokens", revokedSession, { token: revokedToken, platform: "ios" });
  const survivingToken = expoToken("surviving");
  await api("POST", "/push/tokens", survivingSession, { token: survivingToken, platform: "ios" });
  const revokeResult = await api("POST", "/auth/sessions/revoke-others", survivingSession);
  check("revoking other sessions succeeds", revokeResult.status === 200, revokeResult.json);
  check("a revoked session's device stops receiving push", (await pushTokenRow(revokedToken)) == null);
  check(
    "the session that did the revoking keeps its device",
    (await pushTokenRow(survivingToken)) != null,
  );

  pushStub.reset();
  const expiredToken = expoToken("expired");
  const expiringSession = await seedSession(reporter.userId);
  await api("POST", "/push/tokens", expiringSession, { token: expiredToken, platform: "android" });
  await pool.query(
    `UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token = $1`,
    [expiringSession],
  );
  const expiredReport = await seedReport({ reporter, reported, room, tag: "expired" });
  const expiredDecision = await api(
    "PATCH",
    `/chat/admin/reports/${expiredReport}/status`,
    operator.token,
    { status: "dismissed" },
  );
  check("the decision succeeds when a device's session has expired", expiredDecision.status === 200);
  await sleep(1500);
  check(
    "a device whose session has expired is not pushed",
    pushStub.messages.every((sent) => sent.to !== expiredToken),
    pushStub.mine().map((sent) => sent.to),
  );

  const unregistered = await api("POST", "/push/tokens/unregister", survivingSession, {
    token: survivingToken,
  });
  check("a device can turn push off without signing out", unregistered.status === 200
    && (await pushTokenRow(survivingToken)) == null);
  check(
    "unregistering an unknown token is not an error",
    (await api("POST", "/push/tokens/unregister", survivingSession, { token: expoToken("never") }))
      .status === 200,
  );
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanupFixtures() {
  const pattern = `%${FIXTURE_MARKER}%`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM chat_reports WHERE client_request_id LIKE $1 OR details LIKE $1`,
      [pattern],
    );
    await client.query(
      `DELETE FROM chat_messages WHERE body LIKE $1 OR sender_name LIKE $1`,
      [pattern],
    );
    await client.query(
      `DELETE FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1`,
      [pattern],
    );
    // users cascades sessions, notifications and push_tokens.
    await client.query(`DELETE FROM users WHERE name LIKE $1 OR email LIKE $1`, [pattern]);
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
       SELECT 'push tokens', count(*)::int FROM push_tokens WHERE token LIKE $1
       UNION ALL
       SELECT 'rooms', count(*)::int
       FROM chat_rooms WHERE name LIKE $1 OR created_by_name LIKE $1
       UNION ALL
       SELECT 'messages', count(*)::int
       FROM chat_messages WHERE body LIKE $1 OR sender_name LIKE $1
       UNION ALL
       SELECT 'reports', count(*)::int
       FROM chat_reports WHERE client_request_id LIKE $1 OR details LIKE $1
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
  let stub;
  try {
    stub = await startPushStub();
    child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "test",
        EXPO_PUSH_API_URL: `http://localhost:${PUSH_STUB_PORT}/push`,
      },
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
    stub?.close();
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
  console.log("\nAll push delivery checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
