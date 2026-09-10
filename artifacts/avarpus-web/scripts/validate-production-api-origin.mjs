import { pathToFileURL } from "node:url";

const variableName = "VITE_API_URL";
const healthPath = "/api/healthz";
const healthTimeoutMs = 5_000;

function fail(message) {
  console.error(`[deployment-readiness] ${message}`);
  process.exit(1);
}

export function validateProductionApiOrigin(value) {
  const rawValue = value?.trim();

  if (!rawValue) {
    throw new Error(
      `${variableName} is missing. Set it to the public HTTPS origin of the production Avarpus API.`,
    );
  }

  let apiUrl;
  try {
    apiUrl = new URL(rawValue);
  } catch {
    throw new Error(
      `${variableName} must be a valid absolute HTTPS URL; received "${rawValue}".`,
    );
  }

  if (apiUrl.protocol !== "https:") {
    throw new Error(`${variableName} must use HTTPS; received "${rawValue}".`);
  }

  const hostname = apiUrl.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const blockedHostnames = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "build-validation.invalid",
  ]);

  if (
    blockedHostnames.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".build-validation.invalid")
  ) {
    throw new Error(
      `${variableName} must point to the public production API, not "${apiUrl.hostname}".`,
    );
  }

  if (
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.pathname !== "/" ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error(
      `${variableName} must be an origin only (for example, https://api.example.com) with no credentials, path, query, or fragment.`,
    );
  }

  return apiUrl;
}

async function main() {
  let apiUrl;
  try {
    apiUrl = validateProductionApiOrigin(process.env[variableName]);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  console.log(
    `[deployment-readiness] Avarpus Web production API origin is valid: ${apiUrl.origin}`,
  );

  const healthUrl = new URL(healthPath, apiUrl.origin);
  let response;

  try {
    response = await fetch(healthUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(healthTimeoutMs),
    });
  } catch (error) {
  const causeCode =
    error && typeof error === "object" && "cause" in error
      ? error.cause?.code
      : undefined;

  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    fail(
      `Production API health check timed out after ${healthTimeoutMs / 1_000} seconds: ${healthUrl}`,
    );
  }

  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    fail(
      `Production API health check could not resolve DNS for "${apiUrl.hostname}" (${causeCode}).`,
    );
  }

  if (
    typeof causeCode === "string" &&
    (causeCode.startsWith("ERR_TLS") ||
      causeCode.startsWith("CERT_") ||
      causeCode.includes("CERT"))
  ) {
    fail(
      `Production API health check failed TLS verification for "${apiUrl.hostname}" (${causeCode}).`,
    );
  }

  fail(
    `Production API health check could not connect to ${healthUrl}${causeCode ? ` (${causeCode})` : ""}.`,
  );
  }

  if (!response.ok) {
    fail(
      `Production API health check returned HTTP ${response.status} ${response.statusText || "(no status text)"} from ${healthUrl}.`,
    );
  }

const contentType = response.headers.get("content-type") ?? "";
if (!contentType.toLowerCase().includes("application/json")) {
  fail(
    `Production API health check returned unexpected content type "${contentType || "(missing)"}"; expected application/json from ${healthUrl}.`,
  );
}

let health;
try {
  health = await response.json();
} catch {
  fail(
    `Production API health check returned invalid JSON from ${healthUrl}; expected {"status":"ok"}.`,
  );
}

if (
  !health ||
  typeof health !== "object" ||
  Array.isArray(health) ||
  health.status !== "ok" ||
  Object.keys(health).length !== 1
) {
  fail(
    `Production API health check returned an unexpected response from ${healthUrl}; expected {"status":"ok"}.`,
  );
}

  console.log(
    `[deployment-readiness] Production Avarpus API health check passed: ${healthUrl}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
