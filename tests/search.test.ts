// ⌘K search over a demo workspace. Run with `npm test`.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "@/lib/db";
import { getSearchIndex } from "@/lib/data/search";
import { GROUP_ORDER, highlightSegments, matchRanges, searchRecords, suggestQueries } from "@/lib/search";
import type { SearchItem } from "@/lib/search-types";
import { ctx, makeUser, makeWorkspace, resetDb } from "./helpers";

let index: SearchItem[];
before(async () => {
  await resetDb();
  const owner = await makeUser("owner@search.test");
  const ws = await makeWorkspace(owner.id, "Search", { demo: true });
  index = await getSearchIndex(await ctx(owner.id, ws.id));
});
after(() => db.$disconnect());

describe("searching demo data", () => {
  test('"rag" returns results in at least 5 groups', () => {
    const groups = searchRecords(index, "rag");
    const types = groups.map((g) => g.type);
    assert.ok(types.length >= 5, `only ${types.length} groups: ${types.join(", ")}`);
    for (const t of ["module", "project", "session", "issue", "feedback", "instructor", "sme"] as const) {
      assert.ok(types.includes(t), `no ${t} results for "rag"`);
    }
  });

  test("groups follow the palette order", () => {
    const types = searchRecords(index, "rag").map((g) => g.type);
    const positions = types.map((t) => GROUP_ORDER.indexOf(t));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  test("matching is case-insensitive", () => {
    const count = (q: string) => searchRecords(index, q).reduce((n, g) => n + g.hits.length, 0);
    assert.equal(count("RAG"), count("rag"));
    assert.equal(count("Rag"), count("rag"));
  });

  test("descriptions, tags and feedback text are searched", () => {
    const hits = searchRecords(index, "rag").flatMap((g) => g.hits);
    const via = new Set(hits.map((h) => h.snippet?.name).filter(Boolean));
    assert.ok(via.has("Description") || via.has("Brief"), "no match via a description");
    assert.ok(
      hits.some((h) => h.item.type === "feedback" && /\brag\b/i.test(h.item.label)),
      "no feedback comment mentions RAG",
    );
    const course = searchRecords(index, "guardrails").find((g) => g.type === "course");
    assert.ok(course, "course description not searched");
  });

  test("a query with no matches yields no groups but offers suggestions", () => {
    assert.deepEqual(searchRecords(index, "zzqx"), []);
    assert.ok(suggestQueries(index, "zzqx").length > 0);
    assert.ok(suggestQueries(index, "rag zzqx").includes("rag"));
  });
});

describe("matching primitives", () => {
  test("matches word starts only", () => {
    assert.deepEqual(matchRanges("RAG storage average", ["rag"]), [[0, 3]]);
    assert.deepEqual(matchRanges("cloud,rag", ["rag"]), [[6, 9]]);
  });

  test("highlight segments preserve the original text and case", () => {
    const segs = highlightSegments("LLM Application Architecture & RAG", ["rag"]);
    assert.equal(segs.map((s) => s.text).join(""), "LLM Application Architecture & RAG");
    assert.deepEqual(segs.filter((s) => s.match).map((s) => s.text), ["RAG"]);
  });
});
