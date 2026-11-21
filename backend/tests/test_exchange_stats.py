from datetime import datetime, timedelta, timezone

from app.services import page_view_store as pvs


def _use_temp_db(monkeypatch, tmp_path):
    monkeypatch.setattr(pvs, "TURSO_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(pvs, "LOCAL_DB_PATH", tmp_path / "pv.db")
    monkeypatch.setattr(pvs, "_conn", None)


def test_exchange_stats_counts_visits_and_actions(monkeypatch, tmp_path):
    _use_temp_db(monkeypatch, tmp_path)
    now = datetime.now(timezone.utc)

    def seed(conn):
        rows = [
            ("a", "/exchange", "page_view", None, None, 0),
            ("a", "/exchange", "click", "exchange:3d:webgpu", "증권 거래소 · 3D 입장 WEBGPU", 0),
            ("a", "/exchange", "click", "exchange:panel:treemap", "증권 거래소 · 관제 화면 · 시장 지도", 0),
            ("b", "/exchange", "page_view", None, None, 0),
            ("b", "/", "click", "exchange:entry:menu", "증권 거래소 · 메뉴", 0),
            ("b", "/exchange", "click", "exchange:panel:treemap", "증권 거래소 · 관제 화면 · 시장 지도", 0),
            ("bot", "/exchange", "page_view", None, None, 1),
            ("c", "/hot-issues", "click", "hotissue:open", "x", 0),
        ]
        for i, (session, path, event, key, label, bot) in enumerate(rows):
            conn.execute(
                "INSERT INTO page_views (session_id, path, created_at, event_type, object_key, label, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (session, path, (now - timedelta(minutes=i)).isoformat(), event, key, label, bot))
        conn.commit()

    pvs._with_connection(seed)
    stats = pvs.exchange_stats((now - timedelta(days=1)).isoformat())
    assert stats["views"] == 2 and stats["sessions"] == 2
    actions = {a["action"]: (a["count"], a["sessions"]) for a in stats["actions"]}
    assert actions == {"panel:treemap": (2, 2), "3d:webgpu": (1, 1), "entry:menu": (1, 1)}
    assert sum(day["actions"] for day in stats["trend"]) == 4
    assert all(r["action"] == "view" or not r["action"].startswith("hotissue") for r in stats["recent"])
