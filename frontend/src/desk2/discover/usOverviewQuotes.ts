import type { MarketMapItem, MarketSession, MarketTickerItem } from "../../api/client";

/** Futures are separate instruments: never apply their moves to the cash index. */
export function usOverviewQuotes(ticker: MarketTickerItem[], session?: MarketSession | null, english = false) {
  const cash = [
    { symbol: "^GSPC", name: "S&P 500", url: "/sp500-map", futures: false },
    { symbol: "^NDX", name: "NASDAQ 100", url: "/nasdaq100-map", futures: false },
  ];
  const futures = [
    { symbol: "ES=F", name: english ? "S&P 500 futures" : "S&P 500 선물", url: "/sp500-map", futures: true },
    { symbol: "NQ=F", name: english ? "NASDAQ 100 futures" : "나스닥100 선물", url: "/nasdaq100-map", futures: true },
  ];
  const extended = session === "pre" || session === "post";
  return (extended ? [...futures, ...cash] : [...cash, ...futures]).map(entry => {
    const quote = ticker.find(item => item.symbol === entry.symbol);
    return { ...entry, price: quote?.price, change: quote?.change_pct, points: quote?.points ?? [],
      basis: entry.futures ? (english ? "Futures · may be delayed" : "선물 · 지연 가능") : (english ? "Cash index · regular session" : "현물지수 · 정규장 기준"),
      time: quote?.quote_time ? new Date(quote.quote_time * 1000).toISOString() : undefined };
  });
}

/** Exclude untraded regular/older-session rows from extended-session aggregates. */
export function usSessionItems(items: MarketMapItem[], session?: MarketSession | null) {
  return session === "pre" || session === "post" ? items.filter(item => item.session === session) : items;
}
