import logging
import math
import threading
import time
from collections import OrderedDict
from http.client import RemoteDisconnected

import requests
from app.data.http_pool import mount_pool, retry_after_seconds

# Shared by any feature that needs a live KOSPI/KOSDAQ market-cap-ranked snapshot (the
# KOSPI MAP treemap, the top-100 prediction panel's live price column, etc). Each caller
# owns its own cache tier on top of this — this module only knows how to fetch and parse
# one page of Naver's market-cap ranking.
#
# This used to scrape the HTML table at finance.naver.com/sise/sise_market_sum.naver,
# but that URL now 302s to the stock.naver.com Next.js app, whose server-rendered
# response contains no `table.type_2` (the data loads client-side). That silently
# turned every page fetch into zero rows, which cascaded into every KOSPI/KOSDAQ stock
# — 현대차 included — dropping out of the map. The app itself fetches its data from a
# JSON API at m.stock.naver.com; that's what this module calls instead.
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}
NAVER_PAGE_SIZE = 50
_MARKET_CATEGORY = {0: "KOSPI", 1: "KOSDAQ"}

# A shared, connection-pooled session avoids paying a fresh TCP/TLS handshake for each
# of the (potentially many) page requests a cold fetch makes to the same host.
_session = requests.Session()
_session.headers.update(NAVER_HEADERS)
mount_pool(_session, max_retries=0)
logger = logging.getLogger(__name__)
_TIMEOUT = (3.05, 4)
_slots = threading.BoundedSemaphore(4)
_lock = threading.Lock()
_last_good: OrderedDict[tuple[str, int], list[dict]] = OrderedDict()
_failures = 0
_retry_at = 0.0
_generation = 0
_probing = False


class MarketPageUnavailable(RuntimeError):
    """Upstream cannot refresh this page; retain its last successful snapshot."""


def _remote_closed(error: BaseException) -> bool:
    """Inspect wrapped exceptions, without guessing from or logging their text."""
    pending = [error]
    seen = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, RemoteDisconnected):
            return True
        pending.extend(e for e in current.args if isinstance(e, BaseException))
        pending.extend(e for e in (current.__cause__, current.__context__) if e is not None)
    return False


def _begin() -> int:
    global _probing
    with _lock:
        if time.monotonic() < _retry_at or _probing:
            raise MarketPageUnavailable("Naver market ranking cooling down")
        _probing = _failures > 0
        return _generation


def _finish(generation: int, reason: str | None, retry_after: float = 0, *, succeeded: bool = False) -> None:
    global _probing, _failures, _retry_at, _generation
    report = None
    with _lock:
        if generation != _generation:
            return
        _probing = False
        if reason:
            _failures += 1
            base = 900 if reason == "rate_limited" else 30
            wait = max(retry_after, min(900, base * 2 ** min(_failures - 1, 5)))
            _retry_at = time.monotonic() + wait
            _generation += 1
            report = (reason, wait)
        elif succeeded:
            _failures = 0
            _retry_at = 0
    if report:
        logger.info("naver_price_fetcher: ranking unavailable reason=%s next_probe_s=%.0f; retaining last good pages", *report)


def _read_page(url: str, params: dict) -> dict:
    response = None
    fresh_session = None
    try:
        try:
            response = _session.get(url, params=params, timeout=_TIMEOUT)
        except requests.ConnectionError as error:
            if not _remote_closed(error):
                raise
            # A closed keep-alive connection needs one new connection, not the
            # adapter's immediate blind retry against the same pool. Never close
            # the shared session while other page requests are using it.
            fresh_session = mount_pool(requests.Session(), max_retries=0)
            fresh_session.headers.update({**NAVER_HEADERS, "Connection": "close"})
            response = fresh_session.get(url, params=params, timeout=_TIMEOUT)
        response.raise_for_status()
        return response.json()
    finally:
        if response is not None:
            response.close()
        if fresh_session is not None:
            fresh_session.close()


