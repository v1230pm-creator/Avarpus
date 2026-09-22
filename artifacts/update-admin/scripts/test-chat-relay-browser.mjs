// Browser regression check for the chat relay storage trend on the Settings
// page.
//
// It proves the page reads the bounded run history, folds it into the chosen
// range (reclaimed total, collected-vs-expired share, what the relay still
// holds and how that compares with the oldest measurement in range), warns
// when removed media had mostly expired uncollected, draws one bar per local
// day, and refreshes the trend after an operator's "Run now".
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = 5685;
const origin = `http://127.0.0.1:${port}`;
const appBase = `${origin}/update-admin`;
const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const requestsSeen = [];
let role = "super_admin";

// Runs are timestamped at local noon N days ago, so a bucket never straddles a
// day boundary whatever the machine's timezone.
function daysAgo(days) {
  const at = new Date();
  at.setHours(12, 0, 0, 0);
  return new Date(at.getTime() - days * DAY_MS);
}
function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function makeRun(overrides) {
  return {
    id: `run-${Math.random().toString(36).slice(2, 10)}`,
    ranAt: daysAgo(1).toISOString(),
    trigger: "scheduled",
    skipped: null,
    graceDays: 7,
    expiryDays: 30,
    examined: 40,
    purged: 0,
    expired: 0,
    alreadyGone: 0,
    tombstonesPurged: 0,
    kept: 10,
    raced: 0,
    failed: 0,
    bytesReclaimed: 0,
    abortedError: null,
    heldObjects: 100,
    heldBytes: 30 * MB,
    ...overrides,
  };
}

const runYesterday = makeRun({ id: "run-yesterday", ranAt: daysAgo(1).toISOString(), purged: 8, expired: 2, bytesReclaimed: 8 * MB, heldObjects: 120, heldBytes: 40 * MB });
const runThreeDays = makeRun({ id: "run-3d", ranAt: daysAgo(3).toISOString(), purged: 4, expired: 6, bytesReclaimed: 5 * MB, heldObjects: 140, heldBytes: 48 * MB });
const runAborted = makeRun({ id: "run-5d", ranAt: daysAgo(5).toISOString(), purged: 0, expired: 0, tombstonesPurged: 1, failed: 1, bytesReclaimed: 1 * MB, abortedError: "relay object /objects/x could not be deleted", heldObjects: 160, heldBytes: 55 * MB });
const runExpiredHeavy = makeRun({ id: "run-12d", ranAt: daysAgo(12).toISOString(), purged: 0, expired: 20, bytesReclaimed: 30 * MB, heldObjects: 300, heldBytes: 90 * MB });
const runDisabled = makeRun({ id: "run-20d", ranAt: daysAgo(20).toISOString(), skipped: "disabled", tombstonesPurged: 3, bytesReclaimed: 300 * 1024, heldObjects: 300, heldBytes: 95 * MB });
const runBlocked = makeRun({ id: "run-45d", ranAt: daysAgo(45).toISOString(), skipped: "min_build_not_met", heldObjects: 260, heldBytes: 80 * MB });

// Newest first, as the server returns them.
const runs = [runYesterday, runThreeDays, runAborted, runExpiredHeavy, runDisabled, runBlocked];
const held = { objects: 100, bytes: 30 * MB, unknownSizeObjects: 3, pinnedObjects: 2, pinnedBytes: 1 * MB };

function settingsBody() {
  return {
    enabled: true,
    graceDays: 7,
    expiryDays: 30,
    requiredAppBuild: 120,
    minimumSupportedBuild: 125,
    canEnable: true,
    enableBlockedReason: null,
    updatedAt: daysAgo(30).toISOString(),
    updatedByName: "Browser Admin",
    lastRun: {
      ranAt: runs[0].ranAt,
      skipped: null,
      skippedReason: null,
      examined: runs[0].examined,
      purged: runs[0].purged,
      expired: runs[0].expired,
      alreadyGone: 0,
      tombstonesPurged: 0,
      kept: runs[0].kept,
      failed: 0,
      bytesReclaimed: runs[0].bytesReclaimed,
      abortedError: null,
    },
  };
}

