// The test-only sign-in provider must not exist outside the end-to-end test server.
// Starts real servers the way people run the app and asks Auth.js which providers it offers:
// - `next dev` (development) pointed at the test database;
// - a `next build` production build, started with NODE_ENV=test and the test database,
//   the most permissive runtime settings (the build itself must have dropped the provider).
// tests/test-sign-in.test.ts checks the same rule without servers.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { TEST_PROVIDER_ID } from "./support/app";
import { testDatabaseEnv } from "./support/env";
import { OWNER } from "./support/users";

type Server = { url: string; proc: ChildProcess; output: () => string };

function start(command: string, port: number, env: Record<string, string>): Server {
  let output = "";
  const proc = spawn(`${command} --port ${port}`, { shell: true, env: { ...process.env, ...env } });
  proc.stdout?.on("data", (d) => (output += d));
  proc.stderr?.on("data", (d) => (output += d));
  return { url: `http://localhost:${port}`, proc, output: () => output };
}

function stop(server: Server | undefined) {
  if (!server?.proc.pid || server.proc.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.proc.pid), "/T", "/F"]);
  else server.proc.kill("SIGTERM");
}

async function providers(server: Server): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (server.proc.exitCode !== null) throw new Error(`server exited:\n${server.output()}`);
    try {
      const res = await fetch(`${server.url}/api/auth/providers`);
      if (res.ok) return (await res.json()) as Record<string, unknown>;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`server didn't answer:\n${server.output()}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Try the test provider's callback directly; a real sign-in would set a session cookie. */
async function trySignIn(server: Server): Promise<string[]> {
  const csrf = await fetch(`${server.url}/api/auth/csrf`);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${server.url}/api/auth/callback/${TEST_PROVIDER_ID}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ csrfToken, email: OWNER.email, callbackUrl: "/" }),
  });
  return res.headers.getSetCookie().filter((c) => c.includes("session-token="));
}

const base = { ...testDatabaseEnv(), ALLOWED_EMAILS: OWNER.email };

test.describe("test sign-in provider is unavailable outside tests", () => {
  test.setTimeout(900_000);

  test("the e2e test server offers it (control)", async ({ request }) => {
    const res = await request.get("/api/auth/providers");
    expect(Object.keys(await res.json())).toEqual(expect.arrayContaining(["google", TEST_PROVIDER_ID]));
  });

  test("development server", async () => {
    const server = start("npx next dev", 3101, { ...base, NODE_ENV: "development", NEXT_DIST_DIR: ".next-e2e-dev" });
    try {
      const list = await providers(server);
      expect(Object.keys(list)).toContain("google");
      expect(Object.keys(list)).not.toContain(TEST_PROVIDER_ID);
      expect(await trySignIn(server), "no session cookie").toEqual([]);
    } finally {
      stop(server);
    }
  });

  test("production build", async () => {
    const dist = ".next-e2e-prod";
    const build = spawnSync("npx next build", {
      shell: true,
      encoding: "utf8",
      env: { ...process.env, ...base, NODE_ENV: "production", NEXT_DIST_DIR: dist },
    });
    expect(build.status, `next build failed:\n${build.stdout}\n${build.stderr}`).toBe(0);

    const server = start("npx next start", 3102, { ...base, NODE_ENV: "test", NEXT_DIST_DIR: dist });
    try {
      const list = await providers(server);
      expect(Object.keys(list)).toContain("google");
      expect(Object.keys(list)).not.toContain(TEST_PROVIDER_ID);
      expect(await trySignIn(server), "no session cookie").toEqual([]);
    } finally {
      stop(server);
    }
  });
});
