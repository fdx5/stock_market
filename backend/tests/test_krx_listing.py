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

    def json(self):
        import json
        return json.loads(self.content)


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


def test_an_unreadable_industry_map_preserves_classifications(monkeypatch):
    """A cold start during an upstream outage must not group every stock as 기타."""
    market_map.cache.invalidate("krx_industry_map")

    def boom(_market):
        raise RuntimeError("snapshot repo is down")

    monkeypatch.setattr(market_map.krx_listing, "stock_listing", boom)

    fallback = market_map._get_industry_map()
    assert len(fallback) > 2500
    assert market_map._resolve_sector("005930", fallback) == "반도체/전자"
    assert market_map._resolve_sector("005935", fallback) == "반도체/전자"
    assert market_map._resolve_sector("247540", fallback) == "배터리"
    assert market_map._resolve_sector("196170", fallback) == "제약/바이오"
    assert market_map._resolve_sector("105560", fallback) == "금융"
    assert market_map._get_etf_codes() == set()
    # Nothing was cached, so the next call retries rather than being pinned to the
    # degraded answer for the entry's 24-hour TTL.
    monkeypatch.setattr(
        market_map.krx_listing,
        "stock_listing",
        lambda _m: pd.DataFrame({"Code": ["005930"], "Industry": ["반도체 제조업"]}),
    )
    recovered = market_map._get_industry_map()
    assert recovered["005930"] == "반도체 제조업"
    assert recovered["247540"] == fallback["247540"]
    market_map.cache.invalidate("krx_industry_map")


def test_industry_publication_older_than_lookback_uses_latest_available(monkeypatch):
    import json
    monkeypatch.setattr(krx_listing, "_latest_work_date", lambda: dt.date(2026, 10, 2))
    listing = {"tree": [
        {"path": "data/listing/desc/2026-09-16.csv", "type": "blob"},
        {"path": "data/listing/desc/2026-09-17.csv", "type": "blob"},
        {"path": "data/listing/desc/2026-10-03.csv", "type": "blob"},
        {"path": "data/listing/krx/2026-10-02.csv", "type": "blob"},
    ]}
    csv = b",Code,Industry,Market,ListingDate\n0,005930,semiconductor,KOSPI,1975-06-11\n"
    asked = []

    def fake_get(url, **kwargs):
        asked.append(url)
        if url == krx_listing._TREE_URL:
            return _Response(200, json.dumps(listing).encode())
        return _Response(200, csv) if url.endswith("2026-09-17.csv") else _Response(404)

    monkeypatch.setattr(krx_listing.requests, "get", fake_get)
    df = krx_listing.stock_listing("KOSPI-DESC")
    assert list(df["Code"]) == ["005930"]
    assert asked[-1].endswith("2026-09-17.csv")
    assert pd.api.types.is_datetime64_any_dtype(df["ListingDate"])


def test_blank_live_industries_do_not_poison_cache(monkeypatch):
    market_map.cache.invalidate("krx_industry_map")
    monkeypatch.setattr(market_map.krx_listing, "stock_listing", lambda _: pd.DataFrame({
        "Code": ["005930", "000660"], "Industry": [None, " "]}))
    result = market_map._get_industry_map()
    assert market_map._resolve_sector("000660", result) == "반도체/전자"
    assert market_map.cache.peek("krx_industry_map") is None


@pytest.mark.parametrize("market,market_id,code", [("kospi", "STK", "005930"), ("kosdaq", "KSQ", "247540")])
def test_market_map_falls_back_to_krx_when_naver_returns_no_rows(monkeypatch, market, market_id, code):
    """Naver's legacy market-cap HTML can become an empty page after a redirect."""
    monkeypatch.setattr(market_map, "_get_price_snapshot", lambda *args, **kwargs: [])
    monkeypatch.setattr(market_map, "_get_industry_map", lambda: {code: "반도체 제조업"})
    monkeypatch.setattr(market_map, "_get_etf_codes", lambda: set())
    monkeypatch.setattr(market_map, "get_stock_quotes_bulk", lambda codes: {})
    monkeypatch.setattr(
        market_map.krx_listing,
        "stock_listing",
        lambda requested: pd.DataFrame(
            {
                "Code": [code, "999999"],
                "Name": ["테스트 종목", "다른 시장"],
                "MarketId": [market_id, "KSQ" if market_id == "STK" else "STK"],
                "Close": [1000, 2000],
                "Changes": [10, 20],
                "ChagesRatio": [1.0, 2.0],
                "Marcap": [1000000, 2000000],
                "Volume": [100, 200],
            }
        ),
    )

    rows = market_map._get_market_map(market, 0 if market == "kospi" else 1, 50)

    assert [row["code"] for row in rows] == [code]
    assert rows[0]["close"] == 1000
