// End-to-end check for the chat media relay purge.
//
// The unit tests (src/lib/chatRelayPolicy.test.ts, chatRelayCleanup.test.ts)
// prove the purge decides and deletes correctly, and each client renders its
// own placeholder for a purged row. Nothing else drives one real photo through
// the whole life cycle. This script does: a sender uploads a photo through the
// API and sends it in a direct room, the recipient's phone acknowledges its
// stored copy, the purge runs with the operator switch on and a published
// critical release at the minimum build, and then every reader is checked at
// once — the media endpoint (410/404 with CHAT_MEDIA_EXPIRED), the messages
// list and delta sync the phone reads (mediaState=purged), the operator
// transcript endpoint (mediaState=purged), the Avarpus Web chats page ("open
// this chat on your phone" placeholder) and the update-admin transcript dialog
// (transcript-media-unavailable).
//
// The API under test talks to a local Matrix stub, never the real homeserver.
// The purge itself is the production module, bundled from src/ into this run's
// private directory with the server's own esbuild options. The web apps are
// built into the same directory (never the shared dist/public) and their
// same-origin /api requests are forwarded by the browser harness to the test
// API on this machine, so no build ever points at a production origin.
//
// Fixtures: every seeded row carries this run's marker; the operator switch and
// last-run summary in app_settings are snapshotted and restored, and the
// published critical release exists only for the seconds around the purge.
//
// Usage: node scripts/run-isolated.mjs scripts/test-chat-relay-purge-e2e.mjs
// Ports: 5691 (API), 5692 (Matrix stub), 5693 (web preview), 5694 (admin preview).
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import { bundleOptions } from "../build.mjs";
import { createChatFixtures } from "./lib/chat-fixtures.mjs";

const SERVER_ENTRY = process.env.API_SERVER_ENTRY ?? "./dist/index.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(scriptsDir, "..");
const workspaceRoot = path.resolve(artifactDir, "../..");
const webDir = path.join(workspaceRoot, "artifacts/avarpus-web");
const adminDir = path.join(workspaceRoot, "artifacts/update-admin");

const dbPkgDir = path.join(workspaceRoot, "lib/db");
const { Pool } = createRequire(path.join(dbPkgDir, "package.json"))("pg");
// The browser driver is a dev dependency of the admin console (its own browser
// check uses it); borrow it the same way the DB driver is borrowed from lib/db.
const { chromium } = createRequire(path.join(adminDir, "package.json"))("playwright-core");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}

const API_PORT = 5691;
const MATRIX_STUB_PORT = 5692;
const WEB_PORT = 5693;
const ADMIN_PORT = 5694;
const BASE = `http://127.0.0.1:${API_PORT}/api`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const ADMIN_ORIGIN = `http://127.0.0.1:${ADMIN_PORT}`;
const ADMIN_BASE_PATH = "/update-admin/";

const RUN_ID = randomBytes(8).toString("hex");
const FIXTURE_MARKER = `chat-relay-purge-${RUN_ID}`;
const RUN_DIR = path.join(artifactDir, "tmp/isolated-builds", `relay-e2e-${RUN_ID}`);

// Keys the purge reads and writes in app_settings. Kept as literals on purpose:
// they are asserted against the bundled module's exports below, so a rename in
// lib/db cannot leave this script silently toggling a key nobody reads.
const ENABLED_KEY = "chat_relay_cleanup_enabled";
const LAST_RUN_KEY = "chat_relay_last_run";

// Stand-in homeserver identity for the API under test. Every MATRIX_* variable
// is overridden so the real homeserver is never contacted.
const MATRIX_SERVER_NAME = "relay-e2e.test";
const MATRIX_AS_TOKEN = `as-${randomBytes(16).toString("hex")}`;
const MATRIX_HS_TOKEN = `hs-${randomBytes(16).toString("hex")}`;
const PROVIDER_ROOM_ID = `!relay-e2e-${RUN_ID}:${MATRIX_SERVER_NAME}`;

// A real 1×1 PNG: the send path sniffs the leading bytes of an "image" upload.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const {
  marked,
  seedUser,
  seedShop,
  ownerSession,
  seedDirectRoom,
  seedReport,
  cleanupFixtures,
  verifyFixtureCleanup,
} = createChatFixtures({ pool, marker: FIXTURE_MARKER });

