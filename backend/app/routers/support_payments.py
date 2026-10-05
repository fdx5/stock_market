"""Buy Me a Coffee shop checkout links, returns, and authenticated webhooks."""
import hashlib
import hmac
import json
import os
import secrets
import time
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from starlette.concurrency import run_in_threadpool

from app.routers.support import _origin
from app.services import support_payment_store as store

router = APIRouter()
EVENTS = {'extra_purchase.created', 'extra_purchase.updated', 'extra_purchase.refunded'}


@router.get('/buymeacoffee/checkout/{product_id}')
def checkout(product_id: int, request: Request):
    if product_id not in store.PRODUCTS:
        raise HTTPException(404, '후원 상품을 찾을 수 없습니다.')
    checkout_id = secrets.token_urlsafe(32)
    store.create_checkout(checkout_id, product_id, int(time.time()))
    response = RedirectResponse(f'https://buymeacoffee.com/fdx5/e/{product_id}', status_code=303,
                                headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
    response.set_cookie(store.COOKIE, checkout_id, max_age=store.CHECKOUT_TTL,
                        secure=request.url.scheme == 'https' or bool(os.environ.get('RENDER')),
                        httponly=True, samesite='lax', path='/api/support')
    return response


@router.post('/buymeacoffee/return')
def support_return(request: Request, response: Response):
    _origin(request)
    response.headers['Cache-Control'] = 'no-store'
    return {'checkout': store.record_return(request.cookies.get(store.COOKIE), int(time.time()))}


@router.post('/buymeacoffee/webhook')
async def webhook(request: Request, response: Response):
    secret = os.environ.get('BUYMEACOFFEE_WEBHOOK_SECRET')
    if not secret:
        raise HTTPException(503, '결제 알림 연동이 아직 설정되지 않았습니다.')
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise HTTPException(415, 'JSON 입력만 허용됩니다.')
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 131072:
            raise HTTPException(413, '입력 크기가 너무 큽니다.')
    signature = request.headers.get('x-signature-sha256', '')
    expected = hmac.new(secret.encode(), bytes(raw), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected.encode(), signature.encode()):
        raise HTTPException(401, '결제 알림 서명을 확인할 수 없습니다.')
    response.headers['Cache-Control'] = 'no-store'
    try:
        event = json.loads(raw)
        if not isinstance(event, dict) or type(event.get('live_mode')) is not bool:
            raise ValueError('Invalid envelope')
        if not event['live_mode']:
            return {'received': True, 'test': True}
        if event.get('type') not in EVENTS:
            return {'received': True, 'ignored': True}
        data = event['data']
        if not isinstance(data, dict) or not isinstance(data.get('extras'), list):
            raise ValueError('Invalid payment')
        # Scope storage to the three explicitly configured shop products.
        extras = data['extras']
        if any(not isinstance(item, dict) for item in extras):
            raise ValueError('Invalid shop items')
        products = [item for item in extras if type(item.get('id')) is int and item['id'] in store.PRODUCTS]
        if not products:
            return {'received': True, 'ignored': True}
        for value in (event['event_id'], event['created'], data['id'], data['created_at']):
            if type(value) is not int or value < 1:
                raise ValueError('Invalid identifier or timestamp')
        if data['status'] not in {'succeeded', 'refunded'}:
            raise ValueError('Invalid status')
        if not isinstance(data['transaction_id'], str) or not 1 <= len(data['transaction_id']) <= 200:
            raise ValueError('Invalid transaction')
        currency = data['currency']
        if not isinstance(currency, str) or len(currency) != 3 or not currency.isascii() or not currency.isalpha():
            raise ValueError('Invalid currency')
        amount = Decimal(str(data['amount']))
        if not amount.is_finite() or amount < 0 or amount > Decimal('1000000000'):
            raise ValueError('Invalid amount')
        if any(data.get(key) is not None and (not isinstance(data[key], str) or len(data[key]) > 320)
               for key in ('supporter_name', 'supporter_email')):
            raise ValueError('Invalid supporter')
        # Keep the order's product details, including mixed baskets; do not store
        # the whole payload or private answers/support notes in the public feed.
        products = [{key: item.get(key) for key in ('id', 'title', 'amount', 'quantity', 'currency')}
                    for item in extras]
    except (ValueError, KeyError, TypeError, InvalidOperation, OverflowError):
        raise HTTPException(400, '결제 알림 형식을 확인해 주세요.')
    await run_in_threadpool(store.save_payment, event, data, products, str(amount), int(time.time()))
    return {'received': True}
