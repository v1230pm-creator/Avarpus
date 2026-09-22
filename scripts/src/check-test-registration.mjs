#!/usr/bin/env node
/**
 * Test registration guard.
 *
 * Fails when any test file in any workspace package is not run by a
 * registered completion validation step (`.replit` workflows marked
 * `isValidation = true`). A file counts as covered when a step's command
 * resolves (through pnpm scripts, `flock`, `cd`, `sh -c`, …) to a runner
 * that discovers it: a Vitest or Jest catch-all whose config includes it,
 * a `node --test` glob, a `node <script>` invocation naming it, or a bare
 * runner script listing it by name. Anything the guard cannot follow is an
 * error too — a step it cannot read is not a step it can vouch for.
 *
 * Usage: node scripts/src/check-test-registration.mjs [--verbose]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resolver } from "./test-registration/resolve.mjs";
import { reachedBy } from "./test-registration/runners.mjs";
import { parseToml } from "./test-registration/toml.mjs";
import { collectTestFiles, loadWorkspace } from "./test-registration/workspace.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

function loadValidationSteps(file) {
  const config = parseToml(readFileSync(file, "utf8"), path.relative(rootDir, file));
  const workflows = config.workflows?.workflow ?? [];
  const steps = [];
  for (const workflow of workflows) {
    if (workflow.metadata?.isValidation !== true) continue;
    const commands = (workflow.tasks ?? [])
      .filter((task) => task.task === "shell.exec" && typeof task.args === "string")
      .map((task) => task.args);
    steps.push({ name: workflow.name ?? "(unnamed)", commands });
  }
  return steps;
}

function hintFor(file, runnersInPackage) {
  const relToPackage = path.relative(file.pkg.dir, file.file);
  if (file.kind === "script") {
    if (file.pkg.name === "@workspace/api-server") {
      return (
        `standalone test script; register a validation step for it: ` +
        `cd artifacts/api-server && flock /tmp/api-server-tests.lock node scripts/run-isolated.mjs ${relToPackage}`
      );
    }
    return "standalone test script; add it to a script chain a validation step runs, or register a step that runs it";
  }
  if (runnersInPackage.length > 0) {
    const names = [...new Set(runnersInPackage.map((leaf) => `${leaf.name} (step ${leaf.chain[0]})`))].join(", ");
    return `test suite outside the discovery rules of this package's completion runner ${names}; move it under the runner's include pattern or extend that pattern`;
  }
  return "test suite in a package no validation step runs a test runner in; add a catch-all runner script and register a step for it";
}

async function main() {
  const workspace = loadWorkspace(rootDir);
  const steps = loadValidationSteps(path.join(rootDir, ".replit"));
  const problems = [];
  if (steps.length === 0) problems.push(".replit: no validation steps (workflows with metadata.isValidation = true) found");

  const candidates = collectTestFiles(workspace);
  const coverage = new Map(candidates.map((candidate) => [candidate, new Set()]));
  const resolver = new Resolver(workspace);
  const leaves = [];
  for (const step of steps) {
    for (const leaf of resolver.resolveStep(step)) {
      leaves.push(leaf);
      for (const candidate of await reachedBy(leaf, candidates, { workspace, problems })) {
        coverage.get(candidate).add(step.name);
      }
    }
  }
  problems.push(...resolver.problems);

  if (verbose) {
    console.log(`Validation steps: ${steps.length}`);
    for (const step of steps) {
      console.log(`  ${step.name}`);
      for (const leaf of leaves.filter((l) => l.chain[0] === step.name && l.tool !== "other")) {
        console.log(`    ${path.relative(rootDir, leaf.cwd) || "."}$ ${leaf.chain[leaf.chain.length - 1]}`);
      }
    }
    console.log(`Test files: ${candidates.length}`);
    for (const candidate of candidates) {
      const by = [...coverage.get(candidate)];
      console.log(`  ${by.length > 0 ? "ok  " : "MISS"} ${candidate.rel}${by.length > 0 ? `  ← ${by.join(", ")}` : ""}`);
    }
    console.log("");
  }

  const missing = candidates.filter((candidate) => coverage.get(candidate).size === 0);
  if (missing.length === 0 && problems.length === 0) {
    console.log(
      `test-registration-guard: all ${candidates.length} test files across ${workspace.all.length} packages run at completion (${steps.length} validation steps).`,
    );
    return 0;
  }
  if (missing.length > 0) {
    console.error(`test-registration-guard: ${missing.length} test file(s) are not run by any validation step:\n`);
    for (const file of missing) {
      const runnersInPackage = leaves.filter((leaf) => leaf.tool !== "other" && leaf.tool !== "node" && path.relative(file.pkg.dir, leaf.cwd) === "");
      console.error(`  ${file.rel}`);
      console.error(`      ${hintFor(file, runnersInPackage)}`);
    }
    console.error("");
  }
  if (problems.length > 0) {
    console.error(`test-registration-guard: ${problems.length} step command(s) could not be followed:\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("");
  }
  console.error("Validation steps are registered through the validation tooling (never by editing .replit by hand); see replit.md → Gotchas.");
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`test-registration-guard: ${error.stack ?? error}`);
    process.exit(2);
  },
);
