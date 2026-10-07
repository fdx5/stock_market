import json
import sys
import time
from collections import deque
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.routers import system_atlas as router
from app.services import admin_auth, api_pulse, system_atlas, system_telemetry


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api_pulse, '_tail', deque(maxlen=600))
    monkeypatch.setattr(system_telemetry, '_events', deque(maxlen=2400))
    monkeypatch.setattr(admin_auth, '_sessions', {'admin-fixture': (time.time() + 300, admin_auth.SCOPE_ADMIN),
                                               'monitor-fixture': (time.time() + 300, admin_auth.SCOPE_MONITOR)})
    app = FastAPI()
    app.include_router(router.router, prefix='/api/admin')

    @app.get('/api/stock/{code}/quote')
    def quote(): return {'ok': True}

    return TestClient(app)


def test_full_admin_scope_is_required(client):
    for path in ('architecture', 'snapshot', 'health'):
        assert client.get('/api/admin/atlas/' + path).status_code == 401
        assert client.get('/api/admin/atlas/' + path, headers={'Authorization': 'Bearer monitor-fixture'}).status_code == 401
        if path == 'health': continue  # the health body reaches a DB; checked separately with a fixture
        response = client.get('/api/admin/atlas/' + path, headers={'Authorization': 'Bearer admin-fixture'})
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'


def test_runtime_route_inventory_and_valid_edges(client):
    graph = client.get('/api/admin/atlas/architecture', headers={'Authorization': 'Bearer admin-fixture'}).json()
    assert any(e['path'] == '/api/stock/{code}/quote' for e in graph['endpoints'])
    ids = {n['id'] for n in graph['nodes']}
    assert all(e['source'] in ids and e['target'] in ids for e in graph['edges'])
    assert any(m['tables'] for m in graph['modules'])
    assert '/admin/system-atlas' in graph['frontend']['routes']
    assert 'fastapi' in graph['backend_dependencies']


def test_sample_window_empty_latency_errors_and_monitor_exclusion(client, monkeypatch):
    api_pulse.record('/api/stock/{code}/quote', 'GET', 200, 100)
    api_pulse.record('/api/stock/{code}/quote', 'GET', 503, 700)
    api_pulse.record('/api/admin/atlas/snapshot', 'GET', 200, 9000)
    api_pulse._tail.append({'id': 999, 'ts': time.time() - 120, 'route': '/api/stock/{code}/quote', 'method': 'GET', 'status': 200, 'ms': 99999})
    system_telemetry.record('query1.finance.yahoo.com', 'GET', 200, 50)
    system_telemetry.record('query1.finance.yahoo.com', 'GET', 0, 90)
    snap = client.get('/api/admin/atlas/snapshot', headers={'Authorization': 'Bearer admin-fixture'}).json()
    assert snap['api']['count'] == 2 and snap['api']['errors'] == 1
    assert snap['api']['p95_ms'] == 700
    assert snap['external']['groups']['ext-market']['count'] == 2
    assert snap['external']['errors'] == 1
    assert system_telemetry.stats([])['avg_ms'] is None
    assert system_telemetry.stats([])['p95_ms'] is None


def test_http_observer_preserves_response_and_never_retains_credentials(monkeypatch):
    import requests
    from types import SimpleNamespace
    monkeypatch.setattr(system_telemetry, '_installed', False)
    monkeypatch.setattr(system_telemetry, '_events', deque(maxlen=2400))
    response = SimpleNamespace(status_code=200)
    monkeypatch.setattr(requests.adapters.HTTPAdapter, 'send', lambda *args, **kwargs: response)
    system_telemetry.install()
    wrapped = requests.adapters.HTTPAdapter.send
    system_telemetry.install()
    assert requests.adapters.HTTPAdapter.send is wrapped
    request = requests.Request('GET', 'https://example.com/private?token=TOPSECRET', headers={'Authorization': 'TOPSECRET'}).prepare()
    assert requests.adapters.HTTPAdapter().send(request) is response
    encoded = json.dumps(system_telemetry.snapshot())
    assert 'example.com' in encoded and 'TOPSECRET' not in encoded and '/private' not in encoded
    assert 'headers' not in encoded


