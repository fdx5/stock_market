import hashlib
import hmac
import html
import ipaddress
import os
import re
import secrets
import time
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services import support_comment_store as store
from app.services import supporter_store
from app.site import PRIMARY_SITE_URL

router = APIRouter()
_secret = None


class SupportBodyLimit:
    """Bound JSON size before parsing it, including chunked requests without Content-Length."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        limited = scope.get('path') == '/api/support/comments' or scope.get('path', '').startswith('/api/admin/supporters')
        if scope['type'] != 'http' or scope.get('method') not in {'POST', 'PATCH'} or not limited:
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])
        if headers.get(b'content-type', b'').split(b';')[0].strip().lower() != b'application/json':
            return await JSONResponse({'detail': 'JSON 입력만 허용됩니다.'}, status_code=415)(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > 4096:
                return await JSONResponse({'detail': '입력 크기가 너무 큽니다.'}, status_code=413)(scope, receive, send)
            if not message.get('more_body'):
                break
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        return await self.app(scope, replay, send)


def _key():
    global _secret
    if _secret is None:
        configured = os.environ.get('SUPPORT_COMMENT_SECRET') or os.environ.get('TURSO_AUTH_TOKEN')
        if configured:
            _secret = hashlib.sha256(('support-comments-v1:' + configured).encode()).digest()
        else:
            keyfile = Path(store.LOCAL_DB_PATH).with_suffix('.key')
            keyfile.parent.mkdir(parents=True, exist_ok=True)
            try:
                with keyfile.open('xb') as stream:
                    stream.write(secrets.token_bytes(32))
            except FileExistsError:
                pass
            _secret = keyfile.read_bytes()
    return _secret


def _author(request):
    # Render's canonical host is served through Cloudflare. Do not trust the
    # client-controlled leftmost X-Forwarded-For value. Local/direct requests use
    # the ASGI peer (after the server's trusted proxy processing).
    raw = request.client.host if request.client else 'unknown'
    if os.environ.get('RENDER') and request.headers.get('cf-ray'):
        candidate = request.headers.get('cf-connecting-ip', '')
        try:
            raw = str(ipaddress.ip_address(candidate))
        except ValueError:
            pass
    try:
        address = ipaddress.ip_address(raw)
        raw = str(ipaddress.ip_network(f'{address}/64', strict=False)) if address.version == 6 else str(address)
    except ValueError:
        pass
    return hmac.new(_key(), ('author:' + raw).encode(), hashlib.sha256).hexdigest()


def _sign(issued, nonce, author):
    return hmac.new(_key(), f'{issued}:{nonce}:{author}'.encode(), hashlib.sha256).hexdigest()


def _origin(request):
    origin = request.headers.get('origin')
    allowed = {PRIMARY_SITE_URL}
    if not os.environ.get('RENDER') and request.url.hostname in {'localhost', '127.0.0.1', 'testserver'}:
        allowed.update({f'{request.url.scheme}://{request.url.netloc}', 'http://127.0.0.1:5173', 'http://localhost:5173'})
    if origin and origin not in allowed:
        raise HTTPException(403, '다른 사이트에서는 댓글을 등록할 수 없습니다.')
    if request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, '페이지를 새로 열고 다시 시도해 주세요.')


def _plain(value, maximum):
    value = unicodedata.normalize('NFKC', value).strip()
    if not value or len(value) > maximum:
        raise ValueError(f'1~{maximum}자로 입력해 주세요.')
    if any(unicodedata.category(char) in {'Cc', 'Cf', 'Cs'} for char in value):
        raise ValueError('줄바꿈이나 제어 문자는 입력할 수 없습니다.')
    decoded = value
    for _ in range(3):
        decoded = html.unescape(decoded)
    if re.search(r'[<>]|https?\s*:|www\.|javascript\s*:|data\s*:|vbscript\s*:', decoded, re.I):
        raise ValueError('HTML 태그, 스크립트 및 링크는 입력할 수 없습니다.')
    if re.search(r'(.)\1{14,}', value):
        raise ValueError('같은 문자를 과도하게 반복할 수 없습니다.')
    return value


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    username: str = Field(min_length=1, max_length=20)
    text: str = Field(min_length=1, max_length=120)
    request_id: str = Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    token: str = Field(min_length=90, max_length=150)
    website: str = Field(default='', max_length=200)
    supported: Literal[True]

    @field_validator('username', 'text')
    @classmethod
    def validate_plain(cls, value, info):
        return _plain(value, 20 if info.field_name == 'username' else 120)


@router.get('/comments')
def list_comments(response: Response, limit: int = Query(30, ge=1, le=50), before: int | None = Query(None, ge=1)):
    response.headers['Cache-Control'] = 'no-store'
    items = store.list_comments(limit + 1, before)
    return {'items': items[:limit], 'next_before': items[limit - 1]['id'] if len(items) > limit else None}


@router.get('/comment-token')
def comment_token(request: Request, response: Response):
    _origin(request)
    response.headers['Cache-Control'] = 'no-store'
    issued = int(time.time())
    nonce = secrets.token_hex(12)
    return {'token': f'{issued}.{nonce}.{_sign(issued, nonce, _author(request))}'}


@router.post('/comments', status_code=201)
def add_comment(payload: CommentCreate, request: Request, response: Response):
    _origin(request)
    if payload.website:
        raise HTTPException(400, '등록할 수 없는 입력입니다.')
    author = _author(request)
    now = int(time.time())
    try:
        issued, nonce, signature = payload.token.split('.')
        issued = int(issued)
        valid = re.fullmatch(r'[0-9a-f]{24}', nonce) and hmac.compare_digest(signature, _sign(issued, nonce, author))
    except (ValueError, TypeError):
        valid = False
    if not valid or not 0 <= now - issued <= 1800:
        raise HTTPException(403, '입력 시간이 만료되었습니다. 페이지를 새로 열어 주세요.')
    if now - issued < 3:
        raise HTTPException(429, '잠시 후 다시 등록해 주세요.', headers={'Retry-After': '3'})
    text_key = hashlib.sha256(''.join(payload.text.casefold().split()).encode()).hexdigest()
    result = store.add_comment(payload.request_id, payload.username, payload.text, text_key, author, now)
    if result is None:
        raise HTTPException(429, '같은 접속 환경에서 1분에 한 번, 하루 최대 5개까지 남길 수 있습니다. 같은 내용은 하루 동안 다시 등록할 수 없습니다.', headers={'Retry-After': '60'})
    response.headers['Cache-Control'] = 'no-store'
    return result


MONTH_PATTERN = r'^20\d{2}-(0[1-9]|1[0-2])$'


def current_support_month():
    return datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y-%m')


@router.get('/supporters')
def monthly_supporters(response: Response, month: str | None = Query(None, pattern=MONTH_PATTERN)):
    response.headers['Cache-Control'] = 'no-store'
    selected = month or current_support_month()
    return {'month': selected, 'items': supporter_store.list_supporters(selected)}