let failures = 0;

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

async function fetchMedia(roomId, messageId, token) {
  const response = await fetch(`${BASE}/chat/rooms/${roomId}/messages/${messageId}/media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { status: response.status, json: await response.json().catch(() => ({})) };
  }
  return { status: response.status, contentType, bytes: Buffer.from(await response.arrayBuffer()) };
}

// ── Matrix stub ─────────────────────────────────────────────────────────────
// Only the send endpoint is implemented. Anything else is answered like an
// unknown Matrix endpoint and logged, so a new provider call in the send path
// shows up here instead of silently reaching a homeserver.
const matrixStub = { sends: [], unexpected: [] };

function startMatrixStub() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${MATRIX_STUB_PORT}`);
      const send = url.pathname.match(
        /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/m\.room\.message\/([^/]+)$/,
      );
      if (req.method === "PUT" && send) {
        let content = null;
        try {
          content = JSON.parse(raw);
        } catch {
          content = null;
        }
        matrixStub.sends.push({
          roomId: decodeURIComponent(send[1]),
          txnId: decodeURIComponent(send[2]),
          userId: url.searchParams.get("user_id"),
          authorized: req.headers.authorization === `Bearer ${MATRIX_AS_TOKEN}`,
          content,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ event_id: `$relay-e2e-${randomUUID()}` }));
        return;
      }
      matrixStub.unexpected.push(`${req.method} ${url.pathname}`);
      console.error(`  matrix stub: unexpected ${req.method} ${url.pathname}`);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ errcode: "M_UNRECOGNIZED", error: "Unrecognized request" }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MATRIX_STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ── Processes ───────────────────────────────────────────────────────────────
function pipeOutput(child, label) {
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output += chunk;
    });
  }
  return () => (output.trim() ? `\n--- ${label} output ---\n${output.trim()}` : "");
}

function runCommand(command, args, { cwd, env, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = pipeOutput(child, label);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}${output()}`));
    });
  });
}

async function waitForHttp(url, { child, label, attempts = 480 }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

// ── Builds ──────────────────────────────────────────────────────────────────
// The production purge module, bundled exactly like the server (same options,
// same externals) into this run's directory. Importing src/ directly is not an
// option from a plain Node script, and a copy of the logic would prove nothing.
async function bundlePurgeHarness() {
  const outdir = path.join(RUN_DIR, "purge");
  await mkdir(outdir, { recursive: true });
  await esbuild({
    ...bundleOptions({
      entryPoints: [path.join(scriptsDir, "lib/chat-relay-purge-harness.ts")],
      outdir,
    }),
    logLevel: "warning",
  });
  return import(pathToFileURL(path.join(outdir, "chat-relay-purge-harness.mjs")).href);
}

function buildWebApp() {
  return runCommand(
    "pnpm",
    ["exec", "vite", "build", "--config", "vite.config.ts", "--outDir", path.join(RUN_DIR, "web"), "--emptyOutDir"],
    {
      cwd: webDir,
      label: "avarpus-web build",
      env: {
        NODE_ENV: "production",
        PORT: String(WEB_PORT),
        BASE_PATH: "/",
        // The app calls its own preview origin; the browser harness forwards
        // those requests to the test API. No fallback origin: the check must
        // fail, not fail over, if the forwarding breaks.
        VITE_API_URL: WEB_ORIGIN,
        VITE_API_FALLBACK_URL: "",
      },
    },
  );
}

function buildAdminApp() {
  return runCommand(
    "pnpm",
    ["exec", "vite", "build", "--config", "vite.config.ts", "--outDir", path.join(RUN_DIR, "admin"), "--emptyOutDir"],
    {
      cwd: adminDir,
      label: "update-admin build",
      env: { NODE_ENV: "production", PORT: String(ADMIN_PORT), BASE_PATH: ADMIN_BASE_PATH },
    },
  );
}

function startPreview({ cwd, outDir, port, basePath, extraEnv = {} }) {
  const child = spawn(
    "pnpm",
    [
      "exec", "vite", "preview", "--config", "vite.config.ts",
      "--outDir", outDir, "--host", "127.0.0.1", "--strictPort",
    ],
    {
      cwd,
      env: { ...process.env, NODE_ENV: "production", PORT: String(port), BASE_PATH: basePath, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.output = pipeOutput(child, `preview :${port}`);
  return child;
}

// ── Operator settings ───────────────────────────────────────────────────────
async function snapshotSettings(keys) {
  const { rows } = await pool.query(
    `SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = ANY($1::text[])`,
    [keys],
  );
  return new Map(rows.map((row) => [row.key, row]));
}

async function restoreSettings(snapshot, keys) {
  for (const key of keys) {
    const before = snapshot.get(key);
    if (before) {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [key, before.value, before.updated_by, before.updated_at],
      );
    } else {
      await pool.query(`DELETE FROM app_settings WHERE key = $1`, [key]);
    }
  }
}

// ── Browser checks ──────────────────────────────────────────────────────────
// The static builds call /api on their own origin; forward those to the test
// API. Playwright performs the forwarded request itself, so the page keeps its
// same-origin view and CORS never enters the picture.
async function forwardApiToTestServer(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const target = `http://127.0.0.1:${API_PORT}${url.pathname}${url.search}`;
    try {
      const response = await route.fetch({ url: target });
      await route.fulfill({ response });
    } catch (error) {
      console.error(`  forward failed for ${target}: ${error.message}`);
      await route.abort();
    }
  });
}

