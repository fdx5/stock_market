"""Valuation fixtures use only mocked feeds and a new in-memory cache."""
import pytest

from app.services import stock_valuation as valuation
from app.services.cache import TTLCache


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(valuation, "cache", TTLCache())


def test_korean_pbr_keeps_financial_period_and_bps(monkeypatch):
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def raise_for_status(self): pass
        def json(self):
            return {"totalInfos": [{"code": "pbr", "value": "2.58배", "valueDesc": "2026.06."},
                                   {"code": "bps", "value": "86,052원"}]}
    calls = []
    monkeypatch.setattr(valuation.requests, "get", lambda *args, **kwargs: calls.append(args) or Response())
    first = valuation.get_stock_valuation("005930")
    assert first["pbr"] == 2.58 and first["bps"] == 86052 and first["period"] == "2026.06."
    assert first["source"] == "Naver Finance"
    assert valuation.get_stock_valuation("005930") == first and len(calls) == 1


def test_us_provider_ratio_wins_over_current_price(monkeypatch):
    monkeypatch.setattr(valuation.yahoo_batch_transport, "fetch_rows", lambda _: [
        {"symbol": "AAPL", "priceToBook": 42.12, "bookValue": 5, "regularMarketPrice": 250}])
    result = valuation.get_stock_valuation("aapl", us=True)
    assert result["pbr"] == 42.12 and result["basis"] == "provider"


def test_us_fallback_uses_regular_price_and_book_value_from_the_same_row(monkeypatch):
    monkeypatch.setattr(valuation.yahoo_batch_transport, "fetch_rows", lambda _: [
        {"symbol": "BRK-B", "bookValue": 200, "regularMarketPrice": 500, "postMarketPrice": 900}])
    result = valuation.get_stock_valuation("BRK.B", us=True)
    assert result["pbr"] == 2.5 and result["basis"] == "regular_price_to_book"


@pytest.mark.parametrize("value", [None, 0, -1, float("nan"), float("inf"), "N/A", True])
def test_invalid_or_nonpositive_book_ratios_do_not_become_zero(value):
    assert valuation._positive(value) is None


def test_missing_feed_is_unavailable_and_retried_instead_of_cached_as_zero(monkeypatch):
    calls = []
    def fail(*args):
        calls.append(1)
        raise RuntimeError("Fixture outage")
    monkeypatch.setattr(valuation.yahoo_batch_transport, "fetch_rows", fail)
    for _ in range(2):
        result = valuation.get_stock_valuation("AAPL", us=True)
        assert result["pbr"] is None and result["fetched_at"] is None
    assert len(calls) == 2
