import { useEffect, useMemo, useRef, useState } from "react";
import { MarketMapItem, api } from "../api/client";
import { Link, navigate } from "../router";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";

interface SectorZone {
  sector: string;
  rect: TreemapRect;
  headerH: number;
  avgChangePct: number;
  tiles: (TreemapRect & { item: MarketMapItem })[];
}

function formatMarcap(marcap: number): string {
  const eok = marcap / 100_000_000;
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(1)}조원`;
  return `${Math.round(eok).toLocaleString()}억원`;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function KospiMapPage() {
  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");
  const [hovered, setHovered] = useState<MarketMapItem | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Top 100 (by market cap) drives most of the map's visual weight and refreshes often;
  // the long tail matters far less moment-to-moment, so it's fetched far less often too.
  // Fetching top100 alone is much faster than the full 500 (fewer upstream pages), so it
  // also doubles as the fast path for the very first paint after entering the page.
  const TOP_TIER_LIMIT = 100;
  const FULL_LIMIT = 500;
  const TOP_TIER_REFRESH_MS = 30_000;
  const FULL_REFRESH_MS = 10 * 60_000;

  useEffect(() => {
    let cancelled = false;

    const mergeItems = (prev: MarketMapItem[], fresh: MarketMapItem[]): MarketMapItem[] => {
      const byCode = new Map(prev.map((it) => [it.code, it]));
      for (const item of fresh) byCode.set(item.code, item);
      return Array.from(byCode.values());
    };

    // Only the very first load shows the loading state — refreshes swap the data in
    // place so the map keeps rendering the previous snapshot instead of flashing empty.
    const loadTopTier = (isInitial: boolean) => {
      if (isInitial) setLoading(true);

      api
        .marketMap(TOP_TIER_LIMIT)
        .then((res) => {
          if (cancelled) return;
          setItems((prev) => mergeItems(prev, res.items));
          setGeneratedAt(res.generated_at);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          if (isInitial) setError(err.message || "데이터를 불러오지 못했습니다.");
          // A failed background refresh keeps showing the last good snapshot rather
          // than replacing a working map with an error screen.
        })
        .finally(() => {
          if (isInitial && !cancelled) setLoading(false);
        });
    };

    const loadFullList = () => {
      api
        .marketMap(FULL_LIMIT)
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setGeneratedAt(res.generated_at);
        })
        .catch(() => {
          // Long-tail refresh failing quietly keeps whatever is already on screen.
        });
    };

    loadTopTier(true);
    loadFullList();

    const topInterval = setInterval(() => loadTopTier(false), TOP_TIER_REFRESH_MS);
    const fullInterval = setInterval(loadFullList, FULL_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(topInterval);
      clearInterval(fullInterval);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || view !== "map") return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // `loading` is included so this re-attaches once the canvas div actually mounts
    // (it doesn't exist yet on first render, while the map data is still loading).
  }, [view, loading]);

  const sectorZones = useMemo<SectorZone[]>(() => {
    if (items.length === 0 || size.w === 0 || size.h === 0) return [];

    const bySector = new Map<string, MarketMapItem[]>();
    for (const item of items) {
      const list = bySector.get(item.sector) ?? [];
      list.push(item);
      bySector.set(item.sector, list);
    }

    const sectorInputs = Array.from(bySector.entries())
      .map(([sector, list]) => ({
        sector,
        stocks: list.sort((a, b) => b.marcap - a.marcap),
        totalMarcap: list.reduce((sum, it) => sum + it.marcap, 0),
      }))
      .sort((a, b) => b.totalMarcap - a.totalMarcap);

    const sectorRects = squarify(
      sectorInputs.map((s) => ({ id: s.sector, value: s.totalMarcap })),
      0,
      0,
      size.w,
      size.h
    );

    return sectorRects.map((rect) => {
      const group = sectorInputs.find((s) => s.sector === rect.id)!;
      const headerH = rect.h > 46 ? 20 : 0;
      const pad = rect.w > 6 && rect.h - headerH > 6 ? 1 : 0;
      const innerRects = squarify(
        group.stocks.map((s) => ({ id: s.code, value: s.marcap })),
        rect.x + pad,
        rect.y + headerH,
        Math.max(rect.w - pad * 2, 0),
        Math.max(rect.h - headerH - pad, 0)
      );
      const byCode = new Map(group.stocks.map((s) => [s.code, s]));
      const weightedChange = group.stocks.reduce((sum, s) => sum + s.change_pct * s.marcap, 0);
      return {
        sector: rect.id,
        rect,
        headerH,
        avgChangePct: group.totalMarcap > 0 ? weightedChange / group.totalMarcap : 0,
        tiles: innerRects.map((t) => ({ ...t, item: byCode.get(t.id)! })),
      };
    });
  }, [items, size]);

  const handleTileClick = (code: string) => navigate(`/?code=${code}`);

  return (
    <div className="app kospi-map-page">
      <header className="app-header">
        <Link to="/" className="back-link">
          ← 메인으로
        </Link>
        <div className="kospi-map-titlebar">
          <div>
            <div className="app-title-row">
              <h1 className="app-title">KOSPI MAP</h1>
              <span className="kospi-map-live-badge">
                <span className="kospi-map-live-dot" />
                실시간 (상위 100위 30초 · 전체 10분 갱신)
              </span>
            </div>
            <p className="app-subtitle">
              코스피 시가총액 상위 500개 종목을 업종별로 묶어 시가총액 크기, 등락률을 한눈에 보여줍니다. 타일을
              클릭하면 해당 종목 상세로 이동합니다.
              {generatedAt && <span className="kospi-map-updated"> · {generatedAt.replace("T", " ")} 기준</span>}
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
      </header>

      {loading && <div className="loading-state">시총 500개 종목 데이터를 불러오는 중...</div>}
      {error && <div className="error-state">{error}</div>}

      {!loading && !error && (
        <>
          <div className="kospi-map-legend">
            <span className="kospi-map-legend-label">하락</span>
            <span className="kospi-map-legend-bar" />
            <span className="kospi-map-legend-label">상승</span>
            <span className="kospi-map-legend-scale">-5% ~ +5% 기준 포화</span>
          </div>

          {view === "map" && (
            <div className="card kospi-map-canvas" ref={containerRef}>
              {sectorZones.map((zone) => (
                <div
                  key={zone.sector}
                  className="kospi-map-sector"
                  style={{ left: zone.rect.x, top: zone.rect.y, width: zone.rect.w, height: zone.rect.h }}
                >
                  {zone.headerH > 0 && (
                    <div className="kospi-map-sector-header" style={{ height: zone.headerH }}>
                      <span className="kospi-map-sector-name">{zone.sector}</span>
                      <span
                        className="kospi-map-sector-avg"
                        style={{ color: zone.avgChangePct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
                      >
                        {pct(zone.avgChangePct)}
                      </span>
                    </div>
                  )}
                  {zone.tiles.map((tile) => {
                    const rgb = changeToRgb(tile.item.change_pct);
                    const bg = rgbToCss(rgb);
                    const textColor = textColorForRgb(rgb);
                    const localX = tile.x - zone.rect.x;
                    const localY = tile.y - zone.rect.y;
                    const showName = tile.w >= 46 && tile.h >= 30;
                    const showPctOnly = !showName && tile.w >= 24 && tile.h >= 16;
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        className="kospi-map-tile"
                        style={{
                          left: localX,
                          top: localY,
                          width: tile.w,
                          height: tile.h,
                          background: bg,
                          color: textColor,
                        }}
                        onClick={() => handleTileClick(tile.item.code)}
                        onMouseEnter={(e) => {
                          setHovered(tile.item);
                          setHoverPos({ x: e.clientX, y: e.clientY });
                        }}
                        onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHovered(null)}
                      >
                        {showName && (
                          <>
                            <span className="kospi-map-tile-name">{tile.item.name}</span>
                            <span className="kospi-map-tile-pct">{pct(tile.item.change_pct)}</span>
                          </>
                        )}
                        {showPctOnly && <span className="kospi-map-tile-pct">{pct(tile.item.change_pct)}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {view === "table" && (
            <div className="card kospi-map-table-wrap">
              <table className="kospi-map-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>종목명</th>
                    <th>업종</th>
                    <th>시가총액</th>
                    <th>현재가</th>
                    <th>등락률</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.code} onClick={() => handleTileClick(item.code)}>
                      <td>{idx + 1}</td>
                      <td className="kospi-map-table-name">
                        {item.name} <span className="top100-code">{item.code}</span>
                      </td>
                      <td>{item.sector}</td>
                      <td>{formatMarcap(item.marcap)}</td>
                      <td>{item.close.toLocaleString()}원</td>
                      <td style={{ color: item.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                        {pct(item.change_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {hovered && (
        <div className="kospi-map-tooltip" style={{ left: hoverPos.x + 16, top: hoverPos.y + 16 }}>
          <div className="kospi-map-tooltip-title">
            {hovered.name} <span className="top100-code">{hovered.code}</span>
          </div>
          <div className="kospi-map-tooltip-row">업종 {hovered.sector}</div>
          <div className="kospi-map-tooltip-row">시가총액 {formatMarcap(hovered.marcap)}</div>
          <div className="kospi-map-tooltip-row">현재가 {hovered.close.toLocaleString()}원</div>
          <div
            className="kospi-map-tooltip-row"
            style={{ color: hovered.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
          >
            등락 {hovered.change >= 0 ? "+" : ""}
            {hovered.change.toLocaleString()}원 ({pct(hovered.change_pct)})
          </div>
        </div>
      )}
    </div>
  );
}
