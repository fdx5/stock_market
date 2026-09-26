import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RealEstatePopup, { PopupContext, tradeTrend } from "../src/components/RealEstatePopup";
import RealEstateResults from "../src/components/RealEstateResults";
import RealEstateExploreControls from "../src/components/RealEstateExploreControls";
import { FILTER_DEFAULTS, readEstateFilters, tradeState } from "../src/components/realEstateTools";
import { RealEstateItem } from "../src/api/client";

const item: RealEstateItem = {
  id: "11680:test", name: "검증 아파트", sgg: "강남구", dong: "대치동", group: "대치동", brand: null,
  area: 84.9, pyeong: 25.7, price: 123000, deal_date: "2026-09-01", floor: 9, built: 2010,
  base_price: null, base_date: null, change_pct: null, trades: 1, trades_all: 1,
  history: [[20260901, 123000, 9, 0]], high_1y: null, low_1y: null, trades_1y: 80, types: [],
  type_trades_1y: 72, price_sample_count: 1, price_basis: "brokered",
};
const ctx: PopupContext = { periodLabel: "3개월", regionLabel: "강남구", regionRank: 1, regionCount: 10, groupRank: 1, groupCount: 2, share: 10, clickHint: null };

test("a trade without a baseline is never called no trades", () => {
  assert.equal(tradeState(item), "비교 기준 부족");
  assert.equal(tradeState({ ...item, trades: 0 }), "기간 거래 없음");
  assert.equal(tradeState({ ...item, change_pct: 0 }), "0.00%");
});

test("annual count uses the independent count, not the chart array", () => {
  const html = renderToStaticMarkup(<RealEstatePopup item={item} ctx={ctx} />);
  assert.match(html, /이 평형 72건/);
  assert.doesNotMatch(html, /이 평형 1건/);
  assert.match(html, /마지막 기준 거래/);
});

test("empty and one-point charts render without nonfinite SVG coordinates", () => {
  for (const history of [[], item.history]) {
    const html = renderToStaticMarkup(<RealEstatePopup item={{ ...item, history }} ctx={ctx} />);
    assert.doesNotMatch(html, /NaN|Infinity/);
  }
});

test("calculation exceptions are visible on the detail card", () => {
  const html = renderToStaticMarkup(<RealEstatePopup item={{ ...item, price_basis: "direct", baseline_kind: "within_period" }} ctx={ctx} selector={<span>평형</span>} />);
  assert.match(html, /직거래 참고값/);
  assert.match(html, /기간 내 최초 거래 대비/);
});

test("result actions have labels and toggle state; untrusted names are escaped", () => {
  const unsafe = { ...item, name: '<script>alert("x")</script>' };
  const html = renderToStaticMarkup(<RealEstateResults items={[unsafe]} saved={[unsafe]} compared={[]} onOpen={() => {}} onSave={() => {}} onCompare={() => {}} />);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /비교 선택/);
  assert.doesNotMatch(html, /<script>/);
});

test("filter bounds are labelled for keyboard and assistive technology", () => {
  const html = renderToStaticMarkup(<RealEstateExploreControls filters={FILTER_DEFAULTS} onChange={() => {}} busy={false} />);
  assert.match(html, /aria-label="최소 가격 \(억원\)"/);
  assert.match(html, /aria-label="최대 전용면적"/);
});

test("malformed shared filters are sanitized", () => {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?sort=bad&price_max=NaN&area_min=-3&q=test" } });
  const filters = readEstateFilters();
  assert.equal(filters.sort, "price_desc");
  assert.equal(filters.price_max, "");
  assert.equal(filters.area_min, "");
  assert.equal(filters.q, "test");
});

test("trade trend is a median of brokered trades and never bridges a long gap", () => {
  assert.deepEqual(tradeTrend([[20250101, 100, 5, 0]]), []);
  assert.equal(tradeTrend([[20250101, 100, 5, 0], [20250201, 110, 5, 0]])[0][1][1], 110, "two trades are joined as they are");
  const runs = tradeTrend([
    [20240105, 100, 3, 0], [20240110, 300, 9, 0], [20240115, 110, 4, 0], [20240120, 999, 1, 1],
    [20250601, 200, 5, 0], [20250605, 210, 6, 0], [20250610, 205, 7, 0],
  ]);
  assert.equal(runs.length, 2);
  assert.ok(runs[0].every(([, v]) => v === 110), "outlier and 직거래 do not move the median");
  assert.ok(runs[1].every(([, v]) => v === 205));
  const lone = tradeTrend([[20240101, 100, 1, 0], [20240110, 101, 1, 0], [20240120, 102, 1, 0], [20250601, 200, 1, 0]]);
  assert.equal(lone.length, 1, "a lone trade after a gap draws no line and borrows no prices");
  assert.ok(lone[0].every(([, v]) => v < 150));
});
