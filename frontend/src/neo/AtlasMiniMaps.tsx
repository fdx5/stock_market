import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { pct, toneOf } from "../desk2/lib";
import { changeToRgb, rgbToCss, textColorForRgb } from "../treemap";
import { atlasMiniMap } from "./atlasMiniMapModel";
import { useAtlasMiniMaps, type AtlasMapSnapshot, type AtlasMarket } from "./useAtlasMiniMaps";
import NeoIcon from "./NeoIcon";
import CyberQuote from "./CyberQuote";
import { hasReturn } from "./marketQuote";
import "./atlasMiniMaps.css";

export interface AtlasMapQuote { price?: number; change?: number }
const MARKETS = [
  { key: "kospi", title: "코스피", en: "KOSPI", region: "SEOUL / LARGE CAP", to: "/map", accent: "#d6b54e" },
  { key: "kosdaq", title: "코스닥", en: "KOSDAQ", region: "SEOUL / GROWTH", to: "/kosdaq-map", accent: "#bf85ff" },
  { key: "nasdaq100", title: "나스닥100", en: "NASDAQ 100", region: "NEW YORK / TECHNOLOGY", to: "/nasdaq100-map", accent: "#f27560" },
] as const;

function mapTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function AtlasMiniMapCard({ market, snapshot, quote, lang }: {
  market: AtlasMarket; snapshot: AtlasMapSnapshot; quote: AtlasMapQuote; lang: "ko" | "en";
}) {
  const config = MARKETS.find(item => item.key === market)!;
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const stageRef = useRef<HTMLDivElement>(null);
  const [mapSize,setMapSize] = useState({width:1000,height:380});
  useEffect(()=>{
    const stage=stageRef.current;if(!stage)return;
    const resize=new ResizeObserver(entries=>{
      const width=Math.round(entries[0].contentRect.width),height=width<600?640:Math.max(380,Math.min(500,width*.37));
      if(width>0)setMapSize(old=>old.width===width&&old.height===height?old:{width,height});
    });resize.observe(stage);return()=>resize.disconnect();
  },[]);
  const data = useMemo(() => atlasMiniMap(snapshot.items,mapSize.width,mapSize.height), [snapshot.items,mapSize]);
  const time = mapTime(snapshot.generatedAt);
  const title = lang === "ko" ? config.title : config.en;
  const price = quote.price != null && Number.isFinite(quote.price) && quote.price > 0
    ? quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  return <Link to={config.to} className="ng-mini-map-card" style={{ "--map-accent": config.accent } as CSSProperties} aria-label={L(`${title} 전체 맵 보기`, `View the full ${title} map`)}>
    <header><span>{config.region}</span><NeoIcon name="map" /></header>
    <div className="ng-mini-map-heading"><div><h3>{title}</h3><span>{config.en}</span></div><div><CyberQuote value={quote.price}>{price}</CyberQuote><b className={`is-${toneOf(quote.change)}`}>{pct(quote.change)}</b></div></div>
    <div ref={stageRef} className="ng-mini-map-stage" style={{height:mapSize.height}} data-state={data.count ? "ready" : snapshot.settled ? "unavailable" : "loading"}>
      {data.count ? <svg viewBox={`0 0 ${mapSize.width} ${mapSize.height}`} role="img" aria-label={L(`${title} 주요 ${data.count}종목의 크기와 등락 미리보기`, `${title}: size and returns of ${data.count} leading stocks`)}>
        {data.tiles.map(tile => {
          const known = hasReturn(tile.item);
          const rgb = known ? changeToRgb(tile.item.change_pct) : { r: 63, g: 56, b: 69 };
          const label = market === "nasdaq100" ? tile.item.code : tile.item.name || tile.item.code;
          const showName = tile.w >= 51 && tile.h >= 27;
          const twoLines = tile.w >= 62 && tile.h >= 48;
          const fontSize = tile.w > 220 && tile.h > 100 ? 25 : tile.w > 130 && tile.h > 65 ? 18 : 13;
          const maxChars = Math.max(2, Math.floor((tile.w - 12) / (market === "nasdaq100" ? fontSize * .65 : fontSize)));
          const name = label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label;
          return <g key={tile.id}>
            <title>{`${tile.item.name || tile.item.code} · ${known ? pct(tile.item.change_pct) : L("등락 확인 중", "Return unavailable")}`}</title>
            <rect x={tile.x + .7} y={tile.y + .7} width={Math.max(0, tile.w - 1.4)} height={Math.max(0, tile.h - 1.4)} fill={rgbToCss(rgb)} rx="1" />
            {showName && <text x={tile.x + tile.w / 2} y={tile.y + tile.h / 2 + (twoLines ? -5 : 4)} textAnchor="middle" fill={textColorForRgb(rgb)} fontSize={fontSize} fontWeight="650">{name}{twoLines && <tspan x={tile.x + tile.w / 2} dy={fontSize+7} fontSize={Math.max(11,fontSize-4)} fontWeight="500">{known ? pct(tile.item.change_pct) : "—"}</tspan>}</text>}
          </g>;
        })}
      </svg> : <div className="ng-mini-map-empty"><NeoIcon name="map" /><span>{snapshot.settled ? L("맵 데이터를 확인하고 있습니다", "Map data is unavailable") : L("시장 지도를 불러오는 중", "Loading market map")}</span><small>{L("전체 맵에서 더 넓게 살펴보세요", "Explore further in the full map")}</small></div>}
    </div>
    <div className="ng-mini-map-meta"><span>{data.count ? L(`주요 ${data.count}종목`, `${data.count} leading stocks`) : L("주요 종목 미리보기", "Leading stocks preview")}</span><span>{data.count > 0 && <><i className="is-up">↑ {data.up}</i><i className="is-down">↓ {data.down}</i></>}</span></div>
    <div className="ng-mini-map-time"><span>{time ? L(`맵 기준 ${time} KST`, `Map as of ${time} KST`) : L("맵 기준 시각 확인 중", "Waiting for map timestamp")}</span>{snapshot.delayed && data.count > 0 && <b>{L("갱신 지연", "Update delayed")}</b>}</div>
    <footer><span>{L("전체 맵 보기", "Explore full map")}</span><NeoIcon name="arrow" /></footer>
  </Link>;
}

