/* The floor's heat map opened as a wide dialog: the site's market-map treemap (same squarify,
 * colour scale and tile rules as /map), grouped by sector, top 200 by market cap. */
import { useEffect, useMemo, useRef, useState } from "react";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { api, type MarketMapItem } from "../api/client";
import { TILE_FONT_FAMILY, pct, tileDisplayInfo } from "../mapTile";
import { changeToRgb, rgbToCss, squarify, textColorForRgb } from "../treemap";
import StockIcon from "../components/StockIcon";
import UsStockIcon from "../components/UsStockIcon";
import { MARKETS, displayValue, stockDetailPath, type ExchangeMarket, type Language } from "./market";

type Tile = { x: number; y: number; w: number; h: number; row: MarketMapItem };
type Group = { name: string; x: number; y: number; w: number; h: number; change: number; tiles: Tile[] };
const HEADER = 18;

export default function FloorHeatmap({ market, fallback, lang }: { market: ExchangeMarket; fallback: MarketMapItem[]; lang: Language }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rows, setRows] = useState<MarketMapItem[]>(fallback);
  const [hover, setHover] = useState<{ row: MarketMapItem; x: number; y: number }>();
  const t = (ko: string, en: string) => lang === "ko" ? ko : en;

  useEffect(() => {
    let alive = true;
    const load = () => (market === "sp500" ? api.sp500Map(200) : market === "kosdaq" ? api.kosdaqMap(200) : api.marketMap(200))
      .then(value => { if (alive && value.items.length) setRows(value.items.filter(r => r.close > 0)); }).catch(() => {});
    void load();
    // Keep the open dialog live, like the floor's own displays.
    const stop = startVisibilityAwareInterval(() => { void load(); }, 30_000);
    return () => { alive = false; stop(); };
  }, [market]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const groups = useMemo<Group[]>(() => {
    if (!size.w || !size.h || !rows.length) return [];
    const bySector = new Map<string, MarketMapItem[]>();
    for (const r of rows) bySector.set(r.sector || "—", [...(bySector.get(r.sector || "—") ?? []), r]);
    const sectorItems = [...bySector.entries()].map(([name, list]) => ({ id: name, value: list.reduce((s, r) => s + Math.max(r.marcap, 1), 0) }));
    return squarify(sectorItems, 0, 0, size.w, size.h).map(rect => {
      const list = bySector.get(rect.id) ?? [];
      const cap = list.reduce((s, r) => s + Math.max(r.marcap, 1), 0);
      const change = list.reduce((s, r) => s + r.change_pct * Math.max(r.marcap, 1), 0) / (cap || 1);
      const inner = squarify(list.map(r => ({ id: r.code, value: Math.max(r.marcap, 1) })), rect.x + 1, rect.y + HEADER, rect.w - 2, rect.h - HEADER - 1);
      const byCode = new Map(list.map(r => [r.code, r]));
      return { name: rect.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, change,
        tiles: inner.map(tile => ({ x: tile.x, y: tile.y, w: tile.w, h: tile.h, row: byCode.get(tile.id)! })) };
    });
  }, [rows, size]);

  return <div className="exchange-heatmap">
    <div className="exchange-heatmap-legend">
      <span>{MARKETS[market].label} · {t("시가총액 상위", "Top by market cap")} {rows.length} · {t("업종별", "by sector")}</span>
      <i>{[-3, -2, -1, 0, 1, 2, 3].map(v => <b key={v} style={{ background: rgbToCss(changeToRgb(v)) }}>{v > 0 ? "+" + v : v}%</b>)}</i>
    </div>
    <div ref={box} className="exchange-heatmap-box" onMouseLeave={() => setHover(undefined)}>
      {groups.map(group => <section key={group.name} style={{ left: group.x, top: group.y, width: group.w, height: group.h }}>
        <header>{group.w > 60 && <><span>{group.name}</span><b>{pct(group.change)}</b></>}</header>
        {group.tiles.map(tile => {
          const rgb = changeToRgb(tile.row.change_pct);
          const name = market === "sp500" ? tile.row.code : tile.row.name;
          const info = tileDisplayInfo(tile.w, tile.h, name);
          return <a key={tile.row.code} className="exchange-heatmap-tile"
            href={stockDetailPath(market, tile.row.code)} target="_blank" rel="noopener noreferrer"
            style={{ left: tile.x - group.x, top: tile.y - group.y, width: tile.w, height: tile.h, background: rgbToCss(rgb), color: textColorForRgb(rgb), fontFamily: TILE_FONT_FAMILY }}
            onMouseMove={event => setHover({ row: tile.row, x: event.clientX, y: event.clientY })}
            aria-label={`${name} ${pct(tile.row.change_pct)} (${t("새 탭에서 종목 상세 보기", "open stock details in a new tab")})`}>
            {info.showName && <span className="exchange-heatmap-name" style={{ fontSize: info.fontSizes.name }}>
              {info.showIcon && (market === "sp500" ? <UsStockIcon code={tile.row.code} className="exchange-heatmap-icon" style={{ width: info.iconSize, height: info.iconSize }} />
                : <StockIcon code={tile.row.code} className="exchange-heatmap-icon" style={{ width: info.iconSize, height: info.iconSize }} />)}
              {name}</span>}
            {(info.showName || info.showPctOnly) && <span style={{ fontSize: info.fontSizes.pct }}>{pct(tile.row.change_pct)}</span>}
          </a>;
        })}
      </section>)}
    </div>
    {hover && <div className="exchange-heatmap-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
      <strong>{hover.row.name}</strong><small>{hover.row.code} · {hover.row.sector}</small>
      <span>{displayValue(hover.row.close, market === "sp500" ? 2 : 0)} {MARKETS[market].currency}
        <b data-tone={hover.row.change_pct > 0 ? "up" : hover.row.change_pct < 0 ? "down" : "flat"}>{pct(hover.row.change_pct)}</b></span>
      <small>{t("새 탭에서 종목 상세 보기", "Open stock details in a new tab")}</small>
    </div>}
  </div>;
}
