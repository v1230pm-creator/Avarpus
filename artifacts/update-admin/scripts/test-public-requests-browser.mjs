import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = 5682;
const origin = `http://127.0.0.1:${port}`;
const appBase = `${origin}/update-admin`;
const requestId = "11111111-1111-4111-8111-111111111111";
const now = new Date().toISOString();

let role = "super_admin";
let status = "received";
let identityVerification = null;
const transitions = [];
const requestsSeen = [];

const requestRecord = () => ({
  id: requestId,
  kind: "account_deletion",
  requesterName: "Browser Regression Request",
  mobile: "9876543210",
  email: "browser-regression@example.test",
  subject: "Delete my test account",
  message: "Synthetic browser regression request.",
  status,
  createdAt: now,
  reviewedAt: status === "received" ? null : now,
  confirmationAcceptedAt: now,
  reviewerUserId: status === "received" ? null : "admin-user",
});

const detailBody = () => ({
  request: requestRecord(),
  transitions,
  identityVerification,
});

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

    if (url.pathname === "/api/public/requests/admin" && request.method() === "GET") {
      const kindMatches = !url.searchParams.get("kind") || url.searchParams.get("kind") === "account_deletion";
      const statusMatches = !url.searchParams.get("status") || url.searchParams.get("status") === status;
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const searchMatches = !search || requestRecord().requesterName.toLowerCase().includes(search);
      return json(route, {
        requests: kindMatches && statusMatches && searchMatches ? [requestRecord()] : [],
        nextCursor: null,
      });
    }

    if (url.pathname === `/api/public/requests/admin/${requestId}` && request.method() === "GET") {
      return json(route, detailBody());
    }

    if (url.pathname === `/api/public/requests/admin/${requestId}/status` && request.method() === "PATCH") {
      const body = request.postDataJSON();
      const previousStatus = status;
      status = body.status;
      transitions.push({
        id: `transition-${transitions.length + 1}`,
        publicRequestId: requestId,
        fromStatus: previousStatus,
        toStatus: status,
        note: body.note || null,
        reviewerUserId: "admin-user",
        reviewerName: "Browser Admin",
        createdAt: new Date(Date.now() + transitions.length * 1000).toISOString(),
      });
      return json(route, detailBody());
    }

    if (url.pathname === `/api/public/requests/admin/${requestId}/identity-verification` && request.method() === "POST") {
      const body = request.postDataJSON();
      identityVerification = {
        id: "verification-1",
        publicRequestId: requestId,
        method: body.method,
        note: body.note,
        reviewerUserId: "admin-user",
        reviewerName: "Browser Admin",
        createdAt: new Date().toISOString(),
      };
      return json(route, detailBody());
    }

    return json(route, { message: `Unhandled fixture route: ${request.method()} ${url.pathname}` }, 500);
  });
}

async function run() {
  const preview = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--config", "vite.config.ts", "--host", "127.0.0.1"],
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

    const adminContext = await browser.newContext();
    await adminContext.addInitScript(() => localStorage.setItem("auth_token", "browser-admin-token"));
    const page = await adminContext.newPage();
    page.on("console", (message) => console.log(`browser console: ${message.type()} ${message.text()}`));
    page.on("pageerror", (error) => console.error(`browser error: ${error.message}`));
    await installApiFixture(page);

    await page.goto(`${appBase}/public-requests`);
    try {
      await page.getByRole("heading", { name: "Public Requests" }).waitFor();
    } catch (error) {
      console.error(`browser URL: ${page.url()}`);
      console.error((await page.locator("body").innerText()).slice(0, 2_000));
      throw error;
    }
    await assert.doesNotReject(() => page.getByText("Browser Regression Request").waitFor());

    await page.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Account Deletion" }).click();
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Received" }).click();
    await page.getByPlaceholder("Search by name, email, or mobile...").fill("Browser Regression");
    await page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/public/requests/admin" &&
        url.searchParams.get("kind") === "account_deletion" &&
        url.searchParams.get("status") === "received" &&
        url.searchParams.get("search") === "Browser Regression";
    });

    await page.getByText("Browser Regression Request").click();
    await page.getByRole("button", { name: "Start Review" }).click();
    await page.getByLabel("Internal Note (Optional)").fill("Browser review started");
    await page.getByRole("dialog").getByRole("button", { name: "Start Review" }).click();
    await assert.doesNotReject(() => page.getByText("In Review", { exact: true }).waitFor());
    assert.equal(await page.getByRole("button", { name: "Resolve" }).isDisabled(), true);
    assert(requestsSeen.some((entry) => entry === `PATCH /api/public/requests/admin/${requestId}/status`));
    assert(requestsSeen.filter((entry) => entry === `GET /api/public/requests/admin/${requestId}`).length >= 2);

    await page.getByRole("button", { name: "Verify identity" }).click();
    await page.getByLabel("Verification method").fill("Registered mobile callback");
    await page.getByLabel("Verification evidence").fill("Matched the registered account details");
    await page.getByRole("button", { name: "Record verification" }).click();
    await assert.doesNotReject(() => page.locator("main").getByText("Identity verification recorded", { exact: true }).waitFor());
    assert.equal(await page.getByRole("button", { name: "Resolve" }).isDisabled(), false);

    await page.getByRole("button", { name: "Resolve" }).click();
    await page.getByLabel("Internal Note (Recommended)").fill("Verified request completed");
    await page.getByRole("dialog").getByRole("button", { name: "Resolve" }).click();
    await assert.doesNotReject(() => page.getByText("Resolved", { exact: true }).waitFor());

    await page.reload();
    await assert.doesNotReject(() => page.getByText("Identity Verification Recorded", { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByText("Browser Admin · Registered mobile callback", { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByText("Marked Resolved").waitFor());
    await assert.doesNotReject(() => page.getByText("Verified request completed").waitFor());

    await page.getByRole("link", { name: "Back to Queue" }).click();
    await assert.doesNotReject(() => page.getByText("Browser Regression Request").waitFor());
    await assert.doesNotReject(() => page.getByText("Resolved", { exact: true }).waitFor());
    assert(requestsSeen.filter((entry) => entry.startsWith("GET /api/public/requests/admin?")).length >= 2);
    await adminContext.close();

    role = "dealer";
    const dealerContext = await browser.newContext();
    await dealerContext.addInitScript(() => localStorage.setItem("auth_token", "browser-dealer-token"));
    const dealerPage = await dealerContext.newPage();
    await installApiFixture(dealerPage);
    await dealerPage.goto(`${appBase}/public-requests`);
    await dealerPage.waitForURL(`${appBase}/login`);
    assert.equal(await dealerPage.getByRole("heading", { name: "Avarpus Admin Console" }).isVisible(), true);
    assert.equal(await dealerPage.getByRole("heading", { name: "Public Requests" }).count(), 0);
    await dealerContext.close();

    console.log("PASS public request browser regression flow");
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