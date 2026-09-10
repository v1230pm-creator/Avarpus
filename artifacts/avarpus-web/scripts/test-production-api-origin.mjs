import assert from "node:assert/strict";
import test from "node:test";

import { validateProductionApiOrigin } from "./validate-production-api-origin.mjs";

const failureCases = [
  {
    name: "rejects missing configuration",
    value: undefined,
    message:
      "VITE_API_URL is missing. Set it to the public HTTPS origin of the production Avarpus API.",
  },
  {
    name: "rejects blank configuration",
    value: "   ",
    message:
      "VITE_API_URL is missing. Set it to the public HTTPS origin of the production Avarpus API.",
  },
  {
    name: "rejects localhost",
    value: "https://localhost",
    message:
      'VITE_API_URL must point to the public production API, not "localhost".',
  },
  {
    name: "rejects IPv4 loopback",
    value: "https://127.0.0.1",
    message:
      'VITE_API_URL must point to the public production API, not "127.0.0.1".',
  },
  {
    name: "rejects IPv6 loopback",
    value: "https://[::1]",
    message:
      'VITE_API_URL must point to the public production API, not "[::1]".',
  },
  {
    name: "rejects the build-only placeholder",
    value: "https://build-validation.invalid",
    message:
      'VITE_API_URL must point to the public production API, not "build-validation.invalid".',
  },
  {
    name: "rejects malformed values",
    value: "not a URL",
    message:
      'VITE_API_URL must be a valid absolute HTTPS URL; received "not a URL".',
  },
  {
    name: "rejects non-HTTPS values",
    value: "http://api.example.com",
    message:
      'VITE_API_URL must use HTTPS; received "http://api.example.com".',
  },
];

for (const { name, value, message } of failureCases) {
  test(name, () => {
    assert.throws(
      () => validateProductionApiOrigin(value),
      (error) => {
        assert.equal(error.message, message);
        return true;
      },
    );
  });
}

test("accepts a valid HTTPS production origin without contacting the network", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error("network access is forbidden in this test");
  };

  try {
    const apiUrl = validateProductionApiOrigin("  https://api.example.com  ");
    assert.equal(apiUrl.origin, "https://api.example.com");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});