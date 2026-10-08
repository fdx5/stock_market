import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(name, deps = {}) {
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/desk2/stock/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const context = vm.createContext({ exports: {}, require: (key) => deps[key] });
  vm.runInContext(source, context);
  return context.exports;
}
const returns = load("stockReturns");
const model = load("stockBriefModel", { "./stockReturns": returns });
const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, close: 100 + i, volume: 200, volume_ma20: 100, rsi14: 61, sma20: 120 }));

test("index comparisons use the stock's exact endpoint dates, despite a later index bar", () => {
  const bench = days.map((p) => ({ ...p, close: 200 + Number(p.date.slice(-2)) }));
  bench.push({ date: "2026-10-01", close: 999 });
  const month = returns.periodReturns(days, bench).find((r) => r.key === "1m");
  assert.ok(Math.abs(month.value - (129 / 108 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(month.bench - (230 / 209 - 1) * 100) < 1e-9);
  assert.equal(month.start, "2026-09-09");
});
test("a benchmark missing either endpoint never substitutes a nearby date", () => {
  const bench = days.filter((p) => p.date !== "2026-09-09");
  assert.equal(returns.periodReturns(days, bench).find((r) => r.key === "1m").bench, null);
});
test("daily bars are sorted, duplicates are resolved and invalid prices cannot enter returns", () => {
  const points = [...days].reverse().concat([{ date: "2026-09-30", close: 130 }, { date: "2026-10-01", close: 0 }, { date: "2026-10-02", close: NaN }]);
  const month = returns.periodReturns(points, null).find((r) => r.key === "1m");
  assert.ok(Math.abs(month.value - (130 / 108 - 1) * 100) < 1e-9);
});
test("missing quotes and short history stay unavailable rather than becoming zero", () => {
  const brief = model.stockBrief({ points: [], quote: { close: 0, change_pct: 0 } });
  for (const key of ["price", "day", "rsi", "volumeRatio", "distance20"]) assert.equal(brief[key], null);
  assert.equal(brief.month.value, null);
});
test("live price and daily-close analysis keep their own bases", () => {
  const brief = model.stockBrief({ points: days, quote: { close: 150, change_pct: -2 }, summary: { close: 129, change_pct: 1, date: "2026-09-30" } });
  assert.equal(brief.price, 150); assert.equal(brief.day, -2);
  assert.equal(brief.latest.close, 129); assert.equal(brief.volumeRatio, 2);
  assert.equal(brief.priceKind, "quote");
});
test("peer context excludes self, invalid quotes and mismatched trading sessions", () => {
  const item = (code, change_pct, session = "regular", close = 10) => ({ code, name: code, close, change_pct, session, marcap: 1 });
  const peers = model.peerComparison("AAPL", { sector: "Technology", items: [item("AAPL", 2), item("MSFT", 1), item("NVDA", 3), item("BAD", 99, "regular", 0), item("PRE", 100, "pre")] });
  assert.equal(peers.count, 2); assert.equal(peers.average, 2); assert.equal(peers.relative, 0);
  assert.equal(model.peerComparison("OTHER", { sector: "Technology", items: [item("AAPL", 2)] }), null);
});
test("invalid indicator values cannot be rendered as NaN or Infinity", () => {
  const brief = model.stockBrief({ points: [{ ...days[0], rsi14: Infinity, volume_ma20: 0, sma20: NaN }], quote: { close: 150, change_pct: NaN } });
  assert.equal(brief.rsi, null); assert.equal(brief.volumeRatio, null); assert.equal(brief.distance20, null); assert.equal(brief.day, null);
});
