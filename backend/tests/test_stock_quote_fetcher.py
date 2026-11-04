from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.data import stock_quote_fetcher as fetcher  # noqa: E402
from app.data.stock_quote_fetcher import _quote_from_data  # noqa: E402


def _payload(status: str = "PREOPEN") -> dict:
    return {
        "itemCode": "005930",
        "stockName": "삼성전자",
        "marketStatus": status,
        "closePriceRaw": "250500",
        "compareToPreviousClosePriceRaw": "0",
        "fluctuationsRatioRaw": "0.00",
        "marketValueFullRaw": "1495426000000000",
        "accumulatedTradingVolumeRaw": "",
        "accumulatedTradingValueRaw": "",
        "openPriceRaw": "0",
        "highPriceRaw": "0",
        "lowPriceRaw": "0",
        "overMarketPriceInfo": {
            "overPrice": "255,000",
            "compareToPreviousClosePrice": "4,500",
            "fluctuationsRatio": "1.80",
            "accumulatedTradingVolumeRaw": "1318174",
            "accumulatedTradingValueRaw": "335277000000",
        },
    }


def test_pre_market_uses_one_consistent_nxt_tape():
    quote = _quote_from_data(_payload())

    assert quote["close"] == 255000
    assert quote["change_pct"] == 1.8
    assert quote["volume"] == 1_318_174
    assert quote["turnover"] == 335_277_000_000


def test_regular_market_does_not_mix_in_nxt_fields():
    payload = _payload("OPEN")
    payload["accumulatedTradingVolumeRaw"] = "777"
    payload["accumulatedTradingValueRaw"] = "888000"

    quote = _quote_from_data(payload)

    assert quote["close"] == 250500
    assert quote["volume"] == 777
    assert quote["turnover"] == 888000


def test_closed_after_market_preserves_nxt_price_and_its_trade_time():
    payload = _payload("CLOSE")
    payload["localTradedAt"] = "2026-11-04T15:30:00+09:00"
    payload["overMarketPriceInfo"].update({
        "overMarketStatus": "CLOSE", "localTradedAt": "2026-11-04T20:00:00+09:00",
        "overPrice": "287,500", "fluctuationsRatio": "3.60",
    })
    quote = _quote_from_data(payload)
    assert quote["close"] == 287500 and quote["change_pct"] == 3.60
    assert quote["quote_time"] == fetcher.datetime.fromisoformat("2026-11-04T20:00:00+09:00").timestamp()
    assert quote["quote_source"] == "naver_nxt"
    payload["marketStatus"] = "OPEN"
    assert _quote_from_data(payload)["quote_source"] == "naver_regular"
    assert _quote_from_data(payload)["quote_time"] < quote["quote_time"]


def test_bad_row_does_not_discard_the_rest_of_a_quote_batch(monkeypatch):
    class Response:
        def raise_for_status(self): pass
        def json(self): return {"datas": [{"itemCode": "BAD"}, _payload()]}
    monkeypatch.setattr(fetcher.requests, "get", lambda *args, **kwargs: Response())
    result = fetcher._fetch_quotes_chunk(["BAD", "005930"])
    assert list(result) == ["005930"]
    assert result["005930"]["close"] == 255000
