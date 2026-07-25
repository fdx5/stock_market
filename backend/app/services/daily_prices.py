"""Newest-first daily OHLCV rows for the 일별 시세 table, paged.

Built on top of the same `price_fetcher.get_history()` frame the price chart and
/indicators already read, rather than a separate per-page scrape of Naver's 일별시세
page. That buys three things: the table can never disagree with the chart sitting
above it, paging costs nothing upstream (the history is already in the 6h cache by
the time the panel mounts), and the identical code path serves KR and US symbols.
"""

import pandas as pd

# KRX publishes 거래대금 only through paid/session-gated feeds — neither Naver's daily
# table nor FinanceDataReader carries it, so it is derived here from the bar itself.
# (high + low + close) / 3 is the standard "typical price" VWAP proxy; the alternative
# of volume x close systematically misprices any session with a wide range. Responses
# flag it as `value_estimated` so the UI can label the column as an estimate rather
# than pass it off as the exchange's own figure.
def _typical_price(row: pd.Series) -> float:
    return (float(row["high"]) + float(row["low"]) + float(row["close"])) / 3


def build_daily_rows(df: pd.DataFrame, offset: int, limit: int) -> dict:
    """`df` is a chronological OHLCV frame (price_fetcher.get_history's shape).

    Returns the `limit` rows starting `offset` back from the most recent session,
    newest first, each carrying its day-over-day change against the bar *before* it —
    including for the oldest row in the window, which is why the slice is taken from
    the full frame rather than a pre-trimmed one.
    """
    total = len(df)
    start = max(total - offset - limit, 0)
    end = max(total - offset, 0)
    if start >= end:
        return {"items": [], "has_more": False, "total": total}

    items = []
    for pos in range(end - 1, start - 1, -1):
        row = df.iloc[pos]
        close = float(row["close"])
        # The very first bar in the frame has no predecessor to compare against; it
        # reports a flat change rather than being dropped, so the window still fills.
        prev_close = float(df.iloc[pos - 1]["close"]) if pos > 0 else close
        change = close - prev_close
        volume = int(row["volume"])
        items.append(
            {
                "date": str(row["date"]),
                "close": close,
                "change": round(change, 2),
                "change_pct": round((change / prev_close * 100) if prev_close else 0.0, 2),
                "volume": volume,
                "value": round(volume * _typical_price(row)),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
            }
        )

    return {"items": items, "has_more": start > 0, "total": total}
