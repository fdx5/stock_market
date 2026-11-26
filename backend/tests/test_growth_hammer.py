"""Repeat single-page cohorts that borrow common Chrome strings (fresh temp DB only)."""
from datetime import datetime, timedelta, timezone

from app.services import growth_control as gc
from app.services import page_view_store as pvs

CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"


def _add(conn, session, path, when, ua=CHROME, referrer=None, channel="direct"):
    conn.execute(
        "INSERT INTO page_views (session_id, path, created_at, event_type, referrer, source_channel, user_agent, is_bot, device_type) "
        "VALUES (?, ?, ?, 'page_view', ?, ?, ?, 0, 'desktop')",
        (session, path, when.astimezone(timezone.utc).isoformat(), referrer, channel, ua))


def test_hammer_on_a_shared_chrome_string_is_set_aside_per_page(monkeypatch, tmp_path):
    monkeypatch.setattr(pvs, "TURSO_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(pvs, "LOCAL_DB_PATH", tmp_path / "pv.db")
    monkeypatch.setattr(pvs, "_conn", None)
    day = (datetime.now(pvs.KST) - timedelta(days=1)).date()
    noon = datetime.combine(day, datetime.min.time(), pvs.KST) + timedelta(hours=12)

    def seed(conn):
        # crawler: 60 one-page visits over many codes of one guide page, no referrer
        for i in range(60):
            ref = None if i % 3 == 0 else f"https://kospimap.com/bond-tradeoffs?code={100000 + i:06d}&market=kospi"
            _add(conn, f"c{i}", "/bond-tradeoffs", noon + timedelta(seconds=i), referrer=ref)
        # people on the same Chrome string: 25 bookmark visits to "/" (10 read on), 8 from search
        for i in range(25):
            _add(conn, f"h{i}", "/", noon + timedelta(minutes=i))
            if i < 10:
                _add(conn, f"h{i}", "/map", noon + timedelta(minutes=i, seconds=20))
        for i in range(8):
            _add(conn, f"s{i}", "/bond-tradeoffs", noon, referrer="https://www.google.com/", channel="search")
        conn.commit()
    pvs._with_connection(seed)
    m = pvs._with_connection(lambda conn: gc.compute_day(conn, day.isoformat()))
    assert m["suspected"]["sessions"] == 60
    assert m["sessions"] == 33                      # 25 bookmark + 8 search people kept
    assert any("repeat_single_page_cohort" in a["signals"] for a in m["suspected"]["agents"])
    assert sum(h[2] for h in m["hourly"]) == 33
