"""No app startup, persistence, existing DB, or real provider credentials."""
import ipaddress
import time
from collections import OrderedDict
from unittest.mock import Mock

import pytest
from app.services import traffic_cctv as c


def test_missing_key_makes_no_network_request(monkeypatch):
    monkeypatch.delenv("ITS_CCTV_API_KEY", raising=False)
    monkeypatch.delenv("ITS_API_KEY", raising=False)
    monkeypatch.setattr(c.requests, "get", lambda *a, **k: pytest.fail("unexpected network"))
    assert c.cameras(37.5, 127)["status"] == "needs_key"


def test_public_sample_key_is_not_treated_as_working_live_credentials(monkeypatch):
    monkeypatch.setenv("ITS_CCTV_API_KEY", "test")
    monkeypatch.setattr(c.requests, "get", lambda *a, **k: pytest.fail("sample links are not live credentials"))
    assert c.cameras(37.5, 127)["status"] == "invalid_key"


def test_provider_http_authorization_rejection_is_distinct(monkeypatch):
    monkeypatch.setattr(c.requests, "get", lambda *a, **k: Mock(status_code=401))
    with pytest.raises(c.CameraAuthError):
        c._fetch_road("ex", 37.5, 127)


def test_refresh_renews_short_lived_video_links(monkeypatch):
    monkeypatch.setenv("ITS_CCTV_API_KEY", "fixture-not-a-real-key")
    monkeypatch.setattr(c, "_cache", OrderedDict())
    calls = []
    def provider(road, lat, lon):
        calls.append(road)
        return [{"id": road, "media": f"/fixture/{len(calls)}"}]
    monkeypatch.setattr(c, "_fetch_road", provider)
    first = c.cameras(37.5, 127)
    assert c.cameras(37.5, 127) == first and len(calls) == 2
    fresh = c.cameras(37.5, 127, refresh=True)
    assert fresh != first and len(calls) == 4


def test_provider_auth_failure_is_not_reported_as_empty_success(monkeypatch):
    monkeypatch.setenv("ITS_CCTV_API_KEY", "fixture-not-a-real-key")
    monkeypatch.setattr(c, "_cache", OrderedDict())
    def reject(*args):
        raise c.CameraAuthError("Rejected")
    monkeypatch.setattr(c, "_fetch_road", reject)
    result = c.cameras(37.5, 127)
    assert result["status"] == "not_authorized" and result["items"] == []


def test_production_connection_diagnostics_never_include_credential_urls(monkeypatch):
    monkeypatch.setenv("ITS_CCTV_API_KEY", "fixture-not-a-real-key")
    monkeypatch.setattr(c, "_cache", OrderedDict())
    def timeout(*args):
        raise c.requests.exceptions.ConnectTimeout("https://example.org?apiKey=secret-fixture")
    monkeypatch.setattr(c, "_fetch_road", timeout)
    result = c.cameras(37.5, 127)
    assert result["status"] == "unavailable"
    assert result["issues"] == [{"road": "ex", "code": "connect_timeout"}, {"road": "its", "code": "connect_timeout"}]
    assert "secret-fixture" not in str(result) and "example.org" not in str(result)


def test_provider_camera_does_not_expose_key_or_url(monkeypatch):
    monkeypatch.setenv("ITS_CCTV_API_KEY", "fixture-not-a-real-key")
    reply = Mock()
    reply.json.return_value = {"response": {"data": [{"cctvname": "Bridge", "coordx": "127", "coordy": "37.5",
        "cctvtype": "4", "cctvurl": "https://example.org/video.m3u8?secret=fixture"}]}}
    monkeypatch.setattr(c.requests, "get", lambda *a, **k: reply)
    camera = c._fetch_road("ex", 37.5, 127)[0]
    assert camera["name"] == "Bridge"
    assert camera["format"] == "hls"
    assert camera["media"].startswith("/api/realestate/cctv/media/")
    assert "secret" not in str(camera) and "fixture" not in str(camera)


