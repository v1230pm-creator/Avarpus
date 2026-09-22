// Browser regression check for the operator chat-report queue page.
//
// It proves the page reaches the operator-only endpoints, records a decision
// through the UI, reflects the stored decision after a reload, and stays out of
// reach of a non-operator sign-in.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = 5683;
const origin = `http://127.0.0.1:${port}`;
const appBase = `${origin}/update-admin`;
const reportId = "22222222-2222-4222-8222-222222222222";
const roomId = "33333333-3333-4333-8333-333333333333";
const reportedMessageId = "44444444-4444-4444-8444-444444444444";
const batchId = "77777777-7777-4777-8777-777777777777";
const createdAt = new Date().toISOString();

let role = "super_admin";
let report = {
  id: reportId,
  reason: "harassment",
  details: "They keep messaging me after I asked them to stop.",
  status: "open",
  createdAt,
  reporter: { id: "reporter-1", name: "Browser Reporter", mobile: "9876543210" },
  reportedUser: { id: "reported-1", name: "Browser Accused", mobile: "9876500000" },
  room: { id: roomId, name: "Direct room", scope: "global_direct" },
  messageId: reportedMessageId,
  reviewerUserId: null,
  reviewerName: null,
  reviewedAt: null,
  reviewNote: null,
  otherOpenReports: 2,
};

// A second complaint about the same account, reachable only by searching. It
// exists so the page has to send the term to the server rather than filter the
// page it already has.
const otherReport = {
  ...report,
  id: "55555555-5555-4555-8555-555555555555",
  reason: "scam",
  details: "Asked me to pay outside the app.",
  reporter: { id: "reporter-2", name: "Second Complainant", mobile: "9811100000" },
  messageId: null,
  otherOpenReports: 2,
};

// A report the accused account filed about someone else. A text search for
// their name turns it up; drilling into "other open reports about this user"
// must not, or the list contradicts the count that opened it.
const filedByAccused = {
  ...report,
  id: "66666666-6666-4666-8666-666666666666",
  reason: "other",
  details: "They were rude to me first.",
  reporter: { id: "reported-1", name: "Browser Accused", mobile: "9876500000" },
  reportedUser: { id: "reporter-2", name: "Second Complainant", mobile: "9811100000" },
  messageId: null,
  otherOpenReports: 0,
};
const requestsSeen = [];

