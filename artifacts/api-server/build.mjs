import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

// Where the bundle lands. Defaults to ./dist (what `pnpm start` and the
// deployment run). Validation scripts set API_SERVER_OUT_DIR so each run gets
// a private copy: a parallel `pnpm run build` (dev workflow, workspace-build)
// empties ./dist, and a test that had just built there would otherwise start
// against a missing dist/index.mjs. The directory must stay inside this
// artifact so externalized packages still resolve from its node_modules.
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

async function buildAll() {
  const distDir = resolveOutDir();
  await rm(distDir, { recursive: true, force: true });

  // Copy DB migrations so they are available at runtime from dist/migrations/
  const migrationsSource = path.resolve(artifactDir, "../../lib/db/migrations");
  await cp(migrationsSource, path.resolve(distDir, "migrations"), { recursive: true });

  await esbuild(
    bundleOptions({
      entryPoints: [path.resolve(artifactDir, "src/index.ts")],
      outdir: distDir,
    }),
  );
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