def test_http_failure_is_recorded_and_original_error_propagates(monkeypatch):
    import requests
    monkeypatch.setattr(system_telemetry, '_installed', False)
    monkeypatch.setattr(system_telemetry, '_events', deque(maxlen=2400))
    def fail(*args, **kwargs): raise requests.ConnectionError('sensitive-url-token')
    monkeypatch.setattr(requests.adapters.HTTPAdapter, 'send', fail)
    system_telemetry.install()
    with pytest.raises(requests.ConnectionError):
        requests.adapters.HTTPAdapter().send(requests.Request('GET', 'https://example.com/').prepare())
    observed = system_telemetry.snapshot()
    assert observed['errors'] == 1 and observed['recent'][0]['status'] == 0
    assert 'sensitive-url-token' not in json.dumps(observed)


def test_api_request_context_connects_sync_http_call_and_does_not_expose_raw_path(monkeypatch):
    import requests
    monkeypatch.setenv('PYTHON_DOTENV_DISABLED', '1')
    monkeypatch.setenv('TURSO_DATABASE_URL', '')
    monkeypatch.setenv('REALESTATE_TURSO_DATABASE_URL', '')
    monkeypatch.setattr(system_telemetry, '_installed', False)
    monkeypatch.setattr(system_telemetry, '_events', deque(maxlen=2400))
    monkeypatch.setattr(api_pulse, '_tail', deque(maxlen=600))
    def fake_send(self, request, **kwargs):
        response = requests.Response(); response.status_code = 200
        response._content = b'OK'; response.request = request; response.url = request.url
        return response
    monkeypatch.setattr(requests.adapters.HTTPAdapter, 'send', fake_send)
    from app.main import app
    system_telemetry.install()
    @app.get('/api/atlas-context-probe/{code}')
    def probe(code: str):
        requests.get('https://example.com/private?token=NEVER_RECORD')
        return {'ok': True}
    @app.get('/api/atlas-error-probe')
    def error_probe():
        raise RuntimeError('fixture failure')
    try:
        client = TestClient(app)  # no lifespan; no warmers or upstream traffic
        assert client.get('/api/atlas-context-probe/PRIVATE_CODE').status_code == 200
        external = system_telemetry.snapshot()['recent'][0]
        api_events, _ = api_pulse.since(0, 10)
        assert external['route'] == '/api/atlas-context-probe/{code}'
        assert external['trace_id'] == api_events[0]['trace_id']
        assert 'PRIVATE_CODE' not in json.dumps(external) and 'NEVER_RECORD' not in json.dumps(external)
        assert system_telemetry.request_id() is None
        assert TestClient(app, raise_server_exceptions=False).get('/api/atlas-error-probe').status_code == 500
        api_events, _ = api_pulse.since(0, 10)
        assert api_events[-1]['status'] == 500
        count = len(api_events)
        assert client.get('/api/admin/atlas/snapshot').status_code == 401
        assert len(api_pulse.since(0, 10)[0]) == count, 'observing must not generate API observations'
    finally:
        app.routes.pop()
        app.routes.pop()


def test_external_classification_separates_finance_resources_payments_and_databases(monkeypatch):
    monkeypatch.setenv('TURSO_DATABASE_URL', 'libsql://main.example.turso.io')
    monkeypatch.setenv('REALESTATE_TURSO_DATABASE_URL', 'libsql://estate.example.turso.io')
    assert system_atlas.host_group('main.example.turso.io') == 'database'
    assert system_atlas.host_group('estate.example.turso.io') == 'estate-db'
    assert system_atlas.host_group('qr.kakaopay.com') == 'ext-pay'
    assert system_atlas.host_group('cdn.jsdelivr.net') == 'ext-resources'
    assert system_atlas.host_group('query1.finance.yahoo.com') == 'ext-market'
    assert system_atlas.host_group('apis.data.go.kr') == 'ext-spatial'


