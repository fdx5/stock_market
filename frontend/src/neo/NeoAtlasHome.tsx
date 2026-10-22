import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { pct, toneOf } from "../desk2/lib";
import { useBroadsheet } from "../desk2/shell";
import NeoIcon from "./NeoIcon";
import NeoSignalNetwork from "./NeoSignalNetwork";
import { MARKET_ASSETS } from "../marketAssets";
import AtlasMiniMaps from "./AtlasMiniMaps";

function quoteTime(value?: string | number | null) {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isFinite(+date) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) + " KST" : "—";
}
const price = (value?: number) => value != null && Number.isFinite(value) && value > 0 ? value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : "—";

/** Cross-market entrance. Country desks own the detailed charts and stock tables. */
export default function NeoAtlasHome() {
  useBroadsheet();
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const indices = useMarketIndices();
  const ticker = useMarketTicker();
  const tick = (symbol: string) => ticker.find(item => item.symbol === symbol);
  const regions = [
    { id: "kr", number: "01", label: "SEOUL", title: L("국내 증시", "Korea desk"), to: "/desk", detail: L("누가 사고, 어떤 종목이 움직였나", "Follow the flows. Find the moving stocks."), tags: L("외국인 · 기관 수급 / 종목 순위", "Foreign & institutional flows / rankings"), quotes: [
      { name: "KOSPI", price: indices.kospi?.close, change: indices.kospi?.change_pct, time: indices.kospi?.updated_at, to: "/index/kospi" },
      { name: "KOSDAQ", price: indices.kosdaq?.close, change: indices.kosdaq?.change_pct, time: indices.kosdaq?.updated_at, to: "/index/kosdaq" },
    ] },
    { id: "us", number: "02", label: "NEW YORK", title: L("미국 증시", "US desk"), to: "/global", detail: L("어느 섹터가 뉴욕을 이끌고 있나", "Which sectors are leading New York?"), tags: L("섹터 · 빅테크 / 시간외 · 원화 환산", "Sectors & Big Tech / extended hours & FX"), quotes: ["^GSPC", "^NDX"].map((symbol, i) => ({ name: i ? "NASDAQ 100" : "S&P 500", price: tick(symbol)?.price, change: tick(symbol)?.change_pct, time: tick(symbol)?.quote_time, to: i ? "/nasdaq100-map" : "/sp500-map" })) },
  ];
  const assets = MARKET_ASSETS;
  return <main className="d2 ng-home ng-atlas" lang={lang}>
    <header className="ng-atlas-heading"><div><span className="ng-kicker">K STOCK HUB / MARKET ATLAS</span><h1>{L("시장의 흐름을,", "Read the market.")}<br /><em>{L("경계 너머로.", "Beyond borders.")}</em></h1><p className="ng-atlas-deck">{L("서울과 뉴욕, 그리고 자산 사이.", "Seoul, New York, and the assets in between.")}</p></div><div className="ng-atlas-intro"><NeoSignalNetwork /><div><p>{L("전체 흐름을 살피고 나의 시장으로 들어가세요.", "Take the wider view, then enter your market.")}</p><Link to="/market-brief">{L("오늘 브리핑 읽기", "Read the daily briefing")} <NeoIcon name="arrow" /></Link></div></div></header>
    <div className="ng-region-board">{regions.map(region => <section key={region.id} className={`ng-region ng-region-${region.id}`} aria-labelledby={`ng-region-${region.id}`}><header><span>{region.number} / {region.label}</span><span className="ng-region-cross" aria-hidden="true">＋</span></header><Link className="ng-region-title" to={region.to}><h2 id={`ng-region-${region.id}`}>{region.title}</h2><span aria-hidden="true">↗</span></Link><p>{region.detail}</p><div className="ng-region-quotes">{region.quotes.map(quote => <Link key={quote.name} to={quote.to}><span>{quote.name}</span><strong>{price(quote.price)}</strong><b className={`is-${toneOf(quote.change)}`}>{pct(quote.change)}</b><small>{quoteTime(quote.time)}</small></Link>)}</div><footer><span>{region.tags}</span><Link to={region.to}>{L("분석 데스크", "Open desk")} ↗</Link></footer></section>)}</div>
    <section className="ng-asset-belt" aria-labelledby="ng-assets-h"><div><span>03 / ACROSS ASSETS</span><h2 id="ng-assets-h">{L("시장을 잇는 가격", "Prices in between")}</h2></div><div>{assets.map(asset => { const quote = tick(asset.symbol); return <Link key={asset.key} to={`/prices/${asset.key}`} className="ng-asset-link"><article><span>{L(asset.ko, asset.en)}<small>{asset.unit}</small></span><strong>{quote ? quote.price.toLocaleString("en-US", { maximumFractionDigits: asset.digits }) : "—"}</strong><b className={`is-${toneOf(quote?.change_pct)}`}>{pct(quote?.change_pct)}</b><small>{quoteTime(quote?.quote_time)} ↗</small></article></Link>; })}</div></section>
    <p className="ng-atlas-basis">{L("각 지수·자산의 최근 제공 시세 · 등락은 전일 대비 · 시장별 기준 시각과 거래 세션이 다를 수 있습니다.", "Latest supplied quotes · changes vs. previous close · quote times and sessions may differ across markets.")}</p>
    <AtlasMiniMaps quotes={{
      kospi: { price: indices.kospi?.close, change: indices.kospi?.change_pct },
      kosdaq: { price: indices.kosdaq?.close, change: indices.kosdaq?.change_pct },
      nasdaq100: { price: tick("^NDX")?.price, change: tick("^NDX")?.change_pct },
    }} />
    <section className="ng-atlas-destinations" aria-labelledby="ng-explore-h"><header><span className="ng-kicker">04 / CHOOSE YOUR PERSPECTIVE</span><h2 id="ng-explore-h">{L("다른 시선으로 시장 읽기", "Change your perspective")}</h2></header><div>{[
      ["/map", "map", "MAP", L("면적으로 읽는 증시", "The market, in area"), L("시가총액과 등락을 한 장의 지도로", "Capitalization and returns on one map")],
      ["/etf", "layers", "ETF", L("종목 너머의 투자", "Invest beyond a stock"), L("국내·미국 ETF를 비교하고 탐색", "Explore and compare Korean & US ETFs")],
      ["/investors", "chart", "PEOPLE", L("거물의 선택을 따라", "Follow the portfolios"), L("투자자별 보유 종목과 포트폴리오", "Holdings and investor portfolios")],
      ["/realestate-map", "orbit", "SPACE", L("도시를 자산으로 읽다", "Read the city as an asset"), L("부동산 실거래 지도와 3D 탐험", "Transaction maps and 3D exploration")],
    ].map(([to, icon, code, title, detail]) => <Link to={to} key={to}><span>{code}<NeoIcon name={icon} /></span><h3>{title}</h3><p>{detail}</p><b aria-hidden="true">↗</b></Link>)}</div></section>
  </main>;
}
