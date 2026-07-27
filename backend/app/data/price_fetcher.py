import datetime as dt
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import FinanceDataReader as fdr
import pandas as pd
import requests

from app.services.cache import cache

logger = logging.getLogger(__name__)

TTL_PRICE_SECONDS = 6 * 3600

# How long to give Yahoo to catch up on a session that should already be printed but
# isn't showing up yet (see get_history_confirmed below).
STALE_RETRY_ATTEMPTS = 2
STALE_RETRY_DELAY_SECONDS = 4.0

# fdr.DataReader's Yahoo path issues a plain requests.get with no timeout, so a
# stalled/blocked upstream (e.g. Yahoo silently throttling a datacenter IP) hangs the
# call forever. That hang is fatal to TTLCache's background-refresh bookkeeping: the
# refresh thread never reaches its `finally`, so the key is marked "refreshing"
# permanently and never retried again — the cache silently freezes at its last-good
# value. Running the fetch in a worker with a hard deadline turns that indefinite hang
# into an ordinary exception the cache/caller can recover from.
FETCH_TIMEOUT_SECONDS = 20


def _fetch_yahoo_direct(code: str, start: dt.date, end: dt.date) -> pd.DataFrame:
    """The same query2.finance.yahoo.com chart endpoint FinanceDataReader's
    YahooDailyReader hits for every non-KRX ticker, called directly instead so a
    cache-busting param and explicit no-cache headers can be added.

    Reason this exists: a US ticker's fetch from Render was repeatedly coming back one
    session short of what the identical request returned from a different network,
    consistently — not a one-off, and not something retrying the exact same request a
    few seconds later fixed (see get_history_confirmed's docstring for the retry that
    *didn't* resolve it). `period1`/`period2` are whole-day granularity (derived from
    `date.today()`), so every request issued on the same calendar day is byte-identical
    — exactly the shape of URL a cache sitting between Render and Yahoo would happily
    keep serving from whenever it first saw that URL that day, no matter how many times
    it's asked again. `Cache-Control`/`Pragma: no-cache` asks any compliant cache to
    revalidate against Yahoo's origin instead of serving its stored copy; the trailing
    `_=` nonce further guarantees the URL itself differs request to request, which
    defeats a cache that keys on the full URL without honoring those headers at all.
    """
    start_ts = int(dt.datetime(start.year, start.month, start.day, tzinfo=dt.timezone.utc).timestamp())
    end_ts = int(dt.datetime(end.year, end.month, end.day, tzinfo=dt.timezone.utc).timestamp()) + 86400
    url = (
        f"https://query2.finance.yahoo.com/v8/finance/chart/{code}"
        f"?period1={start_ts}&period2={end_ts}&interval=1d&includeAdjustedClose=true"
        f"&_={int(time.time() * 1000)}"
    )
    resp = requests.get(
        url,
        headers={
            "user-agent": "Mozilla/5.0 AppleWebKit/537.36",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
        timeout=FETCH_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    result = resp.json()["chart"]["result"][0]
    index = pd.to_datetime(result["timestamp"], unit="s").normalize()
    quote = result["indicators"]["quote"][0]
    return pd.DataFrame(quote, index=index).rename(
        columns={"open": "Open", "high": "High", "low": "Low", "close": "Close", "volume": "Volume"}
    )


def _load_history(code: str, years: int) -> pd.DataFrame:
    end = dt.date.today()
    start = end - dt.timedelta(days=int(years * 365.25) + 10)
    # KRX codes are 6-digit numeric strings (see prediction_universe._load_krx_top);
    # everything else in this app is a US ticker. Only the US path goes through the
    # cache-busting fetch above — the KRX/Naver path isn't the one that's been seen
    # serving stale data, and fdr.DataReader already handles it correctly.
    fetch = fdr.DataReader if code.isdigit() else _fetch_yahoo_direct
    # shutdown(wait=False): if the fetch times out, the still-hung worker thread is
    # abandoned rather than blocked on — ThreadPoolExecutor's default context-manager
    # exit calls shutdown(wait=True), which would just re-introduce the same hang here.
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(fetch, code, start, end)
        try:
            df = future.result(timeout=FETCH_TIMEOUT_SECONDS)
        except FutureTimeoutError:
            logger.warning("price_fetcher: DataReader(%s) timed out after %ss", code, FETCH_TIMEOUT_SECONDS)
            raise
    finally:
        pool.shutdown(wait=False)
    # YahooDailyReader (used for non-KR tickers) returns an unnamed index, unlike
    # NaverDailyReader's "Date" — reset_index() would otherwise create a column
    # literally named "index" instead of "Date", breaking the rename below.
    df.index.name = df.index.name or "Date"
    df = df.reset_index().rename(
        columns={
            "Date": "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    # Yahoo pads its daily series with a placeholder bar for a session that hasn't
    # printed a close yet — open/high/low filled in, Close literally NaN. Asian indices
    # (N225/SSEC/HSI/TWII) carry one most of the day because their session boundary sits
    # a calendar day ahead of the US series. That NaN is not a price, and letting it
    # through poisons every caller: `float(latest["close"])` yields nan, and Starlette
    # renders responses with allow_nan=False, so a single NaN close 500s the whole
    # endpoint rather than blanking one row. Drop those bars at the source.
    df = df.dropna(subset=["close"]).reset_index(drop=True)
    return df[["date", "open", "high", "low", "close", "volume"]]


def get_history(code: str, years: int = 3, allow_stale: bool = True) -> pd.DataFrame:
    """`allow_stale=False` is for callers that score off today's close (the prediction
    batch, grading) — an expired cache entry must be refreshed synchronously so the
    call reflects the session that just closed, not whatever was last fetched during
    the trading day. The stale-while-revalidate default is right for page views, which
    would rather render a few hours late than block, but wrong here: it would hand the
    batch yesterday's close while quietly refreshing to today's in the background,
    after the batch already read the stale frame.
    """
    key = f"history:{code}:{years}"
    df = cache.get_or_set(key, TTL_PRICE_SECONDS, lambda: _load_history(code, years), allow_stale=allow_stale)
    if df.empty:
        raise ValueError(f"No price history found for code={code}")
    return df


def get_history_confirmed(code: str, years: int, expected_date: dt.date) -> pd.DataFrame:
    """`get_history(..., allow_stale=False)`, plus a few retries if the freshly-fetched
    frame still doesn't reach `expected_date` (the session the caller already knows has
    closed).

    `allow_stale=False` alone rules out *our own* cache handing back an old value, but
    it can't do anything about the upstream itself returning a frame that stops one bar
    short — Yahoo's chart endpoint has occasionally been observed to do exactly this
    for a session that closed hours earlier (GOOGL's 2026-07-24 close was consistently
    missing from a Render-side fetch for the rest of that evening while the identical
    call from another network returned it immediately, which points at upstream/CDN
    propagation rather than anything in this process). A cache-layer fix can't help
    with that — the *first* fetch already came back short, so what's needed is simply
    asking again after a pause, bypassing our cache entirely each time so a repeat
    doesn't just hand back the same short frame from within its own TTL window.

    Gives up after `STALE_RETRY_ATTEMPTS` extra tries and returns whatever the last
    attempt got — a short frame that still resolves *some* close is better than none,
    and the caller (prediction_engine.stale_note) still surfaces the gap as a warning.
    """
    key = f"history:{code}:{years}"
    df = get_history(code, years, allow_stale=False)

    attempt = 0
    while attempt < STALE_RETRY_ATTEMPTS and (df.empty or df.iloc[-1]["date"] < expected_date.isoformat()):
        attempt += 1
        logger.warning(
            "price_fetcher: %s latest bar is %s, expected >= %s — retrying (%d/%d)",
            code,
            df.iloc[-1]["date"] if not df.empty else "<empty>",
            expected_date.isoformat(),
            attempt,
            STALE_RETRY_ATTEMPTS,
        )
        time.sleep(STALE_RETRY_DELAY_SECONDS)
        # Drop the just-cached (short) frame before asking again — otherwise this
        # retry, and the TTL's remaining hours, would just keep handing back the exact
        # same result get_or_set already stored a few lines up.
        cache.invalidate(key)
        df = get_history(code, years, allow_stale=False)

    return df
