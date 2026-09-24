import { useEffect, useMemo, useRef, useState } from "react";
import { api, RealEstateItem, RealEstateMapResponse, RealEstatePeriod, RealEstateSido } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { TILE_FONT_FAMILY, pct, tileDisplayInfo } from "../mapTile";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import { useDocumentTitle } from "../useDocumentTitle";
import Colophon from "../desk2/Colophon";
import Finder from "../desk2/Finder";
import Masthead from "../desk2/Masthead";
import { useBroadsheet, useFinderHotkey } from "../desk2/shell";
import "../desk2/maps.css";
import Tape from "../desk2/Tape";
import AptBrandIcon, { brandIconWidth, brandLabel } from "./AptBrandIcon";

/* /realestate-map — 부동산 맵. The same broadsheet treemap as the four market maps,
 * over apartment complexes instead of listed companies: 시·도 → 시·군·구 → 읍·면·동
 * narrows the region, tiles are sized by each complex's latest 실거래가 and coloured
 * by how that price moved over the chosen period (see backend
 * app/services/realestate_map.py for exactly how both are derived). */

const PERIODS: { key: RealEstatePeriod; label: string; detail: string }[] = [
  { key: "today", label: "오늘", detail: "최근 계약일" },
  { key: "7d", label: "7일", detail: "최근 1주 실거래" },
  { key: "3m", label: "3개월", detail: "최근 3개월 실거래" },
  { key: "6m", label: "6개월", detail: "최근 6개월 실거래" },
  { key: "1y", label: "1년", detail: "최근 1년 실거래" },
];

/** Apartment prices move less than stocks in a day but more over a year; the colour
 * scale saturates at ±10% rather than the stock maps' ±5%. */
const SATURATION_PCT = 10;
const SKELETON_WEIGHTS = [30, 22, 16, 12, 10, 6, 4];
/** The map area is always drawn in the 야간판 palette, even in the 주간판: on the
 * near-black ground the blue-to-red tiles and the hatched no-trade tiles separate far
 * better than on newsprint. Only the canvas — the page around it follows the theme
 * (see .re-map-canvas-night in maps.css). */
const MAP_MODE = "dark" as const;

interface Zone {
  group: string;
  rect: TreemapRect;
  headerH: number;
  avg: number | null;
  tiles: (TreemapRect & { item: RealEstateItem })[];
}

/** 만원 → "23.5억" / "8,500만". */
function shortPrice(manwon: number): string {
  if (manwon >= 10_000) {
    const eok = manwon / 10_000;
    return `${eok >= 100 ? Math.round(eok) : eok.toFixed(1).replace(/\.0$/, "")}억`;
  }
  return `${manwon.toLocaleString()}만`;
}

/** 만원 → "23억 5,000만원". */
function fullPrice(manwon: number): string {
  const eok = Math.floor(manwon / 10_000);
  const rest = manwon % 10_000;
  if (!eok) return `${rest.toLocaleString()}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString()}만원` : `${eok}억원`;
}

function dateDots(iso: string | null): string {
  return iso ? iso.replace(/-/g, ".") : "—";
}

function colourFor(change: number | null, mode: "dark" | "light") {
  if (change === null) return null;
  return changeToRgb((change / SATURATION_PCT) * 5, mode);
}

function readQuery() {
  const q = new URLSearchParams(window.location.search);
  const period = q.get("period") as RealEstatePeriod | null;
  return {
    sido: q.get("sido") ?? "11",
    sgg: q.get("sgg") ?? "",
    dong: q.get("dong") ?? "",
    period: PERIODS.some((p) => p.key === period) ? (period as RealEstatePeriod) : "3m",
  };
}

