"""Location persistence tests use only new, isolated temporary databases."""
import base64
import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.services import audience_analytics as audience, audience_live as live


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIENCE_HMAC_KEY", "test-only-hmac-" * 4)
    monkeypatch.setenv("AUDIENCE_DATABASE_URL", "unused-test")
    monkeypatch.setenv("AUDIENCE_DATABASE_TOKEN", "unused-test")
    monkeypatch.setenv("AUDIENCE_LOCATION_KEY", base64.urlsafe_b64encode(b"test-only-location-key-1234567890!"[:32]).decode())
    conn = sqlite3.connect(tmp_path / "new-live-location.sqlite", check_same_thread=False)
    monkeypatch.setattr(audience, "_conn", conn)
    monkeypatch.setattr(audience, "_schema_ready", False)
    monkeypatch.setattr(live, "_ready", False)
    monkeypatch.setattr(live, "_recent", {})
    monkeypatch.setattr(live, "_counts", {"received": 0, "stored": 0, "failed": 0})
    monkeypatch.setattr(live, "_last_write", {"received_at": None, "stored_at": None, "failed_at": None, "failure": None})
    monkeypatch.setattr(audience, "_ingestion", {key: 0 for key in audience._ingestion})
    assert audience.initialize()
    assert live.initialize()
    yield conn
    conn.close()


def observation():
    return {"session": audience._digest("session", str(uuid4())), "browser": audience._digest("browser", str(uuid4())),
            "country": "KR", "region": "Gyeonggi-do", "city": "Suwon"}


def test_precise_coordinates_encrypted_and_current_only(store):
    statements = []
    store.set_trace_callback(statements.append)
    obs = observation()
    position = {"latitude": 37.264123, "longitude": 127.029456, "accuracy_m": 14.5}
    assert live.record(obs, position, now=1000)
    assert live.record(obs, now=1050)
    rows = store.execute("SELECT ciphertext FROM audience_location_observations").fetchall()
    assert all(b"37.264123" not in row[0] and b"Suwon" not in row[0] for row in rows)
    result = live.overview(now=1060)
    assert result["located"] == 1
    assert result["sessions"][0]["source"] == "browser_location"
    assert result["sessions"][0]["latitude"] == position["latitude"]
    assert result["sessions"][0]["seen_at"] == 1050
    assert len(live.overview(now=1200)["sessions"]) == 1
    assert live.overview(now=1050 + 86401)["sessions"] == []
    assert store.execute("SELECT COUNT(*) FROM audience_location_observations").fetchone()[0] == 2
    assert not any(s.lstrip().upper().startswith(("DELETE", "UPDATE", "DROP", "REPLACE", "TRUNCATE")) for s in statements)


def test_unknown_locations_remain_visible_and_ip_is_estimate(store):
    assert live.record(observation(), now=1000)
    obs = observation()
    obs["_map_location"] = {"latitude": 37.3, "longitude": 127.0, "accuracy_m": 50000}
    assert live.record(obs, now=1000)
    result = live.overview(now=1010)
    assert result["unlocated"] == result["located"] == 1
    point = next(x for x in result["sessions"] if x["source"] == "ip_estimate")
    assert point["accuracy_m"] == 50000


def test_24_hour_window_and_historical_regions_do_not_invent_presence(store):
    obs = observation()
    obs["_map_location"] = {"latitude": 37.3, "longitude": 127.0, "accuracy_m": 50000}
    assert live.record(obs, now=1000)
    assert len(live.overview(now=1000 + 23 * 3600)["sessions"]) == 1
    assert live.overview(now=1000 + 24 * 3600 + 1)["sessions"] == []
    obs.update(day="2026-10-23", network="test-hmac", location_source="dbip_city_lite")
    assert audience.record(obs)
    # A historical city centre is an aggregate, not an active session or a
    # precise original device position. Stored observations stay untouched.
    from datetime import datetime, timezone
    result = audience.overview(90, datetime(2026,10,23,tzinfo=timezone.utc))
    assert result["browsers"] == 1


@pytest.mark.parametrize("agent", ["Googlebot", "Mozilla/5.0 HeadlessChrome", "Mozilla/5.0 selenium", "GoogleOther", "AmazonAdBot"])
def test_known_crawlers_cannot_enter_audience_or_map(store, agent):
    from app.routers import activity
    app = FastAPI(); app.include_router(activity.router)
    client = TestClient(app)
    body = {"browser_id": str(uuid4()), "session_id": str(uuid4())}
    assert client.post("/audience-presence", json=body, headers={"user-agent": agent}).json() == {"accepted": False}
    assert store.execute("SELECT COUNT(*) FROM audience_observations").fetchone()[0] == 0
    assert store.execute("SELECT COUNT(*) FROM audience_location_observations").fetchone()[0] == 0


