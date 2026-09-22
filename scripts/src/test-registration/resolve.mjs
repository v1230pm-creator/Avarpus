/**
 * Resolves a validation step's shell command down to the programs that can
 * actually execute tests.
 *
 * `pnpm --filter X run test` becomes X's `test` script, which becomes its
 * `test:*` scripts, which become `vitest run …` / `node --test …` / `node
 * scripts/…` leaves in the right working directory. Wrappers that only
 * shape the process (`flock`, `env`, `cd`, `CI=1`, `npx`, `sh -c`) are
 * peeled off on the way. Anything the resolver cannot follow is recorded as
 * a problem rather than silently treated as coverage.
 */
import path from "node:path";
import { isEnvAssignment, splitCommands } from "./shell.mjs";
import { packageAt } from "./workspace.mjs";

/** @typedef {{ tool: "vitest" | "jest" | "node" | "other", name: string, args: string[], cwd: string, chain: string[] }} Leaf */

const MAX_DEPTH = 16;

const PNPM_BUILTINS = new Set([
  "add", "install", "i", "install-test", "it", "remove", "rm", "uninstall", "un", "update", "up",
  "upgrade", "link", "ln", "unlink", "import", "rebuild", "rb", "prune", "fetch", "deploy", "patch",
  "patch-commit", "patch-remove", "store", "env", "setup", "config", "c", "dedupe", "licenses",
  "audit", "outdated", "list", "ls", "ll", "la", "why", "publish", "pack", "self-update", "init",
  "cat-file", "cat-index", "find-hash", "approve-builds", "ignored-builds", "doctor", "server",
  "bin", "root", "recursive", "m", "multi", "dlx", "create", "help", "version",
]);
/** pnpm global options that consume the following argument. */
const PNPM_VALUE_OPTIONS = new Set([
  "--filter", "-F", "--filter-prod", "-C", "--dir", "--workspace-concurrency", "--reporter",
  "--loglevel", "--config", "--resume-from", "--report-summary", "--use-stderr", "--changed-files-ignore-pattern",
  "--test-pattern", "--shell-emulator",
]);
const FLOCK_VALUE_OPTIONS = new Set(["-w", "--wait", "--timeout", "-E", "--conflict-exit-code"]);
const NPX_VALUE_OPTIONS = new Set(["-p", "--package", "-c", "--call", "--shell", "--node-arg", "-n"]);

export class Resolver {
  constructor(workspace) {
    this.ws = workspace;
    /** @type {string[]} */
    this.problems = [];
    this.stack = new Set();
  }

  /**
   * @param {{ name: string, commands: string[] }} step
   * @returns {Leaf[]}
   */
  resolveStep(step) {
    const leaves = [];
    for (const command of step.commands) {
      leaves.push(...this.resolveCommand(command, this.ws.rootDir, [step.name]));
    }
    return leaves;
  }

  /** @returns {Leaf[]} */
  resolveCommand(command, cwd, chain) {
    if (chain.length > MAX_DEPTH) {
      this.problem(chain, "command chain is nested too deeply to follow");
      return [];
    }
    const leaves = [];
    let currentCwd = cwd;
    for (const argv of splitCommands(command)) {
      const result = this.resolveArgv(argv, currentCwd, chain);
      if (result.cwd) currentCwd = result.cwd;
      leaves.push(...result.leaves);
    }
    return leaves;
  }

