from datetime import datetime

import pytest

from app.services import treasury_market as market


@pytest.mark.parametrize("value,expected", [("4.953%", 4.953), ("+0.025", .025), ("NaN", None), ("inf", None), (None, None), ("—", None)])
def test_yields_are_percent_values_not_tnx_divided_by_ten(value, expected):
    assert market.number(value) == expected


def test_yield_basis_points_ignore_bond_price_percent_change(monkeypatch):
    monkeypatch.setattr(market, "_json", lambda *args: {"ITVQuoteResult": {"ITVQuote": [
        {"symbol": "US2Y", "last": "4.667%", "previous_day_closing": "4.635%", "change_pct": "-0.0586%", "realTime": "true"},
        {"symbol": "US10Y", "last": "4.9%", "previous_day_closing": "5.0%", "change_pct": "17%"}]}})
    rows = market._fetch_quotes()
    assert rows["US2Y"]["change_bp"] == 3.2
    assert rows["US10Y"]["change_bp"] == -10
    assert rows["US2Y"]["provider_realtime"]


def test_bars_sort_deduplicate_and_reject_nonfinite_values():
    bars = [{"close": "4.9%", "tradeTime": "20261023090000", "tradeTimeinMills": "1792749840000"},
            {"close": "4.8", "tradeTime": "20261022090000", "tradeTimeinMills": "1792663440000"},
            {"close": "NaN", "tradeTime": "20261024090000", "tradeTimeinMills": "1792836240000"},
            {"close": "4.91", "tradeTime": "20261023090000", "tradeTimeinMills": "1792749840000"}]
    points = market.normalize_bars(bars)
    assert len(points) == 2
    assert points[0]["time"] < points[1]["time"]
    assert points[1]["yield_pct"] == 4.91


def test_history_uses_daily_provider_dates_and_prior_day_basis(monkeypatch):
    monkeypatch.setattr(market.cache, "get_or_set", lambda key, ttl, load, **kwargs: load())
    seen = []
    def chart(tenor, **kwargs):
        seen.append(kwargs)
        return [{"close": "4.5", "tradeTime": "20231020000000", "tradeTimeinMills": "1697760000000"},
                {"close": "4.6%", "tradeTime": "20231023000000", "tradeTimeinMills": "1698019200000"},
                {"close": "4.59", "tradeTime": "20261022000000", "tradeTimeinMills": "1792627200000"}]
    monkeypatch.setattr(market, "_chart", chart)
    result = market.history("2", now=datetime(2026, 10, 23, tzinfo=market.NY))
    assert seen[0]["granularity"] == "1D" and len(seen[0]["startDate"]) == 14
    assert result["start_date"] == "2023-10-23"
    assert len(result["points"]) == 2
    assert result["points"][0]["change_bp"] == 10
    assert result["points"][1]["change_bp"] == -1


def test_intraday_only_keeps_latest_new_york_day(monkeypatch):
    monkeypatch.setattr(market.cache, "get_or_set", lambda key, ttl, load, **kwargs: load())
    monkeypatch.setattr(market, "_chart", lambda *args, **kwargs: [
        {"close": "4.5", "tradeTimeinMills": "1792663440000"},
        {"close": "4.6", "tradeTimeinMills": "1792749840000"}])
    result = market.intraday("10")
    assert len(result) == 1
    assert result[0]["date"] == "2026-10-23"


def test_header_ships_only_two_and_ten_year_yields_without_charts(monkeypatch):
    monkeypatch.setattr(market, "quotes", lambda: {"US2Y": {"yield_pct": 4.6, "change_bp": 3.2},
        "US5Y": {"yield_pct": 4.7, "change_bp": 1}, "US10Y": {"yield_pct": 4.8, "change_bp": -2.1}})
    monkeypatch.setattr(market, "intraday", lambda *args: pytest.fail("Header must not request charts"))
    result = market.headline_quotes()
    assert [row["tenor"] for row in result["items"]] == ["2", "10"]
    assert [row["change_bp"] for row in result["items"]] == [3.2, -2.1]
    assert not any("points" in row for row in result["items"])


def test_missing_header_tenor_keeps_last_known_yield_and_marks_it_stale(monkeypatch):
    monkeypatch.setattr(market, "quotes", lambda: {"US2Y": {"yield_pct": 4.6, "change_bp": 3.2}})
    monkeypatch.setattr(market, "_last_quotes", {"US10Y": {"yield_pct": 4.8, "change_bp": -2.1}})
    row = market.headline_quotes()["items"][1]
    assert row["yield_pct"] == 4.8 and row["change_bp"] == -2.1 and row["stale"]
    monkeypatch.setattr(market, "_last_quotes", {})
    assert market.headline_quotes()["items"][1]["yield_pct"] is None
