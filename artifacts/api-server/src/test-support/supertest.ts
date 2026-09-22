/**
 * Test-only stand-in for the bare `supertest` import. vitest.config.ts aliases
 * `supertest` to this file, so every `import request from "supertest"` in the
 * suites goes through here without the test files changing.
 *
 * Stock supertest creates a new http.Server on a fresh ephemeral port for EVERY
 * `request(app).get(...)` call and closes it after the response. The Replit
 * workspace supervisor tracks each newly seen listening port and keeps a few MB
 * per port for the life of the container, so one run of these suites (~500
 * requests) grew it by ~1.4 GB per run until it crashed and took every workflow
 * and any in-flight validation run down with it.
 *
 * This wrapper hands supertest one already-listening server per app object,
 * bound to a fixed port when that port is free, so a whole run opens a single
 * port. supertest only calls `listen(0)` itself when the server it is given has
 * no address yet, and it only closes servers it started.
 */
import http from "node:http";
import realSupertest from "supertest/index.js";
import type { AgentOptions, App } from "supertest/types";

type SuperTestStatic = typeof realSupertest;

/** Kept clear of the fixed ports the spawn-server scripts under scripts/ use (5641–5694). */
const SHARED_PORT = Number(process.env["API_TEST_SHARED_PORT"] ?? 5799);

const sharedServers = new WeakMap<object, http.Server>();

/**
 * Without a host argument Node binds synchronously; a bind failure such as
 * EADDRINUSE surfaces as an asynchronous 'error' event and address() stays null.
 */
function listenSync(server: http.Server, port: number): boolean {
  const swallowBindError = () => {};
  server.once("error", swallowBindError);
  server.listen(port);
  if (server.address() === null) return false;
  server.off("error", swallowBindError);
  return true;
}

function sharedServer(app: http.RequestListener): http.Server {
  const existing = sharedServers.get(app);
  if (existing?.listening) return existing;

  const server = http.createServer(app);
  server.unref(); // a finished test worker must never be kept alive by this socket
  if (!listenSync(server, SHARED_PORT)) {
    // Another vitest process (a by-hand run next to the validation run, a stale
    // worker) holds the fixed port: fall back to one ephemeral port per process.
    const fallback = http.createServer(app);
    fallback.unref();
    fallback.listen(0);
    sharedServers.set(app, fallback);
    return fallback;
  }
  sharedServers.set(app, server);
  return server;
}

function resolveApp(app: App, options?: { http2?: boolean }): App {
  // Strings and servers are used as given; http2 needs supertest's own server.
  if (typeof app !== "function" || options?.http2) return app;
  return sharedServer(app as http.RequestListener);
}

const request = ((app: App, options?: AgentOptions) =>
  realSupertest(resolveApp(app, options), options)) as SuperTestStatic;

// Works with and without `new`, like supertest's own agent factory.
function agent(app?: App, options?: AgentOptions) {
  return realSupertest.agent(app === undefined ? undefined : resolveApp(app, options), options);
}

Object.assign(request, realSupertest, { agent: agent as unknown as SuperTestStatic["agent"] });

export default request;
