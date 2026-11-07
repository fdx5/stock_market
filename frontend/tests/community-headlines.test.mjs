import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
const source = ts.transpileModule(readFileSync(new URL("../src/neo/headlineFeedModel.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { latestHeadlines } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const post = (id, date = "2026-11-07T03:00:00Z") => ({ id, title: `Headline ${id}`, url: `https://example.com/${id}`, source: "Public forum", published_at: date });

test("the reel receives the latest ten distinct posts, newest first", () => {
  const rows = Array.from({ length: 15 }, (_, i) => post(String(i), `2026-11-07T03:${String(i).padStart(2, "0")}:00Z`));
  assert.deepEqual(latestHeadlines([post("14"), ...rows]).map(p => p.id), ["14", "13", "12", "11", "10", "9", "8", "7", "6", "5"]);
  assert.equal(latestHeadlines([post("14"), ...rows])[0].published_at, rows[14].published_at);
});
test("invalid entries and non-web URLs never become clickable titles", () => {
  assert.deepEqual(latestHeadlines([null, {}, post("ok"), { ...post("js"), url: "javascript:alert(1)" }, { ...post("file"), url: "file:///private" }, { ...post("empty"), title: " " }, { ...post("source"), source: {} }]).map(p => p.id), ["ok"]);
  assert.deepEqual(latestHeadlines(null), []);
  assert.deepEqual(latestHeadlines({ items: [] }), []);
  assert.equal(latestHeadlines([post("one")]).length, 1);
});
