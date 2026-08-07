"""Per-company fundamentals (sector, description, EPS, PE, margin, growth, analyst
rating) via Yahoo Finance's v10 quoteSummary endpoint — see yahoo_session.py for why
this one needs a crumb where the chart endpoint elsewhere in this app doesn't.

Called sequentially with a small delay between symbols by the nightly full-snapshot
refresh (global_top100.py), never on a user request path — quoteSummary is slow and
crumb-gated enough that fanning 100 of these out concurrently risks getting the whole
session's crumb invalidated mid-batch.
"""

import logging
import time

from app.data import korea_fundamentals_fetcher, yahoo_session

logger = logging.getLogger(__name__)

QUOTE_SUMMARY_URL = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
MODULES = "defaultKeyStatistics,financialData,recommendationTrend,assetProfile,summaryDetail"

# Yahoo's own recommendationKey values, mapped to the five-way Korean labels this
# app's UI shows. Values outside this set (or a missing key) surface as None — the
# frontend renders that as "-" rather than guessing a rating that wasn't actually given.
RECOMMENDATION_LABELS_KO = {
    "strong_buy": "강력매수",
    "buy": "매수",
    "hold": "중립",
    "sell": "매도",
    "strong_sell": "강력매도",
}

# Delay between sequential requests in fetch_fundamentals_bulk — spacing out ~100
# crumb-authenticated calls so the batch doesn't read as a scrape burst to Yahoo.
_BATCH_DELAY_SECONDS = 0.35

_EMPTY_FIELDS = {
    "sector": None,
    "industry": None,
    "description_en": None,
    "trailing_eps": None,
    "profit_margin": None,
    "earnings_growth": None,
    "trailing_pe": None,
    "forward_pe": None,
    "recommendation_key": None,
    "recommendation_label": None,
    "analyst_count": None,
}


def _raw(value):
    """Most quoteSummary numeric fields arrive as {"raw": x, "fmt": "..."}; a few
    (recommendationKey) are already bare strings. Either shape reads correctly here."""
    if isinstance(value, dict):
        return value.get("raw")
    return value


def _parse(result: dict) -> dict:
    profile = result.get("assetProfile") or {}
    stats = result.get("defaultKeyStatistics") or {}
    financial = result.get("financialData") or {}
    summary = result.get("summaryDetail") or {}

    recommendation_key = financial.get("recommendationKey")
    return {
        "sector": profile.get("sector"),
        "industry": profile.get("industry"),
        "description_en": profile.get("longBusinessSummary"),
        "trailing_eps": _raw(stats.get("trailingEps")),
        "profit_margin": _raw(financial.get("profitMargins")),
        "earnings_growth": _raw(financial.get("earningsGrowth")),
        "trailing_pe": _raw(summary.get("trailingPE")),
        "forward_pe": _raw(summary.get("forwardPE")),
        "recommendation_key": recommendation_key,
        "recommendation_label": RECOMMENDATION_LABELS_KO.get(recommendation_key),
        "analyst_count": _raw(financial.get("numberOfAnalystOpinions")),
    }


def _fill_korea_gaps(symbol: str, fields: dict) -> dict:
    """Yahoo returns everything else for a KRX listing but leaves EPS and PER blank —
    `trailingEps` arrives as an empty `{}` and `trailingPE` is simply absent, while
    sector, profit margin and the analyst rating in the same response are populated.
    Naver has both, so the two holes get filled from there.

    Only ever fills holes: if Yahoo starts answering for these symbols, its numbers
    win and this makes no call at all. EPS comes back in KRW, which is the same
    convention every other non-USD listing on the page already follows (Yahoo reports
    SoftBank's in JPY and Hermès's in EUR)."""
    code = korea_fundamentals_fetcher.krx_code(symbol)
    if not code:
        return fields
    wanted = [key for key in ("trailing_eps", "trailing_pe", "forward_pe") if fields.get(key) is None]
    if not wanted:
        return fields
    for key, value in korea_fundamentals_fetcher.fetch_korea_fundamentals(code).items():
        if key in wanted:
            fields[key] = value
    return fields


def fetch_fundamentals(symbol: str) -> dict:
    """One symbol's fundamentals, or all-None fields if the call fails or Yahoo has no
    data for it (thinly-covered exchanges like China's STAR board routinely answer
    200 with an empty result) — a missing company's failure must not sink the batch."""
    try:
        session, crumb = yahoo_session.get_crumb()
        url = QUOTE_SUMMARY_URL.format(symbol=symbol)
        resp = session.get(url, params={"modules": MODULES, "crumb": crumb}, timeout=8)
        if resp.status_code == 401:
            session, crumb = yahoo_session.get_crumb(force_refresh=True)
            resp = session.get(url, params={"modules": MODULES, "crumb": crumb}, timeout=8)
        resp.raise_for_status()
        result = ((resp.json().get("quoteSummary") or {}).get("result")) or []
        fields = _parse(result[0]) if result else dict(_EMPTY_FIELDS)
    except Exception:
        logger.warning("company_fundamentals_fetcher: failed for %s", symbol, exc_info=True)
        fields = dict(_EMPTY_FIELDS)
    # Outside the try: a Yahoo failure is exactly when the fallback is most useful,
    # and this one keeps its own exceptions to itself.
    return _fill_korea_gaps(symbol, fields)


def fetch_fundamentals_bulk(symbols: list[str]) -> dict[str, dict]:
    """Sequential (throttled) fetch across many symbols — see module docstring for why
    this isn't a thread pool like the rest of this app's bulk fetchers."""
    out: dict[str, dict] = {}
    for i, symbol in enumerate(symbols):
        out[symbol] = fetch_fundamentals(symbol)
        if i < len(symbols) - 1:
            time.sleep(_BATCH_DELAY_SECONDS)
    return out