async function checkWebPlaceholder(browser, { token, messageId }) {
  const context = await browser.newContext();
  try {
    await context.addInitScript((value) => localStorage.setItem("avarpus_auth_token", value), token);
    const page = await context.newPage();
    page.setDefaultTimeout(180_000);
    page.on("pageerror", (error) => console.error(`  web page error: ${error.message}`));
    await forwardApiToTestServer(page);
    await page.goto(`${WEB_ORIGIN}/chats`);
    const placeholder = page.getByTestId(`text-media-unavailable-${messageId}`);
    let placeholderText = null;
    try {
      await placeholder.waitFor();
      placeholderText = (await placeholder.textContent())?.replace(/\s+/g, " ").trim() ?? "";
    } catch (error) {
      console.error(`  web URL: ${page.url()}`);
      console.error(`  web body: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 800)}`);
      throw error;
    }
    check(
      "web: chats page renders the purged photo as an 'open on your phone' placeholder",
      placeholderText.startsWith("Photo") && /open this chat on your phone/i.test(placeholderText),
      placeholderText,
    );
    check(
      "web: the purged photo is not offered as a live attachment",
      (await page.getByTestId(`text-media-attached-${messageId}`).count()) === 0,
    );
  } finally {
    await context.close();
  }
}

async function checkAdminTranscript(browser, { token, reporterName }) {
  const context = await browser.newContext();
  try {
    await context.addInitScript((value) => localStorage.setItem("auth_token", value), token);
    const page = await context.newPage();
    page.setDefaultTimeout(180_000);
    page.on("pageerror", (error) => console.error(`  admin page error: ${error.message}`));
    await forwardApiToTestServer(page);
    await page.goto(`${ADMIN_ORIGIN}${ADMIN_BASE_PATH}chat-reports`);
    let placeholderText = null;
    try {
      await page.getByRole("heading", { name: "Chat Reports" }).waitFor();
      await page.getByLabel("Search reports").fill(reporterName);
      await page.getByRole("button", { name: "View conversation" }).first().click();
      const dialog = page.getByRole("dialog");
      const placeholder = dialog.getByTestId("transcript-media-unavailable");
      await placeholder.waitFor();
      placeholderText = (await placeholder.textContent())?.replace(/\s+/g, " ").trim() ?? "";
      check(
        "admin: transcript dialog does not present the purged photo as attached",
        (await dialog.getByTestId("transcript-media-attached").count()) === 0,
      );
    } catch (error) {
      console.error(`  admin URL: ${page.url()}`);
      console.error(`  admin body: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 800)}`);
      throw error;
    }
    check(
      "admin: transcript dialog shows transcript-media-unavailable for the purged photo",
      /^image attachment — media no longer available \(removed from the relay after delivery\)$/.test(placeholderText),
      placeholderText,
    );
  } finally {
    await context.close();
  }
}

