// Runs the update-admin browser regression suites against ONE production build.
//
// Every suite used to run `pnpm run build` into the shared `dist/public` before
// starting its own `vite preview`, so three validation steps meant three full
// builds (and a fourth from `workspace-build` racing for the same directory).
// This runner builds once into a private per-run directory, hands that
// directory to each suite through UPDATE_ADMIN_BUILD_DIR, and runs the suites
// one after another in a single process tree so only one preview server and
// one Chromium exist at a time.
//
// Usage: node scripts/run-browser-suites.mjs [suite ...]
//   With no arguments every suite runs; pass names to run a subset by hand.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUITES = {
  "public-requests": "test-public-requests-browser.mjs",
  "chat-reports": "test-chat-reports-browser.mjs",
  "chat-relay": "test-chat-relay-browser.mjs",
};

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(scriptsDir, "..");
const RUNS_ROOT = path.join(artifactDir, "tmp", "browser-suites");
const STALE_RUN_MS = 60 * 60 * 1000;
const BASE_PATH = "/update-admin/";

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !(name in SUITES));
if (unknown.length > 0) {
  console.error(
    `Unknown suite(s): ${unknown.join(", ")}. Known suites: ${Object.keys(SUITES).join(", ")}`,
  );
  process.exit(2);
}
const suiteNames = requested.length > 0 ? requested : Object.keys(SUITES);

const runId = `${process.pid}-${Date.now().toString(36)}`;
const runDir = path.join(RUNS_ROOT, runId);
const buildDir = path.join(runDir, "public");

let child = null;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    if (child && child.exitCode === null) child.kill(signal);
  });
}

function sweepStaleRuns() {
  let entries;
  try {
    entries = readdirSync(RUNS_ROOT);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_RUN_MS;
  for (const entry of entries) {
    const dir = path.join(RUNS_ROOT, entry);
    try {
      if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
    } catch {
      // Another run may be removing it; nothing to do.
    }
  }
}

function runChild(command, args, { label, env }) {
  return new Promise((resolve, reject) => {
    console.log(`\n[browser-suites] ${label}`);
    child = spawn(command, args, {
      cwd: artifactDir,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      child = null;
      if (signal) {
        reject(new Error(`${label} was terminated by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  sweepStaleRuns();
  mkdirSync(buildDir, { recursive: true });

  const results = [];
  try {
    const buildCode = await runChild(
      "pnpm",
      [
        "exec", "vite", "build", "--config", "vite.config.ts",
        "--outDir", buildDir, "--emptyOutDir",
      ],
      {
        label: `building update-admin into ${path.relative(artifactDir, buildDir)}`,
        // Match the deployment build: production mode, no development-only plugins.
        env: { NODE_ENV: "production", PORT: "5681", BASE_PATH },
      },
    );
    if (buildCode !== 0) {
      throw new Error(`update-admin build failed with exit code ${buildCode}`);
    }

    for (const name of suiteNames) {
      if (interrupted) break;
      const code = await runChild("node", [path.join("scripts", SUITES[name])], {
        label: `suite ${name} (${SUITES[name]})`,
        env: { UPDATE_ADMIN_BUILD_DIR: buildDir },
      });
      results.push({ name, code });
      console.log(`[browser-suites] suite ${name}: ${code === 0 ? "PASS" : `FAIL (exit ${code})`}`);
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }

  if (interrupted) {
    console.error("[browser-suites] interrupted before every suite ran");
    process.exit(130);
  }
  const failed = results.filter((result) => result.code !== 0);
  console.log(
    `\n[browser-suites] ${results.length - failed.length}/${suiteNames.length} suites passed` +
      (failed.length > 0 ? `; failed: ${failed.map((result) => result.name).join(", ")}` : ""),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`[browser-suites] ${error instanceof Error ? error.message : String(error)}`);
  rmSync(runDir, { recursive: true, force: true });
  process.exit(1);
});
