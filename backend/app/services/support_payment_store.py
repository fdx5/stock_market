"""Provider-confirmed payments and separate, unverified browser return records.

Buy Me a Coffee's static redirect does not carry a trusted checkout identifier.
Never infer a payment association from product, time, name, or browser cookies.
"""
import json
from datetime import datetime, timezone

from app.services import support_comment_store as store

PRODUCTS = {583316: '메가커피', 583318: '스타벅스 커피', 583320: '블루보틀 커피'}
COOKIE = 'support_checkout'
CHECKOUT_TTL = 7 * 86400


def create_checkout(checkout_id, product_id, now):
    def insert(conn):
        conn.execute('INSERT INTO support_checkouts (id, product_id, created_at) VALUES (?, ?, ?)',
                     (checkout_id, product_id, now))
        conn.commit()
    store._run(insert)


def checkout(checkout_id, now, returned_only=False):
    if not checkout_id:
        return None
    def query(conn):
        return conn.execute('SELECT id, product_id, created_at, returned_at FROM support_checkouts '
                            'WHERE id = ? AND created_at BETWEEN ? AND ? '
                            'AND (? = 0 OR returned_at IS NOT NULL)',
                            (checkout_id, now - CHECKOUT_TTL, now, int(returned_only))).fetchone()
    row = store._run(query)
    return dict(zip(('id', 'product_id', 'created_at', 'returned_at'), row)) if row else None


def record_return(checkout_id, now):
    record = checkout(checkout_id, now)
    if record is None:
        return None
    def update(conn):
        conn.execute('UPDATE support_checkouts SET returned_at = COALESCE(returned_at, ?) WHERE id = ?',
                     (now, checkout_id))
        conn.commit()
    store._run(update)
    return {'product_id': record['product_id'], 'product_name': PRODUCTS[record['product_id']],
            'verification': 'unverified', 'returned_at': record['returned_at'] or now}


def save_payment(event, data, products, amount, now):
    """One atomic upsert survives delivery retries and out-of-order refunds."""
    refunded = event['type'] == 'extra_purchase.refunded' or data['status'] == 'refunded' or data.get('refunded') == 'true'
    def upsert(conn):
        conn.execute('''INSERT INTO support_payments (
            payment_id, transaction_id, event_id, event_type, status, amount, currency,
            supporter_name, supporter_email, products_json, paid_at, event_created, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(payment_id) DO UPDATE SET
            event_id = excluded.event_id, event_type = excluded.event_type,
            status = excluded.status, amount = excluded.amount, currency = excluded.currency,
            supporter_name = excluded.supporter_name, supporter_email = excluded.supporter_email,
            products_json = excluded.products_json, event_created = excluded.event_created,
            received_at = excluded.received_at
        WHERE excluded.event_created >= support_payments.event_created
          AND (support_payments.status != 'refunded' OR excluded.status = 'refunded')''',
            (str(data['id']), data['transaction_id'], str(event['event_id']), event['type'],
             'refunded' if refunded else 'succeeded', amount, data['currency'],
             data.get('supporter_name') or '', data.get('supporter_email') or '',
             json.dumps(products, ensure_ascii=False), data['created_at'], event['created'],
             datetime.fromtimestamp(now, timezone.utc).isoformat()))
        conn.commit()
    store._run(upsert)
