import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.data import orderbook_fetcher as book


def serve(monkeypatch, data):
    response = Mock()
    response.json.return_value = data
    get = Mock(return_value=response)
    monkeypatch.setattr(book._session, "get", get)
    return get, response


def test_json_ladder_matches_display_order_and_totals(monkeypatch):
    data = {"itemCode": "005930", "totalSellVolume": "1,234", "totalBuyVolume": "567"}
    for i in range(1, 11):
        data[f"hoga{i}"] = f"{286000 + i * 500}: {286500 - i * 500}:{i * 10}:{i * 20}"
    get, _ = serve(monkeypatch, data)
    result = book.get_orderbook("005930")
    assert result["available"] is True
    assert len(result["asks"]) == len(result["bids"]) == 10
    assert result["asks"][0] == {"price": 291000, "qty": 100}
    assert result["asks"][-1] == {"price": 286500, "qty": 10}
    assert result["bids"][0] == {"price": 286000, "qty": 20}
    assert result["total_ask_qty"] == 1234
    assert result["total_bid_qty"] == 567
    assert "/api/domestic/detail/005930/hoga" in get.call_args.args[0]


@pytest.mark.parametrize("raw", ["", None, "00000000:00000000:00000000:00000000"])
def test_empty_ladder_is_unavailable(monkeypatch, raw):
    serve(monkeypatch, {"itemCode": "005930", "hoga1": raw})
    result = book.get_orderbook("005930")
    assert result["available"] is False
    assert result["asks"] == result["bids"] == []


@pytest.mark.parametrize("data", [
    {}, [], {"itemCode": "000660", "hoga1": "1:2:3:4"},
    {"itemCode": "005930", "hoga1": "1:2:3"},
    {"itemCode": "005930", "hoga1": "bad:2:3:4"},
    {"itemCode": "005930", "hoga1": "-1:2:3:4"},
])
def test_invalid_payload_raises_so_cache_keeps_good_ladder(monkeypatch, data):
    serve(monkeypatch, data)
    with pytest.raises(ValueError):
        book.get_orderbook("005930")


def test_upstream_failure_is_not_cached_as_empty(monkeypatch):
    _, response = serve(monkeypatch, {})
    response.raise_for_status.side_effect = requests.HTTPError("upstream unavailable")
    with pytest.raises(requests.HTTPError):
        book.get_orderbook("005930")
