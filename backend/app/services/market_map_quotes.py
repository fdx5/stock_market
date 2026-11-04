"""Shared, synchronous-on-expiry map quotes; no persistent storage.

Roster scraping may use stale-while-revalidate. Prices must not: a busy background
refresh queue otherwise leaves a full map on the regular close indefinitely.
All domestic map sizes share the same leading tiers and last successful prints.
"""
import threading
import time

from app.data.stock_quote_fetcher import get_stock_quotes_bulk
from app.services.cache import cache

_lock = threading.Lock()
_latest: dict[str, dict] = {}


def _remember(quotes: dict[str, dict]) -> dict[str, dict]:
    received_at = time.time()
    with _lock:
        for code, quote in quotes.items():
            old = _latest.get(code, {})
            old_time, new_time = old.get("quote_time"), quote.get("quote_time")
            if old_time and (not new_time or new_time < old_time):
                continue
            _latest[code] = {**quote, "quote_received_at": received_at}
    return quotes


def get_map_quotes(market: str, codes: list[str]) -> dict[str, dict]:
    # Identical top-20 / next-30 keys for limit=20, 50 and full-map requests.
    # The single-flight cache shares their upstream work, even on a cold entry.
    tail_ttl = 4 if len(codes) <= 60 else 60  # Keep the existing top-60 scanner cadence.
    for start, stop, ttl in ((0, 20, 4), (20, 50, 4), (50, len(codes), tail_ttl)):
        group = codes[start:stop]
        if not group:
            continue
        key = f"map_quotes:v3:{market}:{','.join(sorted(group))}"
        try:
            cache.get_or_set(
                key, ttl, lambda: _remember(get_stock_quotes_bulk(group)), allow_stale=False,
            )
            # The factory records results when fetched, never when stale cache is read.
            # Partial batch failures leave the last successful per-code print intact.
        except Exception:
            # Keep known prices during an upstream outage; the expired entry remains
            # expired so the next request retries rather than caching a failure.
            pass
    with _lock:
        return {code: dict(_latest[code]) for code in codes if code in _latest}