// A realistic window: forty messages, far taller than the dialog, with the
// reported one in the middle. A short fixture would hide the case that matters
// — an operator must be able to reach the message the report is about.
const transcriptMessages = Array.from({ length: 40 }, (_, index) => {
  const reported = index === 20;
  return {
    id: reported
      ? reportedMessageId
      : `44444444-4444-4444-8444-4444444444${String(index).padStart(2, "0")}`,
    senderId: index % 2 === 0 ? "reporter-1" : "reported-1",
    senderName: index % 2 === 0 ? "Browser Reporter" : "Browser Accused",
    kind: "text",
    body: reported
      ? "I will keep messaging you all night."
      : index === 0
        ? "Please stop messaging me."
        : `Filler message ${index}`,
    hasAttachment: false,
    deletedAt: null,
    createdAt,
    isReportedMessage: reported,
    isFromReportedUser: index % 2 === 1,
  };
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

    if (url.pathname === "/api/chat/admin/reports" && request.method() === "GET") {
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search");
      const reportedUserId = url.searchParams.get("reportedUserId");
      // The server decides what a term matches; the fixture only has to prove
      // the page sends it and renders whatever comes back. The account filter
      // is exact, so it is the one thing the fixture models faithfully.
      let pool = reportedUserId || search !== null
        ? [report, otherReport, filedByAccused]
        : [report];
      if (search !== null) {
        pool = pool.filter((entry) =>
          [entry.reporter.name, entry.reporter.mobile, entry.reportedUser.name, entry.reportedUser.mobile]
            .some((field) => field.toLowerCase().includes(search.toLowerCase())));
      }
      if (reportedUserId) {
        pool = pool.filter((entry) => entry.reportedUser.id === reportedUserId);
      }
      return json(route, {
        reports: pool.filter((entry) => !status || status === entry.status),
        nextCursor: null,
        openCount: report.status === "open" ? 1 : 0,
      });
    }

    if (
      url.pathname === `/api/chat/admin/reports/${reportId}/transcript`
      && request.method() === "GET"
    ) {
      return json(route, {
        reportId,
        room: report.room,
        reportedMessageId,
        reportedMessageFound: true,
        messages: transcriptMessages,
        hasMoreBefore: true,
        hasMoreAfter: true,
      });
    }

    if (
      url.pathname === `/api/chat/admin/reports/${reportId}/status`
      && request.method() === "PATCH"
    ) {
      const body = request.postDataJSON();
      report = {
        ...report,
        status: body.status,
        reviewerUserId: "admin-user",
        reviewerName: "Browser Admin",
        reviewedAt: new Date().toISOString(),
        reviewNote: body.note ?? report.reviewNote,
      };
      return json(route, { report });
    }

    if (
      url.pathname === `/api/chat/admin/reports/${reportId}/status/batch`
      && request.method() === "POST"
    ) {
      const body = request.postDataJSON();
      const decided = {
        status: body.status,
        reviewerUserId: "admin-user",
        reviewerName: "Browser Admin",
        reviewedAt: new Date().toISOString(),
      };
      report = {
        ...report,
        ...decided,
        reviewNote: body.note ?? report.reviewNote,
        otherOpenReports: 0,
      };
      otherReport.status = body.status;
      otherReport.otherOpenReports = 0;
      // The server decides the reach of a batch; the fixture only reports one,
      // including a report it left alone because somebody else had decided it.
      return json(route, {
        report,
        appliedCount: 3,
        skippedCount: 1,
        notifiedReporterCount: 2,
        batchId,
        withdrawableUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
    }

    if (
      url.pathname === `/api/chat/admin/reports/batches/${batchId}/withdraw`
      && request.method() === "POST"
    ) {
      // The server puts each report back where it was; the fixture models the
      // two it still owned, and the one another operator has since decided.
      report = {
        ...report,
        status: "open",
        reviewerUserId: null,
        reviewerName: null,
        reviewedAt: null,
        reviewNote: null,
        otherOpenReports: 1,
      };
      otherReport.status = "open";
      otherReport.otherOpenReports = 1;
      return json(route, {
        batchId,
        withdrawnAt: new Date().toISOString(),
        restoredReportIds: [reportId, otherReport.id],
        restoredCount: 2,
        skippedCount: 1,
      });
    }

    return json(route, { message: `Unhandled fixture route: ${request.method()} ${url.pathname}` }, 500);
  });
}

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

    const adminContext = await browser.newContext();
    await adminContext.addInitScript(() => localStorage.setItem("auth_token", "browser-admin-token"));
    const page = await adminContext.newPage();
    // Validation runs this alongside other builds and test suites, so first
    // paint can be far slower here than in an idle workspace.
    page.setDefaultTimeout(180_000);
    page.on("console", (message) => console.log(`browser console: ${message.type()} ${message.text()}`));
    page.on("pageerror", (error) => console.error(`browser error: ${error.message}`));
    await installApiFixture(page);
    // Toast copy is also mirrored into a visually hidden screen-reader
    // announcer that Radix portals outside the notifications region, and
    // whether that mirror is still mounted when an assertion runs depends on
    // timing. Scoping to the region keeps every toast locator to one element.
    const toasts = page.getByRole("region", { name: /notifications/i });

    await page.goto(`${appBase}/chat-reports`);
    try {
      await page.getByRole("heading", { name: "Chat Reports" }).waitFor();
    } catch (error) {
      console.error(`browser URL: ${page.url()}`);
      console.error((await page.locator("body").innerText()).slice(0, 2_000));
      throw error;
    }

    await assert.doesNotReject(() => page.getByText("Browser Reporter").waitFor());
    await assert.doesNotReject(() => page.getByText("Browser Accused").waitFor());
    await assert.doesNotReject(() => page.getByText("Harassment", { exact: true }).waitFor());
    await assert.doesNotReject(() =>
      page.getByText("They keep messaging me after I asked them to stop.").waitFor());

    // One account drawing complaints from several people is the case the queue
    // has to surface; the operator should not have to count rows themselves.
    const repeatBadge = page.locator('[data-testid="other-open-reports"]').first();
    await assert.doesNotReject(() => repeatBadge.waitFor());
    assert.match(await repeatBadge.innerText(), /2 other open reports about this user/);

    // The badge is the shortest path from "this account has form" to seeing
    // what else is open against it. It must filter on the account itself: a
    // name search would also turn up what that account has reported, which is
    // not what the count promised.
    const searchBox = page.getByLabel("Search reports");
    await repeatBadge.click();
    await assert.doesNotReject(() => page.getByText("Second Complainant").first().waitFor());
    assert.equal(await searchBox.inputValue(), "");
    const accountRequest = requestsSeen.filter((entry) => entry.includes("reportedUserId=")).pop();
    assert(accountRequest?.includes("reportedUserId=reported-1"), requestsSeen.join("\n"));
    assert(!accountRequest?.includes("search="), accountRequest);
    assert.equal(await page.getByText("They were rude to me first.").count(), 0);
    // The filter has to be visible and reversible, or the queue is silently
    // showing one account with no way back.
    const focusChip = page.locator('[data-testid="focused-account"]');
    assert.match(await focusChip.innerText(), /Browser Accused/);
    await focusChip.click();
    await assert.doesNotReject(() =>
      page.getByText("Second Complainant").waitFor({ state: "hidden" }));

    // Searching must reach the server, not filter the page already loaded:
    // the match an operator is looking for is usually not on screen yet.
    await searchBox.fill("Browser Accused");
    await assert.doesNotReject(() => page.getByText("Second Complainant").first().waitFor());
    assert(
      requestsSeen.some((entry) =>
        entry.startsWith("GET /api/chat/admin/reports?")
        && entry.includes("search=Browser")),
      requestsSeen.join("\n"),
    );
    // Keystrokes are debounced, so typing a whole term is not one query per
    // character.
    assert(
      requestsSeen.filter((entry) => entry.includes("search=")).length < 5,
      requestsSeen.filter((entry) => entry.includes("search=")).join("\n"),
    );
    await searchBox.fill("Nobody At All");
    await assert.doesNotReject(() => page.getByText("Nothing to review").waitFor());
    await assert.doesNotReject(() =>
      page.getByText('No reports match "Nobody At All"', { exact: false }).waitFor());
    await searchBox.fill("");
    await assert.doesNotReject(() => page.getByText("Browser Reporter").waitFor());
    assert.equal(await page.getByText("Second Complainant").count(), 0);

    // The reported conversation must not be fetched until an operator asks for
    // it: every fetch is logged as a read of two private users' messages.
    assert.equal(
      requestsSeen.filter((entry) => entry.includes("/transcript")).length,
      0,
      requestsSeen.join("\n"),
    );
    await page.getByRole("button", { name: "View conversation" }).click();
    const transcript = page.getByRole("dialog");
    await assert.doesNotReject(() =>
      transcript.getByText("I will keep messaging you all night.").waitFor());
    await assert.doesNotReject(() => transcript.getByText("Reported message").waitFor());
    await assert.doesNotReject(() =>
      transcript.getByText("recorded against your operator account", { exact: false }).waitFor());
    assert.equal(
      requestsSeen.filter((entry) =>
        entry === `GET /api/chat/admin/reports/${reportId}/transcript`).length,
      1,
      requestsSeen.join("\n"),
    );
    // Read-only: the transcript offers no way to reply or act on the room.
    assert.equal(await transcript.getByRole("textbox").count(), 0);

    // A long conversation must scroll inside the dialog, and the message the
    // report is about must be on screen without the operator hunting for it.
    const scroller = transcript.locator('[data-testid="transcript-scroll"]');
    const metrics = await scroller.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    assert(metrics.clientHeight > 0, JSON.stringify(metrics));
    assert(metrics.scrollHeight > metrics.clientHeight, JSON.stringify(metrics));
    assert(metrics.scrollTop > 0, JSON.stringify(metrics));
    const reportedInView = await transcript
      .locator('[data-testid="transcript-message-reported"]')
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        const view = element
          .closest('[data-testid="transcript-scroll"]')
          .getBoundingClientRect();
        return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
      });
    assert(reportedInView, "the reported message is not visible when the transcript opens");
    // Scrolling back reaches the start of the window.
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await assert.doesNotReject(() =>
      transcript.getByText("Please stop messaging me.").waitFor());

    // Coming back to the tab or regaining the network must not silently read
    // two private users' messages again — each read is written to the trail.
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await sleep(750);
    assert.equal(
      requestsSeen.filter((entry) =>
        entry === `GET /api/chat/admin/reports/${reportId}/transcript`).length,
      1,
      requestsSeen.join("\n"),
    );

    await page.keyboard.press("Escape");
    await transcript.waitFor({ state: "hidden" });

    // Deliberately opening it again is a second read, and is logged as one.
    await page.getByRole("button", { name: "View conversation" }).click();
    await assert.doesNotReject(() =>
      transcript.getByText("I will keep messaging you all night.").waitFor());
    assert.equal(
      requestsSeen.filter((entry) =>
        entry === `GET /api/chat/admin/reports/${reportId}/transcript`).length,
      2,
      requestsSeen.join("\n"),
    );
    await page.keyboard.press("Escape");
    await transcript.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await page.getByLabel("Note (optional)").fill("Read the thread, watching the account.");
    // Settling several people's complaints at once has to be a deliberate act,
    // so the offer is visible on a report with other open complaints but is
    // never pre-selected.
    const applyToAll = page.locator('[data-testid="apply-to-all-open"]');
    await assert.doesNotReject(() => applyToAll.waitFor());
    assert.equal(await applyToAll.getAttribute("data-state"), "unchecked");
    await assert.doesNotReject(() =>
      page.getByText("Also apply to 2 other open reports about Browser Accused").waitFor());
    await page.getByRole("dialog").getByRole("button", { name: "Save decision" }).click();
    // The default view is the open queue, so a decided report must drop out of
    // it — that only happens if the list reloads from the server rather than
    // patching local state, which is what keeps an operator off a stale queue.
    await assert.doesNotReject(() => page.getByText("Nothing to review").waitFor());
    assert(requestsSeen.some((entry) => entry === `PATCH /api/chat/admin/reports/${reportId}/status`));
    assert.equal(report.reviewNote, "Read the thread, watching the account.");
    assert(
      requestsSeen.filter((entry) => entry.startsWith("GET /api/chat/admin/reports?")).length >= 2,
      requestsSeen.join("\n"),
    );

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Reviewed" }).click();
    await assert.doesNotReject(() =>
      page.getByText("Browser Admin recorded this decision", { exact: false }).waitFor());
    await assert.doesNotReject(() =>
      page.getByText("Read the thread, watching the account.").waitFor());

    // Leaving the box unchecked decides this report alone, through the
    // single-report endpoint.
    assert.equal(
      requestsSeen.filter((entry) => entry.includes("/status/batch")).length,
      0,
      requestsSeen.join("\n"),
    );

    await page.getByRole("button", { name: "Action taken" }).click();
    await page.locator('[data-testid="apply-to-all-open"]').click();
    // A batch moves other people's complaints, so it is named before it runs:
    // the operator clicked from one card and must see the rest first.
    await page.getByRole("dialog").getByRole("button", { name: "Review what this moves" }).click();
    const confirmation = page.locator('[data-testid="batch-confirmation"]');
    await assert.doesNotReject(() => confirmation.waitFor());
    assert.equal(
      requestsSeen.filter((entry) => entry.includes("/status/batch")).length,
      0,
      "the confirmation step ran the batch before the operator confirmed it",
    );
    assert.match(
      await page.locator('[data-testid="batch-confirm-count"]').innerText(),
      /2 reports about Browser Accused will move/,
    );
    const confirmList = page.locator('[data-testid="batch-confirm-list"]');
    assert.match(await confirmList.innerText(), /Browser Reporter/);
    assert.match(await confirmList.innerText(), /Second Complainant/);
    // Backing out of the confirmation must leave every report where it was.
    await page.getByRole("dialog").getByRole("button", { name: "Back" }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(
      requestsSeen.filter((entry) => entry.includes("/status/batch")).length,
      0,
      requestsSeen.join("\n"),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Review what this moves" }).click();
    await page.locator('[data-testid="confirm-batch"]').click();
    // One decision across every open complaint about the account, and the
    // operator is told how far it reached — including what it left alone.
    await assert.doesNotReject(() =>
      toasts.getByText("Action taken recorded on 3 reports.", { exact: false }).waitFor());
    await assert.doesNotReject(() =>
      toasts.getByText(
        "1 other report about this account was already decided and left alone.",
        { exact: false },
      ).waitFor());
    assert(
      requestsSeen.some((entry) =>
        entry === `POST /api/chat/admin/reports/${reportId}/status/batch`),
      requestsSeen.join("\n"),
    );
    await assert.doesNotReject(() => page.getByText("Nothing to review").waitFor());
    assert.equal(report.status, "actioned");
    assert.equal(otherReport.status, "actioned");

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Action taken" }).click();
    await assert.doesNotReject(() =>
      page.getByText("This report is closed. Its decision cannot be changed.").waitFor());
    assert.equal(await page.getByRole("button", { name: "Mark reviewed" }).count(), 0);

    await page.reload();
    await page.getByRole("heading", { name: "Chat Reports" }).waitFor();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Action taken" }).click();
    await assert.doesNotReject(() =>
      page.getByText("Read the thread, watching the account.").waitFor());

    // A misclick is usually followed by a reload, so the way back from a bulk
    // decision has to survive one.
    const undoBanner = page.locator('[data-testid="undo-batch-banner"]');
    await assert.doesNotReject(() => undoBanner.waitFor());
    assert.match(
      await undoBanner.innerText(),
      /Action taken recorded on 3 reports about Browser Accused/,
    );
    await page.locator('[data-testid="undo-batch"]').click();
    await assert.doesNotReject(() =>
      toasts.getByText("2 reports are back where they were.", { exact: false }).waitFor());
    // What the undo could not take back is said plainly: another operator's
    // decision is not this operator's to reverse.
    await assert.doesNotReject(() =>
      toasts.getByText(
        "1 report another operator has decided since was left alone.",
        { exact: false },
      ).waitFor());
    await assert.doesNotReject(() =>
      toasts.getByText("Reporters keep the alert they were already sent.", { exact: false })
        .waitFor());
    assert(
      requestsSeen.some((entry) =>
        entry === `POST /api/chat/admin/reports/batches/${batchId}/withdraw`),
      requestsSeen.join("\n"),
    );
    // A spent offer is gone, on this page load and the next.
    await undoBanner.waitFor({ state: "hidden" });
    assert.equal(report.status, "open");
    await page.reload();
    await page.getByRole("heading", { name: "Chat Reports" }).waitFor();
    await assert.doesNotReject(() => page.getByText("Browser Reporter").waitFor());
    assert.equal(await undoBanner.count(), 0);
    // The restored report is back in the open queue and can be decided again.
    await assert.doesNotReject(() =>
      page.getByRole("button", { name: "Mark reviewed" }).first().waitFor());
    await adminContext.close();

    role = "dealer";
    const dealerContext = await browser.newContext();
    await dealerContext.addInitScript(() => localStorage.setItem("auth_token", "browser-dealer-token"));
    const dealerPage = await dealerContext.newPage();
    await installApiFixture(dealerPage);
    await dealerPage.goto(`${appBase}/chat-reports`);
    await dealerPage.waitForURL(`${appBase}/login`);
    assert.equal(await dealerPage.getByRole("heading", { name: "Chat Reports" }).count(), 0);
    assert.equal(await dealerPage.getByText("Browser Accused").count(), 0);
    await dealerContext.close();

    console.log("PASS chat report queue browser regression flow");
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