def test_xml_service_response(monkeypatch):
    reply = Mock(content=b'<response><datacount>1</datacount><data><cctvname>Stream</cctvname><coordx>127</coordx><coordy>37</coordy><cctvtype>1</cctvtype><cctvurl>http://example.org/live</cctvurl></data></response>')
    reply.json.side_effect = ValueError
    monkeypatch.setattr(c.requests, "get", lambda *a, **k: reply)
    assert c._fetch_road("its", 37, 127)[0]["format"] == "hls"


def test_invalid_auth_reply_is_failure(monkeypatch):
    reply = Mock()
    reply.json.return_value = {"error": "bad key"}
    monkeypatch.setattr(c.requests, "get", lambda *a, **k: reply)
    with pytest.raises(ValueError):
        c._fetch_road("ex", 37, 127)


def test_manifest_rewrites_child_playlist_segment_and_encryption_key(monkeypatch):
    manifest = b'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow/index.m3u8\n#EXTINF:4,\nhttps://example.org/chunk.ts?signature=private\n'
    monkeypatch.setattr(c, "_public_fetch", lambda url: (manifest, "text/plain", "https://example.org/live/master.m3u8"))
    out, typ = c.media(c._remember("https://example.org/master"))
    assert typ == "application/vnd.apple.mpegurl"
    assert out.count(b"/api/realestate/cctv/media/") == 3
    assert b"example.org" not in out and b"signature" not in out


@pytest.mark.parametrize("host", ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "192.168.1.1"])
def test_media_blocks_private_addresses_before_connect(monkeypatch, host):
    monkeypatch.setattr(c.socket, "getaddrinfo", lambda *a, **k: [(None, None, None, None, (host, 80))])
    with pytest.raises(ValueError, match="host"):
        c._public_fetch("http://example.org/live")


def test_redirect_rechecks_dns(monkeypatch):
    calls = []
    def dns(host, *a, **k):
        calls.append(host)
        return [(None, None, None, None, ("8.8.8.8" if host == "example.org" else "127.0.0.1", 80))]
    monkeypatch.setattr(c.socket, "getaddrinfo", dns)
    response = Mock(status=302, headers={"Location": "http://internal.example/private"})
    monkeypatch.setattr(c.urllib3, "HTTPConnectionPool", lambda *a, **k: Mock(request=lambda *a, **k: response))
    with pytest.raises(ValueError):
        c._public_fetch("http://example.org/live")
    assert calls == ["example.org", "internal.example"]


def test_official_hls_redirect_port_is_supported_without_opening_arbitrary_ports(monkeypatch):
    monkeypatch.setattr(c.socket, "getaddrinfo", lambda *a, **k: [(None, None, None, None, ("8.8.8.8", 443))])
    first = Mock(status=302, headers={"Location": "https://cctvsec.ktict.co.kr:8082/live/index.m3u8"})
    second = Mock(status=200, headers={"Content-Type": "application/vnd.apple.mpegurl"})
    second.read.return_value = b"#EXTM3U\n"
    responses = iter([first, second])
    ports = []
    def pool(*a, **kwargs):
        ports.append(kwargs["port"])
        return Mock(request=lambda *a, **k: next(responses))
    monkeypatch.setattr(c.urllib3, "HTTPSConnectionPool", pool)
    body, _, final = c._public_fetch("https://cctvsec.ktict.co.kr/live")
    assert body == b"#EXTM3U\n" and ports == [443, 8082]
    assert c._remember(final)
    with pytest.raises(ValueError, match="port"):
        c._public_fetch("https://example.org:8082/live")
    with pytest.raises(ValueError, match="address"):
        c._remember("https://example.org:8082/live")


def test_expired_or_unknown_reference_does_not_fetch(monkeypatch):
    monkeypatch.setattr(c, "_public_fetch", lambda url: pytest.fail("unexpected fetch"))
    with pytest.raises(LookupError):
        c.media("unknown-reference")
    token = c._remember("https://example.org/expired")
    monkeypatch.setitem(c._media, token, ("https://example.org/expired", time.monotonic() - 1))
    with pytest.raises(LookupError):
        c.media(token)
