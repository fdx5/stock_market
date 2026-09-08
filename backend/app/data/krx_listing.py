"""Resilient reads of the KRX listing snapshots.

FinanceDataReader resolves the latest KRX trading day from KRX itself and then reads
*that exact date's* snapshot from the FinanceData/fdr_krx_data_cache GitHub repo. Those
two facts come from different places and routinely disagree: KRX declares a session the
moment it opens, while the cache repo publishes that session's CSV some hours later. In
the gap, `fdr.StockListing("KOSPI" | "KOSDAQ" | "KRX-DESC" | ...)` raises
`HTTPError: 404`.

That is what took the whole Korean side of the site down: the KOSPI and KOSDAQ maps,
the 수급·순위 board and the stock list all returned 500, because the first thing each of
them does is read a listing. Nothing was wrong with KRX or with our data — a file was a
few hours late, and one upstream 404 became a total outage of every KR page.

So this module reads the same snapshots itself and walks back to the most recently
published date instead of insisting on today's. A listing — codes, names, market caps,
KSIC industry strings — is near-static from one session to the next, so yesterday's is a
perfectly good answer, and an answer is what the callers need. Markets this module has
no snapshot for (ETF/KR, NASDAQ, S&P500) are delegated to FinanceDataReader unchanged.
"""

import datetime as dt
import io
import logging
from zoneinfo import ZoneInfo

import FinanceDataReader as fdr
import pandas as pd
import requests

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")

_CACHE_BASE = "https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/refs/heads/master/data/listing"
_WORK_DATE_URL = (
    "http://data.krx.co.kr/comm/bldAttendant/executeForResourceBundle.cmd"
    "?baseName=krx.mdc.i18n.component&key=B128.bld"
)
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd",
}

# How far back to look for a published snapshot. Has to cover the long weekend case —
# a Tuesday after a Friday holiday is four calendar days from the last session, and the
# publish lag sits on top of that — with room to spare, since every extra day costs one
# conditional GET only on the days the recent ones are genuinely missing.
_LOOKBACK_DAYS = 14
_TIMEOUT_SECONDS = 15

# `mktId` values in the snapshot, by the market name callers pass.
_MARKET_IDS = {"KOSPI": "STK", "KOSDAQ": "KSQ", "KONEX": "KNX"}
_ALL_MARKETS = ("KRX", "KRX-MARCAP")
_DESC_MARKETS = ("KRX-DESC", "KOSPI-DESC", "KOSDAQ-DESC", "KONEX-DESC")


def _latest_work_date() -> dt.date:
    """The last session KRX will admit to, or today if KRX itself is unreachable.

    Only a starting point: whether that date's snapshot exists is `_read_snapshot`'s
    problem, and starting one day late costs nothing because it walks back anyway.
    """
    try:
        response = requests.get(_WORK_DATE_URL, headers=_HEADERS, timeout=_TIMEOUT_SECONDS)
        response.raise_for_status()
        raw = response.json()["result"]["output"][0]["max_work_dt"]
        return dt.datetime.strptime(raw, "%Y%m%d").date()
    except Exception as exc:  # noqa: BLE001 - any failure here is recoverable
        logger.warning("krx_listing: could not read max_work_dt (%s); starting from today", exc)
        return dt.datetime.now(KST).date()


def _read_snapshot(kind: str) -> pd.DataFrame:
    """The most recent published `kind` snapshot ("krx" or "desc").

    Walks back a day at a time from the latest session. Missing dates are the normal
    case, not an error: weekends and holidays have no snapshot at all, and the newest
    session's file lands hours after the session does.
    """
    start = _latest_work_date()
    last_exc: Exception | None = None
    for offset in range(_LOOKBACK_DAYS):
        date = start - dt.timedelta(days=offset)
        url = f"{_CACHE_BASE}/{kind}/{date.isoformat()}.csv"
        try:
            response = requests.get(url, timeout=_TIMEOUT_SECONDS)
            if response.status_code == 404:
                continue
            response.raise_for_status()
            if offset:
                logger.info(
                    "krx_listing: %s snapshot for %s not published yet; using %s",
                    kind,
                    start.isoformat(),
                    date.isoformat(),
                )
            return pd.read_csv(
                io.BytesIO(response.content),
                index_col=0,
                dtype={"Code": str, "Dept": str, "ChangeCode": str, "MarketId": str},
            ).reset_index(drop=True)
        except Exception as exc:  # noqa: BLE001 - try the previous day before giving up
            last_exc = exc

    raise RuntimeError(
        f"krx_listing: no {kind} snapshot published in the {_LOOKBACK_DAYS} days to "
        f"{start.isoformat()}"
    ) from last_exc


def stock_listing(market: str) -> pd.DataFrame:
    """Drop-in replacement for `fdr.StockListing` for the KRX-backed markets.

    Same market names, same columns. Anything this module has no snapshot for is passed
    straight through to FinanceDataReader.
    """
    market = market.upper()

    if market in _DESC_MARKETS:
        df = _read_snapshot("desc")
        df["ListingDate"] = pd.to_datetime(df["ListingDate"], errors="coerce")
        if market != "KRX-DESC":
            df = df[df["Market"] == market.replace("-DESC", "")].reset_index(drop=True)
        return df

    if market in _ALL_MARKETS or market in _MARKET_IDS:
        df = _read_snapshot("krx")
        market_id = _MARKET_IDS.get(market)
        if market_id:
            df = df[df["MarketId"] == market_id].reset_index(drop=True)
        return df

    return fdr.StockListing(market)
