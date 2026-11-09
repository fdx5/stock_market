"""Public night-futures crawl, shared for all visitors; memory only, no DB writes."""
import datetime as dt
import math
import threading
import time
from zoneinfo import ZoneInfo

import requests

SOURCE_URL = "https://kospi.donkiugi.com/"
FEED_URL = "https://kospi.donkiugi.com/api/quotes.php?action=dashboard"
REFRESH_SECONDS = 10
# The crawl's prevClose is the KOSPI200 *spot* close, not the futures day-session
# close, so its change is off by the spot-futures basis (~0.3%) all night. Brokers
# quote the night session against the day futures close, so take that from Naver.
BASE_URL = "https://m.stock.naver.com/api/index/FUT/price?pageSize=5&page=1"
BASE_RETRY_SECONDS = 60
BASE_MAX_GAP = 0.03  # a quarterly roll or a wrong row must not become the baseline
KST = ZoneInfo("Asia/Seoul")
_lock = threading.Lock()
_attempted: float | None = None
_latest: dict | None = None
_failed = False
_bases: dict[str, float] = {}
_base_attempted: dict[str, float] = {}


def _number(value) -> float:
    if isinstance(value, bool):
        raise ValueError("Invalid quote")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Invalid quote")
    return value


def _day_futures_close(session_date) -> float | None:
    """Day-session KOSPI200 futures close for the night's session date, cached per date."""
    if not isinstance(session_date, str) or not session_date:
        return None
    if session_date in _bases:
        return _bases[session_date]
    now = time.monotonic()
    last = _base_attempted.get(session_date)
    if last is not None and now - last < BASE_RETRY_SECONDS:
        return None
    _base_attempted[session_date] = now
    try:
        response = requests.get(BASE_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=(3, 5))
        response.raise_for_status()
        for row in response.json():
            if row.get("localTradedAt") == session_date:
                value = _number(str(row["closePrice"]).replace(",", ""))
                if value > 0:
                    _bases.clear()  # one live session at a time
                    _bases[session_date] = value
                    return value
    except (requests.RequestException, ValueError, TypeError, KeyError, AttributeError):
        pass
    return None


def _parse(body: dict, base: float | None = None) -> dict:
    row = body["night"]
    price, previous = _number(row["price"]), _number(row["prevClose"])
    if price <= 0 or previous <= 0:
        raise ValueError("Invalid quote")
    base_source = "source_prev_close"
    if base and abs(base / previous - 1) <= BASE_MAX_GAP:
        previous, base_source = base, "day_futures_close"
    # Use the source quote time, never the HTTP request time as a trade timestamp.
    stamp = dt.datetime.fromisoformat(row["updated"])
    stamp = stamp.replace(tzinfo=KST) if stamp.tzinfo is None else stamp.astimezone(KST)
    points = []
    for point in (row.get("points") or [])[-240:]:
        try:
            value = _number(point["v"])
            if value > 0:
                points.append({"date": dt.datetime.fromtimestamp(_number(point["t"]) / 1000, KST).isoformat(), "close": value})
        except (ValueError, TypeError, KeyError, OverflowError, OSError):
            continue
    return {"close": round(price, 4), "change": round(price - previous, 4),
            "change_pct": round((price / previous - 1) * 100, 2),
            "prev_close": round(previous, 4), "base_source": base_source,
            "quote_time": int(stamp.timestamp()), "session_date": row.get("sessionDate"),
            "source_live": row.get("live") is True, "source_stale": body.get("stale") is True,
            "points": points}


def get_quote() -> dict:
    global _attempted, _latest, _failed
    # One server-wide crawl per 10 seconds, including failures. Concurrent visitors
    # join the same request; a hung source has a bounded timeout and no retry storm.
    with _lock:
        now = time.monotonic()
        if _attempted is None or now - _attempted >= REFRESH_SECONDS:
            _attempted = now
            try:
                response = requests.get(FEED_URL, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"}, timeout=(3, 5))
                response.raise_for_status()
                payload = response.json()
                quote = _parse(payload, _day_futures_close(payload["night"].get("sessionDate")))
                if _latest is None or quote["quote_time"] >= _latest["quote_time"]:
                    _latest = quote
                    _failed = False
                else:
                    _failed = True
            except (requests.RequestException, ValueError, TypeError, KeyError, OverflowError):
                _failed = True
        quote = dict(_latest) if _latest else {"close": None, "change": None, "change_pct": None, "quote_time": None, "points": []}
        now_kst = dt.datetime.now(KST)
        minute = now_kst.hour * 60 + now_kst.minute
        night_window = (now_kst.weekday() < 5 and minute >= 18 * 60) or (1 <= now_kst.weekday() <= 5 and minute < 6 * 60)
        age = now_kst.timestamp() - quote["quote_time"] if quote["quote_time"] else None
        stale = _failed or bool(quote.get("source_stale")) or bool(night_window and (age is None or age > 180))
        return {**quote, "stale": stale, "fetch_failed": _failed,
                "session_state": "open" if night_window and quote.get("source_live") else "closed",
                "source": "코스피 야간선물", "source_url": SOURCE_URL,
                "refresh_seconds": REFRESH_SECONDS, "checked_at": now_kst.isoformat()}
