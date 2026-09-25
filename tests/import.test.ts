// Imports: parsing, mapping, AI suggestions (mock), matching, validation reuse,
// saved mappings, Google Sheets sync (fake Google), roles and isolation.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/roles";
import { mockProvider } from "@/lib/ai/mock";
import {
  ImportError, listImportSources, prepareMapping, previewImport, runImport, syncImportSource,
  type ImportSourceInput,
} from "@/lib/data/imports";
import { runIntegrityChecks } from "@/lib/data/integrity";
import { saveRecord } from "@/lib/data/records";
import { scopedDb } from "@/lib/data/scoped";
import { getSearchIndex } from "@/lib/data/search";
import { decryptToken, encryptToken } from "@/lib/google/crypto";
import { parseSheetLink, SHEETS_SCOPE, SheetsError, type Fetch } from "@/lib/google/sheets";
import { exactMapping, headerSignature, importFields, mappingProblems } from "@/lib/import/mapping";
import { normalizeDate } from "@/lib/import/normalize";
import { parseCsv } from "@/lib/import/parse";
import { ctx, makeUser, makeWorkspace, resetDb } from "./helpers";

process.env.AUTH_SECRET ??= "test-secret-for-token-encryption";
const NOW = new Date("2026-09-26T12:00:00Z");

const csv = (text: string, name = "upload.csv"): ImportSourceInput => ({ kind: "CSV", name, ...parseCsv(text) });

let owner: WorkspaceContext;
let editor: WorkspaceContext;
let viewer: WorkspaceContext;
let other: WorkspaceContext;
let editorUserId: string;

before(async () => {
  await resetDb();
  const [o, e, v, b] = await Promise.all([makeUser("o@a.test", "Olivia"), makeUser("e@a.test", "Eli"), makeUser("v@a.test"), makeUser("b@b.test")]);
  editorUserId = e.id;
  const wsA = await makeWorkspace(o.id, "A", { members: [[e.id, "EDITOR"], [v.id, "VIEWER"]] });
  const wsB = await makeWorkspace(b.id, "B", { demo: true });
  [owner, editor, viewer, other] = await Promise.all([ctx(o.id, wsA.id), ctx(e.id, wsA.id), ctx(v.id, wsA.id), ctx(b.id, wsB.id)]);
});
after(() => db.$disconnect());

