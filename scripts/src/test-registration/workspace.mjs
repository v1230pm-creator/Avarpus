/**
 * Workspace model for the guard: the pnpm packages, their scripts, and every
 * file in them that looks like a test.
 */
import { globSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Directories that never hold source tests (build output, caches, deps). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".expo",
  ".cache",
  ".output",
  ".temp",
  ".idea",
  ".turbo",
  ".next",
  "dist",
  "build",
  "tmp",
  "coverage",
]);

/** Runner-discovered suites: Vitest / Jest / `node --test` naming. */
const SUITE_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
/**
 * Standalone test scripts (`scripts/test-shop-isolation.mjs`): the naming
 * Node's own `--test` discovery treats as a test, limited to the directories
 * this repo keeps such scripts in so helper modules such as
 * `src/test-utils.ts` are not mistaken for suites.
 */
const SCRIPT_FILE = /^test-.+\.[cm]?[jt]s$/;
const SCRIPT_DIRS = new Set(["scripts", "script", "test", "tests", "e2e", "__tests__"]);

/**
 * @typedef {{ dir: string, rel: string, name: string, scripts: Record<string, string>, isRoot: boolean }} Package
 * @typedef {{ file: string, rel: string, pkg: Package, kind: "suite" | "script" }} TestFile
 */

export function loadWorkspace(rootDir) {
  const root = readPackage(rootDir, rootDir, true);
  const dirs = new Set();
  for (const pattern of readWorkspaceGlobs(path.join(rootDir, "pnpm-workspace.yaml"))) {
    const negate = pattern.startsWith("!");
    const matches = globSync(negate ? pattern.slice(1) : pattern, { cwd: rootDir })
      .map((match) => path.join(rootDir, match))
      .filter((dir) => isDirectory(dir) && isFile(path.join(dir, "package.json")));
    for (const dir of matches) {
      if (negate) dirs.delete(dir);
      else dirs.add(dir);
    }
  }
  const packages = [...dirs]
    .filter((dir) => dir !== rootDir)
    .sort()
    .map((dir) => readPackage(dir, rootDir, false));
  return { rootDir, root, packages, all: [root, ...packages] };
}

function readWorkspaceGlobs(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const globs = [];
  let inPackages = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item) {
      globs.push(item[1].trim().replace(/^(['"])(.*)\1$/, "$2"));
      continue;
    }
    if (line.trim() === "") continue;
    break; // next top-level key
  }
  if (globs.length === 0) throw new Error(`${file}: no "packages:" entries found`);
  return globs;
}

function readPackage(dir, rootDir, isRoot) {
  const json = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const rel = path.relative(rootDir, dir) || ".";
  return {
    dir,
    rel,
    name: json.name ?? rel,
    scripts: json.scripts ?? {},
    json,
    isRoot,
  };
}

/** The workspace package whose directory contains `file` (deepest wins). */
export function packageAt(workspace, file) {
  let best = null;
  for (const pkg of workspace.all) {
    if (file === pkg.dir || file.startsWith(pkg.dir + path.sep)) {
      if (!best || pkg.dir.length > best.dir.length) best = pkg;
    }
  }
  return best;
}

/** Every test-looking file in every package, in stable path order. */
export function collectTestFiles(workspace) {
  const packageDirs = new Set(workspace.all.map((pkg) => pkg.dir));
  /** @type {TestFile[]} */
  const files = [];
  for (const pkg of workspace.all) {
    walk(pkg.dir, pkg, packageDirs, files, workspace.rootDir);
  }
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function walk(dir, pkg, packageDirs, out, rootDir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Another workspace package owns its own tree.
      if (full !== pkg.dir && packageDirs.has(full)) continue;
      walk(full, pkg, packageDirs, out, rootDir);
      continue;
    }
    if (!entry.isFile()) continue;
    const kind = classify(entry.name, path.relative(pkg.dir, dir));
    if (kind) out.push({ file: full, rel: path.relative(rootDir, full), pkg, kind });
  }
}

function classify(name, relDir) {
  if (SUITE_FILE.test(name)) return "suite";
  if (SCRIPT_FILE.test(name) && relDir.split(path.sep).some((segment) => SCRIPT_DIRS.has(segment))) {
    return "script";
  }
  return null;
}

export function isDirectory(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
