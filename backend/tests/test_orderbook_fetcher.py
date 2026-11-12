import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.data import orderbook_fetcher as book


def responses(*payloads):
    out = []
    for data in payloads:
        response = Mock()
        if isinstance(data, Exception):
            response.raise_for_status.side_effect = data
        else:
            response.json.return_value = data
        out.append(response)
    return out


def serve(monkeypatch, *payloads):
    get = Mock(side_effect=responses(*payloads))
    monkeypatch.setattr(book._session, "get", get)
    return get


def order_book(code="005930", levels=10):
    return {
        "itemCode": code, "basePrice": "206000", "totalAskVolume": "1,234", "totalBidVolume": "567",
        "askLevels": [{"price": str(291000 - i * 500), "volume": str((10 - i) * 10)} for i in range(levels)],
        "middleLevel": {"price": "0.0", "askVolume": "0", "bidVolume": "0"},
        "bidLevels": [{"price": str(286000 - i * 500), "volume": str((i + 1) * 20)} for i in range(levels)],
    }


def test_order_book_ladder_matches_display_order_and_totals(monkeypatch):
    get = serve(monkeypatch, order_book())
    result = book.get_orderbook("005930")
    assert result["available"] is True
    assert len(result["asks"]) == len(result["bids"]) == 10
    assert result["asks"][0] == {"price": 291000, "qty": 100}
    assert result["asks"][-1] == {"price": 286500, "qty": 10}
    assert result["bids"][0] == {"price": 286000, "qty": 20}
    assert result["total_ask_qty"] == 1234
    assert result["total_bid_qty"] == 567
    assert "/api/stockSecurity/items/v2/domestic/005930/order-book" in get.call_args.args[0]


def test_empty_ladder_is_unavailable(monkeypatch):
    serve(monkeypatch, {"itemCode": "005930", "askLevels": [{"price": "", "volume": "0"}], "bidLevels": []})
    result = book.get_orderbook("005930")
    assert result["available"] is False
    assert result["asks"] == result["bids"] == []


def test_primary_failure_falls_back_to_mobile_asking_price(monkeypatch):
    mobile = {"totalSell": "4,445", "totalBuy": "19,107",
              "sellInfo": [{"price": "", "count": "0"}, {"price": "208,500", "count": "619"}, {"price": "208,000", "count": "3,662"}],
              "buyInfos": [{"price": "207,000", "count": "5,897"}, {"price": "", "count": "0"}]}
    get = serve(monkeypatch, requests.HTTPError("404"), mobile)
    result = book.get_orderbook("005930")
    assert result["asks"] == [{"price": 208500, "qty": 619}, {"price": 208000, "qty": 3662}]
    assert result["bids"] == [{"price": 207000, "qty": 5897}]
    assert result["total_ask_qty"] == 4445
    assert "m.stock.naver.com/api/stock/005930/askingPrice" in get.call_args.args[0]


@pytest.mark.parametrize("data", [
    {}, [], {**order_book(), "itemCode": "000660"},
    {"itemCode": "005930", "askLevels": "x", "bidLevels": []},
    {"itemCode": "005930", "askLevels": [{"price": "bad", "volume": "1"}], "bidLevels": []},
    {"itemCode": "005930", "askLevels": [{"price": "-1", "volume": "1"}], "bidLevels": []},
])
def test_invalid_payload_raises_so_cache_keeps_good_ladder(monkeypatch, data):
    serve(monkeypatch, data, {})
    with pytest.raises(ValueError):
        book.get_orderbook("005930")


def test_upstream_failure_is_not_cached_as_empty(monkeypatch):
    serve(monkeypatch, requests.HTTPError("upstream unavailable"), requests.HTTPError("mobile down"))
    with pytest.raises(requests.HTTPError):
        book.get_orderbook("005930")
