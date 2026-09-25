// AI settings and the provider seam: encryption, owner-only edits, keys never leaving the
// server, "Test key", real-provider routing (fake provider APIs), usage logging, the
// monthly limit, and a guard that nothing reaches a provider except through getAIProvider.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { db } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/roles";
import { getAIProvider, getAIMode } from "@/lib/ai/provider";
import { decryptSecret, encryptSecret, EncryptionConfigError } from "@/lib/crypto";
import { getAISettingsView, removeAIKey, saveAISettings, testAIKey } from "@/lib/data/ai-settings";
import { prepareMapping, type ImportSourceInput } from "@/lib/data/imports";
import { parseCsv } from "@/lib/import/parse";
import { ctx, makeUser, makeWorkspace, resetDb } from "./helpers";

const NOW = new Date("2026-09-26T12:00:00Z");
const KEY = "sk-test-SECRET-abcdef-1234";
const csv = (text: string): ImportSourceInput => ({ kind: "CSV", name: "c.csv", ...parseCsv(text) });
const COURSES = csv("Course code,Course name,Geo\nRAG,Retrieval Systems,US\nEVL,Evals,Global\n");

let owner: WorkspaceContext;
let editor: WorkspaceContext;
let viewer: WorkspaceContext;
let other: WorkspaceContext;

/** A fake of all three provider APIs. Records every request. */
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeProviders(opts: { status?: number; answer?: unknown } = {}) {
  const calls: Call[] = [];
  const answer = JSON.stringify(opts.answer ?? { suggestions: [
    { header: "Course code", field: "code", confidence: 0.95, reason: "Header says code; samples RAG, EVL" },
    { header: "Course name", field: "name", confidence: 0.9, reason: "Names of courses" },
    { header: "Geo", field: "region", confidence: 0.8, reason: "US / Global are regions" },
    { header: "Nope", field: "code", confidence: 0.99, reason: "unknown column is dropped" },
    { header: "Geo", field: "bogus", confidence: 0.99, reason: "unknown field is dropped" },
  ] });
  const f: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = req.url;
    const headers = Object.fromEntries(req.headers.entries());
    const text = req.method === "GET" ? "" : await req.text();
    calls.push({ url, method: req.method, headers, body: text ? JSON.parse(text) : null });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
    if (opts.status) return json({ error: { type: "authentication_error", message: "invalid x-api-key" } }, opts.status);
    if (url.includes("api.openai.com/v1/responses")) {
      return json({ output: [{ type: "message", content: [{ type: "output_text", text: answer }] }], usage: { input_tokens: 120, output_tokens: 40 } });
    }
    if (url.includes(":generateContent")) {
      return json({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 30 } });
    }
    if (url.includes("api.anthropic.com/v1/messages")) {
      return json({
        id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: answer }], usage: { input_tokens: 130, output_tokens: 50 },
      });
    }
    if (url.includes("/models")) return json({ id: "model", type: "model", display_name: "Model", created_at: "2026-01-01T00:00:00Z" });
    return json({ error: { message: "unexpected url " + url } }, 500);
  };
  return { fetch: f, calls };
}

before(async () => {
  await resetDb();
  const [o, e, v, b] = await Promise.all([makeUser("o@a.test", "Olivia"), makeUser("e@a.test"), makeUser("v@a.test"), makeUser("b@b.test")]);
  const wsA = await makeWorkspace(o.id, "A", { members: [[e.id, "EDITOR"], [v.id, "VIEWER"]] });
  const wsB = await makeWorkspace(b.id, "B");
  [owner, editor, viewer, other] = await Promise.all([ctx(o.id, wsA.id), ctx(e.id, wsA.id), ctx(v.id, wsA.id), ctx(b.id, wsB.id)]);
});
after(() => db.$disconnect());

