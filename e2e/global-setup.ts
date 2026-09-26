// Before the end-to-end run: migrate the test database, wipe it and seed the shared workspace.
import { spawnSync } from "node:child_process";
import { testDatabaseEnv } from "./support/env";

export default function globalSetup() {
  // No migrate advisory lock: through a pooled (pgbouncer) URL the lock can outlive the run and
  // block every later migrate. Only this run touches the test database.
  const env = { ...process.env, ...testDatabaseEnv(), CC_TEST_DB: "1", PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1" };
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  };
  run("npx", ["prisma", "migrate", "deploy"]);
  run("node", ["--import", "./scripts/test-hooks.mjs", "--import", "tsx", "e2e/support/seed-db.ts"]);
}
