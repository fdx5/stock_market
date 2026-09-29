import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RealEstatePopup, { PopupContext, tradeTrend } from "../src/components/RealEstatePopup";
import RealEstateResults from "../src/components/RealEstateResults";
import RealEstateExploreControls from "../src/components/RealEstateExploreControls";
import { FILTER_DEFAULTS, readEstateFilters, tradeState } from "../src/components/realEstateTools";
import { RealEstateItem } from "../src/api/client";
import RankCrown, { crownLabel } from "../src/components/RankCrown";
import { withoutDemolished } from "../src/components/vworldBuildings";
import { buildWater } from "../src/components/sceneWater";
import { BufferGeometry, Float32BufferAttribute } from "three";
import type { RealEstateBuilding, RealEstateBuildingsResponse } from "../src/api/client";

const item: RealEstateItem = {
  id: "11680:test", name: "검증 아파트", sgg: "강남구", dong: "대치동", group: "대치동", brand: null,
  area: 84.9, pyeong: 25.7, price: 123000, deal_date: "2026-09-01", floor: 9, built: 2010,
  base_price: null, base_date: null, change_pct: null, trades: 1, trades_all: 1,
  history: [[20260901, 123000, 9, 0]], high_1y: null, low_1y: null, trades_1y: 80, types: [],
  type_trades_1y: 72, price_sample_count: 1, price_basis: "brokered",
};
const ctx: PopupContext = { periodLabel: "3개월", regionLabel: "강남구", regionRank: 1, regionCount: 10, groupRank: 1, groupCount: 2, share: 10, clickHint: null };

test("crowns describe the selected ranking and details explain score evidence", () => {
  assert.match(crownLabel(1), /지역 대표단지 1위/);
  assert.match(renderToStaticMarkup(<RankCrown rank={2} size={20} mode="price" />), /대표 평형 평당가 2위/);
  const leader: NonNullable<RealEstateItem["leader"]> = { rank: 1, score: 95, price_score: 100, persistence_score: 90, demand_score: 85,
    confidence: "limited", bands: [{ band: 85, sample_count: 3, window_months: 12, active_months: 3, annual_count: 3, quarters: 2, top_quarters: 1, peers: 5 }] };
  const html = renderToStaticMarkup(<RealEstatePopup item={{ ...item, leader }} ctx={ctx} />);
  assert.match(html, /지역 대표단지 1위/);
  assert.match(html, /제한적/);
  assert.match(html, /최근 12개월 3건/);
  assert.match(html, /입지·학군·세대수·재건축 기대는 미반영/);
});

test("a trade without a baseline is never called no trades", () => {
  assert.equal(tradeState(item), "비교 기준 부족");
  assert.equal(tradeState({ ...item, trades: 0 }), "기간 거래 없음");
  assert.equal(tradeState({ ...item, change_pct: 0 }), "0.00%");
});

test("new and unranked complexes disclose provisional status and missing evidence", () => {
  const leader: NonNullable<RealEstateItem["leader"]> = { rank: 2, score: 52, price_score: 54, persistence_score: 50, demand_score: 50,
    confidence: "limited", status: "provisional", reasons: ["직거래 참고가격", "관측되지 않은 지속성·수요는 중립 50점 적용"], bands: [] };
  const html = renderToStaticMarkup(<RealEstatePopup item={{ ...item, price_source: "rights", leader }} ctx={ctx} />);
  assert.match(html, /잠정평가/);
  assert.match(html, /분양·입주권 거래 참고가/);
  assert.match(html, /최초 분양가와 다름/);
  assert.match(html, /중립 50점/);
  const unranked = renderToStaticMarkup(<RealEstatePopup item={{ ...item, leader: { ...leader, rank: null, score: null, status: "unranked", reasons: ["비교 단지 부족"] } }} ctx={ctx} />);
  assert.match(unranked, /순위 산정 보류/);
  assert.match(unranked, /비교 단지 부족/);
  assert.doesNotMatch(unranked, /null위|NaN점/);
  assert.match(renderToStaticMarkup(<RankCrown rank={2} size={20} provisional />), /잠정평가/);
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

test("houses cleared for a rebuilt complex are dropped, never its towers or an unrebuilt register", () => {
  const b = (floors: number, approved: number | null, use: string | null, name: string | null = null): RealEstateBuilding =>
    ({ rings: [[[0, 0], [10, 0], [10, 10]]], height: floors * 3, floors, base: 0, height_source: "measured", name, use, approved });
  const data = (buildings: RealEstateBuilding[], built: number | null) => ({ id: "t", name: "t", address: "", built, found: true, site: [],
    buildings, context: [], coverage: { buildings: buildings.length, with_height: buildings.length }, vworld: true, error: null, fetched_at: "" }) as unknown as RealEstateBuildingsResponse;
  const rebuilt = withoutDemolished(data([b(36, null, null, "101동"), b(2, null, null, "경비실"), b(2, 1981, "01000"), b(1, null, "01000"), b(5, 2002, "02000")], 2022));
  assert.deepEqual(rebuilt.buildings.map(x => x.name), ["101동", "경비실"]);
  assert.equal(rebuilt.coverage.buildings, 2);
  // The register still holds only the old buildings: nothing better to show.
  const stale = data([b(15, 1990, "02000"), b(2, 1985, "01000")], 2024);
  assert.equal(withoutDemolished(stale), stale);
  // An old complex keeps its own towers.
  const old = data([b(14, 1979, "02000"), b(14, 1979, "02000"), b(2, 1979, "07000")], 1979);
  assert.equal(withoutDemolished(old).buildings.length, 3);
});

test("a river runs on under a bridge the elevation data carries across as a dam", async () => {
  // A 40 m wide channel, 400 m long, in two parcels; a 20 m band where the DEM holds the
  // bridge road 2 m above the water.
  const parcels = [
    { kind: "천", ring: [[-200, -20], [0, -20], [0, 20], [-200, 20]] as [number, number][] },
    { kind: "천", ring: [[0, -20], [200, -20], [200, 20], [0, 20]] as [number, number][] },
  ];
  const terrain = { at: (x: number) => (Math.abs(x - 50) < 10 ? 2 : 0), base: () => 0, relief: 2, elevation: null, source: "test" };
  const water = (await buildWater(parcels, [false, false], terrain, async () => true))!;
  const p = water.mesh.geometry.getAttribute("position");
  let under = 0;
  for (let i = 0; i < p.count; i += 3) if (Math.abs((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 - 50) < 8) under++;
  assert.ok(under > 0, "water under the bridge");
  // The ground there is sunk below the surface (it no longer rises through the water).
  const ground = new BufferGeometry();
  ground.setAttribute("position", new Float32BufferAttribute([50, 0, 2, -100, 0, 0, 50, 60, 2], 3));
  await water.sink(ground);
  const z = ground.getAttribute("position");
  assert.ok(z.getZ(0) < 0.1 && z.getZ(1) < 0.1, "channel ground sunk under the water");
  assert.equal(z.getZ(2), 2, "ground off the water untouched");
  water.dispose();
});
