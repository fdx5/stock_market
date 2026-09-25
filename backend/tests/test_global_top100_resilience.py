import pytest

from app.services import global_top100 as g


class FakeStore:
    def __init__(self):
        self.state = {}
        self.fund = {}

    def load_state(self, key):
        return self.state.get(key)

    def save_state(self, key, payload, updated_at):
        self.state[key] = (payload, updated_at)

    def load_fundamentals(self):
        return dict(self.fund)

    def save_fundamentals(self, rows, updated_at):
        self.fund.update(rows)

    def record_snapshot(self, day, rows):
        pass

    def previous_snapshot_date(self, day):
        return None

    def ranks_for_date(self, day):
        return {}


def _roster(n=100):
    return [
        {"rank": i + 1, "code": f"S{i}", "name": f"Co{i}", "marcap_usd": 1e12 - i, "price_usd": 100.0 + i, "change_pct": 1.0}
        for i in range(n)
    ]


class Ret:
    returns = {"m1": 5.0}
    points = [1.0, 2.0]
    dates = ["20260101", "20260102"]


@pytest.fixture
def svc(monkeypatch):
    fake = FakeStore()
    monkeypatch.setattr(g, "store", fake)
    monkeypatch.setattr(g, "_snapshot", None)
    monkeypatch.setattr(g, "_snapshot_at", None)
    monkeypatch.setattr(g, "_live", {})
    monkeypatch.setattr(g, "_live_at", None)
    monkeypatch.setattr(g, "_chart_at", 0.0)
    monkeypatch.setattr(g, "_live_persisted_at", 0.0)
    monkeypatch.setattr(g, "_loaded", False)
    monkeypatch.setattr(g.yahoo_session, "cooling_down", lambda: False)
    monkeypatch.setattr(g, "get_global_top_n", lambda n: _roster())
    monkeypatch.setattr(g, "fetch_fundamentals_bulk", lambda syms: {s: {"sector": "Tech", "trailing_pe": 20.0} for s in syms})
    monkeypatch.setattr(g, "get_global_returns", lambda syms: {s: Ret() for s in syms})
    monkeypatch.setattr(g, "get_ceo_photos_bulk", lambda names: {})
    monkeypatch.setattr(g, "translate_to_korean", lambda text: "번역")
    return fake


def test_a_new_process_serves_the_saved_snapshot_at_once(svc):
    svc.state["snapshot"] = ([{"symbol": "S0", "rank": 1, "price": 10.0, "currency": "USD", "market_cap_usd": 5.0, "change_pct": 1.0}], "t")
    out = g.get_top100()
    assert [it["symbol"] for it in out["items"]] == ["S0"]
    assert out["updated_at"] == "t"


def test_every_row_has_a_price_even_with_no_live_quote(svc):
    g.force_refresh_full()
    items = g.get_top100()["items"]
    assert len(items) == 100
    assert all(it["price"] is not None and it["currency"] == "USD" for it in items)
    assert svc.state["snapshot"][0][0]["sector"] == "Tech"  # saved for the next process


def test_a_failed_upstream_keeps_last_nights_values(svc, monkeypatch):
    g.force_refresh_full()
    monkeypatch.setattr(g.yahoo_session, "cooling_down", lambda: True)  # no crumb tonight

    def boom(syms):
        raise RuntimeError("down")

    monkeypatch.setattr(g, "get_global_returns", boom)
    g.force_refresh_full()
    row = g.get_top100()["items"][0]
    assert row["sector"] == "Tech" and row["trailing_pe"] == 20.0
    assert row["returns"] == {"m1": 5.0} and row["spark_points"] == [1.0, 2.0]


def test_a_short_roster_leaves_the_snapshot_alone(svc, monkeypatch):
    g.force_refresh_full()
    monkeypatch.setattr(g, "get_global_top_n", lambda n: _roster(12))
    with pytest.raises(RuntimeError):
        g.force_refresh_full()
    assert len(g.get_top100()["items"]) == 100


def test_live_falls_back_to_the_chart_endpoint_and_keeps_old_quotes(svc, monkeypatch):
    g.force_refresh_full()
    calls = []
    monkeypatch.setattr(g, "fetch_live_quotes", lambda syms: {})  # crumb refused

    def chart(syms):
        calls.append(len(syms))
        return {"S0": {"price": 111.0, "change_pct": 2.0, "currency": "USD"}}

    monkeypatch.setattr(g, "fetch_chart_quotes", chart)
    g.refresh_live()
    row = g.get_top100()["items"][0]
    assert row["price"] == 111.0 and row["change_pct"] == 2.0
    assert row["market_cap_usd"] == pytest.approx((1e12) * 111.0 / 100.0)

    g.refresh_live()  # within the minute: no second round of 100 chart calls
    assert calls == [100]
    assert g.get_top100()["items"][0]["price"] == 111.0
