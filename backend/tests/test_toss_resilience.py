from __future__ import annotations

import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.data import toss_session as toss
from app.data import toss_discussion_fetcher as discussion
from app.services.cache import TTLCache


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(toss, "_gate", toss._RequestGate())
    monkeypatch.setattr(toss, "cache", TTLCache())
    monkeypatch.setattr(discussion, "cache", TTLCache())


def response(status=200, result=None, headers=None):
    value = requests.Response()
    value.status_code = status
    value.url = toss.INFO_API + "/api/v4/comments"
    value.headers.update(headers or {})
    value._content = json.dumps({"result": result if result is not None else {"results": []}}).encode()
    value._content_consumed = True
    return value


def ready_code(monkeypatch):
    monkeypatch.setattr(discussion, "resolve_product_code", lambda *a, **k: "US19980120001")


def test_cold_failure_wave_makes_one_attempt_and_logs_once(monkeypatch, caplog):
    ready_code(monkeypatch)
    calls = []

    def timeout(*args, **kwargs):
        calls.append(kwargs["timeout"])
        time.sleep(.025)
        raise requests.ReadTimeout("slow upstream")

    monkeypatch.setattr(toss.session, "request", timeout)
    with ThreadPoolExecutor(max_workers=12) as pool:
        values = list(pool.map(lambda _: discussion.get_toss_discussion("NVDA"), range(24)))
    assert all(value == {"items": [], "next_offset": None} for value in values)
    assert calls == [toss.TOSS_TIMEOUT]
    assert len([r for r in caplog.records if "next probe" in r.message]) == 1
    assert not any("Retrying" in r.message for r in caplog.records)


def test_failed_refresh_keeps_last_good_comments_and_cursor(monkeypatch):
    ready_code(monkeypatch)
    old = {"items": [{"id": "saved", "text": "last good comment"}], "next_offset": "saved-cursor"}
    key = "toss_discussion:NVDA:10:first"
    discussion.cache._store[key] = (0, old)
    calls = []

    def timeout(*args, **kwargs):
        calls.append(1)
        raise requests.ReadTimeout()

    monkeypatch.setattr(toss.session, "request", timeout)
    for _ in range(5):
        assert discussion.get_toss_discussion("NVDA") == old
        deadline = time.monotonic() + 2
        while discussion.cache._refreshing and time.monotonic() < deadline:
            time.sleep(.005)
    assert calls == [1]
    assert discussion.cache._store[key][1] == old


def test_failed_code_resolution_is_not_cached_as_an_empty_board(monkeypatch):
    def timeout(*args, **kwargs):
        raise requests.ReadTimeout()

    monkeypatch.setattr(toss.session, "request", timeout)
    assert discussion.get_toss_discussion("NVDA")["items"] == []
    assert not discussion.cache._store
    assert not toss.cache._store


def test_gate_limits_concurrency_and_allows_one_recovery_probe(monkeypatch):
    gate = toss._RequestGate()
    generations = [gate.begin("comments") for _ in range(toss.MAX_CONCURRENT_REQUESTS)]
    with pytest.raises(toss.TossUnavailable):
        gate.begin("search")
    gate.finish("comments", generations[0], requests.ReadTimeout())
    # A late concurrent success cannot undo the failure.
    for generation in generations[1:]:
        gate.finish("comments", generation, None)
    with pytest.raises(toss.TossUnavailable):
        gate.begin("comments")
    gate._states["comments"].retry_at = 0
    probe = gate.begin("comments")
    with pytest.raises(toss.TossUnavailable):
        gate.begin("comments")
    gate.finish("comments", probe, None)
    assert gate._states["comments"].failures == 0
    generation = gate.begin("comments")
    gate.finish("comments", generation, None)


def test_cooldown_backoff_is_bounded_and_honors_retry_after(monkeypatch):
    monkeypatch.setattr(toss.time, "monotonic", lambda: 1000)
    gate = toss._RequestGate()
    for expected in [30, 60, 120, 240, 300, 300]:
        gate._states.setdefault("comments", toss._EndpointState()).retry_at = 0
        generation = gate.begin("comments")
        gate.finish("comments", generation, requests.ReadTimeout())
        assert gate._states["comments"].retry_at == 1000 + expected
    generation = gate.begin("news")
    gate.finish("news", generation, requests.HTTPError(), retry_after=90)
    assert gate._states["news"].retry_at == 1090


@pytest.mark.parametrize("status,opens", [(429, True), (503, True), (404, False)])
def test_http_failures_scope_cooldown_to_the_affected_endpoint(monkeypatch, status, opens):
    monkeypatch.setattr(toss.session, "request", lambda *a, **k: response(status, headers={"Retry-After": "60"}))
    with pytest.raises(requests.HTTPError):
        toss.request_json("GET", "/api/v4/comments")
    state = toss._gate._states["/api/v4/comments"]
    assert (state.failures > 0) is opens
    other = toss._gate.begin("search")
    toss._gate.finish("search", other, None)


def test_malformed_result_is_not_cached_and_recovers_after_probe(monkeypatch):
    ready_code(monkeypatch)
    payloads = iter([response(result={}), response(result={"results": [{
        "commentId": "one", "message": {"title": "Headline", "message": "Body"},
        "author": {"nickname": "reader"}, "statistic": {"likeCount": 2},
    }], "hasNext": True, "key": "cursor"})])
    monkeypatch.setattr(toss.session, "request", lambda *a, **k: next(payloads))
    assert discussion.get_toss_discussion("NVDA")["items"] == []
    assert not discussion.cache._store
    toss._gate._states["/api/v4/comments"].retry_at = 0
    value = discussion.get_toss_discussion("NVDA")
    assert value["items"][0]["text"] == "Body"
    assert value["next_offset"] == "cursor"
    assert toss._gate._states["/api/v4/comments"].failures == 0


def test_real_read_timeout_does_not_retry_at_transport_layer(monkeypatch, caplog):
    calls = []

    class Slow(BaseHTTPRequestHandler):
        def do_GET(self):
            calls.append(1)
            time.sleep(.15)
            try:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"result":{"results":[]}}')
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    monkeypatch.setattr(toss, "INFO_API", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(toss, "TOSS_TIMEOUT", (.1, .025))
    try:
        with pytest.raises(requests.ReadTimeout):
            toss.request_json("GET", "/api/v4/comments")
        with pytest.raises(toss.TossUnavailable):
            toss.request_json("GET", "/api/v4/comments")
        assert calls == [1]
        assert not any("Retrying" in r.message for r in caplog.records)
    finally:
        server.shutdown()
        server.server_close()