function json(route, body, statusCode = 200) {
  return route.fulfill({
    status: statusCode,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function waitForServer(child) {
  // Validation runs this suite alongside other builds, so the preview can take
  // far longer to answer here than in an idle workspace.
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Admin preview exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${appBase}/`);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for the admin preview");
}

async function installApiFixture(page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requestsSeen.push(`${request.method()} ${url.pathname}${url.search}`);

    if (url.pathname === "/api/auth/me") {
      return json(route, {
        user: {
          id: "admin-user",
          name: role === "super_admin" ? "Browser Admin" : "Browser Dealer",
          email: "browser-admin@example.test",
          mobile: "9000000000",
          role,
          isActive: true,
        },
      });
    }
    if (url.pathname === "/api/notifications" && request.method() === "GET") {
      return json(route, { notifications: [], nextCursor: null });
    }
    if (url.pathname === "/api/auth/sessions" && request.method() === "GET") {
      return json(route, { sessions: [] });
    }
    if (url.pathname === "/api/settings/support-notifications" && request.method() === "GET") {
      return json(route, { recipientEmail: null, updatedAt: null, updatedByName: null, senderConfigured: false });
    }
    if (url.pathname === "/api/settings/chat-relay" && request.method() === "GET") {
      return json(route, settingsBody());
    }
    if (url.pathname === "/api/settings/chat-relay/history" && request.method() === "GET") {
      return json(route, {
        windowDays: 90,
        maxRuns: 500,
        generatedAt: new Date().toISOString(),
        held,
        runs,
      });
    }
    if (url.pathname === "/api/settings/chat-relay/run" && request.method() === "POST") {
      // A manual whole-relay run lands in the history immediately.
      const manual = makeRun({
        id: "run-manual",
        ranAt: new Date().toISOString(),
        trigger: "manual",
        purged: 2,
        expired: 0,
        bytesReclaimed: 2 * MB,
        heldObjects: 98,
        heldBytes: 28 * MB,
      });
      runs.unshift(manual);
      held.objects = 98;
      held.bytes = 28 * MB;
      return json(route, {
        result: {
          ranAt: manual.ranAt,
          skipped: null,
          skippedReason: null,
          examined: manual.examined,
          purged: manual.purged,
          expired: manual.expired,
          alreadyGone: 0,
          tombstonesPurged: 0,
          kept: manual.kept,
          failed: 0,
          bytesReclaimed: manual.bytesReclaimed,
          abortedError: null,
        },
        settings: settingsBody(),
      });
    }

    return json(route, { message: `Unhandled fixture route: ${request.method()} ${url.pathname}` }, 500);
  });
}

const historyRequests = () =>
  requestsSeen.filter((entry) => entry === "GET /api/settings/chat-relay/history").length;

async function run() {
  // run-browser-suites.mjs builds once into a private directory and points every
  // suite at it; a by-hand run without UPDATE_ADMIN_BUILD_DIR serves dist/public.
  const buildDir = process.env.UPDATE_ADMIN_BUILD_DIR;
  const preview = spawn(
    "pnpm",
    [
      "exec", "vite", "preview", "--config", "vite.config.ts",
      "--host", "127.0.0.1", "--strictPort",
      ...(buildDir ? ["--outDir", buildDir] : []),
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT: String(port), BASE_PATH: "/update-admin/" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let previewErrors = "";
  preview.stderr.on("data", (chunk) => {
    previewErrors += chunk;
  });

  let browser;
  try {
    await waitForServer(preview);
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });

    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    await adminContext.addInitScript(() => localStorage.setItem("auth_token", "browser-admin-token"));
    const page = await adminContext.newPage();
    // Validation runs this alongside other builds and test suites, so first
    // paint can be far slower here than in an idle workspace.
    page.setDefaultTimeout(180_000);
    page.on("console", (message) => console.log(`browser console: ${message.type()} ${message.text()}`));
    page.on("pageerror", (error) => console.error(`browser error: ${error.message}`));
    await installApiFixture(page);

    await page.goto(`${appBase}/settings`);
    try {
      await page.getByRole("heading", { name: "Settings" }).waitFor();
    } catch (error) {
      console.error(`browser URL: ${page.url()}`);
      throw error;
    }

    const trend = page.locator('[data-testid="card-chat-relay-trend"]');
    const reclaimed = trend.locator('[data-testid="text-relay-trend-reclaimed"]');
    const ratio = trend.locator('[data-testid="text-relay-trend-ratio"]');
    const heldTile = trend.locator('[data-testid="text-relay-trend-held"]');
    const warning = trend.locator('[data-testid="text-relay-trend-uncollected-warning"]');
    const chart = trend.locator('[data-testid="chart-relay-trend"]');
    const table = trend.locator('[data-testid="table-relay-trend-runs"]');

    // Default range is 30 days: five of the six runs are inside it.
    await assert.doesNotReject(() => reclaimed.getByText("44.3 MB").waitFor());
    assert.equal(historyRequests(), 1, requestsSeen.join("\n"));
    assert.match(await reclaimed.innerText(), /44 files removed across 5 runs/);
    assert.match(await reclaimed.innerText(), /1 run stopped early/);
    // 12 collected vs 28 expired: the relay only shrank because of the hard cap.
    assert.match(await ratio.innerText(), /30%\s*collected\s*·\s*70%\s*expired/);
    assert.match(await ratio.innerText(), /12 removed after every recipient stored it/);
    await assert.doesNotReject(() => warning.waitFor());
    assert.match(await warning.innerText(), /had not been collected by every recipient/);

    // What the relay holds now, honestly labelled, compared with the oldest
    // measurement in range (95 MB / 300 files after the switched-off run).
    const heldText = await heldTile.innerText();
    assert.match(heldText, /30\.0 MB/);
    assert.match(heldText, /100 files/);
    assert.match(heldText, /2 files \(1\.0 MB\) kept as report evidence/);
    assert.match(heldText, /3 older files without a recorded size/);
    const delta = heldTile.locator('[data-testid="text-relay-trend-held-delta"]');
    assert.match(await delta.innerText(), /▼ 65\.0 MB smaller than after the run on/);
    assert.match(await delta.innerText(), /−200 files/);

    // One bar per local day, in the operator's timezone; run days carry their
    // bytes and the day a run stopped early is marked.
    await chart.waitFor();
    assert.equal(await chart.locator('[data-testid^="bar-relay-trend-"]').count(), 30);
    const yesterdayBar = chart.locator(`[data-testid="bar-relay-trend-${localDayKey(daysAgo(1))}"]`);
    assert.equal(await yesterdayBar.getAttribute("data-bytes"), String(8 * MB));
    assert.equal(await yesterdayBar.getAttribute("data-runs"), "1");
    const abortedBar = chart.locator(`[data-testid="bar-relay-trend-${localDayKey(daysAgo(5))}"]`);
    assert.equal(await abortedBar.locator(".bg-destructive").count(), 1);
    const quietBar = chart.locator(`[data-testid="bar-relay-trend-${localDayKey(daysAgo(2))}"]`);
    assert.equal(await quietBar.getAttribute("data-runs"), "0");
    assert.equal(await quietBar.locator("div").count(), 0);
    // The 45-day-old run is outside the default range entirely.
    assert.equal(await chart.locator(`[data-testid="bar-relay-trend-${localDayKey(daysAgo(45))}"]`).count(), 0);
    assert.equal(await table.locator("tbody tr").count(), 5);
    if (process.env.RELAY_TREND_SCREENSHOT) {
      await trend.screenshot({ path: process.env.RELAY_TREND_SCREENSHOT });
    }

    // Narrowing to 7 days recomputes everything locally (no new request) and
    // the warning goes away because collected media dominates that week.
    await trend.locator('[data-testid="toggle-relay-trend-range-7"]').click();
    await assert.doesNotReject(() => reclaimed.getByText("14.0 MB").waitFor());
    assert.match(await ratio.innerText(), /60%\s*collected\s*·\s*40%\s*expired/);
    await warning.waitFor({ state: "hidden" });
    assert.equal(await chart.locator('[data-testid^="bar-relay-trend-"]').count(), 7);
    assert.equal(await table.locator("tbody tr").count(), 3);
    assert.match(await delta.innerText(), /▼ 25\.0 MB smaller than after the run on/);
    assert.equal(historyRequests(), 1, requestsSeen.join("\n"));

    // Widening to 90 days brings back the blocked and switched-off runs, named
    // for what they were rather than counted as purges.
    await trend.locator('[data-testid="toggle-relay-trend-range-90"]').click();
    await assert.doesNotReject(() => table.getByText("Blocked by app build").waitFor());
    await assert.doesNotReject(() => table.getByText("Switched off").waitFor());
    await assert.doesNotReject(() => table.getByText("Stopped early").waitFor());
    assert.equal(await table.locator("tbody tr").count(), 6);
    assert.equal(await chart.locator('[data-testid^="bar-relay-trend-"]').count(), 90);

    // Run now: the purge card fires the run and the trend refreshes itself
    // with the new whole-relay run at the top of the list.
    await page.locator('[data-testid="button-run-chat-relay"]').click();
    await assert.doesNotReject(() => table.locator("tbody tr").first().getByText("Run now").waitFor());
    assert(
      requestsSeen.some((entry) => entry === "POST /api/settings/chat-relay/run"),
      requestsSeen.join("\n"),
    );
    assert.equal(historyRequests(), 2, requestsSeen.join("\n"));
    assert.equal(await table.locator("tbody tr").count(), 7);
    await assert.doesNotReject(() => heldTile.getByText("28.0 MB").waitFor());
    await assert.doesNotReject(() => reclaimed.getByText("46.3 MB").waitFor());
    await adminContext.close();

    // A non-operator sign-in never reaches the settings page, so the history
    // is never even requested on its behalf.
    role = "dealer";
    const historyBeforeDealer = historyRequests();
    const dealerContext = await browser.newContext();
    await dealerContext.addInitScript(() => localStorage.setItem("auth_token", "browser-dealer-token"));
    const dealerPage = await dealerContext.newPage();
    await installApiFixture(dealerPage);
    await dealerPage.goto(`${appBase}/settings`);
    await dealerPage.waitForURL(`${appBase}/login`);
    assert.equal(await dealerPage.locator('[data-testid="card-chat-relay-trend"]').count(), 0);
    assert.equal(historyRequests(), historyBeforeDealer, requestsSeen.join("\n"));
    await dealerContext.close();

    console.log("PASS chat relay trend browser regression flow");
  } finally {
    await browser?.close();
    preview.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => preview.once("exit", resolve)),
      sleep(2_000),
    ]);
    if (preview.exitCode && preview.exitCode !== 0 && preview.signalCode !== "SIGTERM") {
      console.error(previewErrors);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
