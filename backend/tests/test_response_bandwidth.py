import asyncio

from fastapi import FastAPI, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.services.http_cache import validate_public_json
from app.services.response_bandwidth import Counters, ResponseBandwidthMiddleware, route_key


def fixture_app():
    app = FastAPI()
    value = {"price": 100, "generated_at": "first", "points": list(range(1000))}

    @app.get("/api/quote")
    def quote():
        return JSONResponse(value, headers={"Cache-Control": "public, no-store"})

    @app.get("/api/admin/snapshot")
    def admin():
        return value

    @app.get("/api/cookie")
    def cookie():
        response = JSONResponse(value)
        response.set_cookie("session", "test-only")
        return response

    app.middleware("http")(validate_public_json)
    app.add_middleware(GZipMiddleware, minimum_size=500)
    counts = Counters()
    app.add_middleware(ResponseBandwidthMiddleware, observer=counts)
    return TestClient(app), value, counts


def test_gzip_timestamp_does_not_defeat_validation(monkeypatch):
    client, value, _ = fixture_app()
    now = [1000]
    monkeypatch.setattr("gzip.time.time", lambda: now[0])
    first = client.get("/api/quote", headers={"Accept-Encoding": "gzip"})
    assert first.headers["content-encoding"] == "gzip"
    assert first.headers["cache-control"] == "public, no-cache"
    now[0] += 10
    value["generated_at"] = "second"
    second = client.get("/api/quote", headers={"Accept-Encoding": "gzip", "If-None-Match": first.headers["etag"]})
    assert second.status_code == 304
    assert second.content == b""
    value["price"] = 101
    changed = client.get("/api/quote", headers={"If-None-Match": first.headers["etag"]})
    assert changed.status_code == 200
    assert changed.json()["price"] == 101
    assert changed.headers["etag"] != first.headers["etag"]


def test_no_public_validator_for_admin_cookie_or_authorized_response():
    client, _, _ = fixture_app()
    for path, headers in [("/api/admin/snapshot", {}), ("/api/cookie", {}),
                          ("/api/quote", {"Authorization": "Bearer test-only"})]:
        response = client.get(path, headers=headers)
        assert "etag" not in response.headers


def test_counts_compressed_body_and_not_queries():
    client, _, counts = fixture_app()
    first = client.get("/api/quote?private=test-only", headers={"Accept-Encoding": "gzip"})
    snapshot = counts.snapshot()
    assert snapshot["bytes"] == int(first.headers["content-length"])
    assert snapshot["bytes"] < len(first.content)
    client.get("/api/quote", headers={"If-None-Match": first.headers["etag"]})
    assert counts.snapshot()["bytes"] == snapshot["bytes"]
    assert counts.snapshot()["routes"][0]["route"] == "/api/quote"
    assert counts.snapshot()["routes"][0]["responses"] == 2


def test_counter_cardinality_and_unmatched_privacy():
    counts = Counters()
    for i in range(1000):
        counts.record(str(i), 2)
    assert len(counts.total) <= 257
    assert counts.snapshot()["bytes"] == 2000
    assert route_key({"path": "/private/identity", "query_string": b"token=secret"}) == "unmatched"


def test_streaming_and_websocket_payloads_are_counted():
    counts = Counters()

    async def app(scope, receive, send):
        if scope["type"] == "http":
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"abc", "more_body": True})
            await send({"type": "http.response.body", "body": b"def"})
        else:
            await send({"type": "websocket.send", "bytes": b"12345"})
            await send({"type": "websocket.send", "text": "한"})

    async def noop(*args): pass

    middleware = ResponseBandwidthMiddleware(app, observer=counts)
    asyncio.run(middleware({"type": "http", "path": "/"}, noop, noop))
    asyncio.run(middleware({"type": "websocket", "path": "/"}, noop, noop))
    assert counts.snapshot()["bytes"] == 14
