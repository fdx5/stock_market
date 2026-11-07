import json
from unittest.mock import Mock

import pytest
from app.services import cctv_gateway as gateway
from app.services.cctv_gateway_protocol import GatewayUnavailable, pack_reply

MEDIA = "https://cctvsec.ktict.co.kr:8082/live/playlist.m3u8"


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    monkeypatch.setenv("CCTV_HTTP_GATEWAY_URL", "https://cctv-seoul.vercel.app")
    monkeypatch.setenv("CCTV_HTTP_GATEWAY_SECRET", "isolated-test-server-secret-never-production-123")
    monkeypatch.setattr(gateway, "_http_last_ok", 0.)
    monkeypatch.setattr(gateway, "_http_first_ok", 0.)
    monkeypatch.setattr(gateway, "_connection", None)


def test_http_transport_preserves_binary_reply_and_does_not_need_wss(monkeypatch):
    def post(url, **kwargs):
        assert url == "https://cctv-seoul.vercel.app/api/cctv/fetch"
        assert kwargs["allow_redirects"] is False and kwargs["stream"]
        assert kwargs["json"]["kind"] == "media"
        body = pack_reply(kwargs["json"]["id"], 200, b"#EXTM3U\n", "application/vnd.apple.mpegurl", MEDIA)
        reply = Mock(status_code=200)
        reply.iter_content.return_value = [body]
        context = Mock()
        context.__enter__ = Mock(return_value=reply)
        context.__exit__ = Mock(return_value=False)
        return context
    monkeypatch.setattr(gateway.requests, "post", post)
    assert gateway.fetch(MEDIA, "media").body == b"#EXTM3U\n"
    assert gateway.status()["transport"] == "https" and gateway.status()["connected"]


def test_http_failure_never_uses_wss_or_overseas_fallback(monkeypatch):
    def fail(*a, **kw):
        raise ValueError("private-fixture-url")
    monkeypatch.setattr(gateway.requests, "post", fail)
    with pytest.raises(GatewayUnavailable) as failure:
        gateway.fetch(MEDIA, "media")
    assert "private-fixture" not in str(failure.value)
    assert not gateway.status()["connected"]


@pytest.mark.parametrize("url", ["http://bad.example", "https://u:p@bad.example", "https://bad.example/path"])
def test_invalid_configuration_is_not_contacted(monkeypatch, url):
    monkeypatch.setenv("CCTV_HTTP_GATEWAY_URL", url)
    monkeypatch.setattr(gateway.requests, "post", lambda *a, **k: pytest.fail("Bad configuration must not connect"))
    with pytest.raises(GatewayUnavailable):
        gateway.fetch(MEDIA, "media")
