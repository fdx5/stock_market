"""Shared reading of Yahoo Finance's chart payload, including extended hours.

Yahoo's `meta.regularMarketPrice` is the last *regular session* print and nothing
else — during pre- or post-market it keeps reporting the previous close while the
stock is visibly trading elsewhere. Reading only that field is why US names on this
site sat at yesterday's close all through the Korean evening, when Seoul users are
most likely to be looking at them.

There is no `preMarketPrice` in this endpoint's meta (verified against the live
response), so the extended-hours print has to come from the series itself, which
requires `includePrePost=true` on the request. Both callers therefore share the
query params here as well as the parsing.
"""

# `includePrePost` is what makes the 04:00-09:30 and 16:00-20:00 ET bars appear in
# the series at all; without it the arrays stop at the regular close.
BASE_PARAMS = {"includePrePost": "true"}


def _last_traded(result: dict) -> tuple[int, float] | None:
    """(timestamp, close) of the most recent bar that actually printed. Yahoo pads
    the series with nulls for minutes with no trades — common in thin pre-market —
    so the last element is frequently not the last price."""
    timestamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    for ts, close in zip(reversed(timestamps), reversed(closes)):
        if close is not None:
            return int(ts), float(close)
    return None


def _session_of(ts: int, meta: dict) -> str:
    """Whether `ts` fell in the pre-market window of the period Yahoo currently
    reports. Anything later than the regular close that isn't pre-market is
    post-market — which also gives the right answer over a weekend, when the newest
    bar is Friday's post-market print and `currentTradingPeriod` has already rolled
    forward to Monday."""
    period = meta.get("currentTradingPeriod") or {}
    pre = period.get("pre") or {}
    pre_start, pre_end = pre.get("start"), pre.get("end")
    if pre_start is not None and pre_end is not None and pre_start <= ts < pre_end:
        return "pre"
    return "post"


def extract_quote(result: dict) -> dict | None:
    """price / previous_close / regular_close / session for one chart result, or None
    if the payload can't be read.

    `previous_close` is the baseline the change should be measured against, and it
    differs by session — this is the part that's easy to get wrong.

    - Post-market: `previousClose` is the close *before* today's regular session, so a
      change measured from it is the day's regular move plus the after-hours move. That
      is the site's convention: after the bell a reader wants "where this name stands
      versus yesterday", with the after-hours leg broken out separately (which is what
      `regular_close` is carried for).
    - Pre-market: `regularMarketPrice` is the last regular close and `previousClose` has
      NOT rolled forward — it still names the close before that one. Today's regular
      session hasn't run, so the only honest baseline is the last regular close, and
      using `previousClose` here would fold yesterday's whole session into a pre-market
      change.
    - Regular / 24h instruments: `previousClose`, as always.

    `regular_close` is the regular session's own last print, so a caller can show the
    extended leg on its own (price vs `regular_close`) beside the day-over-day figure.
    """
    meta = result.get("meta") or {}
    regular_price = meta.get("regularMarketPrice")
    previous_close = meta.get("previousClose") or meta.get("chartPreviousClose")
    if regular_price is None or previous_close is None:
        return None

    regular_price = float(regular_price)
    previous_close = float(previous_close)
    regular_time = meta.get("regularMarketTime")
    latest = _last_traded(result)

    # Only a print *newer* than the regular close is an extended-hours print. This
    # is also what keeps 24h instruments (FX, crypto, futures) on the regular path:
    # their newest bar is the regular-session bar, so they never take this branch.
    if latest is not None and regular_time is not None and latest[0] > int(regular_time):
        ts, price = latest
        session = _session_of(ts, meta)
        return {
            "price": price,
            "previous_close": regular_price if session == "pre" else previous_close,
            "regular_close": regular_price,
            "session": session,
        }

    return {
        "price": regular_price,
        "previous_close": previous_close,
        "regular_close": regular_price,
        "session": "regular",
    }
