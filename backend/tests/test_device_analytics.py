"""All analytics tests use an isolated SQLite DB, never the configured Turso."""
import importlib
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import device_analytics as devices

NOW = datetime(2026, 9, 30, 4, tzinfo=timezone.utc)
WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15 Safari/604.1"


@pytest.fixture
def store(tmp_path, monkeypatch):
    module = importlib.import_module("app.services.page_view_store")
    monkeypatch.setattr(module, "TURSO_DATABASE_URL", None)
    monkeypatch.setattr(module, "LOCAL_DB_PATH", tmp_path / "visits.db")
    monkeypatch.setattr(module, "_conn", None)
    yield module
    if module._conn:
        module._conn.close()
        module._conn = None


def record(store, stamp, ua=WINDOWS, **kw):
    store.record_page_view("test", "/", stamp, user_agent=ua, **kw)


@pytest.mark.parametrize("ua,hints,expected", [
    (WINDOWS, None, ("desktop", "Windows PC", "Windows", "Chrome")),
    (IPHONE, None, ("mobile", "Apple iPhone", "iOS", "Safari")),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605", {"ipad": True}, ("tablet", "Apple iPad", "iPadOS", "Safari")),
    ("Mozilla/5.0 (Linux; Android 14; SM-S928N Build/X) Chrome/140 Mobile Safari/537", None, ("mobile", "Samsung · SM-S928N", "Android", "Chrome")),
    ("Mozilla/5.0 (Linux; Android 14; SM-X810) Chrome/140 Safari/537", None, ("tablet", "Samsung · SM-X810", "Android", "Chrome")),
    ("Mozilla/5.0 (Linux; Android 10; K) Chrome/140 Mobile Safari/537", {"model": "SM-S928N", "mobile": True}, ("mobile", "Samsung · SM-S928N", "Android", "Chrome")),
    ("Mozilla/5.0 (Linux; Android 10; K) Chrome/140 Mobile Safari/537", None, ("mobile", "Android 휴대폰 · 모델 미공개", "Android", "Chrome")),
    (None, None, ("unknown", "기기 미확인", "미확인", "미확인")),
])
def test_classification(ua, hints, expected):
    assert devices.classify(ua, hints) == expected


def test_rollup_kst_bot_click_and_idempotence(store):
    record(store, "2026-09-28T14:59:59+00:00")  # Sep 28 KST
    record(store, "2026-09-28T15:00:00+00:00", IPHONE)  # Sep 29 KST
    record(store, "2026-09-29T15:00:00+00:00", None)  # Sep 30 KST
    record(store, "2026-09-29T01:00:00+00:00", is_bot=True)
    record(store, "2026-09-29T01:00:00+00:00", event_type="click")
    assert devices.aggregate_pending_days(now=NOW) == 2
    assert devices.aggregate_pending_days(now=NOW) == 0
    result = devices.overview(2, NOW)
    assert result["total"] == 2
    assert result["history_ready"]
    assert result["coverage_percentage"] == 50
    assert {r["type"]: r["count"] for r in result["types"]} == {"desktop": 0, "mobile": 1, "tablet": 0, "unknown": 1}
    assert devices.overview(3, NOW)["total"] == 3
    assert devices.overview(1, NOW)["total"] == 1


def test_legacy_ua_partial_empty_days_and_retention(store):
    record(store, "2026-09-26T03:00:00+00:00", IPHONE)
    store._with_connection(lambda c: (c.execute("UPDATE page_views SET device_type=NULL,device_name=NULL,device_os=NULL,device_browser=NULL"), c.commit()))
    assert not devices.retention_safe("2026-09-27T00:00:00+00:00")
    assert devices.aggregate_pending_days(max_days=1, now=NOW) == 1
    partial = devices.overview(7, NOW)
    assert not partial["history_ready"] and partial["missing_days"] == 3
    assert partial["total"] == 0
    assert devices.aggregate_pending_days(now=NOW) == 3
    assert devices.overview(7, NOW)["total"] == 1
    assert devices.retention_safe("2026-09-27T00:00:00+00:00")
    store.purge_older_than("2026-09-27T00:00:00+00:00")
    store._conn.close()
    store._conn = None  # simulate process restart: historical rollups survive raw expiry
    assert devices.aggregate_pending_days(now=NOW) == 0
    assert devices.overview(7, NOW)["total"] == 1


def test_api_never_reads_historical_raw_and_uses_index(store):
    record(store, "2026-09-29T03:00:00+00:00")
    devices.aggregate_pending_days(now=NOW)
    queries = []
    store._conn.set_trace_callback(queries.append)
    assert devices.overview(730, NOW)["total"] == 1
    raw = [q for q in queries if "FROM page_views " in q]
    assert len(raw) == 1
    assert "2026-09-29T15:00:00" in raw[0] and "2026-09-30T15:00:00" in raw[0]
    plan = store._conn.execute("EXPLAIN QUERY PLAN " + raw[0]).fetchall()
    assert any("SEARCH page_views USING INDEX" in r[3] for r in plan)
    assert not any("SCAN page_views" in r[3] for r in plan)


