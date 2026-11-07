"""Isolated gateway, synthetic credentials/frames only. No main app or database."""
import base64
from concurrent.futures import ThreadPoolExecutor
import struct
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from starlette.websockets import WebSocketDisconnect

from app.services import cctv_gateway as gateway, traffic_cctv as cameras
from app.services.cctv_gateway_protocol import CHALLENGE_CONTEXT, GatewayUnavailable, MAX_BODY, pack_reply, unpack_reply, validate_target

API = "https://openapi.its.go.kr:9443/cctvInfo?apiKey=isolated-fixture"
MEDIA = "https://cctvsec.ktict.co.kr:8082/live/playlist.m3u8"


@pytest.fixture
def identity(monkeypatch):
    key = Ed25519PrivateKey.generate()
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    monkeypatch.setenv("CCTV_GATEWAY_PUBLIC_KEY", base64.b64encode(public).decode())
    monkeypatch.setattr(gateway, "_connection", None)
    return key


@pytest.fixture
def client():
    app = FastAPI()
    app.websocket("/gateway")(gateway.serve)
    with TestClient(app) as c:
        yield c


def authenticate(ws, key):
    challenge = ws.receive_json()
    nonce = base64.b64decode(challenge["nonce"])
    signature = key.sign(CHALLENGE_CONTEXT + nonce)
    ws.send_json({"signature": base64.b64encode(signature).decode()})
    assert ws.receive_json()["type"] == "ready"
    return signature


def test_signed_agent_completes_only_server_created_jobs_and_disconnects(client, identity):
    with client.websocket_connect("/gateway") as ws:
        authenticate(ws, identity)
        assert gateway.status()["connected"]
        with ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(gateway.fetch, API, "api")
            request = ws.receive_json()
            assert request["type"] == "get" and request["url"] == API
            ws.send_bytes(pack_reply(request["id"], 200, b'{"response":{}}', "application/json", API))
            assert result.result(timeout=3).body == b'{"response":{}}'
        ws.send_json({"type": "heartbeat"})
        assert ws.receive_json() == {"type": "heartbeat"}
    # Client context exit and server disconnect processing run on different threads.
    deadline = time.monotonic() + 1
    while gateway.status()["connected"] and time.monotonic() < deadline:
        time.sleep(.005)
    assert not gateway.status()["connected"]


def test_unknown_agent_and_replayed_challenge_are_rejected(client, identity):
    with client.websocket_connect("/gateway") as ws:
        signature = authenticate(ws, identity)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/gateway") as ws:
            ws.receive_json()
            ws.send_json({"signature": base64.b64encode(signature).decode()})
            ws.receive_json()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/gateway") as ws:
            authenticate(ws, Ed25519PrivateKey.generate())


def test_browser_origin_and_unconfigured_gateway_are_rejected(client, identity, monkeypatch):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/gateway", headers={"origin": "https://example.org"}):
            pass
    monkeypatch.delenv("CCTV_GATEWAY_PUBLIC_KEY")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/gateway"):
            pass


def test_another_connection_cannot_replace_the_active_worker(client, identity):
    with client.websocket_connect("/gateway") as first:
        authenticate(first, identity)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/gateway") as second:
                authenticate(second, identity)
        first.send_json({"type": "heartbeat"})
        assert first.receive_json()["type"] == "heartbeat"


@pytest.mark.parametrize("url,kind", [
    ("http://127.0.0.1/admin", "media"),
    ("http://169.254.169.254/latest/meta-data", "media"),
    ("https://cctvsec.ktict.co.kr.evil.example/video", "media"),
    ("https://example.org/video.m3u8", "media"),
    ("https://u:p@cctvsec.ktict.co.kr/video", "media"),
    ("https://openapi.its.go.kr:9443/other", "api"),
    ("https://openapi.its.go.kr:9443/cctvInfo#fragment", "api"),
    (MEDIA, "POST"),
])
def test_gateway_is_not_an_arbitrary_url_proxy(url, kind):
    with pytest.raises(ValueError):
        validate_target(url, kind)


def test_valid_provider_ports_and_bounded_binary_protocol():
    validate_target(API, "api")
    validate_target(MEDIA, "media")
    packet = pack_reply("a" * 32, 200, b"video-bytes", "video/mp2t", MEDIA)
    header, body = unpack_reply(packet)
    assert header["status"] == 200 and body == b"video-bytes"
    for invalid in [b"", b"{}", struct.pack("!I", 999999) + b"{}"]:
        with pytest.raises(ValueError):
            unpack_reply(invalid)
    with pytest.raises(ValueError):
        pack_reply("a" * 32, 200, b"x" * (MAX_BODY + 1))


