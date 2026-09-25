import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

// Where the bundle lands. Defaults to ./dist (what `pnpm start` and the
// deployment run). Validation scripts set API_SERVER_OUT_DIR so each run gets
// a private copy: a parallel `pnpm run build` (dev workflow, workspace-build)
// replaces the files in ./dist, and a test would otherwise run a bundle it did
// not build (or, before builds were staged, start against a missing
// dist/index.mjs). The directory must stay inside this artifact so
// externalized packages still resolve from its node_modules.
function resolveOutDir() {
  const override = process.env.API_SERVER_OUT_DIR;
  if (!override) return path.resolve(artifactDir, "dist");
  const outDir = path.resolve(artifactDir, override);
  const relative = path.relative(artifactDir, outDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `API_SERVER_OUT_DIR must point inside ${artifactDir} (got ${override})`,
    );
  }
  if (relative === "src" || relative === "scripts" || relative === "node_modules") {
    throw new Error(`API_SERVER_OUT_DIR must not be ${relative}/`);
  }
  return outDir;
}

// esbuild options for bundling this artifact's TypeScript for Node. The server
// bundle (src/index.ts → dist/index.mjs) is the main consumer; validation
// scripts reuse the same options to bundle a single library module (for
// example the relay purge) into their private run directory, so a test drives
// the exact code the server ships instead of a hand-maintained copy.
export function bundleOptions({ entryPoints, outdir }) {
  return {
    entryPoints,
    platform: "node",
    bundle: true,
    format: "esm",
    outdir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  };
}

// Write `bytes` to `target` through a sibling temp file and an atomic rename,
// so a reader sees either the previous complete file or the new one.
async function writeFileAtomically(target, bytes) {
  await mkdir(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(tempPath, bytes);
    await rename(tempPath, target);
  } finally {
    await rm(tempPath, { force: true });
  }
}

// Remove every file under `distDir` that this build did not produce, then any
// directory left empty by that.
async function removeStaleOutputs(distDir, produced) {
  const staleFiles = [];
  const directories = [];
  for (const entry of await readdir(distDir, { recursive: true, withFileTypes: true })) {
    const relativePath = path.relative(distDir, path.join(entry.parentPath, entry.name));
    if (entry.isDirectory()) directories.push(relativePath);
    else if (entry.isFile() && !produced.has(relativePath)) staleFiles.push(relativePath);
  }
  for (const relativePath of staleFiles) {
    await rm(path.join(distDir, relativePath), { force: true });
  }
  // Deepest first, so a directory whose only contents were stale goes too.
  directories.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const relativePath of directories) {
    const remaining = await readdir(path.join(distDir, relativePath));
    if (remaining.length === 0) await rm(path.join(distDir, relativePath), { recursive: true });
  }
}

// The output directory is never emptied wholesale. esbuild bundles in memory
// (with `outdir` set to the real destination, because esbuild-plugin-pino bakes
// that absolute path into the bundle for its worker files) and the migration
// files are read up front, so nothing in dist/ changes until every byte of the
// new build is known. Each file is then swapped in atomically, worker bundles
// and migrations first and the entry point last, and only afterwards are files
// from an earlier build removed. A server that is starting up — `pnpm run dev`
// right after its own build, or the deployment — therefore always finds a
// complete dist/index.mjs whose worker files are already in place, even while
// another `pnpm run build` (workspace-build, a validation step) lands at the
// same moment. Before this, the workflow died with MODULE_NOT_FOUND whenever
// the two overlapped.
const ENTRY_OUTPUT = "index.mjs";

async function buildAll() {
  const distDir = resolveOutDir();

  const result = await esbuild({
    ...bundleOptions({
      entryPoints: [path.resolve(artifactDir, "src/index.ts")],
      outdir: distDir,
    }),
    write: false,
  });
  const files = new Map();
  for (const output of result.outputFiles) {
    const relativePath = path.relative(distDir, output.path);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(`esbuild emitted ${output.path} outside ${distDir}`);
    }
    files.set(relativePath, output.contents);
  }
  if (!files.has(ENTRY_OUTPUT)) {
    throw new Error(`esbuild did not emit ${ENTRY_OUTPUT}`);
  }

  // Copy DB migrations so they are available at runtime from dist/migrations/
  const migrationsSource = path.resolve(artifactDir, "../../lib/db/migrations");
  for (const entry of await readdir(migrationsSource, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const sourcePath = path.join(entry.parentPath, entry.name);
    const relativePath = path.join("migrations", path.relative(migrationsSource, sourcePath));
    files.set(relativePath, await readFile(sourcePath));
  }

  await mkdir(distDir, { recursive: true });
  const installOrder = [...files.keys()].sort((a, b) =>
    a === ENTRY_OUTPUT ? 1 : b === ENTRY_OUTPUT ? -1 : a.localeCompare(b),
  );
  for (const relativePath of installOrder) {
    await writeFileAtomically(path.join(distDir, relativePath), files.get(relativePath));
  }

  await removeStaleOutputs(distDir, new Set(files.keys()));
}

// Build only when run as a script (`node ./build.mjs`); importing this module
// for `bundleOptions` must not touch dist/.
const invokedDirectly =
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  buildAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
