from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.routers import stock  # noqa: E402
from app.data import board_fetcher  # noqa: E402


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


def test_discussions_fills_thirty_posts_from_successive_pages(monkeypatch):
    calls: list[int] = []

    def board_page(_code: str, page: int):
        calls.append(page)
        start = (page - 1) * 20
        return [{"nid": str(index)} for index in range(start, start + 20)]

    monkeypatch.setattr(stock.board_fetcher, "get_board_posts", board_page)
    monkeypatch.setattr(stock, "get_stock_name", lambda code: code)

    posts = stock.discussions("005930", limit=30)["items"]["005930"]["posts"]

    assert len(posts) == 30
    assert posts[-1]["nid"] == "29"
    assert calls == [1, 2]


def test_board_fetcher_reads_naver_mobile_json_board(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "isSuccess": True,
                "result": {
                    "posts": [
                        {
                            "id": "429246424",
                            "title": "삼성전자 토론",
                            "writtenAt": "2026-09-10T21:01:22",
                            "writer": {"nickname": "투자자"},
                            "viewCount": 12,
                            "recommendCount": 3,
                            "notRecommendCount": 1,
                        }
                    ]
                },
            }

    seen = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen["params"] = kwargs["params"]
        return Response()

    monkeypatch.setattr(board_fetcher._session, "get", fake_get)

    assert board_fetcher._fetch_board_page("005930", 1) == [
        {
            "nid": "429246424",
            "title": "삼성전자 토론",
            "date": "2026-09-10T21:01:22",
            "author": "투자자",
            "views": 12,
            "likes": 3,
            "dislikes": 1,
        }
    ]
    assert seen["url"] == board_fetcher.MOBILE_BOARD_URL
    assert seen["params"] == {"discussionType": "domesticStock", "itemCode": "005930", "pageSize": 30}
