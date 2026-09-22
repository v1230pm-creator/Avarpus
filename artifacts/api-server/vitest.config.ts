import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        // One shared listening port per test process instead of one ephemeral
        // port per request; see src/test-support/supertest.ts for why.
        find: /^supertest$/,
        replacement: fileURLToPath(new URL("./src/test-support/supertest.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
