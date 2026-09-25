import time

from app.services import admin_query_cache as c


def _wait_refresh():
    for _ in range(100):
        if not c._refreshing:
            return
        time.sleep(0.01)


def test_expired_value_is_served_at_once_and_refreshed_behind(monkeypatch):
    monkeypatch.setattr(c, "_entries", c.OrderedDict())
    monkeypatch.setattr(c, "_refreshing", set())
    calls = []

    @c.ttl_cache(0.01)
    def slow(x):
        calls.append(x)
        return {"n": len(calls)}

    assert slow(1) == {"n": 1}
    time.sleep(0.02)
    assert slow(1) == {"n": 1}  # stale, served without waiting
    _wait_refresh()
    assert slow(1) == {"n": 2}  # the background refresh landed


def test_a_failed_refresh_keeps_the_last_good_value(monkeypatch):
    monkeypatch.setattr(c, "_entries", c.OrderedDict())
    monkeypatch.setattr(c, "_refreshing", set())
    state = {"fail": False}

    @c.ttl_cache(0.01)
    def flaky():
        if state["fail"]:
            raise RuntimeError("database timed out")
        return [1, 2, 3]

    assert flaky() == [1, 2, 3]
    state["fail"] = True
    time.sleep(0.02)
    assert flaky() == [1, 2, 3]
    _wait_refresh()
    assert flaky() == [1, 2, 3]
    assert any(e["error"] and "timed out" in e["error"] for e in c.status())


def test_positional_and_keyword_calls_share_one_entry(monkeypatch):
    """The admin warmer calls endpoints positionally; FastAPI calls them by keyword.
    Both must land on the same entry or the warmer warms nothing a request reads."""
    monkeypatch.setattr(c, "_entries", c.OrderedDict())
    monkeypatch.setattr(c, "_refreshing", set())
    calls = []

    @c.ttl_cache(60)
    def trend(range: str = "24h"):
        calls.append(range)
        return {"range": range}

    assert trend("30d") == {"range": "30d"}  # the warmer
    assert trend(range="30d") == {"range": "30d"}  # a request
    assert calls == ["30d"]