  /** @returns {{ leaves: Leaf[], cwd?: string }} */
  resolveArgv(argv, cwd, chain) {
    let args = [...argv];
    for (;;) {
      if (args.length === 0) return { leaves: [] };
      const head = args[0];
      if (isEnvAssignment(head)) {
        args.shift();
        continue;
      }
      const name = path.basename(head);
      switch (name) {
        case "env":
          args.shift();
          while (args[0]?.startsWith("-")) {
            if (["-u", "--unset", "-C", "--chdir", "-S", "--split-string"].includes(args[0])) args.splice(0, 2);
            else args.shift();
          }
          continue;
        case "flock": {
          args.shift();
          let inlineCommand = null;
          while (args[0]?.startsWith("-")) {
            const option = args.shift();
            if (option === "-c" || option === "--command") inlineCommand = args.shift();
            else if (FLOCK_VALUE_OPTIONS.has(option)) args.shift();
          }
          args.shift(); // the lock file (or descriptor)
          if (inlineCommand !== null) return { leaves: this.resolveCommand(inlineCommand, cwd, chain) };
          continue;
        }
        case "nice":
          args.shift();
          if (args[0] === "-n" || args[0] === "--adjustment") args.splice(0, 2);
          else if (/^-\d+$/.test(args[0] ?? "")) args.shift();
          continue;
        case "time":
          args.shift();
          if (args[0] === "-p") args.shift();
          continue;
        case "timeout":
          args.shift();
          while (args[0]?.startsWith("-")) {
            if (["-s", "--signal", "-k", "--kill-after"].includes(args[0])) args.splice(0, 2);
            else args.shift();
          }
          args.shift(); // duration
          continue;
        case "corepack":
          args.shift();
          continue;
        case "cd":
          return { leaves: [], cwd: path.resolve(cwd, args[1] ?? this.ws.rootDir) };
        case "export":
        case "set":
        case "echo":
        case "true":
        case "false":
        case "exit":
        case "test":
        case "[":
        case "mkdir":
        case "rm":
        case "cp":
        case "touch":
          return { leaves: [] };
        case "sh":
        case "bash":
        case "dash":
        case "zsh": {
          const index = args.findIndex((arg, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(arg));
          if (index === -1) return { leaves: [] };
          return { leaves: this.resolveCommand(args[index + 1] ?? "", cwd, chain) };
        }
        case "npx":
          args.shift();
          while (args[0]?.startsWith("-")) {
            if (NPX_VALUE_OPTIONS.has(args[0])) args.splice(0, 2);
            else args.shift();
          }
          continue;
        case "pnpm":
          return { leaves: this.resolvePnpm(args.slice(1), cwd, chain) };
        case "npm":
          return { leaves: this.resolveNpm(args.slice(1), cwd, chain) };
        case "yarn":
          return { leaves: this.resolveYarn(args.slice(1), cwd, chain) };
        case "node":
        case "nodejs":
        case "tsx":
        case "ts-node":
          return { leaves: [this.leaf("node", name, args.slice(1), cwd, chain)] };
        case "vitest":
          return { leaves: [this.leaf("vitest", name, args.slice(1), cwd, chain)] };
        case "jest":
          return { leaves: [this.leaf("jest", name, args.slice(1), cwd, chain)] };
        default:
          return { leaves: [this.leaf("other", name, args.slice(1), cwd, chain)] };
      }
    }
  }

  leaf(tool, name, args, cwd, chain) {
    return { tool, name, args, cwd, chain: [...chain, [name, ...args].join(" ")] };
  }

  /** `pnpm [options] <command> …` */
  resolvePnpm(args, cwd, chain) {
    const selection = { filters: [], recursive: false, workspaceRoot: false, ifPresent: false, dir: cwd };
    let i = this.consumePnpmOptions(args, 0, selection, cwd);
    const sub = args[i];
    if (sub === undefined) return [];
    let rest = args.slice(i + 1);

    if (sub === "run" || sub === "run-script") {
      const j = this.consumePnpmOptions(rest, 0, selection, cwd);
      const script = rest[j];
      if (script === undefined) return [];
      return this.runInTargets(selection, script, scriptArgs(rest.slice(j + 1)), chain);
    }
    if (sub === "exec") {
      const j = this.consumePnpmOptions(rest, 0, selection, cwd);
      rest = rest.slice(j);
      if (rest[0] === "--") rest = rest.slice(1);
      return this.targets(selection).flatMap((pkg) => this.resolveArgv(rest, pkg.dir, chain).leaves);
    }
    if (sub === "test" || sub === "t" || sub === "tst") return this.runInTargets(selection, "test", scriptArgs(rest), chain);
    if (sub === "start" || sub === "restart" || sub === "stop") return this.runInTargets(selection, sub, scriptArgs(rest), chain);
    if (PNPM_BUILTINS.has(sub)) return [];
    // `pnpm <name>`: a script when one exists, otherwise `pnpm exec <name>`.
    const targets = this.targets(selection);
    if (targets.some((pkg) => sub in pkg.scripts)) return this.runInTargets(selection, sub, scriptArgs(rest), chain);
    return targets.flatMap((pkg) => this.resolveArgv([sub, ...rest], pkg.dir, chain).leaves);
  }

  consumePnpmOptions(args, start, selection, cwd) {
    let i = start;
    while (i < args.length && args[i].startsWith("-") && args[i] !== "--") {
      const option = args[i];
      const [flag, inlineValue] = option.includes("=") ? [option.slice(0, option.indexOf("=")), option.slice(option.indexOf("=") + 1)] : [option, undefined];
      const takesValue = PNPM_VALUE_OPTIONS.has(flag) && inlineValue === undefined;
      const value = inlineValue ?? (takesValue ? args[i + 1] : undefined);
      if (flag === "--filter" || flag === "-F" || flag === "--filter-prod") selection.filters.push(value ?? "");
      else if (flag === "-r" || flag === "--recursive") selection.recursive = true;
      else if (flag === "-w" || flag === "--workspace-root") selection.workspaceRoot = true;
      else if (flag === "-C" || flag === "--dir") selection.dir = path.resolve(cwd, value ?? ".");
      else if (flag === "--if-present") selection.ifPresent = true;
      i += takesValue ? 2 : 1;
    }
    return i;
  }

  targets(selection) {
    if (selection.workspaceRoot) return [this.ws.root];
    if (selection.filters.length > 0) return this.selectPackages(selection.filters);
    if (selection.recursive) return this.ws.packages;
    const pkg = packageAt(this.ws, selection.dir);
    return pkg ? [pkg] : [];
  }

  /** pnpm `--filter` selectors: package names (globs) or `./dir` patterns; `!` negates. */
  selectPackages(filters) {
    const included = new Set();
    const excluded = new Set();
    let positive = false;
    for (const raw of filters) {
      let filter = raw;
      let negate = false;
      if (filter.startsWith("!")) {
        negate = true;
        filter = filter.slice(1);
      }
      // Dependency selectors (`foo...`, `...foo`, `foo^...`) are approximated by their anchor.
      filter = filter.replace(/^\.\.\.\^?/, "").replace(/\^?\.\.\.$/, "").replace(/\[[^\]]*\]$/, "");
      const braces = filter.match(/^\{(.+)\}$/);
      if (braces) filter = `./${braces[1].replace(/^\.\//, "")}`;
      const byDir = filter.startsWith(".") || filter.startsWith("/");
      const matches = this.ws.all.filter((pkg) => (byDir ? matchesDir(pkg, filter, this.ws.rootDir) : matchesName(pkg, filter)));
      if (!negate) positive = true;
      for (const pkg of matches) (negate ? excluded : included).add(pkg);
    }
    const base = positive ? [...included] : this.ws.packages;
    return base.filter((pkg) => !excluded.has(pkg));
  }

