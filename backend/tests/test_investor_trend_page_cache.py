import threading
import time

from app.data import investor_fetcher
from app.services.cache import cache


def test_page_read_never_waits_on_naver(monkeypatch):
    started = threading.Event()

    def slow_fetch(code, size):
        started.set()
        time.sleep(0.3)
        return [{"date": "2026-11-27", "close": 1.0}]

    monkeypatch.setattr(investor_fetcher, "_fetch_investor_trend", slow_fetch)
    t0 = time.monotonic()
    assert investor_fetcher.cached_investor_trend("999991", 30) == []
    assert investor_fetcher.cached_investor_trend("999991", 30) == []  # deduplicated, still instant
    assert time.monotonic() - t0 < 0.1
    assert started.wait(2)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and not investor_fetcher.cached_investor_trend("999991", 30):
        time.sleep(0.05)
    assert investor_fetcher.cached_investor_trend("999991", 30)[0]["close"] == 1.0