def test_required_domestic_route_never_falls_back_to_overseas_fetch(monkeypatch):
    monkeypatch.setenv("CCTV_HIGHWAY_GATEWAY", "required")
    monkeypatch.setenv("ITS_CCTV_API_KEY", "isolated-fixture")
    monkeypatch.setattr(cameras, "HIGHWAY_CCTV_ENABLED", True)
    monkeypatch.setattr(cameras, "CITY_CCTV_ENABLED", False)
    monkeypatch.setattr(cameras, "_cache", {})
    monkeypatch.setattr(gateway, "_connection", None)
    monkeypatch.setattr(cameras.requests, "get", lambda *a, **kw: pytest.fail("overseas fallback must not run"))
    result = cameras.cameras(37.5, 127, refresh=True)
    assert result["status"] == "unavailable"
    assert all(issue["code"] == "domestic_gateway_unavailable" for issue in result["issues"])
    assert "isolated-fixture" not in str(result)


def test_hls_children_and_keys_keep_the_domestic_route(monkeypatch):
    monkeypatch.setattr(cameras, "_manifests", {})
    monkeypatch.setattr(cameras, "_failed_media", {})
    monkeypatch.setattr(cameras, "_relayed_media", set())
    monkeypatch.setattr(cameras, "_public_fetch", lambda *a: pytest.fail("must use domestic worker"))
    calls = []
    def worker(url, kind):
        calls.append((url, kind))
        if url.endswith("playlist.m3u8"):
            return gateway.GatewayReply(200, b'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment.ts\n', "application/vnd.apple.mpegurl", MEDIA)
        return gateway.GatewayReply(200, b"segment", "video/mp2t", url)
    monkeypatch.setattr(gateway, "fetch", worker)
    token = cameras._remember(MEDIA, domestic=True)
    manifest, _ = cameras.media(token)
    assert b"ktict" not in manifest and b"key.bin" not in manifest
    lines = manifest.decode().splitlines()
    segment_token = lines[-1].rsplit("/", 1)[-1]
    assert segment_token in cameras._relayed_media
    assert cameras.media(segment_token)[0] == b"segment"
    assert len(calls) == 2 and all(kind == "media" for _, kind in calls)


def test_domestic_worker_preserves_public_dns_and_redirect_checks(monkeypatch):
    monkeypatch.setattr(cameras.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 443))])
    with pytest.raises(ValueError):
        cameras._public_fetch_direct(MEDIA, validator=lambda u: validate_target(u, "media"))


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:1935/video", "http://169.254.169.254/video",
    "https://localhost/video", "https://device.local/video", "http://[::1]/video",
    "http://192.168.1.1/video", "http://10.0.0.1/video", "http://211.34.147.236:22/video",
])
def test_city_egress_rejects_local_targets_and_service_ports(url):
    with pytest.raises(ValueError):
        validate_target(url, "city_media")


def test_city_egress_supports_public_municipal_providers_but_pins_dns(monkeypatch):
    for url in ["https://lw.hrfco.go.kr/live/cctv116046/hls.m3u8", "http://211.34.147.236:1935/live/cam/playlist.m3u8"]:
        validate_target(url, "city_media")
    monkeypatch.setattr(cameras.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("10.0.0.1", 443))])
    with pytest.raises(ValueError):
        cameras._public_fetch_direct("https://lw.hrfco.go.kr/live/test/hls.m3u8", validator=lambda u: validate_target(u, "city_media"))


def test_mislabeled_official_ts_is_served_as_video_but_html_is_rejected(monkeypatch):
    monkeypatch.setattr(cameras, "_manifests", {})
    monkeypatch.setattr(cameras, "_failed_media", {})
    target = "https://cctvsec.ktict.co.kr:8082/live/segment.ts"
    token = cameras._remember(target, domestic=True)
    body = (b'\x47' + b'\x00' * 187) * 4
    monkeypatch.setattr(gateway, "fetch", lambda *a: gateway.GatewayReply(200, body, "text/vnd.trolltech.linguist", target))
    assert cameras.media(token) == (body, "video/mp2t")
    monkeypatch.setattr(gateway, "fetch", lambda *a: gateway.GatewayReply(200, b'<html>unavailable</html>', "text/html", target))
    with pytest.raises(ValueError, match="Unsupported media response"):
        cameras.media(token)
