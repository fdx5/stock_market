import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import FinanceDataReader as fdr
import pandas as pd

from app.services.cache import cache

logger = logging.getLogger(__name__)

TTL_PRICE_SECONDS = 6 * 3600

# fdr.DataReader's Yahoo path issues a plain requests.get with no timeout, so a
# stalled/blocked upstream (e.g. Yahoo silently throttling a datacenter IP) hangs the
# call forever. That hang is fatal to TTLCache's background-refresh bookkeeping: the
# refresh thread never reaches its `finally`, so the key is marked "refreshing"
# permanently and never retried again — the cache silently freezes at its last-good
# value. Running the fetch in a worker with a hard deadline turns that indefinite hang
# into an ordinary exception the cache/caller can recover from.
FETCH_TIMEOUT_SECONDS = 20


def _load_history(code: str, years: int) -> pd.DataFrame:
    end = dt.date.today()
    start = end - dt.timedelta(days=int(years * 365.25) + 10)
    # shutdown(wait=False): if the fetch times out, the still-hung worker thread is
    # abandoned rather than blocked on — ThreadPoolExecutor's default context-manager
    # exit calls shutdown(wait=True), which would just re-introduce the same hang here.
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(fdr.DataReader, code, start, end)
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


def get_history(code: str, years: int = 3) -> pd.DataFrame:
    key = f"history:{code}:{years}"
    df = cache.get_or_set(key, TTL_PRICE_SECONDS, lambda: _load_history(code, years))
    if df.empty:
        raise ValueError(f"No price history found for code={code}")
    return df
