import hashlib
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.routers import support, admin_comments
from app.services import support_comment_store as store
from app.services.admin_auth import require_admin


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.delenv('TURSO_DATABASE_URL', raising=False)
    monkeypatch.delenv('RENDER', raising=False)
    monkeypatch.setattr(store, 'LOCAL_DB_PATH', tmp_path / 'support.db')
    monkeypatch.setattr(store, '_conn', None)
    monkeypatch.setattr(support, '_secret', b'test-key-never-used-in-production')
    now = [1800000000]
    monkeypatch.setattr(support.time, 'time', lambda: now[0])
    app = FastAPI()
    app.add_middleware(support.SupportBodyLimit)
    app.include_router(support.router, prefix='/api/support')
    app.include_router(admin_comments.router, prefix='/api/admin')
    client = TestClient(app)
    yield client, now, app
    if store._conn:
        store._conn.close()
        store._conn = None


def payload(client, now, text='감사합니다. 오래 함께해요!', **extra):
    token = client.get('/api/support/comment-token').json()['token']
    now[0] += 4
    return dict(username='커피친구', text=text, token=token, request_id=str(uuid.uuid4()), supported=True, **extra)


def post(client, data, **kwargs):
    return client.post('/api/support/comments', json=data, **kwargs)


def test_save_restart_and_private_fields(env):
    client, now, _ = env
    data = payload(client, now, "' OR 1=1; DROP TABLE support_comments; --")
    response = post(client, data)
    assert response.status_code == 201, response.text
    assert response.json()['text'] == data['text']
    assert set(response.json()) == {'id', 'username', 'text', 'created_at', 'is_visible'}
    store._conn.close()
    store._conn = None
    assert client.get('/api/support/comments').json()['items'][0]['text'] == data['text']
    assert post(client, data).json()['id'] == response.json()['id']
    assert len(store.list_comments()) == 1


@pytest.mark.parametrize('text', ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '&lt;svg onload=alert(1)&gt;', '＜script＞hi＜/script＞', 'javascript:alert(1)', 'https://spam.example', 'hello\nworld', 'hello\u200bworld', 'x' * 121, ' ' * 3, '!' * 15])
def test_unsafe_input_rejected(env, text):
    client, now, _ = env
    assert post(client, payload(client, now, text)).status_code == 422
    assert store.list_comments() == []


def test_username_and_extra_fields_rejected(env):
    client, now, _ = env
    data = payload(client, now)
    data['username'] = '<script>x</script>'
    assert post(client, data).status_code == 422
    data['username'] = '친구'
    data['is_visible'] = 'Y'
    assert post(client, data).status_code == 422


