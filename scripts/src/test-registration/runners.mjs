/**
 * Which test files a resolved leaf command actually reaches.
 *
 * Each adapter mirrors the discovery rules of its tool closely enough to
 * answer one question per file: would this invocation run it? Where a rule
 * cannot be read statically (a Jest preset supplying `testMatch`, a Vitest
 * config building `include` from an expression) the adapter reports a
 * problem instead of guessing, so the guard fails closed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isFile, packageAt } from "./workspace.mjs";

const VITEST_DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
const VITEST_DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/cypress/**",
  "**/.{idea,git,cache,output,temp}/**",
  "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
];
const VITEST_CONFIG_FILES = ["vitest.config", "vite.config"].flatMap((base) =>
  ["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `${base}.${ext}`),
);
const VITEST_VALUE_OPTIONS = new Set([
  "--config", "-c", "--root", "-r", "--dir", "--environment", "--reporter", "--outputFile", "--pool",
  "--project", "--testNamePattern", "-t", "--maxWorkers", "--minWorkers", "--maxConcurrency",
  "--testTimeout", "--hookTimeout", "--teardownTimeout", "--retry", "--bail", "--segfaultRetry",
  "--shard", "--exclude", "--mode", "--workspace", "--changed", "--silent", "--printConsoleTrace",
  "--coverage.include", "--coverage.exclude", "--coverage.provider", "--coverage.reporter",
  "--coverage.reportsDirectory", "--sequence.seed", "--sequence.setupFiles", "--sequence.hooks",
  "--api", "--api.port", "--api.host", "--browser", "--browser.name", "--browser.provider",
  "--cache.dir", "--typecheck.tsconfig", "--typecheck.include", "--typecheck.exclude",
  "--poolOptions.threads.maxThreads", "--poolOptions.threads.minThreads", "--poolOptions.forks.maxForks",
  "--poolOptions.forks.minForks", "--poolOptions.vmThreads.memoryLimit", "--inspect", "--inspect-brk",
  "--env-file", "--setupFiles", "--globalSetup", "--snapshotFormat", "--diff", "--includeTaskLocation",
]);
const VITEST_SUBCOMMANDS = new Set(["run", "watch", "dev", "list", "bench", "typecheck", "init", "related"]);

const JEST_DEFAULT_TEST_MATCH = ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[tj]s?(x)"];
const JEST_CONFIG_FILES = ["js", "ts", "mjs", "cjs", "json", "mts", "cts"].map((ext) => `jest.config.${ext}`);
const JEST_VALUE_OPTIONS = new Set([
  "--config", "-c", "--maxWorkers", "-w", "--testNamePattern", "-t", "--testPathPattern", "--testPathPatterns",
  "--testPathIgnorePatterns", "--rootDir", "--roots", "--selectProjects", "--ignoreProjects", "--reporters",
  "--coverageDirectory", "--coverageProvider", "--coverageReporters", "--coverageThreshold", "--collectCoverageFrom",
  "--testTimeout", "--shard", "--outputFile", "--env", "--testEnvironment", "--testEnvironmentOptions",
  "--setupFiles", "--setupFilesAfterEach", "--setupFilesAfterEnv", "--modulePaths", "--moduleNameMapper",
  "--moduleDirectories", "--moduleFileExtensions", "--modulePathIgnorePatterns", "--testMatch", "--testRegex",
  "--projects", "--filter", "--changedSince", "--globalSetup", "--globalTeardown", "--haste", "--cacheDirectory",
  "--workerIdleMemoryLimit", "--seed", "--testSequencer", "--snapshotSerializers", "--prettierPath", "--resolver",
  "--runner", "--testRunner", "--transform", "--transformIgnorePatterns", "--watchPathIgnorePatterns",
  "--displayName", "--unmockedModulePathPatterns", "--testResultsProcessor", "--dependencyExtractor",
  "--json", "--preset", "--testFailureExitCode", "--maxConcurrency", "--openHandlesTimeout", "--randomize",
  "--fakeTimers", "--globals", "--snapshotFormat", "--waitNextEventLoopTurnForUnhandledRejectionEvents",
]);
/** Jest options whose value is actually an array of following arguments. */
const JEST_LIST_OPTIONS = new Set(["--testPathPatterns", "--roots", "--testMatch", "--projects", "--reporters", "--setupFiles", "--modulePaths", "--moduleDirectories", "--moduleFileExtensions", "--collectCoverageFrom", "--coverageReporters", "--snapshotSerializers", "--setupFilesAfterEnv", "--testPathIgnorePatterns", "--modulePathIgnorePatterns", "--transformIgnorePatterns", "--watchPathIgnorePatterns", "--unmockedModulePathPatterns", "--selectProjects", "--ignoreProjects"]);
const JEST_BOOLEAN_OPTIONS = new Set(["--json", "--randomize", "--globals"]);

