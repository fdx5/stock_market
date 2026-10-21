export const MARKET_ASSETS = [
  { key: "usd-krw", symbol: "KRW=X", ko: "원/달러 환율", en: "USD/KRW", code: "USD / KRW", group: "fx", unit: "KRW / USD", digits: 2, icon: "/img/ticker/usdkrw.webp" },
  { key: "bitcoin", symbol: "BTC-USD", ko: "비트코인", en: "Bitcoin", code: "BTC / USD", group: "crypto", unit: "USD / BTC", digits: 2, icon: "/img/ticker/btc.webp" },
  { key: "ethereum", symbol: "ETH-USD", ko: "이더리움", en: "Ethereum", code: "ETH / USD", group: "crypto", unit: "USD / ETH", digits: 2, icon: "/img/ticker/eth.webp" },
  { key: "xrp", symbol: "XRP-USD", ko: "리플 XRP", en: "XRP", code: "XRP / USD", group: "crypto", unit: "USD / XRP", digits: 4, icon: "/img/ticker/xrp.webp" },
  { key: "wti", symbol: "CL=F", ko: "WTI 유가 선물", en: "WTI crude futures", code: "WTI / USD", group: "commodity", unit: "USD / barrel", digits: 2, icon: "/img/ticker/oil.webp" },
  { key: "gold", symbol: "GC=F", ko: "금 선물", en: "Gold futures", code: "GOLD / USD", group: "commodity", unit: "USD / troy oz", digits: 2, icon: "/img/ticker/gold.webp" },
  { key: "silver", symbol: "SI=F", ko: "은 선물", en: "Silver futures", code: "SILVER / USD", group: "commodity", unit: "USD / troy oz", digits: 3, icon: "/img/ticker/silver.webp" },
] as const;
export type MarketAsset = typeof MARKET_ASSETS[number];
export type MarketAssetKey = MarketAsset["key"];
export function marketAssetPath(symbol: string): string | undefined {
  const asset = MARKET_ASSETS.find(asset => asset.symbol === symbol);
  return asset ? `/prices/${asset.key}` : undefined;
}