function PopulatedMaps({ quotes, lang }: { quotes: Record<AtlasMarket, AtlasMapQuote>; lang: "ko" | "en" }) {
  const snapshots = useAtlasMiniMaps();
  return <>{MARKETS.map(market => <AtlasMiniMapCard key={market.key} market={market.key} snapshot={snapshots[market.key]} quote={quotes[market.key]} lang={lang} />)}</>;
}

export default function AtlasMiniMaps({ quotes }: { quotes: Record<AtlasMarket, AtlasMapQuote> }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") { setActive(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setActive(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);
  const placeholder: AtlasMapSnapshot = { items: [], generatedAt: null, settled: false, delayed: false };
  return <section ref={sectionRef} className="ng-atlas-mini-maps" aria-labelledby="ng-mini-maps-h">
    <header><div><span className="ng-kicker">MARKET MAPS</span><h2 id="ng-mini-maps-h">{L("시장별 종목 지도", "Market maps")}</h2><p>{L("코스피 · 코스닥 · 나스닥100 주요 종목", "Leading KOSPI, KOSDAQ and NASDAQ 100 constituents")}</p></div><div className="ng-mini-map-legend"><span><i className="is-up" />{L("상승", "Up")}</span><span><i className="is-flat" />{L("보합", "Flat")}</span><span><i className="is-down" />{L("하락", "Down")}</span></div></header>
    <div className="ng-mini-map-grid">{active ? <PopulatedMaps quotes={quotes} lang={lang} /> : MARKETS.map(market => <AtlasMiniMapCard key={market.key} market={market.key} snapshot={placeholder} quote={quotes[market.key]} lang={lang} />)}</div>
    <p className="ng-mini-map-basis">{L("면적은 국내 시가총액·미국 지수 편입 비중, 색은 전일 대비 등락입니다. 주요 종목을 축약한 미리보기입니다.", "Area: Korean market cap / US index weight. Color: change vs. previous close. A preview of leading constituents.")}</p>
  </section>;
}
