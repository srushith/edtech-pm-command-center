import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Secrets live only in .env.local (gitignored). Already-set variables win, so the
// test runner can point DATABASE_URL at the test database.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Not env(): that throws when unset, and `prisma generate` doesn't need a database.
    url: process.env.DATABASE_URL,
  },
});
