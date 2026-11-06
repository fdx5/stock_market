import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";

// Compile the real pure model without touching the source tree or stored fixtures.
const quote = ts.transpileModule(readFileSync(new URL("../src/neo/marketQuote.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, ""), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const model = ts.transpileModule(readFileSync(new URL("../src/neo/fearGreedModel.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, ""), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { fearGreed, moodOf } = await import("data:text/javascript;base64," + Buffer.from(quote + "\n" + model).toString("base64"));
const stocks = (change = 0) => Array.from({ length: 60 }, (_, i) => ({ code: String(i), marcap: 100, close: 100, change_pct: change, quote_time: 1_790_000_000 }));

test("flat verified quotes are neutral, missing and default zeros are not", () => {
  assert.equal(fearGreed(stocks()).score, 50);
  assert.equal(fearGreed([]).score, null);
  assert.equal(fearGreed(stocks().map(({ quote_time, ...s }) => s)).score, null);
  assert.equal(fearGreed(stocks().slice(0, 47)).score, null);
  assert.equal(fearGreed(stocks().map(s => ({ ...s, close: 0 }))).score, null);
});
test("up and down are monotonic, symmetric and bounded", () => {
  const levels = [-100, -5, -1, 0, 1, 5, 100].map(v => fearGreed(stocks(v)).score);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  assert.equal(levels[0], 0); assert.equal(levels.at(-1), 100);
  assert.equal(fearGreed(stocks(1)).score + fearGreed(stocks(-1)).score, 100);
});
test("capitalization weighting and equal breadth have distinct effects", () => {
  const sample = stocks(-1); sample[0] = { ...sample[0], marcap: 10_000, change_pct: 2 };
  const result = fearGreed(sample);
  assert.equal(result.up, 1); assert.equal(result.down, 59);
  assert.ok(result.weightedReturn > 0); assert.ok(result.breadth < 2);
});
test("duplicates and invalid weights do not count as verified coverage", () => {
  const rows = stocks(); rows[59] = { ...rows[0] };
  assert.equal(fearGreed(rows).total, 59);
  assert.equal(fearGreed(stocks().map((s, i) => i < 13 ? { ...s, change_pct: NaN } : s)).score, null);
});
test("timestamp uses the oldest input only with complete quote timing", () => {
  const rows = stocks(); rows[0].quote_time -= 100;
  assert.equal(fearGreed(rows).asOf, rows[0].quote_time * 1000);
  rows[0].change_pct = 1; delete rows[0].quote_time;
  assert.equal(fearGreed(rows).asOf, null);
});
test("published mood boundaries match the labels", () => {
  assert.deepEqual([0,24,25,44,45,55,56,75,76,100].map(moodOf), ["extreme-fear","extreme-fear","fear","fear","neutral","neutral","greed","greed","extreme-greed","extreme-greed"]);
});