export default function RealEstateMapPage() {
  const { lang } = useLanguage();
  useDocumentTitle("부동산 맵 · 아파트 실거래가 히트맵 · K-Stock Hub");
  useBroadsheet();
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  useEffect(() => {
    document.documentElement.classList.add("is-mm");
    return () => document.documentElement.classList.remove("is-mm");
  }, []);

  const initial = useMemo(readQuery, []);
  const [sido, setSido] = useState(initial.sido);
  const [sgg, setSgg] = useState(initial.sgg);
  const [dong, setDong] = useState(initial.dong);
  const [period, setPeriod] = useState<RealEstatePeriod>(initial.period);
  const [regions, setRegions] = useState<RealEstateSido[]>([]);
  const [data, setData] = useState<RealEstateMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");
  const [hovered, setHovered] = useState<RealEstateItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    api
      .realEstateRegions()
      .then((r) => setRegions(r.sido))
      .catch(() => setError("지역 목록을 불러오지 못했습니다."));
  }, []);

  const sidoNode = regions.find((r) => r.code === sido);
  const sggNode = sidoNode?.sgg.find((g) => g.code === sgg);
  // The selectors list 시·군·구 and 읍·면·동 in 가나다 order; the region table itself
  // arrives in 법정동코드 order.
  const byName = (a: string, b: string) => a.localeCompare(b, "ko");
  const sggOptions = useMemo(() => [...(sidoNode?.sgg ?? [])].sort((a, b) => byName(a.name, b.name)), [sidoNode]);
  const dongOptions = useMemo(() => [...(sggNode?.dongs ?? [])].sort(byName), [sggNode]);

  // The address bar carries the selection, so a map can be shared or bookmarked.
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("sido", sido);
    if (sgg) q.set("sgg", sgg);
    if (sgg && dong) q.set("dong", dong);
    q.set("period", period);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q}`);
  }, [sido, sgg, dong, period]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = (first: boolean) => {
      if (first) setLoading(true);
      api
        .realEstateMap({ sido, sgg: sgg || undefined, dong: (sgg && dong) || undefined, period })
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setError(null);
          // While the collector is still filling this region, re-read it: the map
          // grows district by district instead of waiting for a reload.
          if (res.status.collecting) timer = window.setTimeout(() => load(false), 8000);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message || "부동산 데이터를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load(true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sido, sgg, dong, period]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const items = data?.items ?? [];

  const zones = useMemo<Zone[]>(() => {
    if (items.length === 0 || size.w === 0 || size.h === 0) return [];
    const byGroup = new Map<string, RealEstateItem[]>();
    for (const it of items) {
      const list = byGroup.get(it.group) ?? [];
      list.push(it);
      byGroup.set(it.group, list);
    }
    const groups = Array.from(byGroup.entries())
      .map(([group, list]) => ({ group, list: list.sort((a, b) => b.price - a.price), total: list.reduce((s, it) => s + it.price, 0) }))
      .sort((a, b) => b.total - a.total);
    const rects = squarify(groups.map((g) => ({ id: g.group, value: g.total })), 0, 0, size.w, size.h);
    return rects.map((rect) => {
      const g = groups.find((x) => x.group === rect.id)!;
      const headerH = rect.h > 46 ? 20 : 0;
      const pad = rect.w > 6 && rect.h - headerH > 6 ? 1 : 0;
      const inner = squarify(
        g.list.map((it) => ({ id: it.id, value: it.price })),
        rect.x + pad,
        rect.y + headerH,
        Math.max(rect.w - pad * 2, 0),
        Math.max(rect.h - headerH - pad, 0)
      );
      const byId = new Map(g.list.map((it) => [it.id, it]));
      const moved = g.list.filter((it) => it.change_pct !== null);
      const weight = moved.reduce((s, it) => s + it.price, 0);
      return {
        group: rect.id,
        rect,
        headerH,
        avg: weight > 0 ? moved.reduce((s, it) => s + (it.change_pct as number) * it.price, 0) / weight : null,
        tiles: inner.map((t) => ({ ...t, item: byId.get(t.id)! })),
      };
    });
  }, [items, size]);

  const skeleton = useMemo(
    () => (size.w && size.h ? squarify(SKELETON_WEIGHTS.map((value, i) => ({ id: `s${i}`, value })), 0, 0, size.w, size.h) : []),
    [size]
  );

  const total = useMemo(() => items.reduce((s, it) => s + it.price, 0), [items]);
  const movedCount = items.filter((it) => it.change_pct !== null).length;

  /** A tile or a group drills one level down: 시·도 → 시·군·구 → 읍·면·동. */
  const drill = (item: RealEstateItem | null, group?: string) => {
    if (!sidoNode) return;
    if (!sgg) {
      const name = item?.sgg ?? group;
      const target = sidoNode.sgg.find((g) => g.name === name);
      if (target) {
        setSgg(target.code);
        setDong("");
      }
    } else if (!dong) {
      const name = item?.dong ?? group;
      if (name) setDong(name);
    }
    setHovered(null);
  };

  const levelLabel = dong || sggNode?.name || sidoNode?.name || "";
  const topN = data?.top_n ?? (dong ? 100 : sgg ? 50 : 500);
  const periodInfo = PERIODS.find((p) => p.key === period)!;
  const status = data?.status;

  return (
    <div className="d2 mm app kospi-map-page kospi-map-page--expanded re-map-page" lang={lang}>
      <Masthead
        rail={false}
        onPrint={() => window.print()}
        section={{
          ko: "부동산 지도",
          en: "Real estate map",
          taglineKo: "아파트 실거래가 히트맵 — 면적은 시세, 색은 등락",
          taglineEn: "Apartment trades — area is price, colour is the move",
        }}
      />
      <Tape />

      <main className="d2-main mm-main">
        <div className="app-header-trailing">
          <div className="kospi-map-titlebar">
            <div>
              <div className="app-title-row">
                <h2 className="app-title">부동산 MAP</h2>
                <span className="kospi-map-live-badge">
                  <span className="kospi-map-live-dot" />
                  국토교통부 실거래가
                </span>
              </div>
              <p className="app-subtitle">
                {levelLabel} {data && items.length < topN ? `전체 ${items.length.toLocaleString()}개` : `가격 상위 ${topN.toLocaleString()}개`} 아파트 단지 MAP
                {data?.latest_deal_date && <span className="kospi-map-updated"> · 최근 계약일 {dateDots(data.latest_deal_date)}</span>}
              </p>
            </div>
            <div className="kospi-map-view-toggle">
              <button type="button" className={view === "map" ? "active" : ""} onClick={() => setView("map")}>
                맵 보기
              </button>
              <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
                표로 보기
              </button>
            </div>
          </div>
        </div>

        {error && <div className="error-state">{error}</div>}
        {status && !status.configured && (
          <div className="error-state re-map-notice">
            국토교통부 아파트 매매 실거래가 API 키가 아직 설정되지 않아 데이터를 불러올 수 없습니다. 서버 환경변수 <code>MOLIT_API_KEY</code>를
            설정하면 자동으로 수집을 시작합니다.
          </div>
        )}

        <div className="kospi-map-workspace">
          <aside className="kospi-map-period-rail" aria-label="조회 기간">
            <div className="kospi-map-period-head">
              <small>REAL TRADES</small>
              <strong>조회 기간</strong>
              <p>대표 평형의 현재 시세를 기간 시작 직전 시세와 비교합니다. 시세는 최근 거래 최대 3건(90일 이내)의 중간값입니다.</p>
            </div>
            <div className="kospi-map-period-options">
              {PERIODS.map((option) => (
                <label key={option.key} className={period === option.key ? "active" : ""}>
                  <input type="checkbox" checked={period === option.key} onChange={() => setPeriod(option.key)} />
                  <span>
                    <b>{option.label}</b>
                    <small>{option.key === "today" && data?.latest_deal_date ? `최근 계약일 ${dateDots(data.latest_deal_date)}` : option.detail}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="kospi-map-period-status" aria-live="polite">
              {loading
                ? "실거래 데이터를 불러오는 중…"
                : status?.collecting
                  ? `실거래 수집 중 ${Math.round(status.coverage * 100)}% · 자동 갱신`
                  : `${items.length.toLocaleString()}개 단지 · 기간 내 거래 ${movedCount.toLocaleString()}곳`}
              {status?.error && status.collecting && <div className="re-map-status-error">최근 오류: {status.error}</div>}
            </div>
            <p className="kospi-map-period-note">
              실거래는 계약 후 30일 안에 신고되므로 최근 며칠은 거래가 적게 보일 수 있습니다. 해제된 계약은 제외합니다.
            </p>
          </aside>

          <div className="kospi-map-workspace-main">
            <div className="kospi-map-legend re-map-legend">
              <div className="kospi-map-legend-info">
                <span className="kospi-map-legend-label">하락</span>
                <span className="kospi-map-legend-bar" />
                <span className="kospi-map-legend-label">상승</span>
                <span className="kospi-map-legend-scale">±10% 포화 · 빗금 = 기간 내 거래 없음</span>
              </div>
              <div className="re-map-filters">
                <label className="kospi-map-sector-filter">
                  <span className="kospi-map-sector-filter-label">시·도</span>
                  <select
                    value={sido}
                    onChange={(e) => {
                      setSido(e.target.value);
                      setSgg("");
                      setDong("");
                    }}
                    aria-label="시·도"
                  >
                    {regions.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kospi-map-sector-filter">
                  <span className="kospi-map-sector-filter-label">시·군·구</span>
                  <select
                    value={sgg}
                    onChange={(e) => {
                      setSgg(e.target.value);
                      setDong("");
                    }}
                    aria-label="시·군·구"
                  >
                    <option value="">전체</option>
                    {sggOptions.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="kospi-map-sector-filter">
                  <span className="kospi-map-sector-filter-label">읍·면·동</span>
                  <select value={dong} onChange={(e) => setDong(e.target.value)} disabled={!sgg} aria-label="읍·면·동">
                    <option value="">전체</option>
                    {dongOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {view === "map" && (
              <div className="card kospi-map-canvas re-map-canvas-night" ref={containerRef}>
                {loading &&
                  skeleton.map((rect, i) => (
                    <div
                      key={rect.id}
                      className="kospi-map-skeleton-block"
                      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, animationDelay: `${i * 70}ms` }}
                    />
                  ))}
                {!loading && items.length === 0 && status?.configured && (
                  <div className="re-map-empty">
                    {status.collecting
                      ? `${levelLabel}의 실거래 데이터를 수집하고 있습니다 (${Math.round(status.coverage * 100)}%). 잠시 후 자동으로 표시됩니다.`
                      : `${levelLabel}에는 최근 1년 아파트 매매 실거래가 없습니다.`}
                  </div>
                )}
                {!loading &&
                  zones.map((zone) => (
                    <div
                      key={zone.group}
                      className="kospi-map-sector"
                      style={{ left: zone.rect.x, top: zone.rect.y, width: zone.rect.w, height: zone.rect.h }}
                    >
                      {zone.headerH > 0 && (
                        <button
                          type="button"
                          className="kospi-map-sector-header re-map-group-head"
                          style={{ height: zone.headerH }}
                          onClick={() => drill(null, zone.group)}
                          disabled={!!dong}
                          title={dong ? undefined : `${zone.group}만 보기`}
                        >
                          <span className="kospi-map-sector-name">{zone.group}</span>
                          {zone.avg !== null && (
                            <span className="kospi-map-sector-avg" style={{ color: zone.avg >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                              {pct(zone.avg)}
                            </span>
                          )}
                        </button>
                      )}
                      {zone.tiles.map((tile) => {
                        const it = tile.item;
                        const rgb = colourFor(it.change_pct, MAP_MODE);
                        const idle = rgb === null;
                        const text = rgb ? textColorForRgb(rgb, MAP_MODE) : undefined;
                        const { showName, showPctOnly, fontSizes, iconSize } = tileDisplayInfo(tile.w, tile.h, it.name);
                        // The brand mark goes in front of the name whenever the tile is wide
                        // enough to keep a few letters beside it, even if the name then
                        // truncates — on this map the brand is often the most telling word.
                        const showIcon = showName && !!it.brand && tile.w >= brandIconWidth(it.brand, iconSize) + iconSize * 2.5;
                        const showPrice = showName && tile.h >= 64 && tile.w >= 70;
                        const label = it.change_pct === null ? "거래없음" : pct(it.change_pct);
                        return (
                          <button
                            key={tile.id}
                            type="button"
                            className={`kospi-map-tile${idle ? " re-map-tile--idle" : ""}`}
                            style={{
                              left: tile.x - zone.rect.x,
                              top: tile.y - zone.rect.y,
                              width: tile.w,
                              height: tile.h,
                              background: rgb ? rgbToCss(rgb) : undefined,
                              color: text,
                              fontFamily: TILE_FONT_FAMILY,
                            }}
                            onClick={() => drill(it)}
                            onMouseEnter={(e) => {
                              setHovered(it);
                              setHoverPos({ x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setHovered(null)}
                          >
                            {showName && (
                              <>
                                <span className="kospi-map-tile-name-row">
                                  {showIcon && it.brand && <AptBrandIcon brand={it.brand} size={iconSize} className="kospi-map-tile-icon" />}
                                  <span className="kospi-map-tile-name" style={{ fontSize: fontSizes.name }}>
                                    {it.name}
                                  </span>
                                </span>
                                {showPrice && (
                                  <span className="re-map-tile-price" style={{ fontSize: Math.max(10, fontSizes.pct * 0.85) }}>
                                    {shortPrice(it.price)} · {Math.round(it.area)}㎡
                                  </span>
                                )}
                                <span className="kospi-map-tile-pct" style={{ fontSize: fontSizes.pct }}>
                                  {label}
                                </span>
                              </>
                            )}
                            {showPctOnly && (
                              <span className="kospi-map-tile-pct" style={{ fontSize: fontSizes.pct }}>
                                {it.change_pct === null ? "—" : pct(it.change_pct)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
              </div>
            )}

            {view === "table" && (
              <div className="card kospi-map-table-wrap">
                <table className="kospi-map-table re-map-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>단지명</th>
                      <th>지역</th>
                      <th>대표 평형</th>
                      <th>시세</th>
                      <th>최근 계약</th>
                      <th>기간 전 시세</th>
                      <th>등락률</th>
                      <th>기간 거래</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.id} onClick={() => drill(it)}>
                        <td>{i + 1}</td>
                        <td className="kospi-map-table-name">
                          <span className="re-map-table-name">
                            {it.brand && <AptBrandIcon brand={it.brand} size={16} />}
                            {it.name}
                          </span>
                        </td>
                        <td>
                          {it.sgg} {it.dong}
                        </td>
                        <td>
                          {it.area}㎡ ({it.pyeong}평)
                        </td>
                        <td>{fullPrice(it.price)}</td>
                        <td>{dateDots(it.deal_date)}</td>
                        <td>{it.base_price ? `${fullPrice(it.base_price)} (${dateDots(it.base_date)})` : "—"}</td>
                        <td
                          style={{
                            color: it.change_pct === null ? undefined : it.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)",
                          }}
                        >
                          {it.change_pct === null ? "—" : pct(it.change_pct)}
                        </td>
                        <td>{it.trades}건</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="re-map-source">
              자료: 국토교통부 아파트 매매 실거래가 (공공데이터포털). 면적은 단지 대표 평형(최근 1년 최다 거래 전용면적)의 시세(최근 거래 최대 3건 중간값, 직거래 제외), 그룹 면적은
              지역 내 시세 합계 비중입니다. 브랜드 표시는 단지명 기준 자동 분류이며, 로고는 Wikimedia Commons(힐스테이트·우미린 CC BY-SA)와 각 사 공식 사이트에서 가져왔습니다. 로고가 없는 브랜드는 약식 표지로 표시합니다.
            </p>
          </div>
        </div>

        {hovered && (
          <div className="kospi-map-tooltip" style={{ left: hoverPos.x + 16, top: hoverPos.y + 16 }}>
            <div className="kospi-map-tooltip-title re-map-tooltip-title">
              {hovered.brand && <AptBrandIcon brand={hovered.brand} size={18} />}
              {hovered.name}
            </div>
            <div className="kospi-map-tooltip-row">
              {hovered.sgg} {hovered.dong}
              {brandLabel(hovered.brand) && ` · ${brandLabel(hovered.brand)}`}
              {hovered.built && ` · ${hovered.built}년 준공`}
            </div>
            <div className="kospi-map-tooltip-row">
              대표 평형 전용 {hovered.area}㎡ (전용 {hovered.pyeong}평)
            </div>
            <div className="kospi-map-tooltip-row">
              시세 {fullPrice(hovered.price)} · 최근 계약 {dateDots(hovered.deal_date)}
              {hovered.floor !== null && ` · ${hovered.floor}층`}
            </div>
            <div className="kospi-map-tooltip-row">
              기간 전 시세 {hovered.base_price ? `${fullPrice(hovered.base_price)} · ${dateDots(hovered.base_date)}` : "없음"}
            </div>
            <div
              className="kospi-map-tooltip-row"
              style={{ color: hovered.change_pct === null ? undefined : hovered.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
            >
              {periodInfo.label} 등락{" "}
              {hovered.change_pct === null
                ? hovered.trades
                  ? "비교할 이전 거래 없음"
                  : "기간 내 거래 없음"
                : `${pct(hovered.change_pct)} (${hovered.base_price ? shortPrice(Math.abs(hovered.price - hovered.base_price)) : ""} ${
                    hovered.change_pct >= 0 ? "▲" : "▼"
                  })`}
            </div>
            <div className="kospi-map-tooltip-row">
              기간 내 거래 {hovered.trades}건 (전체 평형 {hovered.trades_all}건) · 맵 면적 비중{" "}
              {total > 0 ? ((hovered.price / total) * 100).toFixed(2) : "0.00"}%
            </div>
          </div>
        )}
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
