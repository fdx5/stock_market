"""Isolated HTTP/memory fixtures; no store, credentials or production DB access."""
import json
import logging
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
from urllib.parse import parse_qs, urlsplit

import pytest
import requests

from app.data import global_top100_batch_quote as top
from app.data import yahoo_batch_transport as transport
from app.data import yahoo_bulk_quote as bulk
from app.data import yahoo_session as auth
from app.data.http_pool import mount_pool


def response(status=200, rows=None, headers=None, payload=None):
    value = requests.Response()
    value.status_code = status
    value.url = transport.QUOTE_URLS[0] + '?crumb=private-fixture-token'
    value.headers.update(headers or {})
    value._content = json.dumps(payload if payload is not None else {
        'quoteResponse': {'result': rows or [], 'error': None}
    }).encode()
    value._content_consumed = True
    return value


def row(symbol='AAPL', price=100):
    return dict(symbol=symbol, regularMarketPrice=price, regularMarketPreviousClose=99,
                regularMarketChangePercent=1.01, currency='USD')


class Session:
    def __init__(self, handler):
        self.handler = handler
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.handler(url, kwargs)


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(transport, '_gate', transport._QuoteGate())
    monkeypatch.setattr(auth, '_session', None)
    monkeypatch.setattr(auth, '_crumb', None)
    monkeypatch.setattr(auth, '_crumb_at', 0)
    monkeypatch.setattr(auth, '_blocked_until', 0)
    monkeypatch.setattr(auth, '_failures', 0)


def use_session(monkeypatch, handler):
    session = Session(handler)
    monkeypatch.setattr(auth, 'get_crumb', lambda force_refresh=False: (session, 'private-fixture-token'))
    return session


def test_timeout_switches_host_and_shares_cooldown_with_us_maps(monkeypatch, caplog):
    def handler(url, kwargs):
        if url == transport.QUOTE_URLS[0]:
            raise requests.ReadTimeout('sensitive exception text')
        return response(rows=[row()])
    session = use_session(monkeypatch, handler)
    with caplog.at_level(logging.INFO):
        assert top.fetch_live_quotes(['AAPL'])['AAPL']['price'] == 100
        assert top.fetch_live_quotes(['AAPL'])['AAPL']['price'] == 100
        assert bulk.get_quotes(['AAPL'])['AAPL']['close'] == 100
    assert [url for url, _ in session.calls] == [transport.QUOTE_URLS[0]] + [transport.QUOTE_URLS[1]] * 3
    assert 'read_timeout' in caplog.text
    assert 'private-fixture-token' not in caplog.text and 'sensitive' not in caplog.text
    assert not any(record.levelno >= logging.WARNING for record in caplog.records)


def test_fresh_rejected_credential_is_not_sent_twice(monkeypatch):
    session = Session(lambda url, kwargs: response(401) if url == transport.QUOTE_URLS[0] else response(rows=[row()]))
    renewals = []
    def crumb(force_refresh=False):
        renewals.append(force_refresh)
        return session, 'same'
    monkeypatch.setattr(auth, 'get_crumb', crumb)
    assert top.fetch_live_quotes(['AAPL'])['AAPL']['price'] == 100
    assert len(session.calls) == 2
    assert renewals == [False, True, False]
    assert transport._gate._states[transport.QUOTE_URLS[0]].failures == 1


def test_replaced_credential_retries_once_and_recovers(monkeypatch):
    old = Session(lambda *args: response(401))
    renewed = Session(lambda *args: response(rows=[row()]))
    monkeypatch.setattr(auth, 'get_crumb', lambda force_refresh=False: (renewed, 'new') if force_refresh else (old, 'old'))
    assert top.fetch_live_quotes(['AAPL'])['AAPL']['price'] == 100
    assert len(old.calls) == len(renewed.calls) == 1
    assert transport._gate._states[transport.QUOTE_URLS[0]].failures == 0


def test_timeout_after_auth_replacement_is_a_network_failure(monkeypatch):
    monkeypatch.setattr(transport.time, 'monotonic', lambda: 1000)
    old = Session(lambda *args: response(401))
    def timeout(*args): raise requests.ReadTimeout()
    renewed = Session(timeout)
    monkeypatch.setattr(auth, 'get_crumb', lambda force_refresh=False: (renewed, 'new') if force_refresh else (old, 'old'))
    with pytest.raises(transport.QuoteUnavailable): transport.fetch_rows_from(transport.QUOTE_URLS[0], ['AAPL'])
    assert len(old.calls) == len(renewed.calls) == 1
    assert transport._gate._states[transport.QUOTE_URLS[0]].retry_at == 1060


