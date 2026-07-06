import datetime as dt

import FinanceDataReader as fdr
import pandas as pd

from app.services.cache import cache

TTL_PRICE_SECONDS = 6 * 3600


def _load_history(code: str, years: int) -> pd.DataFrame:
    end = dt.date.today()
    start = end - dt.timedelta(days=int(years * 365.25) + 10)
    df = fdr.DataReader(code, start, end)
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
    return df[["date", "open", "high", "low", "close", "volume"]]


def get_history(code: str, years: int = 3) -> pd.DataFrame:
    key = f"history:{code}:{years}"
    df = cache.get_or_set(key, TTL_PRICE_SECONDS, lambda: _load_history(code, years))
    if df.empty:
        raise ValueError(f"No price history found for code={code}")
    return df
