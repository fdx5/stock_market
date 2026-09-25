from datetime import datetime, timedelta, timezone

from app.services import page_view_store as pvs


def _use_temp_db(monkeypatch, tmp_path):
    monkeypatch.setattr(pvs, "TURSO_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(pvs, "LOCAL_DB_PATH", tmp_path / "pv.db")
    monkeypatch.setattr(pvs, "_conn", None)


def _add(conn, session, path, when, is_bot=0, event="page_view"):
    conn.execute(
        "INSERT INTO page_views (session_id, path, created_at, event_type, is_bot) VALUES (?, ?, ?, ?, ?)",
        (session, path, when.astimezone(timezone.utc).isoformat(), event, is_bot),
    )


def test_daily_trend_matches_the_raw_bucket_queries(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    now = datetime.now(pvs.KST).replace(hour=12, minute=0, second=0, microsecond=0)
    if datetime.now(pvs.KST) < now:
        now = datetime.now(pvs.KST)

    def seed(conn):
        for d in range(0, 5):
            day = now - timedelta(days=d)
            _add(conn, f"s{d}", "/desk", day)
            _add(conn, f"s{d}", "/map", day, event="click")
            _add(conn, f"t{d}", "/desk", day)
            _add(conn, "bot", "/desk", day, is_bot=1)
        conn.commit()

    pvs._with_connection(seed)
    views, visitors = pvs.daily_trend(3)

    since = (datetime.combine((now - timedelta(days=2)).date(), datetime.min.time(), pvs.KST)).astimezone(timezone.utc)
    raw_views = pvs.counts_by_bucket(since.isoformat(), "day")
    raw_visitors = pvs.unique_visitors_by_bucket(since.isoformat(), "day")
    key = lambda p: (p["bucket"], p.get("path", ""))
    assert sorted(views, key=key) == sorted(raw_views, key=key)
    assert visitors == raw_visitors
    assert len(visitors) == 3

    # The closed days are now rolled up and read without touching page_views.
    assert pvs.ensure_trend_rollups(4) == 2  # the two older closed days not yet read
    assert pvs.ensure_trend_rollups(4) == 0