def test_both_hosts_throttled_stop_all_chunk_requests_and_honor_retry_after(monkeypatch, caplog):
    monkeypatch.setattr(transport.time, 'monotonic', lambda: 1000)
    session = use_session(monkeypatch, lambda *args: response(429, headers={'Retry-After': '1200'}))
    with caplog.at_level(logging.WARNING):
        for _ in range(5):
            assert top.fetch_live_quotes([f'S{i}' for i in range(120)]) == {}
            assert bulk.get_quotes(['AAPL', 'MSFT']) == {}
    assert len(session.calls) == 2
    assert all(state.retry_at == 2200 for state in transport._gate._states.values())
    assert not caplog.text


def test_single_recovery_probe_and_late_success_cannot_clear_failure(monkeypatch):
    monkeypatch.setattr(transport.time, 'monotonic', lambda: 1000)
    gate = transport._QuoteGate(); url = transport.QUOTE_URLS[0]
    generations = [gate.begin(url) for _ in range(transport.MAX_CONCURRENT_PER_HOST)]
    with pytest.raises(transport.QuoteUnavailable): gate.begin(url)
    gate.finish(url, generations[0], 'read_timeout')
    for generation in generations[1:]: gate.finish(url, generation, None)
    assert gate._states[url].failures == 1
    assert gate._states[url].retry_at == 1060
    assert gate._states[url].inflight == 0
    gate._states[url].retry_at = 0
    probe = gate.begin(url)
    with pytest.raises(transport.QuoteUnavailable): gate.begin(url)
    gate.finish(url, probe, None)
    assert gate._states[url].failures == 0
    assert gate._states[url].inflight == 0


def test_backoff_is_bounded_and_recovers_on_valid_probe(monkeypatch):
    monkeypatch.setattr(transport.time, 'monotonic', lambda: 1000)
    gate = transport._QuoteGate(); url = transport.QUOTE_URLS[0]
    for expected in [60, 120, 240, 480, 900, 900]:
        gate._states[url].retry_at = 0
        generation = gate.begin(url); gate.finish(url, generation, 'server_error', 503)
        assert gate._states[url].retry_at == 1000 + expected
    gate._states[url].retry_at = 0
    gate.finish(url, gate.begin(url), None)
    assert gate._states[url].failures == 0


def test_skipped_handshake_does_not_count_as_a_successful_host_recovery(monkeypatch):
    url = transport.QUOTE_URLS[0]
    transport._gate._states[url].failures = 2
    def unavailable(force_refresh=False): raise auth.CrumbUnavailable('fixture')
    monkeypatch.setattr(auth, 'get_crumb', unavailable)
    with pytest.raises(auth.CrumbUnavailable): transport.fetch_rows_from(url, ['AAPL'])
    state = transport._gate._states[url]
    assert state.failures == 2 and state.inflight == 0 and not state.probing


def test_malformed_payload_uses_other_host_without_losing_valid_rows(monkeypatch):
    session = use_session(monkeypatch, lambda url, kwargs: response(payload={'oops': []}) if url == transport.QUOTE_URLS[0] else response(rows=[row(), row('MSFT', 'NaN'), row('EXTRA')]))
    result = top.fetch_live_quotes(['AAPL', 'MSFT'])
    assert set(result) == {'AAPL'} and result['AAPL']['price'] == 100
    assert len(session.calls) == 2
    assert transport._gate._states[transport.QUOTE_URLS[0]].failures == 1


def test_empty_symbol_response_does_not_poison_host(monkeypatch):
    available = [False]
    use_session(monkeypatch, lambda *args: response(rows=[row()] if available[0] else []))
    assert top.fetch_live_quotes(['UNKNOWN']) == {}
    assert all(state.failures == 0 for state in transport._gate._states.values())
    available[0] = True
    assert top.fetch_live_quotes(['AAPL'])['AAPL']['price'] == 100


