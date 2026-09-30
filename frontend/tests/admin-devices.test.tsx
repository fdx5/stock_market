import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceTrafficView } from "../src/components/AdminDevicesPanel";
import type { DeviceTraffic } from "../src/adminApi";
import { resolveDeviceInfo } from "../src/deviceInfo";

const data: DeviceTraffic = {
  days: 30, start_date: "2026-09-01", end_date: "2026-09-30", metric: "human_pageviews",
  total: 10, coverage_percentage: 90, missing_days: 0, history_ready: true,
  available_from: "2026-09-01", aggregated_at: null, generated_at: "2026-09-30T04:00:00Z",
  types: [{ type: "desktop", count: 3, percentage: 30 }, { type: "tablet", count: 1, percentage: 10 }, { type: "mobile", count: 5, percentage: 50 }, { type: "unknown", count: 1, percentage: 10 }],
  devices: [{ type: "desktop", name: "Windows PC", count: 3, percentage: 30, within_type_percentage: 100 }, { type: "tablet", name: "Apple iPad", count: 1, percentage: 10, within_type_percentage: 100 }, { type: "mobile", name: "Apple iPhone", count: 5, percentage: 50, within_type_percentage: 100 }, { type: "unknown", name: "기기 미확인", count: 1, percentage: 10, within_type_percentage: 100 }],
  operating_systems: [{ name: "Windows", count: 3, percentage: 30 }], browsers: [{ name: "Chrome", count: 3, percentage: 30 }],
};

test("distribution labels, units and accessible donut describe the real denominator", () => {
  const html = renderToStaticMarkup(<DeviceTrafficView data={data} />);
  assert.match(html, /데스크톱 30.0%, 태블릿 10.0%, 모바일 50.0%, 미확인 10.0%/);
  assert.match(html, /Windows PC/);
  assert.match(html, /Apple iPad/);
  assert.match(html, /Apple iPhone/);
  assert.match(html, /순 방문자·실제 기기 대수 아님/);
  assert.match(html, /유형 내 비중/);
  assert.doesNotMatch(html, /NaN|Infinity|집계 중/);
});

test("empty and incomplete history are not disguised as complete analytics", () => {
  const empty = { ...data, total: 0, devices: [], browsers: [], operating_systems: [], types: data.types.map(row => ({ ...row, count: 0, percentage: 0 })), history_ready: false, missing_days: 7 };
  const html = renderToStaticMarkup(<DeviceTrafficView data={empty} />);
  assert.match(html, /7일 미완료/);
  assert.match(html, /기기별 조회 데이터 없음/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("device names are escaped and additional models remain available", () => {
  const many = { ...data, devices: Array.from({ length: 8 }, (_, i) => ({ ...data.devices[2], name: `<model-${i}>` })) };
  const html = renderToStaticMarkup(<DeviceTrafficView data={many} />);
  assert.match(html, /<details>/);
  assert.match(html, /외 3종/);
  assert.match(html, /&lt;model-0&gt;/);
  assert.doesNotMatch(html, /<model-0>/);
});

test("first page view resolves browser model hints once without device identifiers", async () => {
  let calls = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    userAgent: "Android Mobile", platform: "Linux", maxTouchPoints: 5,
    userAgentData: { platform: "Android", mobile: true, getHighEntropyValues: async (keys: string[]) => {
      calls++; assert.deepEqual(keys, ["model", "platform"]);
      return { model: "SM-S928N", platform: "Android" };
    } },
  } });
  assert.deepEqual(await resolveDeviceInfo(), { model: "SM-S928N", platform: "Android", mobile: true, ipad: false });
  await resolveDeviceInfo();
  assert.equal(calls, 1);
});
