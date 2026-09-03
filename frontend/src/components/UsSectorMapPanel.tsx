import { useEffect, useMemo, useRef, useState } from "react";
import { MarketMapItem, MarketSession, StockSearchResult, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { pct, tileDisplayInfo } from "../mapTile";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useThemeMode } from "../theme";
import { TreemapRect, changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import SessionBadge from "./SessionBadge";

const REFRESH_MS = 60_000;

// Mounts at every width, same as SectorMapPanel: where a stacked layout leaves no
// column height to fill, the card's own min-height gives the map a box (see
// .card.sector-map-card in styles.css).

/** The /global page's version of the dashboard's 업종 맵 — a Finviz-style treemap of the
 * S&P 500 names sharing the current US ticker's GICS sector, sized by index weight and
 * colored by change.
 *
 * Differs from SectorMapPanel only where the market does: tiles are labelled with the
 * ticker rather than a company name (the convention the S&P500/NASDAQ100 maps already
 * use, since US names are long and there is no logo source for them), and there is no
 * translation pass because those labels are never Korean.
 */
export default function UsSectorMapPanel({
  code,
  onSelectStock,
}: {
  code: string;
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const t = useT();
  const themeMode = useThemeMode();

  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [sector, setSector] = useState<string | null>(null);
  const [avgChangePct, setAvgChangePct] = useState(0);
  const [session, setSession] = useState<MarketSession | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true);
    // Not cleared on a ticker switch, same as the KR panel: a peer within the same
    // sector returns the very same tiles, so blanking the map would make the common
    // case flash for no reason.

    const load = () => {
      api
        .usSectorMap(code)
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setSector(res.sector);
          setAvgChangePct(res.avg_change_pct);
          setSession(res.session);
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
  }, [code]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Compared before it is stored: the observer fires on every frame of a window
    // drag, and an unguarded object would re-render the treemap for each one even
    // where this panel's own box never moved.
    const update = () =>
      setSize((current) =>
        current.w === el.clientWidth && current.h === el.clientHeight
          ? current
          : { w: el.clientWidth, h: el.clientHeight },
      );
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-run on mount only; the observer covers every later size change, including the
    // one that matters most here — the chart column growing as its data lands and
    // handing this panel more height.
  }, []);

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

  return (
    <div className="card sector-map-card">
      <div className="sector-map-head">
        <span className="sector-map-title">
          {t("업종 맵")}
          {/* GICS sector labels arrive in English and stay that way in both languages,
              matching how /sp500-map renders its own sector zone headers. */}
          {sector && <span className="sector-map-sector">{sector}</span>}
        </span>
        {sector && (
          <span
            className="sector-map-avg"
            style={{ color: avgChangePct >= 0 ? "var(--up-color)" : "var(--down-color)" }}
          >
            S&P500 · {pct(avgChangePct)}
            {/* Outside regular hours these tiles are priced off their pre/post prints,
                same as every other US surface — the header has to say so, because the
                tiles can't. */}
            <SessionBadge session={session} compact />
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
          const label = tile.item.code;
          const { showName, showPctOnly, fontSizes } = tileDisplayInfo(tile.w, tile.h, label);
          // The stock the page is actually about gets a ring rather than a different
          // fill — the fill is the change scale and has to keep meaning only that.
          const isCurrent = tile.item.code === code.toUpperCase();
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
              title={`${tile.item.name} ${pct(tile.item.change_pct)}`}
              onClick={() => onSelectStock({ code: tile.item.code, name: tile.item.name, market: "US" })}
            >
              {showName && (
                <>
                  <span className="kospi-map-tile-name-row">
                    <span className="kospi-map-tile-name" style={{ fontSize: fontSizes.name }}>
                      {label}
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
