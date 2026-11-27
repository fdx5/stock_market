import queue
import threading

import requests

from app.services.cache import cache

# Investor buy/sell breakdown is only published as a completed-day figure — there is no
# free source for intraday (let alone 30-second) ticks of this data, so a long TTL is
# fine; it won't change again until the next session closes.
TTL_INVESTOR_SECONDS = 30 * 60

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}


def _parse_num(text: str) -> float:
    return float(str(text).replace(",", "").replace("+", ""))


def _fetch_investor_trend(code: str, page_size: int) -> list[dict]:
    url = (
        f"https://m.stock.naver.com/front-api/stock/domestic/trend"
        f"?code={code}&marketType=KRX&pageSize={page_size}"
    )
    resp = requests.get(url, headers=HEADERS, timeout=4)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("isSuccess"):
        return []

    # Naver nested each day's figures under a per-venue ("krx"/"nxt") object when it
    # added the NXT alternative exchange, and renamed most fields in the process. The
    # old flat-row shape this used to parse (row["closePrice"], row["bizdate"], ...)
    # no longer exists, so every lookup raised KeyError and was silently swallowed by
    # the except below — every /investor page rendered with empty data regardless of
    # code, which is also why they were duplicate-content, un-indexable pages.
    items = ((payload.get("result") or {}).get("items")) or []
    records = []
    for item in items:
        venue = item.get("krx") or item.get("nxt")
        if not venue:
            continue
        try:
            close = _parse_num(venue["closingPrice"])
            foreigner_qty = _parse_num(venue["foreignNetVolume"])
            organ_qty = _parse_num(venue["organizationNetVolume"])
            individual_qty = _parse_num(venue["individualNetVolume"])
            traded_at = str(item["localTradedAt"])
        except (KeyError, ValueError, TypeError):
            continue

        # Naver only publishes net *quantity* by investor type, not net amount — the
        # 억원 figure here is quantity x that day's close, a standard approximation
        # when the true volume-weighted trade price isn't available.
        records.append(
            {
                "date": traded_at,
                "close": close,
                "change": _parse_num(venue.get("changePrice", "0")),
                "individual_amount": round(individual_qty * close / 100_000_000, 1),
                "institution_amount": round(organ_qty * close / 100_000_000, 1),
                "foreign_amount": round(foreigner_qty * close / 100_000_000, 1),
            }
        )
    return records


def get_investor_trend(code: str, page_size: int = 20) -> list[dict]:
    key = f"investor_trend:{code}:{page_size}"
    try:
        return cache.get_or_set(key, TTL_INVESTOR_SECONDS, lambda: _fetch_investor_trend(code, page_size))
    except Exception:
        return []


# Page rendering (server HTML for /stock/{code} and /investor/{code}) must never wait on
# Naver. Incident 2026-11-27 10:02 KST: a crawler walked thousands of codes at once, every
# one a cache miss, each request thread blocked on this fetch and the 1-CPU instance stopped
# answering anything but /api/health for ~90 s. Pages read the cache only; a miss is queued
# for one background worker (bounded, deduplicated) so later visits get the data.
STALE_FOR_PAGES_SECONDS = 3 * 24 * 3600
_WARM_QUEUE_MAX = 200
_warm_queue: "queue.Queue[tuple[str, int]]" = queue.Queue(maxsize=_WARM_QUEUE_MAX)
_warm_pending: set[tuple[str, int]] = set()
_warm_lock = threading.Lock()
_warm_thread: threading.Thread | None = None


def _warm_worker() -> None:
    while True:
        item = _warm_queue.get()
        try:
            get_investor_trend(*item)
        except Exception:
            pass
        finally:
            with _warm_lock:
                _warm_pending.discard(item)


def _schedule_warm(code: str, page_size: int) -> None:
    global _warm_thread
    item = (code, page_size)
    with _warm_lock:
        if item in _warm_pending:
            return
        try:
            _warm_queue.put_nowait(item)
        except queue.Full:
            return
        _warm_pending.add(item)
        if _warm_thread is None or not _warm_thread.is_alive():
            _warm_thread = threading.Thread(target=_warm_worker, name="investor-trend-warm", daemon=True)
            _warm_thread.start()


def cached_investor_trend(code: str, page_size: int = 20) -> list[dict]:
    """Cache-only read for page rendering; never blocks on the network."""
    hit = cache.peek(f"investor_trend:{code}:{page_size}", max_stale_seconds=STALE_FOR_PAGES_SECONDS)
    if hit is not None:
        return hit
    _schedule_warm(code, page_size)
    return []
