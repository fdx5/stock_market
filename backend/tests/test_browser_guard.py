"""Headless browsers never start inside the web server, and deferrals cost no attempts."""
import urllib.error

import pytest

from app.services import browser_guard, naver_social_publisher as pub


def test_refused_on_the_server_unless_allowed(monkeypatch):
    monkeypatch.setattr(browser_guard, "ON_SERVER", True)
    monkeypatch.delenv("SERVER_BROWSER_ALLOWED", raising=False)
    calls = []

    @browser_guard.uses_browser("test")
    def launch():
        calls.append(1)

    with pytest.raises(browser_guard.BrowserUnavailable):
        launch()
    assert calls == []
    monkeypatch.setenv("SERVER_BROWSER_ALLOWED", "1")
    monkeypatch.setattr(browser_guard, "free_memory_mb", lambda: 400.0)
    with pytest.raises(browser_guard.BrowserUnavailable):  # not enough headroom
        launch()
    monkeypatch.setattr(browser_guard, "free_memory_mb", lambda: 1800.0)
    launch()
    assert calls == [1]


def test_allowed_on_the_pc_and_reentrant(monkeypatch):
    monkeypatch.setattr(browser_guard, "ON_SERVER", False)

    @browser_guard.uses_browser("outer")
    def outer():
        return inner()

    @browser_guard.uses_browser("inner")
    def inner():
        return "ok"

    assert outer() == "ok"


def test_transient_errors_are_recognised():
    assert pub._transient(urllib.error.HTTPError("u", 502, "Bad Gateway", {}, None))
    assert pub._transient(TimeoutError())
    assert not pub._transient(urllib.error.HTTPError("u", 404, "Not Found", {}, None))
    assert not pub._transient(ValueError("bad data"))


class _Store:
    MAX_ATTEMPTS = 4

    def __init__(self):
        self.rows, self.released, self.logs = {}, [], []

    def key(self, day, edition):
        return f"{day}:{edition}"

    def enqueue(self, day, edition, category):
        self.rows.setdefault(f"{day}:{edition}", {"post_key": f"{day}:{edition}", "status": "pending", "attempts": 0})

    def get(self, k):
        return self.rows.get(k)

    def claim(self, k):
        self.rows[k]["status"] = "publishing"
        self.rows[k]["attempts"] += 1
        return True

    def release(self, k, error, refund):
        self.released.append((k, error, refund))
        self.rows[k]["status"] = "pending"
        if refund:
            self.rows[k]["attempts"] -= 1

    def release_stale(self):
        return 0

    def log_run(self, *a):
        self.logs.append(a)


@pytest.mark.parametrize("error, refunded, status", [
    (urllib.error.HTTPError("u", 502, "Bad Gateway", {}, None), True, "ok"),
    (browser_guard.BrowserUnavailable("server"), True, "deferred"),
    (RuntimeError("real bug"), False, "partial"),
])
def test_deferrals_do_not_use_attempts(monkeypatch, error, refunded, status):
    import datetime as dt
    store = _Store()
    monkeypatch.setattr(pub, "store", store)
    monkeypatch.setattr(pub.naver_session_store, "is_configured", lambda: True)
    monkeypatch.setattr(pub.naver_session_store, "get", lambda: {"cookies": [], "blog_id": "b"})
    monkeypatch.setattr(pub.naver_publish_store, "acquire_batch_lock", lambda **k: "owner")
    monkeypatch.setattr(pub.naver_publish_store, "release_batch_lock", lambda o: None)

    def boom(*a, **k):
        raise error
    monkeypatch.setattr(pub, "publish_edition", boom)
    result = pub.run_due(force_day=dt.date(2026, 11, 26), only=["midday"])
    k = "2026-11-26:midday"
    assert store.released[0][2] is refunded
    assert store.rows[k]["attempts"] == (0 if refunded else 1)
    assert result["status"] == status
