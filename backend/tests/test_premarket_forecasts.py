import datetime as dt
import sqlite3

import pytest

from app.services import prediction_store, trading_calendar


@pytest.mark.parametrize(
    ("region", "utc_now", "expected_cutoff"),
    [
        ("KR", "2026-11-22T22:59:59+00:00", "2026-11-22T23:00:00+00:00"),
        ("KR", "2026-11-22T23:00:00+00:00", None),
        ("KR", "2026-11-23T10:59:59+00:00", None),
        ("KR", "2026-11-23T11:00:00+00:00", "2026-11-23T23:00:00+00:00"),
        ("KR", "2026-12-25T00:00:00+00:00", "2026-12-27T23:00:00+00:00"),
        ("US", "2026-07-06T07:59:59+00:00", "2026-07-06T08:00:00+00:00"),
        ("US", "2026-07-06T08:00:00+00:00", None),
        ("US", "2026-11-23T08:59:59+00:00", "2026-11-23T09:00:00+00:00"),
        ("US", "2026-11-23T09:00:00+00:00", None),
        ("US", "2026-11-26T17:00:00+00:00", "2026-11-27T09:00:00+00:00"),
    ],
)
def test_premarket_window(region, utc_now, expected_cutoff):
    session = trading_calendar.upcoming_premarket(region, dt.datetime.fromisoformat(utc_now))
    if expected_cutoff is None:
        assert session is None
    else:
        day, cutoff = session
        assert day == cutoff.date()
        assert cutoff.astimezone(dt.timezone.utc) == dt.datetime.fromisoformat(expected_cutoff)


def test_cards_and_popup_use_the_same_upcoming_session(monkeypatch):
    with sqlite3.connect(":memory:") as conn:
        conn.executescript(prediction_store._SCHEMA)
        for index in prediction_store._INDEXES:
            conn.execute(index)
        conn.executemany(
            "INSERT INTO stock_predictions (stock_code, market, market_cap, collect_date, "
            "predict_date, hit, stock_name, score, detail, predict_result, base_price, "
            "predict_price, change_rate, confidence, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '상승', 100, 101, 1, '중', '', '')",
            [
                *[
                    (str(i), "KOSPI", i, "20261120", "20261123", None, f"Stock {i}", 1, f"Detail {i}")
                    for i in range(1, 11)
                ],
                ("10", "KOSPI", 10, "20261119", "20261123", None, "Older 10", 1, "Older detail"),
                ("40", "KOSPI", 100, "20261118", "20261123", 1, "Graded", 1, "Graded detail"),
                ("50", "KOSPI", 200, "20261118", "20261119", None, "Old session", 1, "Old session detail"),
                ("21", "KOSDAQ", 1, "20261120", "20261123", None, "Kosdaq", 1, "Kosdaq detail"),
                ("ABC", "NASDAQ", 1, "20261118", "20261119", None, "Nasdaq", 1, "Nasdaq detail"),
            ],
        )
        monkeypatch.setattr(prediction_store, "_with_connection", lambda run: run(conn))

        groups = prediction_store.premarket_cards({
            "KOSPI": "20261123", "KOSDAQ": "20261123", "NASDAQ": "20261119",
        })
        assert [item["code"] for item in groups["KOSPI"]] == ["10", "9", "8", "7", "6", "5", "4", "3"]
        assert [item["code"] for item in groups["KOSDAQ"]] == ["21"]
        assert [item["code"] for item in groups["NASDAQ"]] == ["ABC"]
        preview = groups["KOSPI"][0]
        assert preview["name"] == "Stock 10"
        assert "detail" not in preview

        detail = prediction_store.session_prediction(preview["code"], "KOSPI", "20261123")
        assert detail["name"] == preview["name"]
        assert detail["detail"] == "Detail 10"
        assert prediction_store.session_prediction(preview["code"], "KOSDAQ", "20261123") is None