describe("encryption", () => {
  test("round-trips, binds the purpose, detects tampering, needs ENCRYPTION_KEY", () => {
    const enc = encryptSecret(KEY, "ai-key");
    assert.ok(enc.startsWith("enc:v2:") && !enc.includes("SECRET"));
    assert.equal(decryptSecret(enc, "ai-key").value, KEY);
    assert.equal(decryptSecret(enc, "google-refresh-token").value, null, "wrong purpose");
    assert.equal(decryptSecret(enc.slice(0, -3) + "xyz", "ai-key").value, null, "tampered");
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    assert.throws(() => encryptSecret("x", "ai-key"), EncryptionConfigError);
    process.env.ENCRYPTION_KEY = "dG9vLXNob3J0";
    assert.throws(() => encryptSecret("x", "ai-key"), /32 bytes/);
    process.env.ENCRYPTION_KEY = saved;
  });
});

describe("settings: owners edit, keys stay on the server", () => {
  test("without a key the workspace uses the mock", async () => {
    assert.deepEqual(await getAIMode(owner), { kind: "mock" });
    const { provider } = await getAIProvider(owner);
    assert.equal(provider?.name, "Mock AI");
  });

  test("editors and viewers can't change, test or remove settings", async () => {
    for (const c of [editor, viewer]) {
      await assert.rejects(saveAISettings(c, { provider: "OPENAI", model: "gpt-6-luna", apiKey: KEY, monthlyRequestLimit: "" }), AccessError);
      await assert.rejects(testAIKey(c, { provider: "OPENAI", model: "gpt-6-luna", apiKey: KEY }), AccessError);
      await assert.rejects(removeAIKey(c), AccessError);
    }
  });

  test("the key is stored encrypted and never appears in what any member receives", async () => {
    await saveAISettings(owner, { provider: "OPENAI", model: "gpt-6-luna", apiKey: KEY, monthlyRequestLimit: "" });
    const row = await db.workspaceAISettings.findUniqueOrThrow({ where: { workspaceId: owner.workspace.id } });
    assert.ok(row.encryptedKey && !row.encryptedKey.includes(KEY));
    const ownerView = await getAISettingsView(owner, NOW);
    assert.equal(ownerView.keyMasked, "••••1234");
    assert.equal((await getAISettingsView(editor, NOW)).keyMasked, null, "masked key is owners-only");
    for (const c of [owner, editor, viewer]) {
      const json = JSON.stringify(await getAISettingsView(c, NOW));
      assert.ok(!json.includes(KEY) && !json.includes("SECRET") && !json.includes(row.encryptedKey!), "no key or ciphertext in the view");
    }
  });

  test("blank key keeps the saved one; switching provider requires a new key", async () => {
    await saveAISettings(owner, { provider: "OPENAI", model: "gpt-6-sol", apiKey: "", monthlyRequestLimit: "" });
    assert.equal((await getAISettingsView(owner, NOW)).keyMasked, "••••1234");
    await assert.rejects(saveAISettings(owner, { provider: "GEMINI", model: "gemini-3.8-flash", apiKey: "", monthlyRequestLimit: "" }), /Enter the Gemini API key/);
    await assert.rejects(saveAISettings(owner, { provider: "OPENAI", model: "bad model!", apiKey: "", monthlyRequestLimit: "" }), /model name/);
    await assert.rejects(saveAISettings(owner, { provider: "OPENAI", model: "gpt-6-luna", apiKey: "", monthlyRequestLimit: "0" }), /monthly limit/);
    await saveAISettings(owner, { provider: "OPENAI", model: "gpt-6-luna", apiKey: "", monthlyRequestLimit: "" });
  });
});

