"""Only brand-new temporary SQLite databases; no application startup/jobs."""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.services import audience_analytics as audience

NOW = datetime(2026, 10, 23, 3, tzinfo=timezone.utc)


def request(**headers):
    return Request({"type": "http", "headers": [(k.replace("_", "-").encode(), v.encode()) for k, v in headers.items()],
                    "client": ("127.0.0.1", 1)})


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIENCE_HMAC_KEY", "test-hmac-key-" * 4)
    monkeypatch.setenv("AUDIENCE_EDGE_SECRET", "test-edge-key-" * 4)
    monkeypatch.setenv("AUDIENCE_DATABASE_URL", "test-unused")
    monkeypatch.setenv("AUDIENCE_DATABASE_TOKEN", "test-unused")
    conn = sqlite3.connect(tmp_path / "new-audience.sqlite", check_same_thread=False)
    schema = Path(__file__).resolve().parents[1] / "schema/audience_observations.sql"
    conn.executescript(schema.read_text(encoding="utf-8"))
    monkeypatch.setattr(audience, "_conn", conn)
    monkeypatch.setattr(audience, "_schema_ready", True)
    yield conn
    conn.close()


def edge(**extra):
    return request(x_audience_edge_key="test-edge-key-" * 4, cf_connecting_ip="8.8.8.8",
                   cf_ipcountry="KR", cf_region="Seoul", cf_ipcity="Seoul", **extra)


def test_no_raw_identifiers_or_ips_stored_and_no_destructive_sql(store):
    statements = []
    store.set_trace_callback(statements.append)
    browser, session = str(uuid4()), str(uuid4())
    observation = audience.context(edge(), browser, session, False, NOW)
    assert audience.record(observation)
    assert audience.record(observation)  # idempotent within day/session/location
    rows = store.execute("SELECT * FROM audience_observations").fetchall()
    assert len(rows) == 1
    encoded = json.dumps(rows)
    assert browser not in encoded and session not in encoded and "8.8.8.8" not in encoded
    assert not any(s.lstrip().upper().startswith(("DELETE", "UPDATE", "DROP", "ALTER", "REPLACE")) for s in statements)


def test_spoofed_proxy_headers_are_not_trusted(store):
    observation = audience.context(request(cf_connecting_ip="8.8.8.8", cf_ipcountry="KR",
                                  x_forwarded_for="8.8.8.8"), str(uuid4()), str(uuid4()), False, NOW)
    assert observation["network"] == observation["country"] == observation["city"] == ""
    assert observation["location_source"] == "unknown"


@pytest.mark.parametrize("headers", [{"dnt": "1"}, {"sec_gpc": "1"}])
def test_privacy_signals(store, headers):
    assert audience.context(edge(**headers), str(uuid4()), str(uuid4()), False, NOW) is None


def test_bots_old_clients_and_missing_key_skip_collection(store, monkeypatch):
    assert audience.context(edge(), str(uuid4()), str(uuid4()), True, NOW) is None
    assert audience.context(edge(), None, str(uuid4()), False, NOW) is None
    assert audience.context(edge(), "bad-id", str(uuid4()), False, NOW) is None
    monkeypatch.delenv("AUDIENCE_HMAC_KEY")
    assert audience.context(edge(), str(uuid4()), str(uuid4()), False, NOW) is None
    assert audience.overview(30, NOW)["enabled"] is False


def test_multiday_same_browser_multiple_sessions_and_network_rotation(store):
    browser = str(uuid4())
    for day in (21, 22, 23):
        for _ in range(2):
            observation = audience.context(edge(), browser, str(uuid4()), False, NOW.replace(day=day))
            assert audience.record(observation)
    report = audience.overview(7, NOW)
    assert report["browsers"] == 1
    assert report["sessions"] == 6
    assert report["repeat_browsers"] == report["regular_browsers"] == 1
    assert report["network_days"] == 3
    assert report["browser_days"] == report["located_browser_days"] == 3
    assert report["regions"][0]["browser_days"] == 3
    assert len({row[0] for row in store.execute("SELECT DISTINCT network FROM audience_observations")}) == 3
    assert audience.overview(1, NOW)["repeat_browsers"] == 0


def test_kst_date_and_unknown_region_do_not_disappear(store):
    observation = audience.context(request(), str(uuid4()), str(uuid4()), False,
                                   NOW.replace(day=22, hour=15))
    assert observation["day"] == "2026-10-23"
    audience.record(observation)
    report = audience.overview(1, NOW)
    assert report["browsers"] == 1 and report["located_browser_days"] == 0
    assert report["regions"][0]["country"] == ""


def test_activity_integration_skips_admin_bots_clicks_and_preserves_old_clients(store, monkeypatch):
    from app.routers import activity
    monkeypatch.setattr(activity.activity_log, "record_event", lambda **kwargs: None)
    recorded = []
    monkeypatch.setattr(audience, "record", lambda row: recorded.append(row))
    app = FastAPI()
    app.include_router(activity.router)
    client = TestClient(app)
    body = {"session_id": str(uuid4()), "browser_id": str(uuid4()), "type": "page_view", "path": "/desk"}
    assert client.post("/event", json=body, headers={"user-agent": "Mozilla/5.0"}).status_code == 200
    assert len(recorded) == 1
    for payload, agent in (({**body, "path": "/admin/db"}, "Mozilla/5.0"),
                            ({**body, "type": "click"}, "Mozilla/5.0"),
                            (body, "Googlebot/2.1"),
                            ({k: v for k, v in body.items() if k != "browser_id"}, "Mozilla/5.0")):
        assert client.post("/event", json=payload, headers={"user-agent": agent}).status_code == 200
    assert len(recorded) == 1


