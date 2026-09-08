import datetime as dt

import pandas as pd
import pytest

from app.data import krx_listing
from app.services import market_map


class _Response:
    def __init__(self, status_code: int, content: bytes = b""):
        self.status_code = status_code
        self.content = content

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


_CSV = b",Code,ISU_CD,Name,Market,MarketId,Marcap\n0,005930,KR7005930003,samsung,KOSPI,STK,100\n"


def test_snapshot_falls_back_to_the_last_published_day(monkeypatch):
    """The regression that 500'd every KR page: KRX declares a session as soon as it
    opens, but the snapshot repo publishes that session's CSV hours later, so asking
    for today's file by name returns 404 for most of the trading day."""
    monkeypatch.setattr(krx_listing, "_latest_work_date", lambda: dt.date(2026, 9, 8))
    asked = []

    def fake_get(url, **kwargs):
        asked.append(url)
        if url.endswith("2026-09-08.csv"):
            return _Response(404)
        return _Response(200, _CSV)

    monkeypatch.setattr(krx_listing.requests, "get", fake_get)

    df = krx_listing.stock_listing("KOSPI")

    assert list(df["Code"]) == ["005930"]
    assert asked[0].endswith("2026-09-08.csv")
    assert asked[-1].endswith("2026-09-07.csv")


def test_snapshot_walks_past_a_weekend(monkeypatch):
    monkeypatch.setattr(krx_listing, "_latest_work_date", lambda: dt.date(2026, 9, 8))
    published = "2026-09-04.csv"
    monkeypatch.setattr(
        krx_listing.requests,
        "get",
        lambda url, **kw: _Response(200, _CSV) if url.endswith(published) else _Response(404),
    )

    assert list(krx_listing.stock_listing("KRX")["Code"]) == ["005930"]


def test_snapshot_gives_up_with_a_clear_error(monkeypatch):
    monkeypatch.setattr(krx_listing, "_latest_work_date", lambda: dt.date(2026, 9, 8))
    monkeypatch.setattr(krx_listing.requests, "get", lambda url, **kw: _Response(404))

    with pytest.raises(RuntimeError, match="no krx snapshot published"):
        krx_listing.stock_listing("KOSPI")


def test_market_filter_selects_one_board(monkeypatch):
    both = (
        b",Code,Name,Market,MarketId\n"
        b"0,005930,samsung,KOSPI,STK\n"
        b"1,247540,ecopro,KOSDAQ,KSQ\n"
    )
    monkeypatch.setattr(krx_listing, "_latest_work_date", lambda: dt.date(2026, 9, 8))
    monkeypatch.setattr(krx_listing.requests, "get", lambda url, **kw: _Response(200, both))

    assert list(krx_listing.stock_listing("KOSDAQ")["Code"]) == ["247540"]
    assert list(krx_listing.stock_listing("KRX")["Code"]) == ["005930", "247540"]


def test_an_unreadable_industry_map_degrades_instead_of_failing(monkeypatch):
    """The map is a price picture grouped by sector. Losing the grouping is a worse
    map; raising took the whole KOSPI/KOSDAQ page down with a 500."""
    market_map.cache.invalidate("krx_industry_map")

    def boom(_market):
        raise RuntimeError("snapshot repo is down")

    monkeypatch.setattr(market_map.krx_listing, "stock_listing", boom)

    assert market_map._get_industry_map() == {}
    assert market_map._get_etf_codes() == set()
    # Nothing was cached, so the next call retries rather than being pinned to the
    # degraded answer for the entry's 24-hour TTL.
    monkeypatch.setattr(
        market_map.krx_listing,
        "stock_listing",
        lambda _m: pd.DataFrame({"Code": ["005930"], "Industry": ["반도체 제조업"]}),
    )
    assert market_map._get_industry_map() == {"005930": "반도체 제조업"}
    market_map.cache.invalidate("krx_industry_map")
