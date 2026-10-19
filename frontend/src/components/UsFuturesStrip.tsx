import { useMarketTicker } from "../useMarketTicker";
import { useLanguage } from "../i18n/LanguageContext";
import "./usFuturesStrip.css";

const CONTRACTS = [
  { symbol: "ES=F", ko: "S&P500 선물", en: "S&P 500 futures" },
  { symbol: "NQ=F", ko: "나스닥100 선물", en: "Nasdaq 100 futures" },
];

/** Actual index contracts, shown separately from constituent stock returns. */
export default function UsFuturesStrip() {
  const items = useMarketTicker();
  const { lang } = useLanguage();
  return <div className="us-futures-strip" role="group" aria-label={lang === "ko" ? "미국 지수 선물" : "US index futures"}>
    {CONTRACTS.map((contract) => {
      const quote = items.find((item) => item.symbol === contract.symbol);
      return <span className="us-futures-contract" key={contract.symbol}>
        <b>{lang === "ko" ? contract.ko : contract.en}</b>
        {quote ? <>
          <span>{quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <strong className={quote.change_pct > 0 ? "change-up" : quote.change_pct < 0 ? "change-down" : ""}>
            {quote.change_pct > 0 ? "+" : ""}{quote.change_pct.toFixed(2)}%
          </strong>
          {quote.quote_time && <time dateTime={new Date(quote.quote_time * 1000).toISOString()}>
            {new Date(quote.quote_time * 1000).toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} KST
          </time>}
        </> : <span>{lang === "ko" ? "시세 수신 대기" : "Awaiting quote"}</span>}
      </span>;
    })}
    <small>{lang === "ko" ? "자동 갱신 · 공급자 시세 지연 가능" : "Auto refresh · feed may be delayed"}</small>
  </div>;
}
