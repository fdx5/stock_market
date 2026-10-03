import sqlite3
import sys
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import page_view_store as pages, support_analytics_store as store
from app.routers import support_analytics, activity
from app.services.admin_auth import require_admin


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(pages, '_conn', None)
    monkeypatch.setattr(pages, '_connect', lambda: sqlite3.connect(tmp_path/'activity.db', check_same_thread=False))
    app = FastAPI()
    app.include_router(support_analytics.router, prefix='/api/admin')
    app.include_router(activity.router, prefix='/api/activity')
    yield TestClient(app), app
    if pages._conn:
        pages._conn.close()
        pages._conn = None


def seed(session, hours, path='/support', kind='page_view', bot=False, key=None):
    now = (datetime.now(timezone.utc)-timedelta(hours=hours)).isoformat()
    pages.record_page_view(session,path,now,kind,label='<script>alert(1)</script>',is_bot=bot,object_key=key)
    return now


def test_ranges_sessions_dedup_restart_and_detail(env):
    client, app = env
    a,b,c = [str(uuid.uuid4()) for _ in range(3)]
    seed(a,1); now=seed(a,.5,kind='click',key='support-pay')
    seed(b,30); seed(c,60); seed(str(uuid.uuid4()),2,bot=True)
    seed(str(uuid.uuid4()),1,path='/desk')
    packet=str(uuid.uuid4())
    store.record(a,packet,15,now); store.record(a,packet,15,now)
    pages._conn.close(); pages._conn=None
    assert client.get('/api/admin/support-log').status_code==401
    app.dependency_overrides[require_admin]=lambda: 'admin'
    for hours,count in [(24,1),(48,2),(72,3),(168,3)]:
        response=client.get(f'/api/admin/support-log?hours={hours}')
        assert response.status_code==200, response.text
        result=response.json()
        assert result['total']==count
        assert result['summary']['seconds']==15
        assert result['summary']['pay_clicks']==1
    detail=client.get(f'/api/admin/support-log?session_id={a}').json()
    assert [e['type'] for e in detail['events']]==['page_view','click']
    assert detail['events'][1]['label']=='<script>alert(1)</script>'
    assert client.get('/api/admin/support-log?hours=30').status_code==422
    assert client.get('/api/admin/support-log?session_id=sql-injection').status_code==422
    assert client.get('/api/admin/support-log?offset=-1').status_code==422


def test_packet_limits_bot_exclusion_and_recording(env):
    client,_=env
    body=dict(session_id=str(uuid.uuid4()),type='support',path='/support',action='dwell',value=12,object_key=str(uuid.uuid4()))
    for changes in [dict(value=31),dict(path='/desk'),dict(action='control'),dict(object_key='bad'),dict(value=0)]:
        assert client.post('/api/activity/event',json={**body,**changes}).status_code==422
    assert client.post('/api/activity/event',json=body,headers={'user-agent':'Googlebot'}).status_code==200
    assert pages._with_connection(lambda c:c.execute('SELECT COUNT(*) FROM support_dwell').fetchone()[0])==0
    assert client.post('/api/activity/event',json=body).status_code==200
    assert client.post('/api/activity/event',json=body).status_code==200
    assert pages._with_connection(lambda c:c.execute('SELECT SUM(seconds) FROM support_dwell').fetchone()[0])==12


def test_pagination_and_time_window_detail(env):
    client,app=env
    app.dependency_overrides[require_admin]=lambda:'admin'
    ids=[str(uuid.uuid4()) for _ in range(52)]
    for sid in ids: seed(sid,1)
    seed(ids[0],100)
    first=client.get('/api/admin/support-log').json()
    second=client.get('/api/admin/support-log?offset=50').json()
    assert first['total']==52 and len(first['items'])==50 and len(second['items'])==2
    assert not set(x['session_id'] for x in first['items']) & set(x['session_id'] for x in second['items'])
    assert len(client.get(f'/api/admin/support-log?session_id={ids[0]}').json()['events'])==1