// ── The scenario ────────────────────────────────────────────────────────────
async function run({ purge, webBuild, adminBuild }) {
  const state = {
    appUpdateId: null,
    objectPath: null,
    roomId: null,
    storage: null,
    settingsBefore: null,
    settingsSnapshot: null,
    settingsKeys: [ENABLED_KEY, LAST_RUN_KEY],
  };
  // Read before anything else so cleanup can prove the operator's settings
  // were left alone even when the run aborts early.
  state.settingsBefore = await snapshotSettings(state.settingsKeys);

  check(
    "harness: bundled purge module exposes the production entry points",
    typeof purge.runChatRelayCleanup === "function"
      && typeof purge.readChatRelayPolicy === "function"
      && typeof purge.readMinimumSupportedAppBuild === "function"
      && Number.isInteger(purge.CHAT_RELAY_MIN_APP_BUILD),
    Object.keys(purge),
  );
  const storage = new purge.ObjectStorageService();
  state.storage = storage;

  try {
    // People: the sender is a shop owner, the recipient a customer account (the
    // "phone" whose stored copy licenses the purge), the operator a super_admin.
    const shop = await seedShop("sender");
    const sender = await ownerSession(shop.ownerId);
    const recipient = await seedUser({ tag: "recipient", role: "customer" });
    const operator = await seedUser({ tag: "operator", role: "super_admin" });
    const room = await seedDirectRoom({
      memberIds: [shop.ownerId, recipient.userId],
      tag: "room",
      providerRoomId: PROVIDER_ROOM_ID,
    });
    state.roomId = room.roomId;

    console.log("send: upload a photo and send it through the API");
    const uploadTicket = await api("POST", `/chat/rooms/${room.roomId}/upload-url`, sender.token, {
      name: "purge-e2e.png",
      size: PNG_BYTES.length,
      contentType: "image/png",
    });
    check("send: upload URL issued", uploadTicket.status === 200 && !!uploadTicket.json.uploadURL, uploadTicket);
    state.objectPath = uploadTicket.json.objectPath;
    const put = await fetch(uploadTicket.json.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: PNG_BYTES,
    });
    check("send: photo bytes stored", put.ok, { status: put.status, body: await put.text().catch(() => "") });

    const clientRequestId = marked(randomUUID());
    const sent = await api("POST", `/chat/rooms/${room.roomId}/messages`, sender.token, {
      clientRequestId,
      kind: "image",
      body: "purge-e2e.png",
      objectPath: state.objectPath,
    });
    const message = sent.json.message;
    check(
      "send: image message accepted with an available relay copy",
      (sent.status === 200 || sent.status === 201)
        && message?.kind === "image"
        && message?.objectPath === state.objectPath
        && message?.mediaState === "available"
        && message?.sizeBytes === PNG_BYTES.length,
      sent,
    );
    if (!message?.id) throw new Error("send failed; nothing to purge");
    const messageId = message.id;
    check(
      "send: the API delivered the event to the (stubbed) homeserver with the appservice token",
      matrixStub.sends.length === 1
        && matrixStub.sends[0].roomId === PROVIDER_ROOM_ID
        && matrixStub.sends[0].authorized
        && matrixStub.sends[0].content?.msgtype === "m.image"
        && matrixStub.unexpected.length === 0,
      matrixStub,
    );

    const senderMedia = await fetchMedia(room.roomId, messageId, sender.token);
    const recipientMedia = await fetchMedia(room.roomId, messageId, recipient.token);
    check(
      "before: media endpoint serves the photo bytes to both members",
      senderMedia.status === 200
        && recipientMedia.status === 200
        && recipientMedia.contentType.startsWith("image/png")
        && recipientMedia.bytes.equals(PNG_BYTES),
      { sender: senderMedia.status, recipient: recipientMedia.status, type: recipientMedia.contentType },
    );

    console.log("ack: the recipient's phone reports its stored copy");
    const ack = await api("POST", "/chat/acks", recipient.token, {
      acks: [{ messageId, state: "stored" }],
    });
    check(
      "ack: stored receipt accepted",
      ack.status === 200 && ack.json.acknowledged?.includes(messageId),
      ack,
    );
    const { rows: receiptRows } = await pool.query(
      `SELECT stored_at FROM chat_message_receipts WHERE message_id = $1 AND user_id = $2`,
      [messageId, recipient.userId],
    );
    check("ack: receipt row carries stored_at", receiptRows.length === 1 && receiptRows[0].stored_at !== null, receiptRows);
    const senderView = await api("GET", `/chat/rooms/${room.roomId}/messages`, sender.token);
    const senderCopy = (senderView.json.messages ?? []).find((row) => row.id === messageId);
    check(
      "ack: sender sees the message as stored on the recipient's device",
      senderView.status === 200 && !!senderCopy?.delivery?.storedAt,
      senderCopy?.delivery ?? senderView,
    );

    // Purge conditions: the grace period after the last stored receipt has
    // passed (the message is aged rather than the clock moved, because the
    // candidate query compares against the database clock), the operator
    // switch is on, and a published critical release meets the minimum build.
    const policy = await purge.readChatRelayPolicy();
    check("purge: operator switch is off before this run touches it", policy.enabled === false, policy);
    await pool.query(
      `UPDATE chat_messages SET created_at = now() - ($2 || ' days')::interval WHERE id = $1`,
      [messageId, String(policy.graceDays + 1)],
    );

    state.settingsSnapshot = await snapshotSettings(state.settingsKeys);
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, 'true', NULL, now())
       ON CONFLICT (key) DO UPDATE SET value = 'true', updated_by = NULL, updated_at = now()`,
      [ENABLED_KEY],
    );
    const enabledPolicy = await purge.readChatRelayPolicy();
    check("purge: production policy reader sees the switch on", enabledPolicy.enabled === true, enabledPolicy);

    const { rows: [appUpdate] } = await pool.query(
      `INSERT INTO app_updates
         (version, build_number, update_type, status, published_at, release_notes)
       VALUES ($1, $2, 'critical', 'published', now(), $3::jsonb)
       RETURNING id`,
      [
        `0.0.0-${marked("relay-e2e")}`,
        purge.CHAT_RELAY_MIN_APP_BUILD,
        JSON.stringify([`Fixture for ${FIXTURE_MARKER}; safe to delete.`]),
      ],
    );
    state.appUpdateId = appUpdate.id;
    const minimumBuild = await purge.readMinimumSupportedAppBuild();
    check(
      `purge: minimum supported build meets the relay guard (${purge.CHAT_RELAY_MIN_APP_BUILD})`,
      Number.isInteger(minimumBuild) && minimumBuild >= purge.CHAT_RELAY_MIN_APP_BUILD,
      minimumBuild,
    );

    console.log("purge: run the production relay purge on this room");
    let result;
    try {
      // The room's photo is this run's own fixture, so the purge may delete it
      // even though this process is not the production deployment.
      result = await purge.runChatRelayCleanup({
        roomIds: [room.roomId],
        storageSweeps: { enabled: true, reason: "OBJECT_STORAGE_SWEEPS=on" },
      });
    } finally {
      // Shrink the window in which the dev database advertises a fixture
      // release and an enabled purge, whatever the run did.
      await pool.query(`DELETE FROM app_updates WHERE id = $1`, [state.appUpdateId]);
      state.appUpdateId = null;
      await restoreSettings(state.settingsSnapshot, state.settingsKeys);
      state.settingsSnapshot = null;
    }
    check(
      "purge: exactly this photo was purged after its stored receipt",
      result.skipped === null
        && result.abortedError === null
        && result.purged === 1
        && result.expired === 0
        && result.failed === 0
        && result.alreadyGone === 0
        && result.bytesReclaimed === PNG_BYTES.length,
      result,
    );

    console.log("after: every reader of the row");
    let objectGone = false;
    try {
      await storage.getObjectEntityFile(state.objectPath);
    } catch (error) {
      objectGone = error instanceof purge.ObjectNotFoundError;
      if (!objectGone) throw error;
    }
    check("after: relay object no longer exists in storage", objectGone);
    if (objectGone) state.objectPath = null;

    const { rows: [dbRow] } = await pool.query(
      `SELECT media_state, media_pinned, object_path, deleted_at FROM chat_messages WHERE id = $1`,
      [messageId],
    );
    check(
      "after: row is permanent — purged state, path kept, not deleted",
      dbRow?.media_state === "purged" && dbRow.media_pinned === false && dbRow.object_path !== null && dbRow.deleted_at === null,
      dbRow,
    );

    const goneForRecipient = await fetchMedia(room.roomId, messageId, recipient.token);
    const goneForSender = await fetchMedia(room.roomId, messageId, sender.token);
    check(
      "after: media endpoint answers 404 CHAT_MEDIA_EXPIRED with mediaState=purged",
      [goneForRecipient, goneForSender].every(
        (reply) => reply.status === 404 && reply.json?.code === "CHAT_MEDIA_EXPIRED" && reply.json?.mediaState === "purged",
      ),
      { recipient: goneForRecipient, sender: goneForSender },
    );

    const recipientList = await api("GET", `/chat/rooms/${room.roomId}/messages`, recipient.token);
    const listedRow = (recipientList.json.messages ?? []).find((row) => row.id === messageId);
    check(
      "after: messages list reports mediaState=purged and still names the attachment",
      recipientList.status === 200 && listedRow?.mediaState === "purged" && listedRow?.objectPath === dbRow.object_path,
      listedRow ?? recipientList,
    );

    const sync = await api("GET", `/chat/sync?roomId=${room.roomId}`, recipient.token);
    const syncedRow = (sync.json.messages ?? []).find((row) => row.id === messageId);
    check(
      "after: delta sync (what the phone reads) reports mediaState=purged",
      sync.status === 200 && syncedRow?.mediaState === "purged",
      syncedRow ?? sync,
    );

    // The complaint is filed after the purge: an open report pins media and
    // would have blocked it. The operator must still be told what happened.
    const report = await seedReport({
      reporter: recipient,
      reported: sender,
      room,
      reason: "harassment",
      details: `Sent an unwanted photo ${marked("details")}`,
      ageMinutes: 1,
      messageId,
    });
    const transcript = await api("GET", `/chat/admin/reports/${report.id}/transcript`, operator.token);
    const transcriptRow = (transcript.json.messages ?? []).find((row) => row.id === messageId);
    check(
      "after: operator transcript endpoint reports the attachment as purged",
      transcript.status === 200
        && transcriptRow?.hasAttachment === true
        && transcriptRow?.mediaState === "purged"
        && transcriptRow?.isReportedMessage === true,
      transcriptRow ?? transcript,
    );
    const { rows: [afterReport] } = await pool.query(
      `SELECT media_state, media_pinned FROM chat_messages WHERE id = $1`,
      [messageId],
    );
    check(
      "after: a later report pins nothing back — the row stays purged",
      afterReport?.media_state === "purged",
      afterReport,
    );

    console.log("browser: the web app and the operator console");
    await Promise.all([webBuild, adminBuild]);
    const webPreview = startPreview({
      cwd: webDir,
      outDir: path.join(RUN_DIR, "web"),
      port: WEB_PORT,
      basePath: "/",
      extraEnv: { VITE_API_URL: WEB_ORIGIN, VITE_API_FALLBACK_URL: "" },
    });
    const adminPreview = startPreview({
      cwd: adminDir,
      outDir: path.join(RUN_DIR, "admin"),
      port: ADMIN_PORT,
      basePath: ADMIN_BASE_PATH,
    });
    let browser;
    try {
      await Promise.all([
        waitForHttp(`${WEB_ORIGIN}/`, { child: webPreview, label: "web preview" }),
        waitForHttp(`${ADMIN_ORIGIN}${ADMIN_BASE_PATH}`, { child: adminPreview, label: "admin preview" }),
      ]);
      browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
        headless: true,
        args: ["--no-sandbox"],
      });
      await checkWebPlaceholder(browser, { token: recipient.token, messageId });
      await checkAdminTranscript(browser, { token: operator.token, reporterName: recipient.name });
    } catch (error) {
      console.error(webPreview.output());
      console.error(adminPreview.output());
      throw error;
    } finally {
      await browser?.close().catch(() => undefined);
      await Promise.all([stopProcess(webPreview), stopProcess(adminPreview)]);
    }
  } finally {
    await cleanup(state);
  }
}

async function cleanup(state) {
  console.log("cleanup");
  if (state.appUpdateId) {
    await pool.query(`DELETE FROM app_updates WHERE id = $1`, [state.appUpdateId]);
  }
  if (state.settingsSnapshot) await restoreSettings(state.settingsSnapshot, state.settingsKeys);
  if (state.objectPath && state.storage) {
    // Only reached when the purge did not remove the object (a failed run).
    try {
      const file = await state.storage.getObjectEntityFile(state.objectPath);
      await file.delete();
    } catch {
      // Best effort; the abandoned-upload sweep reclaims stragglers.
    }
  }
  await cleanupFixtures();
  await verifyFixtureCleanup();
  const { rows: [leftovers] } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM app_updates WHERE version LIKE $1) AS app_updates,
       (SELECT count(*)::int FROM pending_uploads WHERE object_path LIKE $2) AS pending_uploads`,
    [`%${FIXTURE_MARKER}%`, state.roomId ? `%/chat/${state.roomId}/%` : "relay-e2e-no-room"],
  );
  check(
    "cleanup: no fixture release or pending upload remains",
    leftovers.app_updates === 0 && leftovers.pending_uploads === 0,
    leftovers,
  );
  const settingsNow = await snapshotSettings(state.settingsKeys);
  const describe = (snapshot) =>
    Object.fromEntries(state.settingsKeys.map((key) => [key, snapshot?.get(key)?.value ?? null]));
  const now = describe(settingsNow);
  const wanted = describe(state.settingsBefore);
  check(
    "cleanup: operator switch and last-run summary left exactly as found",
    state.settingsKeys.every((key) => now[key] === wanted[key]),
    { now, before: wanted },
  );
}

