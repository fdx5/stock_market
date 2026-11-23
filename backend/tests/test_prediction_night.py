"""Pre-open KOSPI200 night-futures revision. Runs only against a fresh in-memory DB."""

import datetime as dt
import sqlite3

import pandas as pd
import pytest

from app.services import prediction_features, prediction_night, prediction_store, trading_calendar as cal

KST = cal.KST


def _quote(session="2026-11-20", change=-3.0, live=False, base="day_futures_close", tick="2026-11-21T06:00:00"):
    stamp = dt.datetime.fromisoformat(tick).replace(tzinfo=KST)
    return {
        "close": 730.17, "prev_close": 752.75, "change_pct": change, "session_date": session,
        "source_live": live, "base_source": base, "quote_time": int(stamp.timestamp()),
    }


def _row(code="005930", result="상승", change=1.5, beta=1.2, band=0.6, price=10000.0):
    return {
        "collect_date": "20261120", "predict_date": "20261123", "code": code, "name": code,
        "market": "KOSPI", "result": result, "base_price": price, "predict_price": price * (1 + change / 100),
        "change_rate": change, "score": 0.3, "confidence": "중",
        "detail": f"근거 문장. [익일 전망: {result} {change:+.2f}%]",
        "prob_up": 60, "prob_flat": 25, "prob_down": 15, "flat_band": band, "reliability": 90.0,
        "reliability_grade": "높음", "reliability_notes": [], "close_change_rate": -1.0,
        "close_summary": "", "evidence": [{"category": "주가", "label": "x", "value": "y", "impact": "neutral"}],
        "market_cap": 1.0, "night_beta": beta, "volatility_pct": 2.0,
        "created_at": "2026-11-20T14:00:00+00:00", "updated_at": "2026-11-20T14:00:00+00:00",
    }


@pytest.fixture
def db(monkeypatch):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute(prediction_store._SCHEMA)
    conn.execute(prediction_store._NIGHT_SCHEMA)
    prediction_store._migrate(conn)
    monkeypatch.setattr(prediction_store, "_with_connection", lambda run: run(conn))
    yield conn
    conn.close()


def test_completed_session_requires_finished_matching_session():
    day = dt.date(2026, 11, 20)
    assert prediction_night.completed_night_session(day, _quote())["change_pct"] == -3.0
    assert prediction_night.completed_night_session(day, _quote(live=True)) is None
    assert prediction_night.completed_night_session(day, _quote(session="2026-11-19")) is None
    assert prediction_night.completed_night_session(day, _quote(base="source_prev_close")) is None
    assert prediction_night.completed_night_session(day, _quote(tick="2026-11-20T23:00:00")) is None
    assert prediction_night.completed_night_session(day, _quote(change=-25.0)) is None


def test_revise_row_follows_night_session_and_keeps_band():
    night = {"change_pct": -3.0}
    rev = prediction_night.revise_row(_row(), night, "now")
    # 0.5*(1.5-0.22)+0.22 + 1.4*(1.2*0.5+0.5)*-3 = 0.86 - 4.62 = -3.76
    assert rev["result"] == "하락"
    assert rev["change_rate"] == pytest.approx(-3.76, abs=0.05)
    assert rev["prob_down"] > rev["prob_up"]
    assert rev["detail"].endswith(f"[익일 전망: 하락 {rev['change_rate']:+.2f}%]")
    assert rev["detail"].count("[익일 전망") == 1
    assert "야간선물 반영" in rev["detail"]
    assert rev["evidence"][0]["category"] == "야간선물"
    # A flat night leaves the evening call's direction alone.
    assert prediction_night.revise_row(_row(), {"change_pct": 0.0}, "now")["result"] == "상승"


def test_revision_preserves_evening_call_and_runs_once(db, monkeypatch):
    prediction_store.upsert_predictions([_row("A"), _row("B", result="하락", change=-1.0, beta=None)])
    monkeypatch.setattr(prediction_night.kospi_night, "get_quote", lambda: _quote(change=2.5))
    now = dt.datetime(2026, 11, 23, 6, 10, tzinfo=KST)

    out = prediction_night.run_revision(now)
    assert out["status"] == "ok" and out["revised"] == 2 and out["night_pct"] == 2.5

    cols = "stock_code, predict_result, change_rate, pre_night_result, pre_night_change_rate, night_fut_pct"
    rows = {r[0]: r for r in db.execute(f"SELECT {cols} FROM stock_predictions").fetchall()}
    assert rows["A"][1] == "상승" and rows["A"][3] == "상승" and rows["A"][4] == 1.5
    assert rows["B"][1] == "상승" and rows["B"][3] == "하락" and rows["B"][4] == -1.0
    assert rows["A"][5] == 2.5
    assert db.execute("SELECT change_pct FROM night_futures_sessions").fetchall() == [(2.5,)]

    again = prediction_night.run_revision(now + dt.timedelta(minutes=5))
    assert again["status"] == "skipped"
    assert db.execute("SELECT pre_night_change_rate FROM stock_predictions WHERE stock_code='B'").fetchone()[0] == -1.0


def test_revision_skips_graded_rows_and_outside_window(db, monkeypatch):
    prediction_store.upsert_predictions([_row("A")])
    db.execute("UPDATE stock_predictions SET hit = 1, graded_at = 'x'")
    monkeypatch.setattr(prediction_night.kospi_night, "get_quote", lambda: _quote())
    assert prediction_night.run_revision(dt.datetime(2026, 11, 23, 6, 10, tzinfo=KST))["status"] == "skipped"
    assert prediction_night.run_revision(dt.datetime(2026, 11, 23, 9, 5, tzinfo=KST))["status"] == "skipped"
    assert prediction_night.run_revision(dt.datetime(2026, 11, 22, 7, 0, tzinfo=KST))["status"] == "skipped"


def test_waits_while_night_session_is_open(db, monkeypatch):
    prediction_store.upsert_predictions([_row("A")])
    monkeypatch.setattr(prediction_night.kospi_night, "get_quote", lambda: _quote(live=True))
    out = prediction_night.run_revision(dt.datetime(2026, 11, 23, 6, 10, tzinfo=KST))
    assert out["status"] == "waiting"
    assert db.execute("SELECT night_applied_at FROM stock_predictions").fetchone()[0] is None


def test_market_beta(monkeypatch):
    dates = pd.date_range("2026-01-01", periods=150, freq="B").strftime("%Y-%m-%d")
    rng = pd.Series(range(150), dtype=float)
    index = 100 * (1 + 0.01 * ((rng % 7) - 3) / 3).cumprod()
    stock = 100 * (1 + 2 * 0.01 * ((rng % 7) - 3) / 3).cumprod()
    monkeypatch.setattr(
        prediction_features, "_beta_index_closes", lambda: pd.Series(index.values, index=dates)
    )
    beta = prediction_features.market_beta(pd.DataFrame({"date": dates, "close": stock.values}))
    assert beta == pytest.approx(2.0, abs=0.05)