describe("Test key", () => {
  test("checks the saved key against the model, logs a test, records the result", async () => {
    const fake = fakeProviders();
    const r = await testAIKey(owner, { provider: "OPENAI", model: "gpt-6-luna", apiKey: "" }, { fetch: fake.fetch, now: NOW });
    assert.deepEqual(r, { ok: true, message: "Key works: OpenAI can use gpt-6-luna." });
    assert.equal(fake.calls[0].url, "https://api.openai.com/v1/models/gpt-6-luna");
    assert.equal(fake.calls[0].headers.authorization, `Bearer ${KEY}`);
    const view = await getAISettingsView(owner, NOW);
    assert.equal(view.lastTest?.ok, true);
    assert.equal(view.usage.thisMonth.tests, 1);
    assert.equal(view.usage.thisMonth.billable, 0, "tests don't count toward the limit");
  });

  test("each provider's rejection comes back as a readable message", async () => {
    for (const [provider, model] of [["OPENAI", "gpt-6-luna"], ["GEMINI", "gemini-3.8-flash"], ["ANTHROPIC", "claude-opus-5"]] as const) {
      const fake = fakeProviders({ status: 401 });
      const r = await testAIKey(owner, { provider, model, apiKey: "typed-key-000000" }, { fetch: fake.fetch, now: NOW });
      assert.equal(r.ok, false);
      assert.match(r.message, /rejected the API key/, provider);
    }
    // Testing a typed (unsaved) key doesn't overwrite the saved key's last result.
    assert.equal((await getAISettingsView(owner, NOW)).lastTest?.ok, true);
  });

  test("the saved key is tested only with its own provider", async () => {
    await assert.rejects(testAIKey(owner, { provider: "GEMINI", model: "gemini-3.8-flash", apiKey: "" }), /saved key is for OpenAI/);
  });
});

