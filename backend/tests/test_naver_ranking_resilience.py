"""Independent socket/memory fixtures; never connect to an application database."""
import json
import logging
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from http.client import RemoteDisconnected
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests
from urllib3.exceptions import ProtocolError

from app.data import naver_price_fetcher as naver
from app.data.http_pool import mount_pool


def payload(code='001234', price=100):
    return {'stocks': [{'itemCode': code, 'stockName': 'fixture', 'closePriceRaw': str(price),
                       'marketValueRaw': '10000', 'fluctuationsRatio': '1'}], 'totalCount': 100}


def response(data=None, status=200, retry_after=None):
    value = requests.Response(); value.status_code = status
    value._content = json.dumps(data if data is not None else payload()).encode()
    value._content_consumed = True
    if retry_after: value.headers['Retry-After'] = retry_after
    return value


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(naver, '_last_good', OrderedDict())
    monkeypatch.setattr(naver, '_slots', threading.BoundedSemaphore(4))
    for key, value in [('_failures', 0), ('_retry_at', 0), ('_generation', 0), ('_probing', False)]:
        monkeypatch.setattr(naver, key, value)


def test_real_remote_disconnect_recovers_once_on_a_fresh_connection(monkeypatch, caplog):
    connections = []
    class Upstream(BaseHTTPRequestHandler):
        def do_GET(self):
            connections.append(self.client_address)
            if len(connections) == 1:
                self.close_connection = True
                return
            body = json.dumps(payload()).encode()
            self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    session = mount_pool(requests.Session(), max_retries=0)
    monkeypatch.setattr(naver, '_session', session)
    try:
        with caplog.at_level(logging.WARNING):
            data = naver._read_page(f'http://127.0.0.1:{server.server_port}/ranking', {'page': 2})
        assert data == payload() and len(connections) == 2
        assert connections[0] != connections[1]
        assert 'Retrying' not in caplog.text
    finally:
        session.close(); server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_persistent_disconnect_does_not_drop_good_page_or_repeat_requests(monkeypatch, caplog):
    calls = []
    failed = [False]
    class Session:
        headers = {}
        def get(self, *args, **kwargs):
            calls.append(1)
            if failed[0]: raise requests.ConnectionError(ProtocolError('fixture', RemoteDisconnected()))
            return response()
        def close(self): pass
        def mount(self, *args): pass
    monkeypatch.setattr(naver, '_session', Session())
    monkeypatch.setattr(naver.requests, 'Session', Session)
    good = naver.fetch_market_cap_page(2, 1)
    failed[0] = True
    with caplog.at_level(logging.INFO):
        for _ in range(20): assert naver.fetch_market_cap_page(2, 1) == good
    assert len(calls) == 3  # First success + pooled failure + one fresh failure.
    assert naver._failures == 1 and len(caplog.records) == 1
    assert not any(r.levelno >= logging.WARNING for r in caplog.records)
    good[0]['close'] = 0
    assert naver.fetch_market_cap_page(2, 1)[0]['close'] == 100


def test_read_timeout_is_not_immediately_retried(monkeypatch):
    calls = []
    def timeout(*args): calls.append(1); raise requests.ReadTimeout()
    monkeypatch.setattr(naver, '_read_page', timeout)
    for _ in range(5):
        with pytest.raises(naver.MarketPageUnavailable): naver.fetch_market_cap_page(1)
    assert len(calls) == 1


def test_last_good_is_isolated_by_market_and_page(monkeypatch):
    monkeypatch.setattr(naver, '_read_page', lambda *args: payload())
    naver.fetch_market_cap_page(2, 1)
    monkeypatch.setattr(naver, '_retry_at', float('inf'))
    with pytest.raises(naver.MarketPageUnavailable): naver.fetch_market_cap_page(2, 0)
    with pytest.raises(naver.MarketPageUnavailable): naver.fetch_market_cap_page(1, 1)
    assert naver.fetch_market_cap_page(2, 1)


@pytest.mark.parametrize('bad', [{'error': 'fixture'}, {'stocks': [], 'totalCount': 100},
                                 {'stocks': [None]}, payload(price=100) | {'stocks': [{'itemCode': '001234', 'marketValueRaw': 'NaN'}]}])
def test_malformed_response_cannot_replace_last_good(monkeypatch, bad):
    monkeypatch.setattr(naver, '_read_page', lambda *args: payload())
    good = naver.fetch_market_cap_page(1)
    monkeypatch.setattr(naver, '_read_page', lambda *args: bad)
    assert naver.fetch_market_cap_page(1) == good
    assert naver._failures == 1


def test_valid_end_page_is_not_an_outage(monkeypatch):
    monkeypatch.setattr(naver, '_read_page', lambda *args: {'stocks': [], 'totalCount': 50})
    assert naver.fetch_market_cap_page(2) == [] and naver._failures == 0


def test_429_retry_after_and_single_probe_ignore_late_old_success(monkeypatch):
    monkeypatch.setattr(naver.time, 'monotonic', lambda: 1000)
    def limited(*args):
        r = response(status=429, retry_after='1200'); raise requests.HTTPError(response=r)
    monkeypatch.setattr(naver, '_read_page', limited)
    with pytest.raises(naver.MarketPageUnavailable): naver.fetch_market_cap_page(2, 1)
    assert naver._retry_at == 2200
    naver._finish(0, None, succeeded=True)
    assert naver._failures == 1
    monkeypatch.setattr(naver.time, 'monotonic', lambda: 2201)
    generation = naver._begin()
    with pytest.raises(naver.MarketPageUnavailable): naver._begin()
    naver._finish(generation, None, succeeded=True)
    assert naver._failures == 0


def test_concurrent_market_requests_have_at_most_four_connections(monkeypatch):
    active = [0, 0]; lock = threading.Lock(); ready = threading.Event(); release = threading.Event()
    def read(*args):
        with lock:
            active[0] += 1; active[1] = max(active)
            if active[0] == 4: ready.set()
        assert release.wait(3)
        with lock: active[0] -= 1
        return payload()
    monkeypatch.setattr(naver, '_read_page', read)
    with ThreadPoolExecutor(max_workers=12) as pool:
        jobs = [pool.submit(naver.fetch_market_cap_page, i + 1, i % 2) for i in range(12)]
        assert ready.wait(3)
        release.set()
        assert all(job.result() for job in jobs)
    assert active[1] == 4
