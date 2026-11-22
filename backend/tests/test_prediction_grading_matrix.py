import sqlite3

import pytest

from app.services import prediction_store


@pytest.mark.parametrize(
    ("markets", "expected_dates", "expected_codes"),
    [
        (None, ["20261118", "20261117"], ["000001", "000002", "ABC"]),
        (("KOSPI",), ["20261117", "20261116"], ["000002", "000001"]),
        (("KOSPI", "NASDAQ"), ["20261118", "20261117"], ["000001", "000002", "ABC"]),
        (("KOSDAQ",), [], []),
    ],
)
def test_grading_matrix_reads_one_session_window(monkeypatch, markets, expected_dates, expected_codes):
    with sqlite3.connect(":memory:") as conn:
        conn.executescript(prediction_store._SCHEMA)
        for index in prediction_store._INDEXES:
            conn.execute(index)
        records = [
            ("000001", "KOSPI", "20261119", None, 100),  # Pending-only session.
            ("ABC", "NASDAQ", "20261118", 1, 200),
            ("000001", "KOSPI", "20261118", None, 100),
            ("000001", "KOSPI", "20261117", 0, 20),
            ("000002", "KOSPI", "20261117", 1, 50),
            ("000001", "KOSPI", "20261116", 1, 100),
        ]
        conn.executemany(
            "INSERT INTO stock_predictions (collect_date, predict_date, stock_code, stock_name, market, "
            "predict_result, base_price, predict_price, change_rate, score, confidence, detail, "
            "created_at, updated_at, hit, market_cap) "
            "VALUES (?, ?, ?, ?, ?, '상승', 100, 101, 1, 1, 'high', '', '', '', ?, ?)",
            [(day, day, code, code, market, hit, cap) for code, market, day, hit, cap in records],
        )
        statements = []
        conn.set_trace_callback(statements.append)
        monkeypatch.setattr(prediction_store, "_with_connection", lambda run: run(conn))

        matrix = prediction_store.grading_matrix(markets, limit_dates=2)

    selects = [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]
    assert len(selects) == 1
    assert matrix["dates"] == expected_dates
    assert [row["code"] for row in matrix["rows"]] == expected_codes
    by_code = {row["code"]: row["cells"] for row in matrix["rows"]}
    if "000001" in by_code:
        assert by_code["000001"]["20261117"]["hit"] is False
        if "20261118" in expected_dates:
            assert by_code["000001"]["20261118"]["hit"] is None
