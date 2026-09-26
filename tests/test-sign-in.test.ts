// The test-only sign-in provider (lib/auth/test-sign-in.ts) must never exist outside the
// end-to-end test server. e2e/sign-in-guard.spec.ts checks real dev and production servers too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { runtimeEnvVar, testSignInEnabled } from "@/lib/auth/test-sign-in";

const TEST_DB = "postgres://test-branch";
const MAIN_DB = "postgres://main-branch";
const env = (over: Partial<Parameters<typeof testSignInEnabled>[0]>) =>
  testSignInEnabled({ buildEnv: "development", runtimeEnv: "test", databaseUrl: TEST_DB, testDatabaseUrl: TEST_DB, ...over });

describe("test sign-in provider", () => {
  test("on for `next dev` with NODE_ENV=test against DATABASE_URL_TEST", () => {
    assert.equal(env({}), true);
  });

  test("off in development", () => {
    assert.equal(env({ runtimeEnv: "development" }), false);
    assert.equal(env({ runtimeEnv: undefined }), false);
  });

  test("off in any production build, even when the server is started with NODE_ENV=test", () => {
    assert.equal(env({ buildEnv: "production" }), false);
    assert.equal(env({ buildEnv: "production", runtimeEnv: "production" }), false);
  });

  test("off unless DATABASE_URL is the test database", () => {
    assert.equal(env({ databaseUrl: MAIN_DB }), false);
    assert.equal(env({ testDatabaseUrl: undefined, databaseUrl: undefined }), false);
    assert.equal(env({ testDatabaseUrl: "", databaseUrl: "" }), false);
  });

  test("runtimeEnvVar reads the live environment", () => {
    process.env.CC_E2E_PROBE = "on";
    assert.equal(runtimeEnvVar("CC_E2E_PROBE"), "on");
    delete process.env.CC_E2E_PROBE;
    assert.equal(runtimeEnvVar("CC_E2E_PROBE"), undefined);
  });

  test("Auth.js config gates it on the build-time NODE_ENV, not only the runtime one", () => {
    const src = readFileSync("lib/auth/index.ts", "utf8");
    // The literal `process.env.NODE_ENV` is what Next inlines ("production" in `next build`).
    assert.match(src, /process\.env\.NODE_ENV !== "production" &&[^\n]*\n\s*testSignInEnabled\(/);
    // The runtime NODE_ENV must be looked up by key: Next inlines `process.env.NODE_ENV`.
    assert.match(src, /runtimeEnv: runtimeEnvVar\("NODE_ENV"\)/);
    assert.match(src, /databaseUrl: runtimeEnvVar\("DATABASE_URL"\)/);
    assert.match(src, /providers: withTestSignIn \? \[Google, testSignInProvider\(\)\] : \[Google\]/);
    assert.equal((src.match(/testSignInProvider\(\)/g) ?? []).length, 1, "registered in one place only");
  });
});
