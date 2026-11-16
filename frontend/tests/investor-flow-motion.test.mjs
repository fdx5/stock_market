import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({ entryPoints: [fileURLToPath(new URL("../src/neo/investorFlowMotion.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const { FLOW_DURATION_MS, investorWon, flowValuesAt, flowMicroValuesAt, flowIsFresh } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("source net amounts retain their sign when converted from KRW 100M to won", () => {
  assert.deepEqual(investorWon({ individual_amount: 6256, foreign_amount: -9116, institution_amount: 1235 }), [625600000000, -911600000000, 123500000000]);
  assert.deepEqual(investorWon({ individual_amount: 0, foreign_amount: .1, institution_amount: -.1 }), [0, 10000000, -10000000]);
  for (const value of [NaN, Infinity, undefined, null, "5", 1e12]) {
    assert.equal(investorWon({ individual_amount: value, foreign_amount: 1, institution_amount: 1 }), null);
  }
  assert.equal(investorWon(null), null);
});

test("fast movements reverse naturally while remaining bounded by received values", () => {
  const transition = { from: [600000000000, -900000000000, 0], to: [625600000000, -911600000000, 0], startedAt: 1000 };
  assert.deepEqual(flowValuesAt(transition, 0), transition.from);
  assert.deepEqual(flowValuesAt(transition, 1000), transition.from);
  assert.equal(FLOW_DURATION_MS, 60000);
  assert.deepEqual(flowValuesAt(transition, 1000 + FLOW_DURATION_MS), transition.to);
  assert.deepEqual(flowValuesAt(transition, 999999), transition.to);
  const samples = Array.from({ length: 500 }, (_, index) => flowValuesAt(transition, 1000 + index * 120));
  for (const row of samples) row.forEach((value, index) => {
    assert.ok(Number.isSafeInteger(value));
    assert.ok(value >= Math.min(transition.from[index], transition.to[index]));
    assert.ok(value <= Math.max(transition.from[index], transition.to[index]));
  });
  assert.ok(samples.some((row, index) => index && row[0] < samples[index - 1][0]), "upward flow also has gentle downward movements");
  assert.ok(samples.some((row, index) => index && row[1] > samples[index - 1][1]), "downward flow also has gentle upward movements");
  assert.ok(new Set(samples.map(row => row[0])).size > 450, "numbers update throughout the minute");
  assert.ok(samples.some(row => row[0] % 100 !== 0), "motion reaches the won digits");
  assert.ok(samples.every(row => row[2] === 0), "no movement is invented for an unchanged source");
});

test("zero crossings, no-change replies and large amounts settle exactly", () => {
  for (const [from, to] of [[[-100, 100, 0], [100, -100, 0]], [[1, 2, 3], [1, 2, 3]], [[8e14, -8e14, 1], [8e14 + 100000000, -8e14 - 100000000, -1]]]) {
    const transition = { from, to, startedAt: 0 };
    assert.deepEqual(flowValuesAt(transition, FLOW_DURATION_MS), to);
    for (let time = 0; time < FLOW_DURATION_MS; time += 120) {
      flowValuesAt(transition, time).forEach((value, index) => {
        assert.ok(Number.isSafeInteger(value));
        assert.ok(value >= Math.min(from[index], to[index]) && value <= Math.max(from[index], to[index]));
      });
    }
  }
});

test("only a fresh same-day OPEN feed can animate; old, closed and missing feeds stop", () => {
  const now = Date.parse("2026-11-16T10:00:00+09:00");
  const source = { business_date: "20261116", fetched_at: now / 1000 };
  const quote = { market_status: "OPEN", updated_at: new Date(now).toISOString() };
  assert.equal(flowIsFresh(source, quote, now), true);
  assert.equal(flowIsFresh(source, quote, now + 30001), false);
  assert.equal(flowIsFresh({ ...source, business_date: "20261113" }, quote, now), false);
  assert.equal(flowIsFresh({ ...source, fetched_at: now / 1000 + 60 }, quote, now), false);
  assert.equal(flowIsFresh(source, { ...quote, updated_at: new Date(now - 90001).toISOString() }, now), false);
  for (const market_status of ["CLOSE", "CLOSED", "HALT", "", undefined]) assert.equal(flowIsFresh(source, { ...quote, market_status }, now), false);
  assert.equal(flowIsFresh(null, quote, now), false);
  assert.equal(flowIsFresh(source, null, now), false);
});

test("repeated rounded quotes and first connection still roll, with no cumulative drift", () => {
  const base = [743000000000, -1036200000000, 79800000000];
  const samples = Array.from({ length: 250 }, (_, index) => flowMicroValuesAt(base, [0, 0, 0], 0, index * 120));
  for (let index = 0; index < 3; index++) {
    assert.ok(new Set(samples.map(row => row[index])).size > 200);
    assert.ok(samples.some(row => row[index] > base[index]));
    assert.ok(samples.some(row => row[index] < base[index]));
    assert.ok(samples.every(row => Math.abs(row[index] - base[index]) <= 3200000));
  }
  assert.deepEqual(flowMicroValuesAt(base, [0, 0, 0], 0, 0), base);
  assert.deepEqual(flowMicroValuesAt(base, [0, 0, 0], 0, FLOW_DURATION_MS), base);
  assert.deepEqual(flowMicroValuesAt(base, [0, 0, 0], 0, 10000000), base);
});

test("first motion follows the index direction and minute seeds do not repeat patterns", () => {
  const base = [1e12, -1e12, 1e12];
  const up = flowMicroValuesAt(base, [0, 0, 0], 0, 120, 1);
  const down = flowMicroValuesAt(base, [0, 0, 0], 0, 120, -1);
  assert.ok(up.every((value, index) => value > base[index]));
  assert.ok(down.every((value, index) => value < base[index]));
  assert.notDeepEqual(flowMicroValuesAt(base, [0, 0, 0], 0, 5000), flowMicroValuesAt(base, [0, 0, 0], 60000, 65000));
});

test("micro motion follows observed change size, stays below source precision and retains signs", () => {
  for (const base of [[1, -1, 0], [1000000000, -1000000000, 0]]) {
    for (let time = 0; time < 20000; time += 120) {
      const values = flowMicroValuesAt(base, [1e12, -1e12, 0], 0, time);
      values.forEach((value, index) => {
        assert.equal(Math.sign(value), Math.sign(base[index]));
        assert.ok(Math.abs(value - base[index]) <= 18000000);
      });
    }
  }
  const base = [1e12, -1e12, 1e12];
  const small = flowMicroValuesAt(base, [0, 0, 0], 0, 120);
  const large = flowMicroValuesAt(base, [1e9, 1e9, 1e9], 0, 120);
  assert.ok(large.every((value, index) => Math.abs(value - base[index]) > Math.abs(small[index] - base[index])));
});