const NODE_VALUE_OPTIONS = new Set([
  "--import", "--require", "-r", "--loader", "--experimental-loader", "--env-file", "--env-file-if-exists",
  "--conditions", "-C", "--input-type", "--test-reporter", "--test-reporter-destination", "--test-name-pattern",
  "--test-skip-pattern", "--test-concurrency", "--test-timeout", "--test-shard", "--test-coverage-include",
  "--test-coverage-exclude", "--test-coverage-branches", "--test-coverage-functions", "--test-coverage-lines",
  "--test-isolation", "--test-global-setup", "--stack-trace-limit", "--title", "--max-old-space-size",
  "--experimental-default-type", "--unhandled-rejections", "--watch-path", "--dns-result-order",
  "--openssl-config", "--icu-data-dir", "--heapsnapshot-signal", "--redirect-warnings", "--report-directory",
  "--secure-heap", "--disable-warning", "--trace-event-categories", "--eval", "-e", "--print", "-p",
  "--inspect-port", "--experimental-config-file", "--cpu-prof-dir", "--heap-prof-dir", "--diagnostic-dir",
  "--tls-cipher-list", "--tls-keylog", "--use-largepages", "--v8-options", "--snapshot-blob", "--build-snapshot-config",
  "--experimental-sea-config", "--tsx",
]);
const NODE_TEST_DEFAULT_PATTERNS = [
  "**/*.test.{cjs,mjs,js,cts,mts,ts}",
  "**/*-test.{cjs,mjs,js,cts,mts,ts}",
  "**/*_test.{cjs,mjs,js,cts,mts,ts}",
  "**/test-*.{cjs,mjs,js,cts,mts,ts}",
  "**/test.{cjs,mjs,js,cts,mts,ts}",
  "**/test/**/*.{cjs,mjs,js,cts,mts,ts}",
];

/**
 * @typedef {import("./workspace.mjs").TestFile} TestFile
 * @typedef {import("./resolve.mjs").Leaf} Leaf
 */

/**
 * @param {Leaf} leaf
 * @param {TestFile[]} candidates
 * @param {{ workspace: object, problems: string[] }} context
 * @returns {Promise<TestFile[]>}
 */
