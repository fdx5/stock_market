"""No app startup, persistence, existing DB, or real provider credentials."""
import ipaddress
import json
import time
from collections import OrderedDict
from unittest.mock import Mock

import pytest
from app.services import traffic_cctv as c


@pytest.fixture(autouse=True)
def enable_provider_for_isolated_adapter_checks(monkeypatch):
    monkeypatch.setattr(c, "HIGHWAY_CCTV_ENABLED", True)
    monkeypatch.setattr(c, "CITY_CCTV_ENABLED", False)


def test_paused_provider_never_queries_its_even_with_a_key_and_refresh(monkeypatch):
    monkeypatch.setattr(c, "HIGHWAY_CCTV_ENABLED", False)
    monkeypatch.setenv("ITS_CCTV_API_KEY", "fixture-not-a-real-key")
    monkeypatch.setattr(c.requests, "get", lambda *a, **k: pytest.fail("paused provider must not connect"))
    assert c.cameras(37.5, 127, refresh=True)["status"] == "disabled"
    assert c.cameras(37.5, 127)["items"] == []


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


# --- UTIC city CCTV ------------------------------------------------------------

@pytest.fixture
def city(monkeypatch):
    monkeypatch.setattr(c, "CITY_CCTV_ENABLED", True)
    monkeypatch.setattr(c, "HIGHWAY_CCTV_ENABLED", False)
    for name in c.UTIC_KEY_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("UTIC_API_KEY", "fixture-city-key")
    monkeypatch.setattr(c, "_utic", {"rows": {}, "at": 0.0, "retry_at": 0.0, "issue": None, "fields": [], "kinds": {}})
    monkeypatch.setattr(c, "_resolved", OrderedDict())
    monkeypatch.setattr(c, "_utic_next", [0.0])
    monkeypatch.setattr(c, "_utic_block", [0.0])
    return monkeypatch


CATALOGUE = [{"CCTVID": "L010001", "CCTVNAME": "남산1호터널", "CENTERNAME": "서울특별시", "XCOORD": "126.9886", "YCOORD": "37.5465",
    "MOVIE": "Y", "KIND": "Seoul", "CCTVIP": "L010001", "CH": None, "ID": None, "PASSWD": None, "PORT": None},
    {"CCTVID": "far", "CCTVNAME": "Busan", "XCOORD": "129.07", "YCOORD": "35.17", "KIND": "B", "MOVIE": "Y"}]


def test_city_needs_a_key_before_any_request(city):
    city.delenv("UTIC_API_KEY")
    city.setattr(c.requests, "get", lambda *a, **k: pytest.fail("no key, no request"))
    assert c.cameras(37.5465, 126.9886)["status"] == "needs_key"


def test_city_catalogue_is_read_once_and_filtered_nearby_without_exposing_the_key(city):
    calls = []
    def get(url, params=None, **k):
        calls.append(url)
        return Mock(status_code=200, content=json.dumps(CATALOGUE).encode(), headers={}, raise_for_status=lambda: None)
    city.setattr(c.requests, "get", get)
    first = c.cameras(37.5465, 126.9886)
    again = c.cameras(37.547, 126.989)
    assert calls == [c.UTIC_LIST]
    assert [i["id"] for i in first["items"]] == ["utic:L010001"] == [i["id"] for i in again["items"]]
    item = first["items"][0]
    assert item["resolve"].startswith("/api/realestate/cctv/open/") and item["media"] is None
    assert first["items"][0]["resolve"] == again["items"][0]["resolve"], "one camera keeps one reference"
    assert "fixture-city-key" not in str(first) and "utic.go.kr" not in str(first)
    assert c.status()["city"]["key"] == "UTIC_API_KEY" and "fixture-city-key" not in str(c.status())


def test_city_rejection_is_reported_and_not_retried_at_once(city):
    calls = []
    def get(url, params=None, **k):
        calls.append(url)
        return Mock(status_code=200, content=json.dumps([{"resultCode": "02", "resultMsg": "유효한 KEY값이 아닙니다."}]).encode(), headers={}, raise_for_status=lambda: None)
    city.setattr(c.requests, "get", get)
    assert c.cameras(37.5, 127)["status"] == "not_authorized"
    assert c.cameras(37.5, 127)["status"] == "not_authorized" and len(calls) == 1
    assert c.status()["city"]["issue"]["message"].startswith("유효한")


