// The end-to-end tests only ever touch DATABASE_URL_TEST (like `npm test`, they wipe it).
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/** DATABASE_URL pointed at the test database, after the same checks as scripts/test.mjs. */
export function testDatabaseEnv(): { DATABASE_URL: string; DATABASE_URL_TEST: string } {
  const { DATABASE_URL, DATABASE_URL_TEST } = process.env;
  if (!DATABASE_URL_TEST) throw new Error("DATABASE_URL_TEST is not set in .env.local (see .env.example).");
  if (DATABASE_URL_TEST === DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL: the end-to-end tests wipe their database.");
  }
  return { DATABASE_URL: DATABASE_URL_TEST, DATABASE_URL_TEST };
}