def test_precise_permission_expires_without_changing_saved_history(store):
    obs = observation()
    assert live.record(obs, {"latitude": 37.2, "longitude": 127.1, "accuracy_m": 20}, now=1000)
    assert live.record(obs, now=1950)
    result = live.overview(now=1960)
    assert result["unlocated"] == 1 and result["sessions"][0]["source"] == "unknown"
    assert store.execute("SELECT COUNT(*) FROM audience_location_observations").fetchone()[0] == 2


def test_presence_requires_human_and_privacy_signals_respected(store):
    from app.routers import activity
    app = FastAPI(); app.include_router(activity.router)
    client = TestClient(app)
    body = {"browser_id": str(uuid4()), "session_id": str(uuid4())}
    assert not client.post("/audience-presence", json=body, headers={"user-agent": "HeadlessChrome"}).json()["accepted"]
    assert not client.post("/audience-presence", json=body, headers={"user-agent": "Mozilla/5.0", "dnt": "1"}).json()["accepted"]
    assert client.post("/audience-presence", json=body, headers={"user-agent": "Mozilla/5.0"}).json()["accepted"]
    assert audience.overview(7)["browsers"] == 1
    assert len(live.overview()["sessions"]) == 1


def test_diagnostics_scoped_to_aggregate_reads(store, monkeypatch):
    from app.routers.audience_diagnostics import router
    monkeypatch.setenv("AUDIENCE_DIAGNOSTICS_KEY", "test-only-diagnostics-" * 3)
    app = FastAPI(); app.include_router(router)
    client = TestClient(app)
    assert client.get("/audience-diagnostics").status_code == 401
    response = client.get("/audience-diagnostics", headers={"x-audience-diagnostics-key": "test-only-diagnostics-" * 3})
    assert response.status_code == 200
    assert response.json()["map_ready"] is True
    assert not any(s in response.text for s in ["latitude", "longitude", "ciphertext", "nonce", "password"])


def test_location_key_change_preserves_session_counts_without_exposing_location(store, monkeypatch):
    assert live.record(observation(), {"latitude": 37.2, "longitude": 127.1, "accuracy_m": 20}, now=1000)
    monkeypatch.setenv("AUDIENCE_LOCATION_KEY", base64.urlsafe_b64encode(b"different-test-key-only-123456789"[:32]).decode())
    report = live.overview(now=1010)
    assert report["total"] == report["unlocated"] == report["unreadable"] == 1
    assert report["sessions"][0]["source"] == "unknown"
    assert "latitude" not in report["sessions"][0]


def test_precise_only_record_expires_at_15_minutes_without_losing_presence(store):
    assert live.record(observation(), {"latitude": 37.2, "longitude": 127.1, "accuracy_m": 20}, now=1000)
    report = live.overview(now=1901)
    assert report["total"] == report["unlocated"] == 1
    assert "latitude" not in report["sessions"][0]


def test_country_filter_precedes_session_limit_and_total_includes_unlocated(store):
    for i in range(501):
        assert live.record(observation(), now=2000 + i)
    obs = {**observation(), "country": "US"}
    assert live.record(obs, now=1000)
    report = live.overview(now=3000)
    assert report["total"] == report["unlocated"] == 502
    assert len(report["sessions"]) == 500 and report["truncated"]
    filtered = live.overview(now=3000, country="US")
    assert filtered["total"] == 1 and filtered["sessions"][0]["country"] == "US"
    assert not filtered["truncated"]


def test_page_view_also_records_encrypted_presence(store, monkeypatch):
    from app.routers import activity
    monkeypatch.setattr(activity.activity_log, "record_event", lambda **kwargs: None)
    app = FastAPI(); app.include_router(activity.router)
    client = TestClient(app)
    body = {"browser_id": str(uuid4()), "session_id": str(uuid4()), "type": "page_view", "path": "/desk"}
    headers = {"user-agent": "Mozilla/5.0"}
    assert client.post("/event", json=body, headers=headers).status_code == 200
    assert len(live.overview()["sessions"]) == 1
    for path, agent in (("/admin/dashboard", "Mozilla/5.0"), ("/desk", "Googlebot")):
        assert client.post("/event", json={**body, "session_id": str(uuid4()), "path": path}, headers={"user-agent": agent}).status_code == 200
    assert len(live.overview()["sessions"]) == 1


