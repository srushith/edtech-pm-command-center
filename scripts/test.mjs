// npm test: run the suite against DATABASE_URL_TEST, never the main database.
// Applies migrations to the test database first; the tests truncate it freely.
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const { DATABASE_URL, DATABASE_URL_TEST } = process.env;
if (!DATABASE_URL_TEST) {
  console.error("DATABASE_URL_TEST is not set in .env.local (see .env.example).");
  process.exit(1);
}
if (DATABASE_URL_TEST === DATABASE_URL) {
  console.error("DATABASE_URL_TEST must differ from DATABASE_URL: the tests wipe their database.");
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: DATABASE_URL_TEST, CC_TEST_DB: "1" };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("npx", ["prisma", "migrate", "deploy"]);
run("node", ["--import", "tsx", "--test", "--test-concurrency=1", ...(process.argv.slice(2).length ? process.argv.slice(2) : ["tests/**/*.test.ts"])]);