export async function reachedBy(leaf, candidates, context) {
  switch (leaf.tool) {
    case "vitest":
      return vitestReach(leaf, candidates, context);
    case "jest":
      return jestReach(leaf, candidates, context);
    case "node":
      return nodeReach(leaf, candidates, context);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Vitest

function vitestReach(leaf, candidates, { problems }) {
  const { flags, positionals } = parseArgs(leaf.args, VITEST_VALUE_OPTIONS);
  let filters = positionals;
  if (VITEST_SUBCOMMANDS.has(filters[0])) {
    const sub = filters[0];
    filters = filters.slice(1);
    if (sub === "bench" || sub === "init" || sub === "typecheck") return [];
    if (sub === "related") {
      problem(problems, leaf, "`vitest related` picks tests by import graph; the guard cannot credit it");
      return [];
    }
  }
  const root = path.resolve(leaf.cwd, last(flags, "--root") ?? last(flags, "-r") ?? ".");
  const explicitConfig = last(flags, "--config") ?? last(flags, "-c");
  const configFile = explicitConfig
    ? path.resolve(leaf.cwd, explicitConfig)
    : VITEST_CONFIG_FILES.map((name) => path.join(root, name)).find((file) => isFile(file));
  if (explicitConfig && !isFile(configFile)) {
    problem(problems, leaf, `config file ${explicitConfig} does not exist`);
    return [];
  }
  let config = {};
  if (configFile) {
    try {
      config = readVitestTestConfig(configFile);
    } catch (error) {
      problem(problems, leaf, error.message);
      return [];
    }
  }
  const configRoot = config.root ? path.resolve(path.dirname(configFile), config.root) : root;
  const dir = path.resolve(configRoot, last(flags, "--dir") ?? config.dir ?? ".");
  const include = config.include ?? VITEST_DEFAULT_INCLUDE;
  const exclude = [...(config.exclude ?? VITEST_DEFAULT_EXCLUDE), ...(flags.get("--exclude") ?? [])];
  return candidates.filter((candidate) => {
    if (!isInside(candidate.file, dir)) return false;
    const rel = path.relative(dir, candidate.file);
    if (!include.some((glob) => path.matchesGlob(rel, glob))) return false;
    if (exclude.some((glob) => path.matchesGlob(rel, glob))) return false;
    if (filters.length === 0) return true;
    // vitest filterFiles(): case-insensitive substring of the dir-relative path.
    const lower = rel.toLowerCase();
    return filters.some((filter) => {
      if (path.isAbsolute(filter) && candidate.file.startsWith(filter)) return true;
      const relativeFilter = filter.endsWith("/")
        ? path.join(path.relative(dir, path.resolve(leaf.cwd, filter)), "/")
        : path.relative(dir, path.resolve(leaf.cwd, filter));
      return lower.includes(filter.toLowerCase()) || lower.includes(relativeFilter.toLowerCase());
    });
  });
}

/**
 * Reads `test.include` / `test.exclude` / `test.dir` / `test.root` from a
 * Vitest or Vite config without importing it (importing would pull in the
 * app's plugins). Only literal string arrays are accepted.
 */
export function readVitestTestConfig(file) {
  const source = stripComments(readFileSync(file, "utf8"));
  const label = path.relative(process.cwd(), file);
  const match = /(^|[\s,{])["']?test["']?\s*:\s*\{/.exec(source);
  if (!match) return {};
  const start = match.index + match[0].length - 1;
  const block = extractBalanced(source, start, "{", "}");
  if (block === null) throw new Error(`${label}: could not find the end of the test config block`);
  if (/(^|[\s,{])["']?(projects|workspace)["']?\s*:/.test(block)) {
    throw new Error(`${label}: vitest projects/workspace configs are not supported by the test registration guard`);
  }
  const result = {};
  for (const key of ["include", "exclude"]) {
    const keyMatch = new RegExp(`(^|[\\s,{])["']?${key}["']?\\s*:\\s*`).exec(block);
    if (!keyMatch) continue;
    const valueStart = keyMatch.index + keyMatch[0].length;
    if (block[valueStart] !== "[") {
      throw new Error(`${label}: test.${key} must be a literal array of strings for the test registration guard to read it`);
    }
    const array = extractBalanced(block, valueStart, "[", "]");
    if (array === null) throw new Error(`${label}: unterminated test.${key} array`);
    result[key] = parseStringArray(array, `${label}: test.${key}`);
  }
  for (const key of ["dir", "root"]) {
    const keyMatch = new RegExp(`(^|[\\s,{])["']?${key}["']?\\s*:\\s*(["'])([^"']*)\\2`).exec(block);
    if (keyMatch) result[key] = keyMatch[3];
    else if (new RegExp(`(^|[\\s,{])["']?${key}["']?\\s*:`).test(block)) {
      throw new Error(`${label}: test.${key} must be a string literal for the test registration guard to read it`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Jest

async function jestReach(leaf, candidates, { workspace, problems }) {
  const { flags, positionals } = parseArgs(leaf.args, JEST_VALUE_OPTIONS, { lists: JEST_LIST_OPTIONS, booleans: JEST_BOOLEAN_OPTIONS });
  if (flags.has("--findRelatedTests")) {
    problem(problems, leaf, "`jest --findRelatedTests` picks tests by import graph; the guard cannot credit it");
    return [];
  }
  let config;
  let configDir = leaf.cwd;
  const explicitConfig = last(flags, "--config") ?? last(flags, "-c");
  try {
    if (explicitConfig?.trim().startsWith("{")) {
      config = JSON.parse(explicitConfig);
    } else if (explicitConfig) {
      const file = path.resolve(leaf.cwd, explicitConfig);
      configDir = path.dirname(file);
      config = await loadJestConfigFile(file);
    } else {
      const file = JEST_CONFIG_FILES.map((name) => path.join(leaf.cwd, name)).find((candidate) => isFile(candidate));
      if (file) config = await loadJestConfigFile(file);
      else {
        const pkg = packageAt(workspace, leaf.cwd);
        const inPackageJson = pkg && pkg.json.jest;
        if (inPackageJson && typeof inPackageJson === "string") {
          const file = path.resolve(pkg.dir, inPackageJson);
          configDir = path.dirname(file);
          config = await loadJestConfigFile(file);
        } else {
          config = inPackageJson ?? {};
          if (pkg) configDir = pkg.dir;
        }
      }
    }
  } catch (error) {
    problem(problems, leaf, `could not read the jest config: ${error.message}`);
    return [];
  }
  if (Array.isArray(config.projects) || flags.has("--projects") || flags.has("--selectProjects")) {
    problem(problems, leaf, "multi-project jest configs are not supported by the test registration guard");
    return [];
  }
  const testMatch = flags.get("--testMatch") ?? asArray(config.testMatch);
  const testRegex = flags.get("--testRegex") ?? asArray(config.testRegex);
  if (!testMatch && !testRegex && config.preset) {
    problem(problems, leaf, `the jest config relies on preset "${config.preset}" for test discovery; set testMatch explicitly so the guard can read it`);
    return [];
  }
  const rootDir = path.resolve(configDir, last(flags, "--rootDir") ?? config.rootDir ?? ".");
  const withRoot = (value) => path.resolve(rootDir, value.replace(/<rootDir>/g, rootDir));
  const roots = (flags.get("--roots") ?? asArray(config.roots) ?? ["<rootDir>"]).map(withRoot);
  const ignore = (flags.get("--testPathIgnorePatterns") ?? asArray(config.testPathIgnorePatterns) ?? ["/node_modules/"]).map((pattern) => new RegExp(pattern.replace(/<rootDir>/g, rootDir)));
  const moduleIgnore = (flags.get("--modulePathIgnorePatterns") ?? asArray(config.modulePathIgnorePatterns) ?? []).map((pattern) => new RegExp(pattern.replace(/<rootDir>/g, rootDir)));
  const pathPatterns = [...positionals, ...(flags.get("--testPathPattern") ?? []), ...(flags.get("--testPathPatterns") ?? [])].map((pattern) => new RegExp(pattern));
  const globs = testMatch ?? (testRegex ? null : JEST_DEFAULT_TEST_MATCH);
  const regexes = globs ? null : testRegex.map((pattern) => new RegExp(pattern));
  return candidates.filter((candidate) => {
    if (!roots.some((root) => isInside(candidate.file, root))) return false;
    const matched = globs ? globs.some((glob) => path.matchesGlob(candidate.file, glob)) : regexes.some((regex) => regex.test(candidate.file));
    if (!matched) return false;
    if (ignore.some((regex) => regex.test(candidate.file))) return false;
    if (moduleIgnore.some((regex) => regex.test(candidate.file))) return false;
    return pathPatterns.length === 0 || pathPatterns.some((regex) => regex.test(candidate.file));
  });
}

async function loadJestConfigFile(file) {
  if (!isFile(file)) throw new Error(`${file} does not exist`);
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  const loaded = await import(pathToFileURL(file).href);
  const config = loaded.default ?? loaded;
  return typeof config === "function" ? await config() : config;
}

// ---------------------------------------------------------------------------
// node / tsx

function nodeReach(leaf, candidates, { workspace }) {
  const { flags, positionals } = parseArgs(leaf.args, NODE_VALUE_OPTIONS, { stopAtPositional: true });
  if (flags.has("--eval") || flags.has("-e") || flags.has("--print") || flags.has("-p")) return [];
  if (flags.has("--test")) {
    const patterns = positionals.length > 0 ? positionals : NODE_TEST_DEFAULT_PATTERNS;
    return candidates.filter((candidate) => {
      if (!isInside(candidate.file, leaf.cwd)) return false;
      const rel = path.relative(leaf.cwd, candidate.file);
      return patterns.some((pattern) => rel === path.normalize(pattern) || path.matchesGlob(rel, pattern));
    });
  }
  const byPath = new Map(candidates.map((candidate) => [candidate.file, candidate]));
  const reached = new Set();
  for (const positional of positionals) {
    const candidate = byPath.get(path.resolve(leaf.cwd, positional));
    if (candidate) reached.add(candidate);
  }
  // A runner invoked bare (`node scripts/run-browser-suites.mjs`) owns the
  // suites it lists by file name in a string literal.
  const [entry, ...scriptArgs] = positionals;
  if (entry && scriptArgs.length === 0) {
    const entryFile = path.resolve(leaf.cwd, entry);
    const entryPkg = packageAt(workspace, entryFile);
    if (entryPkg && !byPath.has(entryFile) && existsSync(entryFile)) {
      const source = readFileSync(entryFile, "utf8");
      for (const candidate of candidates) {
        if (candidate.pkg !== entryPkg) continue;
        const name = escapeRegExp(path.basename(candidate.file));
        if (new RegExp(`["'\`][\\w./-]*${name}["'\`]`).test(source)) reached.add(candidate);
      }
    }
  }
  return [...reached];
}

// ---------------------------------------------------------------------------
// helpers

/**
 * Splits CLI arguments into repeated-value flags and positionals.
 * `--k=v`, `--k v` (for options in `valueOptions`), `--no-k` and `--` are
 * understood; unknown `--k` is a boolean.
 */
export function parseArgs(args, valueOptions, { lists = new Set(), booleans = new Set(), stopAtPositional = false } = {}) {
  const flags = new Map();
  const positionals = [];
  const add = (key, value) => {
    if (!flags.has(key)) flags.set(key, []);
    flags.get(key).push(value);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && arg !== "-") {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        add(arg.slice(0, eq), arg.slice(eq + 1));
        continue;
      }
      if (arg.startsWith("--no-")) {
        add(`--${arg.slice(5)}`, false);
        continue;
      }
      if (lists.has(arg)) {
        while (i + 1 < args.length && !args[i + 1].startsWith("-")) add(arg, args[++i]);
        continue;
      }
      if (valueOptions.has(arg) && !booleans.has(arg) && i + 1 < args.length) {
        add(arg, args[++i]);
        continue;
      }
      add(arg, true);
      continue;
    }
    if (stopAtPositional) {
      positionals.push(...args.slice(i));
      break;
    }
    positionals.push(arg);
  }
  return { flags, positionals };
}

function last(flags, key) {
  const values = flags.get(key);
  if (!values) return undefined;
  const value = values[values.length - 1];
  return typeof value === "string" ? value : undefined;
}

function asArray(value) {
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value : [value];
}

function isInside(file, dir) {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function problem(problems, leaf, message) {
  problems.push(`${leaf.chain.join(" → ")}: ${message}`);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes `//` and `/* *\/` comments while leaving string contents intact. */
export function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = findStringEnd(source, i);
      out += source.slice(i, end);
      i = end;
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function findStringEnd(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") i += 2;
    else if (source[i] === quote) return i + 1;
    else if (quote !== "`" && source[i] === "\n") return i;
    else i++;
  }
  return source.length;
}

/** Returns the text from `start` (an opener) to its matching closer, inclusive. */
export function extractBalanced(source, start, open, close) {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = findStringEnd(source, i);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

function parseStringArray(arrayText, label) {
  const inner = arrayText.slice(1, -1).trim();
  if (inner === "") return [];
  const items = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`)\s*(,|$)/gy;
  let index = 0;
  while (index < inner.length) {
    re.lastIndex = index;
    const m = re.exec(inner);
    if (!m) throw new Error(`${label} must contain only string literals`);
    items.push(m[1] ?? m[2] ?? m[3]);
    index = re.lastIndex;
    if (m[4] === "" ) break;
  }
  return items;
}