def test_presence_reports_location_failure_and_still_attempts_each_store(store, monkeypatch):
    from app.routers import activity
    app = FastAPI(); app.include_router(activity.router)
    client = TestClient(app)
    body = {"browser_id": str(uuid4()), "session_id": str(uuid4())}
    monkeypatch.setattr(live, "record", lambda *args: False)
    assert client.post("/audience-presence", json=body, headers={"user-agent": "Mozilla/5.0"}).json() == {"accepted": False}
    calls = []
    monkeypatch.setattr(audience, "record", lambda *args: False)
    monkeypatch.setattr(live, "record", lambda *args: calls.append(args) or True)
    assert client.post("/audience-presence", json=body, headers={"user-agent": "Mozilla/5.0"}).json() == {"accepted": False}
    assert len(calls) == 1


def test_page_view_without_browser_identity_still_counts_session(store, monkeypatch):
    """A slow config request/blocked localStorage must not erase a public visit."""
    from app.routers import activity
    monkeypatch.setattr(activity.activity_log, "record_event", lambda **kwargs: None)
    app = FastAPI(); app.include_router(activity.router)
    client = TestClient(app)
    session = str(uuid4())
    body = {"session_id": session, "type": "page_view", "path": "/desk"}
    assert client.post("/event", json=body, headers={"user-agent": "Mozilla/5.0"}).status_code == 200
    report = live.overview()
    assert report["total"] == report["unlocated"] == 1
    assert report["located"] == 0
    assert report["sessions"][0]["id"] == audience._digest("session", session)[:16]
    # A per-tab fallback is not a made-up persistent browser/revisit identity.
    assert store.execute("SELECT COUNT(*) FROM audience_observations").fetchone()[0] == 0
    assert session not in json.dumps(report)


def test_session_only_visit_with_trusted_ip_becomes_map_marker(store, monkeypatch):
    from app.routers import activity
    monkeypatch.setattr(activity.activity_log, "record_event", lambda **kwargs: None)
    monkeypatch.setenv("AUDIENCE_EDGE_SECRET", "synthetic-edge-secret-" * 3)
    monkeypatch.setattr(audience.audience_network, "lookup", lambda ip: {
        "country": "KR", "region": "Gyeonggi-do", "city": "Suwon",
        "latitude": 37.3, "longitude": 127.0, "accuracy_m": 50000})
    app = FastAPI(); app.include_router(activity.router)
    response = TestClient(app).post("/event", json={"session_id": str(uuid4()), "type": "page_view", "path": "/desk"},
        headers={"user-agent": "Mozilla/5.0", "x-audience-edge-key": "synthetic-edge-secret-" * 3,
                 "cf-connecting-ip": "8.8.8.8"})
    assert response.status_code == 200
    report = live.overview(country="KR")
    assert report["total"] == report["located"] == 1
    assert report["unlocated"] == 0
    assert report["sessions"][0]["latitude"] == 37.3
    assert report["sessions"][0]["source"] == "ip_estimate"


@pytest.mark.parametrize("extra,headers,path", [
    ({}, {"dnt": "1"}, "/desk"),
    ({}, {"sec-gpc": "1"}, "/desk"),
    ({"automated": True}, {}, "/desk"),
    ({}, {"user-agent": "Googlebot"}, "/desk"),
    ({}, {}, "/admin/dashboard"),
])
def test_session_only_fallback_preserves_collection_exclusions(store, monkeypatch, extra, headers, path):
    from app.routers import activity
    monkeypatch.setattr(activity.activity_log, "record_event", lambda **kwargs: None)
    app = FastAPI(); app.include_router(activity.router)
    response = TestClient(app).post("/event", json={"session_id": str(uuid4()), "type": "page_view", "path": path, **extra},
                                    headers={"user-agent": "Mozilla/5.0", **headers})
    assert response.status_code == 200
    assert live.overview()["total"] == 0


def test_bad_geoip_coordinates_preserve_unlocated_visit(store):
    obs = observation()
    obs["_map_location"] = {"latitude": float("nan"), "longitude": 127, "accuracy_m": 50000}
    assert live.record(obs, now=1000)
    report = live.overview(now=1010)
    assert report["total"] == report["unlocated"] == 1
    assert "latitude" not in report["sessions"][0]


