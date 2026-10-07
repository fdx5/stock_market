import json
import sys
from collections import deque
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import activity_log, atlas_behavior, visitor_tracker
from app.routers.activity import ActivityEvent


@pytest.fixture
def telemetry(monkeypatch):
    # No existing storage, threads, network or DB cleanup is used by these tests.
    monkeypatch.setattr(activity_log, '_tail', deque(maxlen=500))
    monkeypatch.setattr(activity_log, '_behavior', deque(maxlen=2000))
    monkeypatch.setattr(activity_log, '_sessions', {})
    monkeypatch.setattr(activity_log.time, 'time', lambda: 1000)
    monkeypatch.setattr(activity_log.threading, 'Thread', lambda **kw: SimpleNamespace(start=lambda: None))
    monkeypatch.setattr(visitor_tracker.tracker, '_sessions', {})


def test_real_actions_survive_dwell_noise_and_bots_never_enter(telemetry):
    activity_log.record_event('person-a', 'page_view', '/stocks', label='종목정보')
    activity_log.record_event('person-a', 'click', '/stocks', label='종목 선택 · 삼성전자')
    for _ in range(2100):
        activity_log.record_event('person-a', 'hub', '/', action='dwell', value=20)
    activity_log.record_event('person-a', 'hub', '/', action='focus', label='관심 대상')
    activity_log.record_event('crawler', 'click', '/stocks', label='BOT', is_bot=True)
    activity_log.record_event('admin', 'click', '/admin/system-atlas', label='관리자')
    snapshot = atlas_behavior.snapshot(1000)
    assert snapshot['event_count'] == 3
    assert len(snapshot['sessions']) == 1
    assert [e['type'] for e in snapshot['sessions'][0]['events']] == ['page_view', 'click', 'hub']
    assert 'BOT' not in json.dumps(snapshot)


def test_alias_privacy_order_presence_and_snapshot_is_read_only(telemetry):
    # A navigation received after a click is still plotted before that click.
    activity_log.record_event('private-session', 'click', '/stocks', label='조회', occurred_at=990)
    activity_log.record_event('private-session', 'page_view', '/stocks?token=SECRET#email', occurred_at=980)
    activity_log.record_event('other-person', 'stock_view', '/stock/AAPL', stock_code='AAPL', stock_name='Apple')
    visitor_tracker.tracker._sessions.update({'private-session': 995, 'quiet-session': 999, 'expired-session': 800})
    before = list(activity_log._behavior)
    states = {sid: dict(state) for sid, state in activity_log._sessions.items()}
    first = atlas_behavior.snapshot(1000)
    second = atlas_behavior.snapshot(1000)
    assert first == second
    assert first['online_count'] == 2 and first['active_count'] == 2
    assert len(first['sessions']) == 3
    events = next(s['events'] for s in first['sessions'] if len(s['events']) == 2)
    assert [e['ts'] for e in events] == [980, 990]
    assert events[0]['path'] == '/stocks'
    assert any(s['online'] and not s['active'] and not s['events'] for s in first['sessions'])
    payload = json.dumps(first)
    for secret in ('private-session', 'other-person', 'quiet-session', 'SECRET', 'email', 'session_id', 'referrer', 'user_agent'):
        assert secret not in payload
    assert list(activity_log._behavior) == before and activity_log._sessions == states
    assert 'expired-session' in visitor_tracker.tracker._sessions


def test_window_boundaries_truncation_and_all_sessions(telemetry, monkeypatch):
    rows = [{'id': i, 'ts': ts, 'session_id': f's-{i}', 'type': 'page_view', 'path': '/desk'}
            for i, ts in enumerate([99, 100, 1000, 1001])]
    monkeypatch.setattr(activity_log, '_behavior', deque(rows, maxlen=2000))
    data = atlas_behavior.snapshot(1000)
    assert sorted(e['ts'] for s in data['sessions'] for e in s['events']) == [100, 1000]
    rows = [{'id': i, 'ts': 999, 'session_id': f's-{i}', 'type': 'click', 'path': '/map'} for i in range(150)]
    monkeypatch.setattr(activity_log, '_behavior', deque(rows, maxlen=2000))
    assert len(atlas_behavior.snapshot(1000)['sessions']) == 150, 'all observed sessions remain selectable'
    rows = [{**rows[0], 'id': i} for i in range(90)]
    monkeypatch.setattr(activity_log, '_behavior', deque(rows, maxlen=2000))
    data = atlas_behavior.snapshot(1000)
    assert data['event_count'] == 90 and data['truncated']
    assert len(data['sessions'][0]['events']) == 80


def test_duplicate_navigation_and_untrusted_clock(telemetry):
    activity_log.record_event('s', 'page_view', '/desk', occurred_at=990)
    activity_log.record_event('s', 'page_view', '/desk', occurred_at=990)
    activity_log.record_event('s', 'click', '/desk', occurred_at=5000)
    activity_log.record_event('s', 'click', '/desk', occurred_at=1)
    events = atlas_behavior.snapshot(1000)['sessions'][0]['events']
    assert [e['ts'] for e in events] == [990, 1000, 1000]
    with pytest.raises(ValueError):
        ActivityEvent(session_id='11111111-1111-4111-8111-111111111111', type='click', path='/desk', occurred_at=float('nan'))


def test_sessions_rank_actions_before_heartbeat_presence_and_reorder_live(telemetry, monkeypatch):
    rows = [dict(id=i, ts=ts, session_id=sid, type='click', path='/stocks')
            for i, (sid, ts) in enumerate([('older-action', 800), ('active-online', 970), ('active-no-heartbeat', 990)])]
    monkeypatch.setattr(activity_log, '_behavior', deque(rows, maxlen=2000))
    visitor_tracker.tracker._sessions.update({'quiet': 1000, 'older-action': 999, 'active-online': 980})
    snapshot = atlas_behavior.snapshot(1000)
    aliases = {sid: atlas_behavior._alias(sid) for sid in ('quiet', 'older-action', 'active-online', 'active-no-heartbeat')}
    assert [s['id'] for s in snapshot['sessions']] == [aliases[sid] for sid in
        ('active-no-heartbeat', 'active-online', 'older-action', 'quiet')]
    # A new action promotes its own session, without changing any session identity.
    activity_log._behavior.append(dict(id=10, ts=1000, session_id='active-online', type='click', path='/map'))
    updated = atlas_behavior.snapshot(1000)
    assert [s['id'] for s in updated['sessions']] == [aliases[sid] for sid in
        ('active-online', 'active-no-heartbeat', 'older-action', 'quiet')]


def test_activity_route_accepts_old_clients_and_forwards_occurrence_time(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routers import activity
    received = []
    monkeypatch.setattr(activity_log, 'record_event', lambda **data: received.append(data))
    app = FastAPI()
    app.include_router(activity.router)
    client = TestClient(app)
    body = dict(session_id='11111111-1111-4111-8111-111111111111', type='click', path='/stocks')
    assert client.post('/event', json=body).status_code == 200
    assert received[-1]['occurred_at'] is None
    assert client.post('/event', json={**body, 'occurred_at': 990}).status_code == 200
    assert received[-1]['occurred_at'] == 990
    assert client.post('/event', json={**body, 'occurred_at': -1}).status_code == 422