describe("parsing and mapping (pure)", () => {
  test("CSV: BOM, quoted commas and newlines, blank lines, repeated headers", () => {
    const t = parseCsv('﻿Name,Code,Name\n"Retrieval, Systems","RAG","x"\n\n"Evals\nand more",EVL,y\n');
    assert.deepEqual(t.headers, ["Name", "Code", "Name (2)"]);
    assert.deepEqual(t.rows, [["Retrieval, Systems", "RAG", "x"], ["Evals\nand more", "EVL", "y"]]);
  });

  test("dates: ISO, sheet serials and month names work; day/month ambiguity is refused", () => {
    assert.deepEqual(normalizeDate("2026-09-01", "Start"), { value: "2026-09-01" });
    assert.deepEqual(normalizeDate("2026/9/1", "Start"), { value: "2026-09-01" });
    assert.deepEqual(normalizeDate(46266, "Start"), { value: "2026-09-01" });
    assert.deepEqual(normalizeDate("1 Sep 2026", "Start"), { value: "2026-09-01" });
    assert.deepEqual(normalizeDate("Sep 1, 2026", "Start"), { value: "2026-09-01" });
    assert.match((normalizeDate("01/09/2026", "Start") as { error: string }).error, /ambiguous/);
    assert.match((normalizeDate("2026-02-30", "Start") as { error: string }).error, /isn't a real date/);
  });

  test("exact header matches map without AI; signatures ignore column order", () => {
    const m = exactMapping("cohort", ["Course", "Code", "Name", "Start date", "Enrolled learners", "Notes"]);
    assert.deepEqual(m, { Course: "courseId", Code: "code", Name: "name", "Start date": "startDate", "Enrolled learners": "enrolledLearners", Notes: null });
    assert.equal(headerSignature(["A", "B"]), headerSignature(["b", "a"]));
    assert.notEqual(headerSignature(["A", "B"]), headerSignature(["A", "C"]));
    assert.match(mappingProblems("cohort", { Code: "code" }).join(" "), /Map a column to Name/);
    assert.match(mappingProblems("course", { A: "name", B: "name" }).join(" "), /"A" and "B" both map to Name/);
    assert.match(mappingProblems("module", { T: "title" }).join(" "), /Map a column to Course/);
  });

  test("mock AI suggests matches with evidence from headers and samples", async () => {
    const fields = importFields("cohort").map((f) => ({ name: f.name, label: f.label, kind: f.kind, required: !!f.required, options: f.options?.map((o) => o.label) }));
    const s = await mockProvider.suggestColumnMapping({
      recordType: "cohort",
      fields,
      columns: [
        { header: "Students", samples: ["40", "35"] },
        { header: "Seats", samples: ["50", "60"] },
        { header: "Kickoff", samples: ["2026-09-01"] },
        { header: "Colour", samples: ["blue"] },
      ],
    });
    const byHeader = Object.fromEntries(s.map((x) => [x.header, x.field]));
    assert.equal(byHeader.Students, "enrolledLearners");
    assert.equal(byHeader.Seats, "capacity");
    assert.equal(byHeader.Kickoff, "startDate");
    assert.equal(byHeader.Colour, undefined);
    assert.ok(s.every((x) => x.confidence >= 0.5 && x.reason.includes("Header")));
  });

  test("sheet links and token encryption", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    assert.deepEqual(parseSheetLink(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`), { spreadsheetId: id, sheetId: 42 });
    assert.deepEqual(parseSheetLink(`https://docs.google.com/spreadsheets/d/${id}/edit`), { spreadsheetId: id, sheetId: null });
    assert.equal(parseSheetLink("https://example.com/nope"), null);
    const enc = encryptToken("refresh-123");
    assert.ok(enc.startsWith("enc:v1:") && !enc.includes("refresh-123"));
    assert.equal(decryptToken(enc), "refresh-123");
    assert.equal(decryptToken(enc.slice(0, -4) + "AAAA"), null);
  });
});

describe("CSV import", () => {
  const COURSES = "Code,Name,Region,Track,Status,Description\nRAG,Retrieval Systems,US,AI,Active,RAG end to end\nEVL,Evals,global,AI,In development,Offline and online evals\n";

  test("preview classifies new rows and writes nothing", async () => {
    const source = csv(COURSES, "courses.csv");
    const p = await previewImport(owner, { type: "course", source, mapping: exactMapping("course", source.kind === "CSV" ? source.headers : []) }, fetch, NOW);
    assert.deepEqual(p.counts, { new: 2, update: 0, unchanged: 0, invalid: 0 });
    assert.equal(await scopedDb(owner).course.count(), 0);
  });

  test("import creates records, saves the mapping, records the run and logs one event", async () => {
    const source = csv(COURSES, "courses.csv");
    const r = await runImport(editor, { type: "course", source, mapping: exactMapping("course", (source as { headers: string[] }).headers) }, { now: NOW });
    assert.deepEqual(r.counts, { created: 2, updated: 0, unchanged: 0, skipped: 0 });
    const courses = await scopedDb(owner).course.findMany({ orderBy: { code: "asc" } });
    assert.deepEqual(courses.map((c) => [c.code, c.region, c.status]), [["EVL", "GLOBAL", "IN_DEVELOPMENT"], ["RAG", "US", "ACTIVE"]]);
    const events = await scopedDb(owner).activityEvent.findMany({ where: { entityType: "Import" } });
    assert.equal(events.length, 1);
    assert.match(events[0].summary, /^Eli imported courses from "courses.csv" \(CSV\): 2 new, 0 updated, 0 skipped$/);
    assert.equal(await scopedDb(owner).activityEvent.count({ where: { entityType: "Course" } }), 0, "no per-row events");
    const index = await getSearchIndex(owner);
    assert.ok(index.some((i) => i.type === "course" && i.label === "Retrieval Systems"));
  });

  test("the same layout is remembered (even reordered) and re-importing is idempotent", async () => {
    const reordered = csv("Name,Code,Description,Region,Track,Status\nRetrieval Systems,RAG,RAG end to end,US,AI,Active\n");
    const help = await prepareMapping(owner, "course", csv(COURSES));
    assert.equal(help.savedMatches, true);
    assert.equal(help.saved?.Code, "code");
    const help2 = await prepareMapping(owner, "course", reordered);
    assert.equal(help2.savedMatches, true, "column order doesn't matter");
    const r = await runImport(owner, { type: "course", source: csv(COURSES), mapping: help.saved! }, { now: NOW });
    assert.deepEqual(r.counts, { created: 0, updated: 0, unchanged: 2, skipped: 0 });
  });

  test("updates match by name; blank cells keep existing values; changes are listed", async () => {
    const source = csv("Name,Code,Description,Status\nRetrieval Systems,RAG,,Sunset\n");
    const mapping = exactMapping("course", (source as { headers: string[] }).headers);
    const p = await previewImport(owner, { type: "course", source, mapping }, fetch, NOW);
    assert.equal(p.rows[0].kind, "update");
    assert.deepEqual(p.rows[0].changes, [{ field: "Status", from: "Active", to: "Sunset" }]);
    await runImport(owner, { type: "course", source, mapping }, { now: NOW });
    const c = await scopedDb(owner).course.findFirstOrThrow({ where: { code: "RAG" } });
    assert.equal(c.status, "SUNSET");
    assert.equal(c.description, "RAG end to end", "blank cell kept the description");
  });

  test("the code/email guard refuses a row whose name and code point at different records", async () => {
    const source = csv("Name,Code,Region,Track,Status,Description\nRetrieval Systems v2,RAG,US,AI,Active,Renamed\n");
    const p = await previewImport(owner, { type: "course", source, mapping: exactMapping("course", (source as { headers: string[] }).headers) }, fetch, NOW);
    assert.equal(p.rows[0].kind, "invalid");
    assert.match(p.rows[0].reasons!.join(" "), /Code "RAG" already belongs to "Retrieval Systems"/);
  });

  test("cohorts: course by code or name, Add-form rules, duplicates in the file", async () => {
    const source = csv(
      [
        "Course,Code,Name,Start date,End date,Capacity,Enrolled learners,Health",
        "RAG,RAG-C1,Retrieval Cohort 1,2026-09-01,2026-11-30,50,40,Healthy",
        "Evals,EVL-C1,Evals Cohort 1,1 Sep 2026,2026-12-01,40,20,healthy",
        "RAG,RAG-C2,Retrieval Cohort 2,2026-10-01,2026-12-01,50,60,Healthy",
        "Nope,X-1,Unknown course cohort,2026-10-01,2026-12-01,50,10,Healthy",
        "RAG,RAG-C3,Retrieval Cohort 3,01/10/2026,2026-12-01,50,10,Healthy",
        "RAG,RAG-C4,Twin,2026-10-01,2026-12-01,50,10,Healthy",
        "RAG,RAG-C5,Twin,2026-10-01,2026-12-01,50,10,Healthy",
      ].join("\n"),
    );
    const mapping = exactMapping("cohort", (source as { headers: string[] }).headers);
    const p = await previewImport(owner, { type: "cohort", source, mapping }, fetch, NOW);
    const reason = (n: number) => p.rows.find((r) => r.rowNumber === n)!.reasons?.join(" ") ?? "";
    assert.deepEqual(p.rows.map((r) => r.kind), ["new", "new", "invalid", "invalid", "invalid", "invalid", "invalid"]);
    assert.match(reason(3), /Enrolled \(60\) can't exceed capacity \(50\)/);
    assert.match(reason(4), /no course "Nope" in this workspace/);
    assert.match(reason(5), /ambiguous/);
    assert.match(reason(6), /Same name as row 7/);
    const r = await runImport(owner, { type: "cohort", source, mapping }, { now: NOW });
    assert.deepEqual(r.counts, { created: 2, updated: 0, unchanged: 0, skipped: 5 });
    assert.equal(r.errors.length, 5);
    const run = await scopedDb(owner).importRun.findFirstOrThrow({ where: { id: r.runId } });
    assert.equal(run.skipped, 5);
    assert.equal((await scopedDb(owner).cohort.findFirstOrThrow({ where: { code: "RAG-C1" } })).status, "ACTIVE", "derived like the form");
  });

  test("names shared by two existing records are ambiguous", async () => {
    for (const email of ["sam1@x.test", "sam2@x.test"]) {
      await saveRecord(owner, "instructor", null, { name: "Sam Lee", email, expertise: "rag", region: "US", hiringStage: "ACTIVE", joinedAt: "2026-01-01" }, NOW);
    }
    const source = csv("Name,Region\nSam Lee,India\n");
    const p = await previewImport(owner, { type: "instructor", source, mapping: exactMapping("instructor", (source as { headers: string[] }).headers) }, fetch, NOW);
    assert.match(p.rows[0].reasons!.join(" "), /2 existing records are named "Sam Lee"/);
  });

  test("modules match by title within their course and get sequential order", async () => {
    const source = csv("Course,Title,Description,Stage,Owner,Due date,SME reviewer\nRAG,Chunking,Split docs,Planned,Olivia,2026-10-01,\nRAG,Embeddings,Vectors,Drafting,Olivia,2026-10-15,\nEVL,Chunking,Eval chunking,Planned,Olivia,2026-10-01,\n");
    const mapping = { ...exactMapping("module", (source as { headers: string[] }).headers), Owner: "ownerName" };
    const r = await runImport(owner, { type: "module", source, mapping }, { now: NOW });
    assert.deepEqual(r.counts, { created: 3, updated: 0, unchanged: 0, skipped: 0 }, JSON.stringify(r.errors));
    const rag = await scopedDb(owner).module.findMany({ where: { course: { code: "RAG" } }, orderBy: { order: "asc" } });
    assert.deepEqual(rag.map((m) => [m.title, m.order]), [["Chunking", 1], ["Embeddings", 2]]);
  });

  test("the integrity checks pass after imports", async () => {
    const failing = (await runIntegrityChecks(owner, NOW)).filter((c) => !c.passed).map((c) => c.id);
    assert.deepEqual(failing, []);
  });
});

describe("roles and isolation", () => {
  test("viewers can't prepare, preview, import or sync", async () => {
    const source = csv("Name\nX\n");
    await assert.rejects(prepareMapping(viewer, "course", source), AccessError);
    await assert.rejects(previewImport(viewer, { type: "course", source, mapping: { Name: "name" } }), AccessError);
    await assert.rejects(runImport(viewer, { type: "course", source, mapping: { Name: "name" } }), AccessError);
    const [src] = await listImportSources(owner);
    await assert.rejects(syncImportSource(viewer, src.id), AccessError);
  });

  test("another workspace's sources are invisible and can't be synced", async () => {
    const mine = await listImportSources(owner);
    assert.ok(mine.length >= 3);
    assert.equal((await listImportSources(other)).length, 0);
    await assert.rejects(syncImportSource(other, mine[0].id), ImportError);
    // B importing the same CSV only touches B.
    const before = await scopedDb(owner).course.count();
    await runImport(other, { type: "course", source: csv("Code,Name,Region,Track,Status,Description\nZZZ,Only in B,US,AI,Active,x\n"), mapping: { Code: "code", Name: "name", Region: "region", Track: "track", Status: "status", Description: "description" } }, { now: NOW });
    assert.equal(await scopedDb(owner).course.count(), before);
  });
});

describe("Google Sheets (fake Google API)", () => {
  const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  let values: (string | number)[][];
  let tokenCalls = 0;
  let forbid = false;
  const fakeFetch: Fetch = async (input) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      tokenCalls++;
      return json({ access_token: "fresh-access", expires_in: 3600 });
    }
    if (forbid) return json({ error: "forbidden" }, 403);
    if (url.includes("/values/")) return json({ values });
    return json({ properties: { title: "PM Roster" }, sheets: [{ properties: { sheetId: 7, title: "SMEs" } }] });
  };

  test("without a Sheets grant, the user is asked to grant it", async () => {
    await assert.rejects(
      prepareMapping(editor, "sme", { kind: "SHEET", spreadsheetId: SHEET, sheetId: 7 }, fakeFetch),
      (e: unknown) => e instanceof SheetsError && e.code === "needs-grant",
    );
  });

  test("with a grant: token refresh, import, one-click sync, changed columns stop the sync", async () => {
    await db.account.create({
      data: {
        userId: editorUserId, type: "oidc", provider: "google", providerAccountId: "g-eli",
        scope: `openid email profile ${SHEETS_SCOPE}`, refresh_token: encryptToken("r-eli"), access_token: null, expires_at: null,
      },
    });
    values = [["Name", "Email", "Domain", "Company", "Hours per week", "Hiring stage"], ["Grace Hopper", "grace@x.test", "RAG & Retrieval", "Navy", 4, "Sourced"]];
    const source = { kind: "SHEET" as const, spreadsheetId: SHEET, sheetId: 7 };
    const help = await prepareMapping(editor, "sme", source, fakeFetch);
    assert.equal(help.sourceName, "PM Roster · SMEs");
    assert.equal(tokenCalls, 1, "expired token refreshed once, then reused");
    const r = await runImport(editor, { type: "sme", source, mapping: help.exact }, { fetchImpl: fakeFetch, now: NOW });
    assert.equal(r.counts.created, 1);

    values = [...values, ["Alan Turing", "alan@x.test", "Evals", "Bletchley", 6, "Active"]];
    values[1][4] = 8;
    const s = await syncImportSource(editor, r.sourceId, fakeFetch, NOW);
    assert.deepEqual(s.counts, { created: 1, updated: 1, unchanged: 0, skipped: 0 });
    assert.equal(tokenCalls, 1);
    const ev = await scopedDb(owner).activityEvent.findFirstOrThrow({ where: { entityType: "Import", action: "synced" } });
    assert.match(ev.summary, /Eli synced SMEs from "PM Roster · SMEs" \(Google Sheet\): 1 new, 1 updated, 0 skipped/);

    values = [["Full name", "Email"], ["Grace Hopper", "grace@x.test"]];
    await assert.rejects(syncImportSource(editor, r.sourceId, fakeFetch, NOW), /columns in "PM Roster · SMEs" changed/);

    forbid = true;
    await assert.rejects(syncImportSource(editor, r.sourceId, fakeFetch, NOW), (e: unknown) => e instanceof SheetsError && e.code === "no-access");
    forbid = false;
  });

  test("sync uses the clicking user's own access: the owner without a grant is asked to grant", async () => {
    const [src] = (await listImportSources(owner)).filter((s) => s.kind === "SHEET");
    await assert.rejects(syncImportSource(owner, src.id, fakeFetch, NOW), (e: unknown) => e instanceof SheetsError && e.code === "needs-grant");
  });
});