async function main() {
  let child;
  let stub;
  let exitCode = 1;
  await mkdir(RUN_DIR, { recursive: true });
  try {
    // Kick the slow builds off first; the API-level steps run alongside them.
    // The two builds run one after the other: this step shares the machine
    // with the other validation steps, and two concurrent bundlers plus a
    // browser is the kind of peak that starves everything under memory
    // pressure. A rejected build must surface where it is awaited, not as an
    // unhandled rejection while the API steps are still running.
    const webBuild = buildWebApp();
    webBuild.catch(() => undefined);
    const adminBuild = webBuild.then(() => buildAdminApp());
    adminBuild.catch(() => undefined);

    const purge = await bundlePurgeHarness();
    stub = await startMatrixStub();
    child = spawn("node", ["--enable-source-maps", SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(API_PORT),
        NODE_ENV: "test",
        MATRIX_BASE_URL: `http://127.0.0.1:${MATRIX_STUB_PORT}`,
        MATRIX_SERVER_NAME,
        MATRIX_APP_SERVICE_TOKEN: MATRIX_AS_TOKEN,
        MATRIX_HOMESERVER_TOKEN: MATRIX_HS_TOKEN,
        MATRIX_APP_SERVICE_URL: `http://127.0.0.1:${MATRIX_STUB_PORT}/appservice`,
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    await waitForHttp(`${BASE}/healthz`, { child, label: "API server", attempts: 240 });
    await run({ purge, webBuild, adminBuild });
    exitCode = failures === 0 ? 0 : 1;
    console.log(failures === 0 ? "\nAll relay purge end-to-end checks passed" : `\n${failures} check(s) failed`);
  } catch (error) {
    console.error(`\nrelay purge end-to-end check aborted: ${error?.stack ?? error}`);
    exitCode = 1;
  } finally {
    await stopProcess(child);
    stub?.close();
    await rm(RUN_DIR, { recursive: true, force: true }).catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
  // The bundled purge module keeps a logger worker and a DB pool alive.
  process.exit(exitCode);
}

main();