def test_distributions_percentiles_and_timeline_conserve_samples():
    now = 1000
    rows = [{'ts': 940 + i * 10, 'ms': ms, 'status': code}
            for i, (ms, code) in enumerate([(50, 200), (100, 302), (300, 404), (1000, 503), (3000, 0), (500, 200)])]
    stats = system_telemetry.stats(rows)
    assert (stats['p50_ms'], stats['p95_ms'], stats['max_ms'], stats['slow']) == (300, 3000, 3000, 2)
    data = system_telemetry.breakdown(rows, now)
    assert data['status'] == {'2xx': 2, '3xx': 1, '4xx': 1, '5xx': 1, 'transport': 1}
    assert data['latency'] == [1, 1, 2, 1, 1]
    assert len(data['timeline']) == 12
    assert sum(b['count'] for b in data['timeline']) == len(rows)
    assert sum(b['errors'] for b in data['timeline']) == stats['errors']
    assert system_telemetry.stats([])['p50_ms'] is None
    assert system_telemetry.stats([])['max_ms'] is None


def test_method_specific_metrics_and_trace_calls_beyond_display_tail(client):
    from types import SimpleNamespace
    path = '/api/stock/{code}/quote'
    token = system_telemetry.begin_request({'route': SimpleNamespace(path=path)})
    trace_id = system_telemetry.request_id()
    for _ in range(35):
        system_telemetry.record('query1.finance.yahoo.com', 'GET', 200, 100)
    api_pulse.record(path, 'GET', 200, 4500, trace_id=trace_id)
    system_telemetry.end_request(token)
    api_pulse.record(path, 'POST', 503, 2000)
    # These background calls evict the request calls from the 60-event display tail.
    for _ in range(65):
        system_telemetry.record('m.stock.naver.com', 'GET', 404, 500)
    snap = client.get('/api/admin/atlas/snapshot', headers={'Authorization': 'Bearer admin-fixture'}).json()
    methods = {e['method']: e for e in snap['api']['endpoints']}
    assert methods['GET']['count'] == 1 and methods['GET']['errors'] == 0
    assert methods['POST']['errors'] == 1 and methods['POST']['p95_ms'] == 2000
    trace = snap['traces'][0]
    assert trace['request']['trace_id'] == trace_id
    assert trace['external_count'] == 35 and len(trace['calls']) == 30 and trace['calls_truncated']
    assert len(snap['external']['recent']) == 60
    assert not any(e.get('trace_id') == trace_id for e in snap['external']['recent'])
    group = snap['external']['groups']['ext-market']
    assert group['count'] == 100 and group['p95_ms'] == 500 and group['p50_ms'] == 500
    assert 'request_calls' not in snap['external']


def test_external_recent_excludes_expired_and_future_samples(monkeypatch):
    monkeypatch.setattr(system_telemetry, '_events', deque([
        {'id': i, 'ts': ts, 'host': 'example.com', 'status': 200, 'method': 'GET', 'ms': 20}
        for i, ts in enumerate((100, 950, 1100))], maxlen=2400))
    snap = system_telemetry.snapshot(1000)
    assert snap['count'] == 1 and len(snap['recent']) == 1
    assert snap['recent'][0]['ts'] == 950


def test_atlas_health_transport_does_not_pollute_external_metrics(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(system_telemetry, '_events', deque(maxlen=2400))
    token = system_telemetry.begin_request({'route': SimpleNamespace(path='/api/admin/atlas/health')})
    system_telemetry.record('shared.turso.io', 'POST', 200, 120)
    system_telemetry.end_request(token)
    assert system_telemetry.snapshot()['count'] == 0
    system_telemetry.record('shared.turso.io', 'POST', 200, 120)
    assert system_telemetry.snapshot()['count'] == 1
