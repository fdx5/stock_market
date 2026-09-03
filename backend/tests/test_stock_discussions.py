from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.routers import stock  # noqa: E402


def test_discussions_deduplicates_codes_and_preserves_first_seen_order(monkeypatch):
    monkeypatch.setattr(
        stock.board_fetcher,
        "get_board_posts",
        lambda code, page: [{"nid": f"{code}-1"}, {"nid": f"{code}-2"}],
    )
    monkeypatch.setattr(stock, "get_stock_name", lambda code: {"005930": "삼성전자", "000660": "SK하이닉스"}[code])

    response = stock.discussions("005930, 000660,005930", limit=1)

    assert list(response["items"]) == ["005930", "000660"]
    assert response["items"]["005930"] == {"name": "삼성전자", "posts": [{"nid": "005930-1"}]}


@pytest.mark.parametrize("codes", ["AAPL", "00593", "005930<script>"])
def test_discussions_rejects_non_krx_codes(codes):
    with pytest.raises(HTTPException) as error:
        stock.discussions(codes, limit=1)
    assert error.value.status_code == 400


def test_discussions_ignores_empty_segments(monkeypatch):
    monkeypatch.setattr(stock.board_fetcher, "get_board_posts", lambda code, page: [])
    monkeypatch.setattr(stock, "get_stock_name", lambda code: code)
    assert list(stock.discussions("005930,", limit=1)["items"]) == ["005930"]


def test_discussions_rejects_more_than_the_endpoint_ceiling():
    codes = ",".join(f"{index:06d}" for index in range(stock.DISCUSSIONS_MAX_CODES + 1))
    with pytest.raises(HTTPException) as error:
        stock.discussions(codes, limit=1)
    assert error.value.status_code == 400


def test_discussions_keeps_a_quiet_or_failed_board_empty(monkeypatch):
    monkeypatch.setattr(stock.board_fetcher, "get_board_posts", lambda code, page: [])
    monkeypatch.setattr(stock, "get_stock_name", lambda code: None)

    assert stock.discussions("005930", limit=5)["items"]["005930"] == {
        "name": "005930",
        "posts": [],
    }