def test_token_origin_honeypot_and_confirmation(env):
    client, now, _ = env
    data = payload(client, now)
    assert post(client, data, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert post(client, {**data, 'website': 'bot'}).status_code == 400
    assert post(client, {**data, 'supported': False}).status_code == 422
    assert post(client, {**data, 'token': data['token'][:-1] + 'z'}).status_code == 403
    assert client.get('/api/support/comment-token', headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    now[0] += 1801
    assert post(client, data).status_code == 403


def test_minimum_time_and_body_limit(env):
    client, now, _ = env
    data = payload(client, now)
    now[0] -= 4
    assert post(client, data).status_code == 429
    assert client.post('/api/support/comments', content='x'*5000, headers={'Content-Type': 'application/json'}).status_code == 413
    assert client.post('/api/support/comments', data={'text': 'hello'}).status_code == 415


def test_cooldown_daily_cap_duplicates_and_restart(env):
    client, now, _ = env
    assert post(client, payload(client, now, '응원 합니다')).status_code == 201
    assert post(client, payload(client, now, '새 응원')).status_code == 429
    now[0] += 61
    assert post(client, payload(client, now, '응원합니다')).status_code == 429
    for index in range(4):
        now[0] += 61
        assert post(client, payload(client, now, f'좋은 서비스 {index}')).status_code == 201
    store._conn.close()
    store._conn = None
    now[0] += 61
    assert post(client, payload(client, now, '여섯 번째')).status_code == 429
    now[0] += 86401
    assert post(client, payload(client, now, '응원합니다')).status_code == 201


def test_parallel_insertion_and_idempotency(env):
    _, now, _ = env
    def save(index):
        return store.add_comment(str(uuid.uuid4()), '친구', f'응원{index}', hashlib.sha256(str(index).encode()).hexdigest(), 'same-author', now[0])
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(save, range(8)))
    assert sum(result is not None for result in results) == 1


def test_admin_separate_feed_hide_delete_and_rate_history(env, monkeypatch):
    client, now, app = env
    data = payload(client, now)
    saved = post(client, data).json()
    assert client.get('/api/admin/support-comments').status_code in (401, 403)
    assert client.delete(f"/api/admin/comments/support/{saved['id']}").status_code in (401, 403)
    app.dependency_overrides[require_admin] = lambda: True
    admin = client.get('/api/admin/support-comments').json()['items']
    assert len(admin) == 1 and admin[0]['source'] == 'support'
    monkeypatch.setattr(admin_comments, 'get_global_top20_cached', lambda: [])
    monkeypatch.setattr(admin_comments.comment_store, 'list_comments', lambda *a, **k: [])
    monkeypatch.setattr(admin_comments.fight_comment_store, 'list_all_comments', lambda *a, **k: [])
    assert client.get('/api/admin/comments').json()['items'] == []
    url = f"/api/admin/comments/support/{saved['id']}"
    assert client.patch(url + '/visibility', json={'visible': False}).status_code == 200
    assert client.get('/api/support/comments').json()['items'] == []
    assert client.patch(url + '/visibility', json={'visible': True}).status_code == 200
    assert client.delete(url).status_code == 200
    assert client.get('/api/admin/support-comments').json()['items'] == []
    assert post(client, payload(client, now, '삭제 뒤 도배')).status_code == 429


def test_paging_and_forwarded_ip_cannot_reset_limit(env):
    client, now, _ = env
    for index in range(3):
        now[0] += 61
        assert post(client, payload(client, now, f'메시지 {index}')).status_code == 201
    feed = client.get('/api/support/comments?limit=2').json()
    assert len(feed['items']) == 2
    older = client.get('/api/support/comments', params={'limit': 2, 'before': feed['next_before']}).json()
    assert len(older['items']) == 1
    assert post(client, payload(client, now, '위조 헤더'), headers={'X-Forwarded-For': '1.2.3.4', 'CF-Connecting-IP': '9.9.9.9'}).status_code == 429


def test_monthly_supporter_crud_is_separate_and_persistent(env):
    client, _, app = env
    donor = {'month': '2026-10', 'nickname': '따뜻한커피', 'color': 'gold'}
    assert client.get('/api/admin/supporters').status_code in (401, 403)
    assert client.post('/api/admin/supporters', json=donor).status_code in (401, 403)
    assert client.patch('/api/admin/supporters/1', json=donor).status_code in (401, 403)
    assert client.delete('/api/admin/supporters/1').status_code in (401, 403)
    app.dependency_overrides[require_admin] = lambda: True
    saved = client.post('/api/admin/supporters', json=donor).json()
    assert saved['color'] == 'gold'
    edited = client.patch(f"/api/admin/supporters/{saved['id']}", json={**donor, 'color': 'silver'}).json()
    assert edited['color'] == 'silver'
    store._conn.close()
    store._conn = None
    assert client.get('/api/support/supporters?month=2026-10').json()['items'] == [edited]
    assert client.get('/api/support/comments').json()['items'] == []
    assert client.get('/api/admin/support-comments').json()['items'] == []
    assert client.delete(f"/api/admin/supporters/{saved['id']}").status_code == 200
    assert client.get('/api/support/supporters?month=2026-10').json()['items'] == []


def test_supporter_month_isolation_and_repeat_save(env):
    client, _, app = env
    app.dependency_overrides[require_admin] = lambda: True
    for month in ['2026-09', '2026-10', '2027-10']:
        assert client.post('/api/admin/supporters', json={'month': month, 'nickname': '커피 친구', 'color': 'gold'}).status_code == 200
    duplicate = client.post('/api/admin/supporters', json={'month': '2026-10', 'nickname': '커피친구', 'color': 'silver'}).json()
    assert client.get('/api/support/supporters?month=2026-10').json()['items'] == [duplicate]
    assert client.get('/api/support/supporters?month=2026-09').json()['items'][0]['color'] == 'gold'
    assert client.get('/api/support/supporters?month=2027-10').json()['items'][0]['color'] == 'gold'


@pytest.mark.parametrize('change', [{'month': '2026-13'}, {'month': '2026-00'}, {'nickname': '<script>x</script>'}, {'nickname': 'x\nhello'}, {'color': 'red'}, {'color': 'gold; background:url(javascript:1)'}, {'nickname': 'x'*21}, {'nickname': '&lt;img src=x onerror=alert(1)&gt;'}])
def test_supporter_invalid_input(env, change):
    client, _, app = env
    app.dependency_overrides[require_admin] = lambda: True
    assert client.post('/api/admin/supporters', json={'month': '2026-10', 'nickname': '친구', 'color': 'gold', **change}).status_code == 422
    assert client.get('/api/support/supporters?month=2026-10').json()['items'] == []


def test_supporter_database_constraints(env):
    import sqlite3
    from app.services import supporter_store
    supporter_store.list_supporters('2026-10')
    conn = store._conn
    columns = {row[1] for row in conn.execute('PRAGMA table_info(support_monthly_donors)').fetchall()}
    assert columns >= {'id', 'month', 'nickname', 'nickname_key', 'color', 'created_at', 'updated_at'}
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO support_monthly_donors(month,nickname,nickname_key,color) VALUES ('2026-13','친구','친구','gold')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO support_monthly_donors(month,nickname,nickname_key,color) VALUES ('2026-10','친구','친구','red')")
    conn.rollback()


def test_current_supporter_month_comes_from_seoul_clock(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(support, 'current_support_month', lambda: '2027-01')
    assert client.get('/api/support/supporters').json()['month'] == '2027-01'
    assert client.get('/api/support/supporters?month=2026-12').json()['month'] == '2026-12'