def _parse_signed(value) -> float:
    """Handles the API's own raw numeric strings, which already carry their sign (a
    falling stock's compareToPreviousClosePriceRaw is e.g. "-8000") and occasional
    "N/A"/empty placeholders for fields Naver has nothing to report."""
    if value in (None, "", "N/A"):
        return 0.0
    try:
        number = float(str(value).replace(",", ""))
        return number if math.isfinite(number) else 0.0
    except (ValueError, TypeError, OverflowError):
        return 0.0


def _fetch_market_cap_page(page: int, sosok: int = 0) -> list[dict]:
    """One page (50 rows) of the market-cap ranking, live — `sosok=0` for KOSPI,
    `sosok=1` for KOSDAQ. Includes ETFs — callers that need companies only should
    cross-reference StockListing('ETF/KR')."""
    category = _MARKET_CATEGORY.get(sosok, "KOSPI")
    url = f"https://m.stock.naver.com/api/stocks/marketValue/{category}"
    payload = _read_page(url, {"page": page, "pageSize": NAVER_PAGE_SIZE})
    if not isinstance(payload, dict) or not isinstance(payload.get("stocks"), list):
        raise ValueError("invalid Naver ranking response")
    total = payload.get("totalCount")
    if not payload["stocks"] and (not isinstance(total, int) or (page - 1) * NAVER_PAGE_SIZE < total):
        raise ValueError("incomplete Naver ranking response")

    rows = []
    for item in payload.get("stocks", []):
        if not isinstance(item, dict) or not isinstance(item.get("itemCode"), str):
            raise ValueError("invalid Naver ranking row")
        code = item["itemCode"]
        if not code or _parse_signed(item.get("marketValueRaw")) <= 0:
            raise ValueError("invalid Naver market value")
        rows.append(
            {
                "code": code,
                "name": item.get("stockName") or "",
                "close": _parse_signed(item.get("closePriceRaw")),
                "change": _parse_signed(item.get("compareToPreviousClosePriceRaw")),
                "change_pct": _parse_signed(item.get("fluctuationsRatio")),
                "marcap": _parse_signed(item.get("marketValueRaw")),
                "volume": _parse_signed(item.get("accumulatedTradingVolumeRaw")),
            }
        )
    return rows


def fetch_market_cap_page(page: int, sosok: int = 0) -> list[dict]:
    """Bound host concurrency; recover closed sockets; preserve a whole good page."""
    key = (_MARKET_CATEGORY.get(sosok, "KOSPI"), page)
    acquired = False
    generation = None
    reason = None
    retry_after = 0
    succeeded = False
    try:
        acquired = _slots.acquire(timeout=_TIMEOUT[1])
        if not acquired:
            raise MarketPageUnavailable("Naver market ranking request slots busy")
        generation = _begin()
        try:
            rows = _fetch_market_cap_page(page, sosok)
        except requests.HTTPError as error:
            status = error.response.status_code if error.response is not None else None
            if status == 429 or status in (401, 403) or status is not None and status >= 500:
                reason = "rate_limited" if status == 429 else "http_unavailable"
                retry_after = retry_after_seconds(error.response) or 0
            raise MarketPageUnavailable("Naver ranking HTTP unavailable") from None
        except requests.RequestException as error:
            reason = "read_timeout" if isinstance(error, requests.ReadTimeout) else "remote_closed" if _remote_closed(error) else "transport_error"
            raise MarketPageUnavailable("Naver ranking transport unavailable") from None
        except (ValueError, TypeError):
            reason = "invalid_payload"
            raise MarketPageUnavailable("Naver ranking payload unavailable") from None
        succeeded = True
        with _lock:
            _last_good[key] = rows
            _last_good.move_to_end(key)
            while len(_last_good) > 160:
                _last_good.popitem(last=False)
        return [dict(row) for row in rows]
    except MarketPageUnavailable:
        with _lock:
            previous = _last_good.get(key)
            if previous is not None:
                return [dict(row) for row in previous]
        raise
    finally:
        if generation is not None:
            _finish(generation, reason, retry_after, succeeded=succeeded)
        if acquired:
            _slots.release()
