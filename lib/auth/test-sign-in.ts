// Test-only sign-in for the Playwright end-to-end tests: Google OAuth can't be automated.
//
// It exists only when all of these hold:
// - the code wasn't built for production. lib/auth/index.ts checks `process.env.NODE_ENV`,
//   which Next inlines at build time, so a production build drops the provider whatever
//   the server's environment says at runtime;
// - the server runs with NODE_ENV=test (read at runtime; `next dev` inlines "development");
// - DATABASE_URL points at DATABASE_URL_TEST, the database the tests wipe.
// `npm run test:e2e` starts `next dev` that way. tests/test-sign-in.test.ts checks the rule, and
// e2e/sign-in-guard.spec.ts checks real development and production servers don't offer it.
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/access";

export const TEST_PROVIDER_ID = "test-login";

export type TestSignInEnv = {
  /** process.env.NODE_ENV as the bundler saw it (inlined by Next). */
  buildEnv: string | undefined;
  /** NODE_ENV of the running server process. */
  runtimeEnv: string | undefined;
  databaseUrl: string | undefined;
  testDatabaseUrl: string | undefined;
};

/**
 * An environment variable as the running server sees it. Next replaces `process.env.NODE_ENV`
 * (even through an alias like `const env = process.env; env.NODE_ENV`) with the build's value,
 * "development" under `next dev`; a lookup by a runtime key is left alone.
 */
export function runtimeEnvVar(name: string): string | undefined {
  return process.env[name];
}

export function testSignInEnabled(env: TestSignInEnv): boolean {
  return (
    env.buildEnv !== "production" &&
    env.runtimeEnv === "test" &&
    !!env.testDatabaseUrl &&
    env.databaseUrl === env.testDatabaseUrl
  );
}

/**
 * Signs in as any email, no password. Invite-only still applies: the signIn callback in
 * lib/auth/index.ts turns away emails that aren't admins, members or invitees.
 */
export function testSignInProvider() {
  return Credentials({
    id: TEST_PROVIDER_ID,
    name: "Test sign-in",
    credentials: { email: { label: "Email" }, name: { label: "Name" } },
    async authorize(credentials) {
      const email = normalizeEmail(String(credentials?.email ?? ""));
      if (!email.includes("@")) return null;
      const name = String(credentials?.name ?? "").trim() || null;
      const user = await db.user.upsert({ where: { email }, create: { email, name }, update: {} });
      return { id: user.id, email: user.email, name: user.name };
    },
  });
}