  runInTargets(selection, script, extraArgs, chain) {
    return this.targets(selection).flatMap((pkg) => this.runScript(pkg, script, extraArgs, selection.ifPresent, chain));
  }

  /** Runs a package.json script, including its pre/post hooks. */
  runScript(pkg, name, extraArgs, ifPresent, chain) {
    const script = pkg.scripts[name];
    if (script === undefined) {
      if (!ifPresent) this.problem(chain, `package ${pkg.name} has no "${name}" script`);
      return [];
    }
    const key = `${pkg.dir}\0${name}`;
    if (this.stack.has(key)) {
      this.problem(chain, `script "${name}" in ${pkg.name} calls itself`);
      return [];
    }
    this.stack.add(key);
    const leaves = [];
    for (const hook of [`pre${name}`, name, `post${name}`]) {
      if (!(hook in pkg.scripts)) continue;
      const command = hook === name && extraArgs.length > 0 ? `${script} ${extraArgs.map(shellQuote).join(" ")}` : pkg.scripts[hook];
      leaves.push(...this.resolveCommand(command, pkg.dir, [...chain, `${pkg.name} ${hook}`]));
    }
    this.stack.delete(key);
    return leaves;
  }

  /** `npm run X`, `npm test`, `npm exec …` in the package at cwd. */
  resolveNpm(args, cwd, chain) {
    const pkg = packageAt(this.ws, cwd);
    if (!pkg) return [];
    let i = 0;
    while (args[i]?.startsWith("-")) i += ["--prefix", "-C", "-w", "--workspace"].includes(args[i]) ? 2 : 1;
    const sub = args[i];
    const rest = args.slice(i + 1);
    if (sub === "run" || sub === "run-script" || sub === "rum" || sub === "urn") {
      return rest[0] ? this.runScript(pkg, rest[0], scriptArgs(rest.slice(1)), false, chain) : [];
    }
    if (sub === "test" || sub === "t" || sub === "tst") return this.runScript(pkg, "test", scriptArgs(rest), false, chain);
    if (sub === "start" || sub === "restart" || sub === "stop") return this.runScript(pkg, sub, scriptArgs(rest), false, chain);
    if (sub === "exec" || sub === "x") return this.resolveArgv(rest[0] === "--" ? rest.slice(1) : rest, cwd, chain).leaves;
    return [];
  }

  /** `yarn X` / `yarn run X` / `yarn workspace <name> X`. */
  resolveYarn(args, cwd, chain) {
    let pkg = packageAt(this.ws, cwd);
    let rest = args;
    if (rest[0] === "workspace") {
      pkg = this.ws.all.find((candidate) => candidate.name === rest[1]) ?? null;
      rest = rest.slice(2);
    }
    if (!pkg) return [];
    if (rest[0] === "run") rest = rest.slice(1);
    if (rest[0] === "exec") return this.resolveArgv(rest.slice(1), pkg.dir, chain).leaves;
    if (!rest[0] || rest[0].startsWith("-")) return [];
    if (rest[0] in pkg.scripts) return this.runScript(pkg, rest[0], scriptArgs(rest.slice(1)), false, chain);
    return this.resolveArgv(rest, pkg.dir, chain).leaves;
  }

  problem(chain, message) {
    this.problems.push(`${chain.join(" → ")}: ${message}`);
  }
}

function scriptArgs(args) {
  return args[0] === "--" ? args.slice(1) : args;
}

function shellQuote(arg) {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function matchesName(pkg, pattern) {
  return pkg.name === pattern || path.matchesGlob(pkg.name, pattern);
}

function matchesDir(pkg, pattern, rootDir) {
  const normalized = pattern.replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (normalized === "." || normalized === "/") return pkg.isRoot;
  const rel = pkg.isRoot ? "." : path.relative(rootDir, pkg.dir);
  return rel === normalized || rel.startsWith(`${normalized}/`) || path.matchesGlob(rel, normalized);
}