SEOUL_PAGE = """<div id="cctvarea">
<!-- 2018_10_26 'http://211.236.72.94:1935/live/video.stream/playlist.m3u8-->
<video id="vid" controls autoplay muted><source src="https://strmu.spatic.go.kr/live/L010001.stream/playlist.m3u8" type="application/x-mpegURL"></video>
</div><script src="/js/hls.js"></script>"""


def test_player_page_resolves_to_a_relayed_stream_once(city):
    city.setattr(c.requests, "get", lambda url, params=None, **k: Mock(status_code=200, content=json.dumps(CATALOGUE).encode(), headers={}, raise_for_status=lambda: None))
    token = c.cameras(37.5465, 126.9886)["items"][0]["resolve"].rsplit("/", 1)[1]
    pages = []
    def page(url, params=None, **k):
        pages.append(params)
        return Mock(status_code=200, content=SEOUL_PAGE.encode(), raise_for_status=lambda: None)
    city.setattr(c.requests, "get", page)
    opened = c.open_city(token)
    assert opened["format"] == "hls" and opened["media"].startswith("/api/realestate/cctv/media/")
    assert opened["direct"] == "https://strmu.spatic.go.kr/live/L010001.stream/playlist.m3u8"
    assert "fixture-city-key" not in str(opened)
    assert c.open_city(token) == opened and len(pages) == 1, "a resolved camera is not fetched again"
    assert pages[0]["kind"] == "Seoul" and pages[0]["cctvip"] == "L010001"
    target = c._media[opened["media"].rsplit("/", 1)[1]][0]
    assert target == "https://strmu.spatic.go.kr/live/L010001.stream/playlist.m3u8", "commented old addresses are ignored"


def test_page_without_video_is_a_failure_not_a_stream(city):
    url, frame = c._page_media('<div id="cctvarea"><source src="https://strmu.spatic.go.kr/live/null.stream/playlist.m3u8"></div>', c.UTIC_PAGE)
    assert url is None and frame is None


def test_unknown_city_reference_does_not_fetch(city):
    city.setattr(c.requests, "get", lambda *a, **k: pytest.fail("unexpected fetch"))
    with pytest.raises(LookupError):
        c.open_city("unknown-reference-token-000")


def test_provider_errors_are_not_repeated_within_ten_seconds(city):
    calls = []
    def fail(url):
        calls.append(url)
        raise c.MediaProviderError(502)
    city.setattr(c, "_public_fetch", fail)
    token = c._remember("https://strmu.spatic.go.kr/live/x.stream/playlist.m3u8")
    for _ in range(3):
        with pytest.raises(c.MediaProviderError):
            c.media(token)
    assert len(calls) == 1


def test_html_catalogue_takes_positions_from_the_public_camera_map(city):
    page = ("<table><tr><td><a href=\"javascript:test('L010001')\">12649.남산</a></td></tr>"
        "<tr><td><a href=\"javascript:test('E970016')\">1.서울광장</a></td></tr></table>").encode()
    camera_map = [{"CCTVID": "L010001", "CCTVNAME": "남산1호터널", "XCOORD": 126.9886, "YCOORD": 37.5465, "KIND": "X", "MOVIE": "Y", "CCTVIP": "L010001"},
        {"CCTVID": "E970016", "CCTVNAME": "서울광장", "XCOORD": 126.97887, "YCOORD": 37.56496, "KIND": "EC", "CH": 53, "ID": "274", "MOVIE": "Y"},
        {"CCTVID": "unlisted", "CCTVNAME": "Not for this key", "XCOORD": 126.98, "YCOORD": 37.55, "MOVIE": "Y"}]
    calls = []
    def get(url, params=None, **k):
        calls.append(url)
        body = page if url == c.UTIC_LIST else json.dumps(camera_map).encode()
        return Mock(status_code=200, content=body, headers={}, raise_for_status=lambda: None)
    city.setattr(c.requests, "get", get)
    items = c.cameras(37.5465, 126.9886)["items"]
    assert calls == [c.UTIC_LIST, c.UTIC_MAP]
    assert sorted(i["id"] for i in items) == ["utic:E970016", "utic:L010001"], "only cameras the key lists"
    rows = c._utic["rows"]
    assert rows["L010001"]["kind"] == "Seoul", "kind from the ID prefix, as UTIC's player does"
    assert rows["E970016"]["ch"] == "53" and rows["E970016"]["user"] == "274"
    c.cameras(37.5465, 126.9886)
    assert len(calls) == 2, "both lists are kept for hours"
