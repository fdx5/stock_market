import { useEffect, useMemo, useRef, useState } from "react";
import { MarketMapItem, StockSearchResult, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { pct, tileDisplayInfo } from "../mapTile";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useThemeMode } from "../theme";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import { useMediaQuery } from "../useMediaQuery";
import StockIcon from "./StockIcon";

const REFRESH_MS = 60_000;

// The dashboard's two columns only diverge in height on a wide screen — below the
// 920px breakpoint .layout stacks them and there is no leftover space for this to
// fill, so the panel is not merely hidden there but never mounted, and never spends
// a request. Matches the same breakpoint styles.css stacks at.
const DESKTOP_QUERY = "(min-width: 921px)";

/** A Finviz-style treemap of the stocks sharing the selected stock's sector, sized by
 * market cap and colored by change — the same squarify layout and diverging palette
 * the full KOSPI/KOSDAQ maps use (see MarketMapPage), minus the per-sector zoning that
 * a single-sector map has no use for.
 *
 * It lives under the discussion/news panel and stretches into whatever height the
 * chart column has that the side column does not, which is why it measures itself
 * rather than taking a fixed height the way the full-page maps can.
 */
export default function SectorMapPanel({
  code,
  onSelectStock,
}: {
  code: string;
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const t = useT();
  const themeMode = useThemeMode();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [sector, setSector] = useState<string | null>(null);
  const [market, setMarket] = useState<"KOSPI" | "KOSDAQ">("KOSPI");
  const [avgChangePct, setAvgChangePct] = useState(0);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!isDesktop || !code) return;
    let cancelled = false;
    setLoading(true);
    // Not cleared on a stock switch: a peer within the same sector returns the very
    // same tiles, so blanking the map would make the common case flash for no reason.
    // A different sector simply replaces them when its response lands.

    const load = () => {
      api
        .sectorMap(code)
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setSector(res.sector);
          setMarket(res.market);
          setAvgChangePct(res.avg_change_pct);
        })
        .catch(() => {
          // The map is context, not the point of the page — a failure leaves whatever
          // is already drawn rather than taking over the column with an error.
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load();
    const stopPolling = startVisibilityAwareInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [code, isDesktop]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-run on mount only; the observer covers every later size change, including the
    // one that matters most here — the chart column growing as its data lands and
    // handing this panel more height.
  }, [isDesktop]);

  const translatedNames = useTranslatedTexts(items.map((it) => it.name));
  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it, i) => map.set(it.code, translatedNames[i] ?? it.name));
    return map;
  }, [items, translatedNames]);

  const tiles = useMemo<(TreemapRect & { item: MarketMapItem })[]>(() => {
    if (items.length === 0 || size.w === 0 || size.h === 0) return [];
    const sorted = [...items].sort((a, b) => b.marcap - a.marcap);
    const rects = squarify(
      sorted.map((it) => ({ id: it.code, value: it.marcap })),
      0,
      0,
      size.w,
      size.h
    );
    const byCode = new Map(sorted.map((it) => [it.code, it]));
    return rects.map((rect) => ({ ...rect, item: byCode.get(rect.id)! }));
  }, [items, size]);

  if (!isDesktop) return null;

  return (
    <div className="card sector-map-card">
      <div className="sector-map-head">
        <span className="sector-map-title">
          {t("업종 맵")}
          {sector && <span className="sector-map-sector">{t(sector)}</span>}
        </span>
        {sector && (
          <span
            className="sector-map-avg"
            style={{ color: avgChangePct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
          >
            {market} · {pct(avgChangePct)}
          </span>
        )}
      </div>

      <div className="sector-map-canvas" ref={containerRef}>
        {loading && items.length === 0 && <div className="sector-map-status">{t("불러오는 중...")}</div>}
        {!loading && items.length === 0 && (
          <div className="sector-map-status">{t("같은 업종의 종목을 찾지 못했습니다.")}</div>
        )}
        {tiles.map((tile) => {
          const rgb = changeToRgb(tile.item.change_pct, themeMode);
          const name = nameByCode.get(tile.item.code) ?? tile.item.name;
          const { showName, showPctOnly, fontSizes, showIcon, iconSize } = tileDisplayInfo(tile.w, tile.h, name);
          // The stock the page is actually about gets a ring rather than a different
          // fill — the fill is the change scale and has to keep meaning only that.
          const isCurrent = tile.item.code === code;
          return (
            <button
              key={tile.id}
              type="button"
              className={`kospi-map-tile ${isCurrent ? "sector-map-tile--current" : ""}`}
              style={{
                left: tile.x,
                top: tile.y,
                width: tile.w,
                height: tile.h,
                background: rgbToCss(rgb),
                color: textColorForRgb(rgb, themeMode),
              }}
              title={`${name} ${pct(tile.item.change_pct)}`}
              onClick={() => onSelectStock({ code: tile.item.code, name: tile.item.name, market })}
            >
              {showName && (
                <>
                  <span className="kospi-map-tile-name-row">
                    {showIcon && (
                      <StockIcon
                        className="kospi-map-tile-icon"
                        style={{ width: iconSize, height: iconSize }}
                        code={tile.item.code}
                      />
                    )}
                    <span className="kospi-map-tile-name" style={{ fontSize: fontSizes.name }}>
                      {name}
                    </span>
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
    </div>
  );
}