def test_late_visit_invalidates_and_rebuild_removes_obsolete_dimensions(store):
    record(store, "2026-09-28T03:00:00+00:00")
    devices.aggregate_pending_days(now=NOW)
    assert devices.overview(7, NOW)["total"] == 1
    record(store, "2026-09-28T04:00:00+00:00", IPHONE)
    partial = devices.overview(7, NOW)
    assert partial["missing_days"] == 1 and partial["total"] == 0
    store._with_connection(lambda c: (c.execute("UPDATE page_views SET is_bot=1 WHERE device_type='desktop'"), c.commit()))
    assert devices.aggregate_pending_days(now=NOW) == 1
    result = devices.overview(7, NOW)
    assert result["total"] == 1 and result["history_ready"]
    assert result["devices"][0]["name"] == "Apple iPhone"
    assert len(result["devices"]) == 1


def test_bounded_dimensions_keep_all_counts(store):
    for i in range(40):
        record(store, "2026-09-30T03:00:00+00:00", "Android 14 Mobile Chrome/140", device_info={"model": f"SM-S{i}"})
    result = devices.overview(1, NOW)
    assert len(result["devices"]) == 26
    assert sum(r["count"] for r in result["devices"]) == result["total"] == 40
    assert result["devices"][-1]["count"] == 15


def test_interrupted_remote_style_writes_never_publish_partial_day(store, monkeypatch):
    record(store, "2026-09-29T03:00:00+00:00")
    original = store._with_connection

    class AutoCommitProxy:
        def execute(self, sql, parameters=()):
            if parameters and "_complete" in parameters and sql.startswith("INSERT"):
                raise RuntimeError("simulated completion write failure")
            cursor = store._conn.execute(sql, parameters)
            store._conn.commit()  # emulate remote independently committed requests
            return cursor

        def commit(self):
            store._conn.commit()

    with monkeypatch.context() as context:
        context.setattr(store, "_with_connection", lambda fn: fn(AutoCommitProxy()))
        with pytest.raises(RuntimeError):
            devices.aggregate_pending_days(now=NOW)
    partial = devices.overview(7, NOW)
    assert partial["total"] == 0 and not partial["history_ready"]
    assert devices.aggregate_pending_days(now=NOW) == 1
    assert devices.overview(7, NOW)["total"] == 1
    assert store._with_connection == original


def test_admin_endpoint_auth_validation_and_cached_response(store, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routers import admin
    from app.services import admin_auth, admin_query_cache

    app = FastAPI()
    app.include_router(admin.router, prefix="/api/admin")
    client = TestClient(app)
    assert client.get("/api/admin/traffic/devices").status_code == 401
    app.dependency_overrides[admin_auth.require_admin] = lambda: None
    calls = []
    monkeypatch.setattr(devices, "overview", lambda days: calls.append(days) or {"days": days, "total": 123})
    with admin_query_cache._lock:
        admin_query_cache._entries.clear()
    assert client.get("/api/admin/traffic/devices?days=0").status_code == 422
    assert client.get("/api/admin/traffic/devices?days=731").status_code == 422
    for _ in range(2):
        assert client.get("/api/admin/traffic/devices?days=30").json() == {"days": 30, "total": 123}
    assert calls == [30]
    with admin_query_cache._lock:
        admin_query_cache._entries.clear()


def test_delayed_arrival_during_materialization_cannot_seal_wrong_snapshot(store, monkeypatch):
    record(store, "2026-09-29T03:00:00+00:00")
    original = devices._groups
    def arrival(conn, day):
        snapshot = original(conn, day)
        conn.execute("INSERT INTO page_views(session_id,path,created_at,event_type,user_agent,is_bot) VALUES('late','/','2026-09-29T04:00:00+00:00','page_view',?,0)", (IPHONE,))
        conn.commit()
        return snapshot
    with monkeypatch.context() as context:
        context.setattr(devices, "_groups", arrival)
        devices.aggregate_pending_days(now=NOW)
    assert devices.overview(2, NOW)["missing_days"] == 1
    assert devices.overview(2, NOW)["total"] == 0
    devices.aggregate_pending_days(now=NOW)
    assert devices.overview(2, NOW)["total"] == 2


def test_activity_contract_accepts_old_clients_and_validates_new_hints(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routers import activity
    from app.services import activity_log

    calls = []
    monkeypatch.setattr(activity_log, "record_event", lambda **kw: calls.append(kw))
    app = FastAPI()
    app.include_router(activity.router, prefix="/api/activity")
    client = TestClient(app)
    body = {"session_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "type": "page_view", "path": "/"}
    for extra in [{}, {"device_info": {"model": "SM-S928N", "platform": "Android", "mobile": True}}]:
        assert client.post("/api/activity/event", json={**body, **extra}, headers={"user-agent": WINDOWS}).status_code == 200
    assert calls[0]["device_info"] is None
    assert calls[1]["device_info"]["model"] == "SM-S928N"
    assert calls[1]["device_info"]["mobile"] is True
    assert client.post("/api/activity/event", json={**body, "device_info": {"model": "x" * 81}}).status_code == 422


@pytest.mark.parametrize("days", [0, -1, 731])
def test_invalid_window(days):
    with pytest.raises(ValueError):
        devices.overview(days, NOW)
