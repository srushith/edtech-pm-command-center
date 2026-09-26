// End-to-end tests: `npm run test:e2e` (see TESTING.md).
//
// The app runs under `next dev` with NODE_ENV=test against DATABASE_URL_TEST, the only setup in
// which the test-only sign-in provider exists (lib/auth/test-sign-in.ts). It builds into its own
// folder (.next-e2e) and port, so it runs alongside `npm run dev`. The test database is wiped.
import { defineConfig, devices } from "@playwright/test";
import { testDatabaseEnv } from "./e2e/support/env";
import { OWNER } from "./e2e/support/users";

export const E2E_PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One worker: the tests share one dev server, and the sign-in guard builds the app.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // `next dev` compiles each page on its first visit.
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${E2E_PORT}`,
    navigationTimeout: 90_000,
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next dev --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/signin`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...testDatabaseEnv(),
      NODE_ENV: "test",
      NEXT_DIST_DIR: ".next-e2e",
      ALLOWED_EMAILS: OWNER.email,
      // AI stays on the mock provider: the test workspaces have no key.
      CC_AI: "",
    },
  },
});
