"""Shared last-good US prints and bounded chart recovery for missing batch rows.

Maps must return promptly even when all 500 batch rows fail. Chart recovery runs in
one background queue with eight workers; partial results reach the next map poll.
The two indices, detail pages and retries share per-symbol locks and a 60s recovery
cadence. Nothing here accesses a database or starts work at import time.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.data.global_marketcap_fetcher import _fetch_live_quote
from app.data.yahoo_quote import as_stock_quote

CHART_REFRESH_SECONDS = 60
_lock = threading.Lock()
_latest: dict[str, dict] = {}
_attempted: dict[str, float] = {}
_symbol_locks: dict[str, threading.Lock] = {}
_pending: set[str] = set()
_queued: set[str] = set()
_running = False
_slots = threading.BoundedSemaphore(8)


def remember(quotes: dict[str, dict]) -> dict[str, dict]:
    """A delayed response cannot replace a newer trade from another surface."""
    with _lock:
        for code, quote in quotes.items():
            old = _latest.get(code) or {}
            if old.get("quote_time") and quote.get("quote_time") and quote["quote_time"] < old["quote_time"]:
                continue
            _latest[code] = {**old, **quote}
        return {code: dict(_latest[code]) for code in quotes if code in _latest}


def latest(codes: list[str]) -> dict[str, dict]:
    with _lock:
        return {code: dict(_latest[code]) for code in codes if code in _latest}


def chart_quote(code: str) -> dict | None:
    with _lock:
        symbol_lock = _symbol_locks.setdefault(code, threading.Lock())
    with symbol_lock:
        with _lock:
            attempted = _attempted.get(code)
            if attempted is not None and time.monotonic() - attempted < CHART_REFRESH_SECONDS:
                return dict(_latest[code]) if code in _latest else None
            _attempted[code] = time.monotonic()
        try:
            with _slots:
                parsed = _fetch_live_quote(code.replace(".", "-"))
            if parsed:
                return remember({code: as_stock_quote(parsed)})[code]
        except Exception:
            pass  # Preserve the last valid print; retry on the next recovery cycle.
        return latest([code]).get(code)


def _recover() -> None:
    global _running
    with ThreadPoolExecutor(max_workers=8) as pool:
        while True:
            with _lock:
                if not _pending:
                    _running = False
                    return
                batch = list(_pending)
                _pending.clear()
            # Consume the iterator: all workers must finish before taking the next batch.
            list(pool.map(chart_quote, batch))
            with _lock:
                _queued.difference_update(batch)


def recover_missing(codes: list[str]) -> None:
    global _running
    with _lock:
        now = time.monotonic()
        _pending.update(code for code in codes if code not in _queued and (
            code not in _attempted or now - _attempted[code] >= CHART_REFRESH_SECONDS
        ))
        _queued.update(_pending)
        if _running or not _pending:
            return
        _running = True
    threading.Thread(target=_recover, name="us-quote-recovery", daemon=True).start()
