const NAVER_LOGO_ROOT = "https://ssl.pstatic.net/imgstock/fn/real/logo/png";

const US_ISSUER_LOGOS: Record<string, string> = {
  SPY: "StockBRANDSPDR",
  QQQ: "StockBRANDInvesco",
  VOO: "StockBRANDVanguard",
  IVV: "StockBRANDIshares",
  VTI: "StockBRANDVanguard",
  IWM: "StockBRANDIshares",
  DIA: "StockBRANDSPDR",
  TLT: "StockBRANDIshares",
  SGOV: "StockBRANDIshares",
  GLD: "StockBRANDSPDR",
  SLV: "StockBRANDIshares",
  XLF: "StockBRANDSPDR",
  XLK: "StockBRANDSPDR",
  SMH: "StockBRANDVanEck",
  SCHD: "StockBRANDCharlesSchwab",
  ARKK: "StockBRANDARK",
};

const US_STRATEGY_LOGOS: Record<string, string> = {
  SOXL: "StockUSETFLeverage3x",
  TQQQ: "StockUSETFLeverage3x",
  SQQQ: "StockUSETFInverse3x",
  SPXL: "StockUSETFLeverage3x",
};

/** Naver renders ETFs with an issuer/strategy mark, not the ordinary per-stock path. */
export function etfLogoUrl(code: string, name?: string): string | null {
  const symbol = code.trim().toUpperCase().split(".")[0];

  if (/^\d[0-9A-Z]{5}$/.test(symbol)) {
    const issuer = name?.trim().split(/\s+/)[0].toUpperCase();
    if (issuer === "KODEX" || issuer === "TIGER" || issuer === "ACE") {
      return `${NAVER_LOGO_ROOT}/etf/StockKRETF${issuer}.png`;
    }
    return null;
  }

  const strategy = US_STRATEGY_LOGOS[symbol];
  if (strategy) return `${NAVER_LOGO_ROOT}/etf/${strategy}.png`;

  const issuer = US_ISSUER_LOGOS[symbol];
  return issuer ? `${NAVER_LOGO_ROOT}/brand/foreign/${issuer}.png` : null;
}
