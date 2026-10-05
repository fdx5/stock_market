import hashlib
import hmac
import json
import sqlite3
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.routers import support, support_payments
from app.services import support_comment_store as comments


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.delenv('TURSO_DATABASE_URL', raising=False)
    monkeypatch.delenv('RENDER', raising=False)
    monkeypatch.setenv('BUYMEACOFFEE_WEBHOOK_SECRET', 'test-webhook-secret')
    monkeypatch.setattr(comments, 'LOCAL_DB_PATH', tmp_path / 'support.db')
    monkeypatch.setattr(comments, '_conn', None)
    monkeypatch.setattr(support, '_secret', b'test-comments-key')
    now = [1800000000]
    monkeypatch.setattr(support.time, 'time', lambda: now[0])
    app = FastAPI()
    app.add_middleware(support.SupportBodyLimit)
    app.include_router(support.router, prefix='/api/support')
    app.include_router(support_payments.router, prefix='/api/support')
    client = TestClient(app)
    yield client, now
    if comments._conn:
        comments._conn.close()
        comments._conn = None


def event(**changes):
    payload = {'event_id': 123, 'type': 'extra_purchase.created', 'live_mode': True,
               'created': 1800000000, 'attempt': 1, 'data': {
                   'id': 987, 'transaction_id': 'pi_test_987', 'status': 'succeeded',
                   'refunded': 'false', 'amount': 5.5, 'currency': 'USD',
                   'supporter_name': 'Coffee friend', 'supporter_email': 'private@example.test',
                   'created_at': 1800000000, 'extras': [
                       {'id': 583318, 'title': '스타벅스 커피', 'amount': 5.5, 'quantity': 1, 'currency': 'USD'}]}}
    payload.update(changes)
    return payload


def deliver(client, payload, signature=None):
    raw = json.dumps(payload, ensure_ascii=False).encode()
    signature = signature or hmac.new(b'test-webhook-secret', raw, hashlib.sha256).hexdigest()
    return client.post('/api/support/buymeacoffee/webhook', content=raw,
                       headers={'Content-Type': 'application/json', 'x-signature-sha256': signature})


def payment_rows():
    return comments._run(lambda conn: conn.execute('SELECT * FROM support_payments').fetchall())


def test_checkout_return_is_unverified_idempotent_and_expires(env):
    client, now = env
    assert client.post('/api/support/buymeacoffee/return').json() == {'checkout': None}
    for product_id in (583316, 583318, 583320):
        response = client.get(f'/api/support/buymeacoffee/checkout/{product_id}', follow_redirects=False)
        assert response.status_code == 303
        assert response.headers['location'] == f'https://buymeacoffee.com/fdx5/e/{product_id}'
        assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=lax' in response.headers['set-cookie']
        result = client.post('/api/support/buymeacoffee/return').json()['checkout']
        assert result['product_id'] == product_id and result['verification'] == 'unverified'
        now[0] += 5
        assert client.post('/api/support/buymeacoffee/return').json()['checkout'] == result
    assert payment_rows() == []
    assert client.get('/api/support/buymeacoffee/checkout/99', follow_redirects=False).status_code == 404
    assert client.post('/api/support/buymeacoffee/return', headers={'Origin': 'https://evil.test'}).status_code == 403
    now[0] += 7 * 86400 + 1
    assert client.post('/api/support/buymeacoffee/return').json()['checkout'] is None


def test_signed_payment_persists_retries_restart_and_refund(env):
    client, _ = env
    paid = event()
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert all(response.status_code == 200 for response in executor.map(lambda _: deliver(client, paid), range(6)))
    assert len(payment_rows()) == 1
    row = payment_rows()[0]
    assert row[4:7] == ('succeeded', '5.5', 'USD')
    assert json.loads(row[9])[0]['id'] == 583318
    comments._conn.close()
    comments._conn = None
    assert len(payment_rows()) == 1
    refunded = event(type='extra_purchase.refunded', event_id=124, created=1800000010)
    assert deliver(client, refunded).status_code == 200
    # Late delivery and even a newer succeeded update cannot undo a refund.
    assert deliver(client, paid).status_code == 200
    assert deliver(client, event(type='extra_purchase.updated', event_id=125, created=1800000020)).status_code == 200
    assert payment_rows()[0][4] == 'refunded'
    public = client.get('/api/support/comments').text
    assert 'private@example.test' not in public and 'pi_test_987' not in public


def test_signature_test_events_unknown_items_and_invalid_input(env, monkeypatch):
    client, _ = env
    assert deliver(client, event(), signature='bad').status_code == 401
    assert deliver(client, event(live_mode=False)).json()['test'] is True
    assert deliver(client, event(type='donation.created')).json()['ignored'] is True
    other = event()
    other['data']['extras'][0]['id'] = 1
    assert deliver(client, other).json()['ignored'] is True
    for change in ({'amount': 'NaN'}, {'amount': -1}, {'status': 'pending'}, {'transaction_id': ''},
                   {'currency': 'US'}, {'extras': [None]}, {'id': True}, {'supporter_email': ['bad']}):
        invalid = event()
        invalid['data'].update(change)
        assert deliver(client, invalid).status_code == 400
    assert client.post('/api/support/buymeacoffee/webhook', content='x' * 131073,
                       headers={'Content-Type': 'application/json'}).status_code == 413
    assert payment_rows() == []
    monkeypatch.delenv('BUYMEACOFFEE_WEBHOOK_SECRET')
    assert deliver(client, event()).status_code == 503


def test_success_message_links_only_return_record(env):
    client, now = env
    client.get('/api/support/buymeacoffee/checkout/583316', follow_redirects=False)
    client.post('/api/support/buymeacoffee/return')
    token = client.get('/api/support/comment-token').json()['token']
    now[0] += 4
    payload = {'username': '커피친구', 'text': '오늘도 응원합니다', 'request_id': str(uuid.uuid4()),
               'token': token, 'supported': True}
    assert client.post('/api/support/comments', json=payload).status_code == 201
    checkout_id = comments._run(lambda conn: conn.execute('SELECT checkout_id FROM support_comments').fetchone())[0]
    assert checkout_id == client.cookies.get('support_checkout')
    assert payment_rows() == []
    assert 'checkout_id' not in client.get('/api/support/comments').json()['items'][0]


def test_existing_comment_schema_migrates_without_losing_messages(env):
    client, _ = env
    conn = sqlite3.connect(comments.LOCAL_DB_PATH)
    conn.execute(comments._SCHEMA)
    conn.execute("INSERT INTO support_comments (request_id, username, text, text_key, author_hash, posted_at, created_at) "
                 "VALUES ('legacy', '기존 후원자', '기존 메시지', 'key', 'hash', 1, '2026-01-01')")
    conn.commit()
    conn.close()
    assert client.get('/api/support/comments').json()['items'][0]['text'] == '기존 메시지'
    columns = comments._run(lambda database: database.execute('PRAGMA table_info(support_comments)').fetchall())
    assert 'checkout_id' in {row[1] for row in columns}