describe("real providers through getAIProvider", () => {
  const cases = [
    { provider: "OPENAI", model: "gpt-6-luna", endpoint: "https://api.openai.com/v1/responses", keyHeader: ["authorization", `Bearer ${KEY}`], tokens: [120, 40] },
    { provider: "GEMINI", model: "gemini-3.8-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", keyHeader: ["x-goog-api-key", KEY], tokens: [110, 30] },
    { provider: "ANTHROPIC", model: "claude-opus-5", endpoint: "https://api.anthropic.com/v1/messages", keyHeader: ["x-api-key", KEY], tokens: [130, 50] },
  ] as const;

  for (const c of cases) {
    test(`${c.provider}: import column mapping calls the workspace's provider with its key and logs tokens`, async () => {
      await saveAISettings(owner, { provider: c.provider, model: c.model, apiKey: KEY, monthlyRequestLimit: "" });
      assert.deepEqual(await getAIMode(owner), { kind: "live", provider: c.provider, model: c.model });
      const fake = fakeProviders();
      const before = await db.aIUsageEvent.count({ where: { workspaceId: owner.workspace.id, feature: "import.column-mapping" } });
      const help = await prepareMapping(owner, "course", COURSES, fake.fetch);

      const call = fake.calls.find((x) => x.url.startsWith(c.endpoint));
      assert.ok(call, `no request to ${c.endpoint}: ${fake.calls.map((x) => x.url).join(", ")}`);
      assert.equal(call.headers[c.keyHeader[0]], c.keyHeader[1]);
      assert.ok(!c.endpoint.includes(KEY) && !call.url.includes(KEY), "key never in the URL");
      assert.ok(JSON.stringify(call.body).includes("Course code"), "headers and samples are sent");
      assert.match(help.ai!.provider, new RegExp(c.model));
      assert.deepEqual(
        help.ai!.suggestions.map((s) => [s.header, s.field]),
        [["Course code", "code"], ["Course name", "name"], ["Geo", "region"]],
        "unknown columns/fields dropped",
      );
      if (c.provider === "ANTHROPIC") {
        assert.equal(call.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
        assert.equal((call.body as { fallbacks?: string }).fallbacks, "default");
      }
      const events = await db.aIUsageEvent.findMany({ where: { workspaceId: owner.workspace.id, feature: "import.column-mapping" }, orderBy: { createdAt: "asc" } });
      assert.equal(events.length, before + 1);
      const last = events[events.length - 1];
      assert.deepEqual([last.provider, last.model, last.inputTokens, last.outputTokens, last.ok], [c.provider, c.model, ...c.tokens, true]);
    });
  }

  test("a failing provider leaves mapping manual, with the reason, and logs the error", async () => {
    const fake = fakeProviders({ status: 401 });
    const help = await prepareMapping(owner, "course", COURSES, fake.fetch);
    assert.equal(help.ai, null);
    assert.match(help.aiNote!, /AI suggestions unavailable: Anthropic rejected the API key/);
    assert.equal(help.exact["Geo"], null, "manual mapping still available");
    const last = await db.aIUsageEvent.findFirstOrThrow({ where: { workspaceId: owner.workspace.id }, orderBy: { createdAt: "desc" } });
    assert.equal(last.ok, false);
  });

  test("a malformed answer is rejected, not trusted", async () => {
    const fake = fakeProviders({ answer: { wrong: true } });
    const help = await prepareMapping(owner, "course", COURSES, fake.fetch);
    assert.equal(help.ai, null);
    assert.match(help.aiNote!, /didn't match the expected shape/);
  });

  test("usage is per workspace: B sees none of A's", async () => {
    const b = await getAISettingsView(other, NOW);
    assert.equal(b.usage.thisMonth.requests, 0);
    assert.equal(b.hasKey, false);
    assert.deepEqual(b.mode, { kind: "mock" });
  });
});

describe("monthly limit", () => {
  test("reaching it turns AI off (not the mock) until next month", async () => {
    const used = await db.aIUsageEvent.count({ where: { workspaceId: owner.workspace.id, isTest: false } });
    await saveAISettings(owner, { provider: "ANTHROPIC", model: "claude-opus-5", apiKey: "", monthlyRequestLimit: String(used + 1) });
    const fake = fakeProviders();
    assert.ok((await prepareMapping(owner, "course", COURSES, fake.fetch)).ai, "last allowed request");
    const mode = await getAIMode(owner);
    assert.equal(mode.kind, "off");
    const help = await prepareMapping(owner, "course", COURSES, fake.fetch);
    assert.equal(help.ai, null);
    assert.match(help.aiNote!, /Monthly AI limit reached/);
    const { provider } = await getAIProvider(owner);
    assert.equal(provider, null, "never falls back to the mock");
    // Next month it's back on.
    const next = await getAIProvider(owner, { now: new Date("2026-10-01T00:00:01Z") });
    assert.ok(next.provider && next.provider.name !== "Mock AI");
  });

  test("CC_AI=off turns AI off everywhere", async () => {
    process.env.CC_AI = "off";
    assert.equal((await getAIProvider(other)).provider, null);
    delete process.env.CC_AI;
  });

  test("removing the key returns the workspace to the mock", async () => {
    await removeAIKey(owner);
    assert.deepEqual(await getAIMode(owner), { kind: "mock" });
  });
});

describe("no AI call bypasses getAIProvider", () => {
  const root = process.cwd();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".next", "generated", ".git"].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  for (const d of ["app", "components", "lib"]) walk(join(root, d));
  const rel = (p: string) => p.slice(root.length + 1).replaceAll("\\", "/");

  test("only lib/ai reaches providers, the mock, or provider SDKs", () => {
    const offenders = files
      .filter((f) => !rel(f).startsWith("lib/ai/"))
      .filter((f) => /from ["'](@\/lib\/ai\/(mock|providers\/[\w-]+|types|column-mapping|usage)|@anthropic-ai\/sdk|openai|@google\/genai)["']/.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map(rel).filter((f) => f !== "lib/data/ai-settings.ts"), []);
  });

  test("every AI feature call goes through getAIProvider", () => {
    const callers = files.filter((f) => /\.suggest\w+\(/.test(readFileSync(f, "utf8"))).map(rel);
    for (const f of callers.filter((f) => !f.startsWith("lib/ai/"))) {
      assert.match(readFileSync(join(root, f), "utf8"), /getAIProvider\(/, `${f} calls a provider method without getAIProvider`);
    }
    assert.deepEqual(callers.filter((f) => !f.startsWith("lib/ai/")), ["lib/data/imports.ts"]);
  });

  test("no client component imports server secrets or providers", () => {
    const client = files.filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")));
    const bad = client.filter((f) => /from ["']@\/lib\/(crypto|ai\/provider|ai\/providers\/[\w-]+|ai\/usage|data\/ai-settings)["']/.test(readFileSync(f, "utf8").replace(/import type [^;]+;/g, "")));
    assert.deepEqual(bad.map(rel), []);
  });
});