def test_unready_store_reports_failure_instead_of_healthy_zero(store, monkeypatch):
    monkeypatch.setattr(live, "_ready", False)
    assert not live.record(observation(), now=1000)
    report = live.overview(now=1010)
    assert report["enabled"] is False
    assert report["collection_status"] == "location_store_not_ready"
    assert report["diagnostics"]["received"] == report["diagnostics"]["failed"] == 1
    assert report["diagnostics"]["failure"] == "location_store_not_ready"


def test_encryption_failure_is_counted_and_does_not_raise(store, monkeypatch):
    class FailingCipher:
        def encrypt(self, *args):
            raise ValueError("sensitive exception text must never be returned")
    monkeypatch.setattr(live, "_cipher", lambda: FailingCipher())
    assert not live.record(observation(), now=1000)
    report = live.overview(now=1010)
    assert report["diagnostics"]["failed"] == 1
    assert report["diagnostics"]["failure"] == "location_write_failed"
    assert "sensitive" not in json.dumps(report)


def test_country_filter_reports_global_session_count(store):
    assert live.record(observation(), now=1000)
    report = live.overview(now=1010, country="US")
    assert report["total"] == 0
    assert report["all_total"] == 1


def test_existing_public_heartbeat_records_encrypted_map_presence(store, monkeypatch, caplog):
    from app.routers import visitors
    monkeypatch.setattr(visitors.tracker, "heartbeat", lambda *args, **kwargs: (4, 100))
    monkeypatch.setenv("AUDIENCE_EDGE_SECRET", "test-edge-secret-" * 3)
    monkeypatch.setattr(audience.audience_network, "lookup", lambda ip: {
        "country": "KR", "region": "Seoul", "city": "Seoul",
        "latitude": 37.5, "longitude": 127.0, "accuracy_m": 50000})
    app = FastAPI(); app.include_router(visitors.router)
    session = str(uuid4())
    with caplog.at_level("INFO", logger="app.services.audience_live"):
        response = TestClient(app).get("/count", params={"session_id": session}, headers={
            "user-agent": "Mozilla/5.0", "referer": f"https://{visitors.PRIMARY_SITE_HOST}/global",
            "x-audience-edge-key": "test-edge-secret-" * 3, "cf-connecting-ip": "8.8.8.8"})
    assert response.json() == {"count": 4, "total": 100}
    report = live.overview()
    assert report["total"] == report["located"] == 1
    assert report["sessions"][0]["source"] == "ip_estimate"
    assert report["ingestion"]["eligible"] == 1
    assert report["ingestion"]["heartbeat_public"] == 1
    assert session not in json.dumps(report)
    assert store.execute("SELECT COUNT(*) FROM audience_observations").fetchone()[0] == 0
    messages = [record.message for record in caplog.records if record.name == "app.services.audience_live"]
    assert messages == ["audience map storage active: stored=1, located=1"]


@pytest.mark.parametrize("extra,referer,reason", [
    ({"dnt": "1"}, "/global", "privacy_excluded"),
    ({"sec-gpc": "1"}, "/global", "privacy_excluded"),
    ({"user-agent": "Googlebot"}, "/global", "bot_excluded"),
    ({}, "/admin/dashboard", None),
    ({}, "/admin", None),
    ({}, None, None),
    ({}, "https://unrelated.invalid/global", None),
])
def test_heartbeat_collection_preserves_exclusions_and_counts_reasons(store, monkeypatch, extra, referer, reason):
    from app.routers import visitors
    monkeypatch.setattr(visitors.tracker, "heartbeat", lambda *args, **kwargs: (4, 100))
    app = FastAPI(); app.include_router(visitors.router)
    headers = {"user-agent": "Mozilla/5.0", **extra}
    if referer:
        headers["referer"] = f"https://{visitors.PRIMARY_SITE_HOST}{referer}" if referer.startswith("/") else referer
    assert TestClient(app).get("/count", params={"session_id": str(uuid4())}, headers=headers).status_code == 200
    report = live.overview()
    assert report["total"] == 0
    assert report["ingestion"]["eligible"] == 0
    if reason:
        assert report["ingestion"][reason] == 1
    else:
        assert report["ingestion"]["received"] == 0
        assert report["ingestion"]["heartbeat_excluded"] == 1
