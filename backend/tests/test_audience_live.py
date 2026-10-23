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
    assert live.overview(now=1200)["sessions"] == []
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