def test_public_cannot_read_admin_audience(store):
    from app.routers import admin
    app = FastAPI()
    app.include_router(admin.router)
    assert TestClient(app).get("/traffic/audience").status_code == 401


def test_browser_location_takes_precedence_without_mutating_ip_history(store):
    observation = audience.context(edge(), str(uuid4()), str(uuid4()), False, NOW)
    assert audience.record(observation)
    assert audience.record({**observation, "region": "Gyeonggi-do", "city": "Suwon",
                            "location_source": "browser_location"})
    report = audience.overview(7, NOW)
    assert report["browsers"] == report["browser_days"] == 1
    assert len(report["regions"]) == 1
    assert report["regions"][0]["city"] == "Suwon"
    assert store.execute("SELECT COUNT(*) FROM audience_observations").fetchone()[0] == 2


def test_opt_in_geocoder_does_not_store_coordinates_or_addresses(store, monkeypatch):
    from app.services import audience_location as location
    monkeypatch.setenv("AUDIENCE_GEOCODER_URL", "https://geocoder.example.test/reverse")
    monkeypatch.setattr(location, "_next_lookup", 0)
    calls = []
    class Reply:
        status_code = 200
        def json(self):
            return {"address": {"country_code": "kr", "state": "Gyeonggi-do", "city": "Suwon",
                                "road": "PRIVATE STREET", "house_number": "PRIVATE NUMBER"}}
    def fetch(url, **kwargs):
        calls.append(kwargs)
        return Reply()
    monkeypatch.setattr(location.requests, "get", fetch)
    observation = audience.context(edge(), str(uuid4()), str(uuid4()), False, NOW)
    assert location.resolve(observation, 37.263573, 127.028601, 50)
    assert calls[0]["params"]["lat"] == 37.264
    assert calls[0]["params"]["lon"] == 127.029
    rows = json.dumps(store.execute("SELECT * FROM audience_observations").fetchall())
    for private in ("37.264", "127.029", "PRIVATE STREET", "PRIVATE NUMBER"):
        assert private not in rows
    assert not location.resolve(observation, 37, 127, 5001)


def test_location_requires_consent_and_obeys_privacy_signals(store, monkeypatch):
    from app.routers import activity
    calls = []
    monkeypatch.setattr(activity.audience_location, "resolve", lambda *args: calls.append(args) or True)
    app = FastAPI()
    app.include_router(activity.router)
    client = TestClient(app)
    body = {"browser_id": str(uuid4()), "session_id": str(uuid4()), "consent": True,
            "latitude": 37.264, "longitude": 127.029, "accuracy_m": 100}
    assert client.post("/audience-location", json={**body, "consent": False}).status_code == 422
    assert client.post("/audience-location", json={**body, "latitude": 91}).status_code == 422
    assert client.post("/audience-location", json=body, headers={"sec-gpc": "1"}).json() == {"accepted": False}
    assert not calls
    assert client.post("/audience-location", json=body, headers={"user-agent": "Mozilla/5.0"}).json() == {"accepted": True}
    assert len(calls) == 1


def test_location_unconfigured_and_public_osm_are_disabled(store, monkeypatch):
    from app.services import audience_location as location
    monkeypatch.delenv("AUDIENCE_GEOCODER_URL", raising=False)
    assert not location.enabled()
    monkeypatch.setenv("AUDIENCE_GEOCODER_URL", "https://nominatim.openstreetmap.org/reverse")
    assert not location.enabled()


def test_verified_render_chain_uses_local_city_database(store, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("AUDIENCE_EDGE_SECRET")
    monkeypatch.setattr(audience.audience_network, "lookup", lambda ip: {"country": "KR", "region": "Seoul", "city": "Seoul"})
    trusted = request(x_forwarded_for="8.8.8.8, 173.245.48.1, 10.0.0.1", cf_connecting_ip="8.8.8.8")
    row = audience.context(trusted, str(uuid4()), str(uuid4()), False, NOW)
    assert row["city"] == "Seoul" and row["location_source"] == "dbip_city_lite"
    forged = request(x_forwarded_for="173.245.48.1, 9.9.9.9, 10.0.0.1", cf_connecting_ip="8.8.8.8", cf_ipcity="FORGED")
    row = audience.context(forged, str(uuid4()), str(uuid4()), False, NOW)
    assert not row["network"] and not row["city"]


def test_activation_only_adds_new_schema_and_requires_key(store, monkeypatch):
    monkeypatch.setattr(audience, "_schema_ready", False)
    before = store.execute("SELECT COUNT(*) FROM audience_observations").fetchone()[0]
    assert audience.initialize() and audience.ready()
    assert store.execute("SELECT COUNT(*) FROM audience_observations").fetchone()[0] == before