def test_successful_chunk_survives_later_handshake_failure_and_symbols_deduplicate(monkeypatch):
    calls = []
    def chunk(symbols):
        calls.append(symbols)
        if len(calls) > 1: raise auth.CrumbUnavailable('fixture')
        return {symbols[0]: {'price': 100}}
    monkeypatch.setattr(top, '_fetch_chunk', chunk)
    symbols = [f'S{i}' for i in range(55)] + ['S0', 'S1']
    assert top.fetch_live_quotes(symbols) == {'S0': {'price': 100}}
    assert list(map(len, calls)) == [50, 5]


def test_first_handshake_failure_is_managed_and_logged_only_once(monkeypatch, caplog):
    attempts = []
    def unavailable():
        attempts.append(1)
        raise requests.HTTPError('private-fixture-token', response=response(429))
    monkeypatch.setattr(auth, '_new_session_and_crumb', unavailable)
    with caplog.at_level(logging.WARNING):
        for _ in range(5):
            assert top.fetch_live_quotes([f'S{i}' for i in range(100)]) == {}
            assert bulk.get_quotes(['AAPL']) == {}
    assert len(attempts) == 1
    assert len(caplog.records) == 1 and caplog.records[0].name == auth.__name__
    assert 'private-fixture-token' not in caplog.text


def test_retry_after_date_and_jitter_never_undercut_requested_delay(monkeypatch):
    monkeypatch.setattr(auth.time, 'time', lambda: 1000)
    monkeypatch.setattr(auth.random, 'uniform', lambda *args: .85)
    assert auth._retry_after_seconds(response(headers={'Retry-After': formatdate(1200, usegmt=True)})) == 200
    assert auth._retry_after_seconds(response(headers={'Retry-After': 'NaN'})) is None
    assert auth._retry_after_seconds(response(headers={'Retry-After': 'inf'})) is None
    def unavailable(): raise auth._Throttled(200)
    monkeypatch.setattr(auth, '_new_session_and_crumb', unavailable)
    with pytest.raises(auth.CrumbUnavailable): auth.get_crumb()
    assert auth._blocked_until >= 1200


@pytest.mark.parametrize('meta', ['bad', {'regularMarketPrice': 'NaN'}, {'regularMarketPrice': 100, 'previousClose': 'bad'}])
def test_chart_invalid_fields_do_not_raise_or_discard_other_symbols(monkeypatch, meta):
    monkeypatch.setattr(top.requests, 'get', lambda *a, **k: response(payload={'chart': {'result': [{'meta': meta}]}}))
    quote = top._chart_quote('AAPL')
    assert quote is None if not isinstance(meta, dict) or meta.get('regularMarketPrice') == 'NaN' else quote['price'] == 100 and quote['change_pct'] is None


def test_real_read_timeout_is_not_retried_or_repeated_for_each_chunk(monkeypatch, caplog):
    calls = {'primary': 0, 'backup': 0}
    class Upstream(BaseHTTPRequestHandler):
        def do_GET(self):
            name = 'primary' if self.path.startswith('/primary') else 'backup'
            calls[name] += 1
            if name == 'primary': time.sleep(.12)
            symbols = parse_qs(urlsplit(self.path).query).get('symbols', [''])[0].split(',')
            payload = json.dumps({'quoteResponse': {'result': [row(s) for s in symbols], 'error': None}}).encode()
            self.send_response(200); self.end_headers()
            try: self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError): pass
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    urls = tuple(f'http://127.0.0.1:{server.server_port}/{name}' for name in ('primary', 'backup'))
    monkeypatch.setattr(transport, 'QUOTE_URLS', urls)
    monkeypatch.setattr(transport, '_gate', transport._QuoteGate())
    monkeypatch.setattr(transport, 'TIMEOUT', (.03, .03))
    session = mount_pool(requests.Session(), max_retries=0)
    monkeypatch.setattr(auth, 'get_crumb', lambda force_refresh=False: (session, 'fixture'))
    try:
        with caplog.at_level(logging.WARNING):
            for _ in range(3): assert len(top.fetch_live_quotes([f'S{i}' for i in range(120)])) == 120
        assert calls == {'primary': 1, 'backup': 9}
        assert 'Retrying' not in caplog.text and 'chunk fetch failed' not in caplog.text
    finally:
        session.close(); server.shutdown(); server.server_close(); thread.join(timeout=2)
