import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { pct, toneOf } from "../desk2/lib";
import { useBroadsheet } from "../desk2/shell";
import NeoIcon from "./NeoIcon";
import MarketScanner from "./MarketScanner";
import { MARKET_ASSETS } from "../marketAssets";
import AtlasMiniMaps from "./AtlasMiniMaps";
import CyberQuote from "./CyberQuote";
import "./cyberEffects.css";

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
  const assets = MARKET_ASSETS;
  return <main className="d2 ng-home ng-atlas" lang={lang}>
    <MarketScanner />
    <section className="ng-asset-belt" aria-labelledby="ng-assets-h"><div><span>03 / ACROSS ASSETS</span><h2 id="ng-assets-h">{L("시장을 잇는 가격", "Prices in between")}</h2></div><div>{assets.map(asset => { const quote = tick(asset.symbol); return <Link key={asset.key} to={`/prices/${asset.key}`} className="ng-asset-link"><article><span>{L(asset.ko, asset.en)}<small>{asset.unit}</small></span><CyberQuote value={quote?.price}>{quote ? quote.price.toLocaleString("en-US", { maximumFractionDigits: asset.digits }) : "—"}</CyberQuote><b className={`is-${toneOf(quote?.change_pct)}`}>{pct(quote?.change_pct)}</b><small>{quoteTime(quote?.quote_time)} ↗</small></article></Link>; })}</div></section>
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
