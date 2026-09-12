// Build the API server into a private, per-run directory and then run a test
// script against that build.
//
// Usage (from artifacts/api-server):
//   node scripts/run-isolated.mjs scripts/test-shop-isolation.mjs [args...]
//
// Why: every `pnpm run build` (the dev workflow, workspace-build, another
// validation step) wipes and rewrites ./dist. A test that had just built into
// ./dist could therefore find dist/index.mjs gone by the time it spawned the
// server. Building into tmp/isolated-builds/<run-id>/ means nothing else can
// touch the files a run depends on. The test scripts pick the build up via
// API_SERVER_ENTRY and fall back to ./dist/index.mjs when run by hand.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildsRoot = path.join(artifactDir, "tmp", "isolated-builds");
// A run that was killed hard (SIGKILL, container restart) cannot clean up
// after itself; sweep anything this old on the next run instead.
const STALE_BUILD_MS = 60 * 60 * 1000;

const [, , script, ...scriptArgs] = process.argv;
if (!script) {
  console.error("Usage: node scripts/run-isolated.mjs <test-script.mjs> [args...]");
  process.exit(2);
}

const runId = `${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}`;
const outDir = path.join(buildsRoot, runId);
const entry = path.join(outDir, "index.mjs");

function run(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: artifactDir,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });
    const forward = (signal) => () => child.kill(signal);
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      resolve(signal ? 1 : code ?? 1);
    });
  });
}

async function sweepStaleBuilds() {
  let entries;
  try {
    entries = await readdir(buildsRoot);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_BUILD_MS;
  await Promise.all(
    entries.map(async (name) => {
      const dir = path.join(buildsRoot, name);
      try {
        const info = await stat(dir);
        if (info.isDirectory() && info.mtimeMs < cutoff) {
          await rm(dir, { recursive: true, force: true });
        }
      } catch {
        // Another run may be sweeping the same directory; nothing to do.
      }
    }),
  );
}

let exitCode = 1;
try {
  await sweepStaleBuilds();
  await mkdir(outDir, { recursive: true });
  console.log(`[run-isolated] building API server into ${path.relative(artifactDir, outDir)}/`);
  const buildCode = await run(process.execPath, ["./build.mjs"], {
    API_SERVER_OUT_DIR: path.relative(artifactDir, outDir),
  });
  if (buildCode !== 0) {
    console.error(`[run-isolated] build failed with exit code ${buildCode}`);
    exitCode = buildCode;
  } else {
    await stat(entry); // fail loudly here rather than inside the test script
    console.log(`[run-isolated] running ${script}`);
    exitCode = await run(process.execPath, [script, ...scriptArgs], { API_SERVER_ENTRY: entry });
  }
} catch (err) {
  console.error("[run-isolated]", err);
  exitCode = 1;
} finally {
  await rm(outDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
