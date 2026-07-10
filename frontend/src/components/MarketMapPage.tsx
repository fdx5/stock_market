import { useEffect, useMemo, useRef, useState } from "react";
import { MarketMapItem } from "../api/client";
import { wonSuffix } from "../i18n/format";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { Link, navigate } from "../router";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import { useDocumentTitle } from "../useDocumentTitle";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketTickerBar from "./MarketTickerBar";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";

interface SectorZone {
  sector: string;
  rect: TreemapRect;
  headerH: number;
  avgChangePct: number;
  tiles: (TreemapRect & { item: MarketMapItem })[];
}

function formatMarcap(marcap: number, lang: Lang): string {
  const eok = marcap / 100_000_000;
  if (lang === "en") {
    if (eok >= 10_000) return `${(eok / 10_000).toFixed(1)}T KRW`;
    return `${(eok / 10).toFixed(1)}B KRW`;
  }
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(1)}조원`;
  return `${Math.round(eok).toLocaleString()}억원`;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

// Scales name/pct text with how much area the tile actually has, instead of a single
// fixed size for every tile that clears the "show text" threshold — a tile many times
// larger than another (e.g. Samsung vs. a mid-cap name) reads noticeably larger too.
function tileFontSizes(w: number, h: number): { name: number; pct: number } {
  const minDim = Math.min(w, h);
  const name = Math.min(26, 11 + Math.max(0, minDim - 30) * 0.09);
  const pctSize = Math.min(19, 10 + Math.max(0, minDim - 30) * 0.07);
  return { name, pct: pctSize };
}

export interface MarketMapPageProps {
  pageTitle: string;
  loadingLabel: string;
  subtitlePrefix: string;
  fetchMap: (limit: number) => Promise<{ generated_at: string; count: number; items: MarketMapItem[] }>;
  /** Rank 1..tier1Limit refreshes every 30s, tier1Limit+1..tier2Limit every 5min, the
   * rest (up to fullLimit) every 10min — matches the backend's cache TTL tiers. */
  tier1Limit: number;
  tier2Limit: number;
  fullLimit: number;
  /** Extra nav links shown next to the live badge (besides the back-link and visitor badge). */
  navLinks: { to: string; label: string }[];
}

// Shared by KospiMapPage and KosdaqMapPage — both are a Finviz-style sector treemap over
// a ranked market-cap snapshot, differing only in data source, rank-tier sizes, and
// header copy. CSS classes below keep the "kospi-map-*" naming from when this was KOSPI
// MAP-only; they're generic layout hooks now, shared by both markets.
export default function MarketMapPage({
  pageTitle,
  loadingLabel,
  subtitlePrefix,
  fetchMap,
  tier1Limit,
  tier2Limit,
  fullLimit,
  navLinks,
}: MarketMapPageProps) {
  const { lang } = useLanguage();
  const t = useT();
  useDocumentTitle("K-Stock Hub");

  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");
  const [hovered, setHovered] = useState<MarketMapItem | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const TIER1_REFRESH_MS = 30_000;
  const TIER2_REFRESH_MS = 5 * 60_000;
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
    const loadPartial = (limit: number, isInitial: boolean) => {
      if (isInitial) setLoading(true);

      fetchMap(limit)
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
      fetchMap(fullLimit)
        .then((res) => {
          if (cancelled) return;
          // The full snapshot is authoritative (unlike the partial tiers above), so it
          // replaces state outright — that's also what drops names that fell off the tail.
          setItems(res.items);
          setGeneratedAt(res.generated_at);
        })
        .catch(() => {
          // Long-tail refresh failing quietly keeps whatever is already on screen.
        });
    };

    loadPartial(tier1Limit, true);
    loadPartial(tier2Limit, false);
    loadFullList();

    const tier1Interval = setInterval(() => loadPartial(tier1Limit, false), TIER1_REFRESH_MS);
    const tier2Interval = setInterval(() => loadPartial(tier2Limit, false), TIER2_REFRESH_MS);
    const fullInterval = setInterval(loadFullList, FULL_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(tier1Interval);
      clearInterval(tier2Interval);
      clearInterval(fullInterval);
    };
  }, [fetchMap, tier1Limit, tier2Limit, fullLimit]);

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

  // One batched translation request for every name currently loaded (tiles, table,
  // tooltip all read from this same array), rather than one call per row.
  const translatedNames = useTranslatedTexts(items.map((it) => it.name));
  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it, i) => map.set(it.code, translatedNames[i] ?? it.name));
    return map;
  }, [items, translatedNames]);

  const liveBadgeText = lang === "en" ? "Live (rank-based refresh: 30s–10min)" : "실시간 (순위별 30초 ~ 10분단위 갱신)";

  return (
    <div className="app kospi-map-page">
      <header className="app-header">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          {navLinks.map((link) => (
            <Link key={link.to} to={link.to} className="kospi-map-nav-link">
              {t(link.label)}
            </Link>
          ))}
          <VisitorBadge />
        </div>
        <div className="kospi-map-titlebar">
          <div>
            <div className="app-title-row">
              <h1 className="app-title">{pageTitle}</h1>
              <span className="kospi-map-live-badge">
                <span className="kospi-map-live-dot" />
                {liveBadgeText}
              </span>
            </div>
            <p className="app-subtitle">
              {t(subtitlePrefix)} {t("종목 MAP")}
              {generatedAt && (
                <span className="kospi-map-updated">
                  {lang === "en"
                    ? ` · as of ${generatedAt.replace("T", " ")}`
                    : ` · ${generatedAt.replace("T", " ")} 기준`}
                </span>
              )}
            </p>
          </div>
          <div className="kospi-map-view-toggle">
            <button type="button" className={view === "map" ? "active" : ""} onClick={() => setView("map")}>
              {t("맵 보기")}
            </button>
            <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
              {t("표로 보기")}
            </button>
          </div>
        </div>
      </header>

      <MarketTickerBar />

      {loading && <div className="loading-state">{t(loadingLabel)}</div>}
      {error && <div className="error-state">{t(error)}</div>}

      {!loading && !error && (
        <>
          <div className="kospi-map-legend">
            <span className="kospi-map-legend-label">{t("하락")}</span>
            <span className="kospi-map-legend-bar" />
            <span className="kospi-map-legend-label">{t("상승")}</span>
            <span className="kospi-map-legend-scale">{t("-5% ~ +5% 기준 포화")}</span>
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
                      <span className="kospi-map-sector-name">{t(zone.sector)}</span>
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
                    const fontSizes = tileFontSizes(tile.w, tile.h);
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
                            <span className="kospi-map-tile-name" style={{ fontSize: fontSizes.name }}>
                              {nameByCode.get(tile.item.code) ?? tile.item.name}
                            </span>
                            <span className="kospi-map-tile-pct" style={{ fontSize: fontSizes.pct }}>
                              {pct(tile.item.change_pct)}
                            </span>
                          </>
                        )}
                        {showPctOnly && (
                          <span className="kospi-map-tile-pct" style={{ fontSize: fontSizes.pct }}>
                            {pct(tile.item.change_pct)}
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
              <table className="kospi-map-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("종목명")}</th>
                    <th>{t("업종")}</th>
                    <th>{t("시가총액")}</th>
                    <th>{t("현재가")}</th>
                    <th>{t("등락률")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.code} onClick={() => handleTileClick(item.code)}>
                      <td>{idx + 1}</td>
                      <td className="kospi-map-table-name">
                        {nameByCode.get(item.code) ?? item.name} <span className="top100-code">{item.code}</span>
                      </td>
                      <td>{t(item.sector)}</td>
                      <td>{formatMarcap(item.marcap, lang)}</td>
                      <td>{item.close.toLocaleString()}{wonSuffix(lang)}</td>
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
            {nameByCode.get(hovered.code) ?? hovered.name} <span className="top100-code">{hovered.code}</span>
          </div>
          <div className="kospi-map-tooltip-row">{t("업종")} {t(hovered.sector)}</div>
          <div className="kospi-map-tooltip-row">{t("시가총액")} {formatMarcap(hovered.marcap, lang)}</div>
          <div className="kospi-map-tooltip-row">{t("현재가")} {hovered.close.toLocaleString()}{wonSuffix(lang)}</div>
          <div
            className="kospi-map-tooltip-row"
            style={{ color: hovered.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
          >
            {t("등락")} {hovered.change >= 0 ? "+" : ""}
            {hovered.change.toLocaleString()}{wonSuffix(lang)} ({pct(hovered.change_pct)})
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
