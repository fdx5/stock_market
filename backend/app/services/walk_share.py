"""Stateless public room-tour identity, identical to the browser's compact URL format."""
import base64
import re


def _decode(value: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,800}', value):
        return ''
    try:
        return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)).decode('utf-8')[:200]
    except (ValueError, UnicodeError):
        return ''


def _encode(value: str) -> str:
    return base64.urlsafe_b64encode(value[:200].encode('utf-8')).decode('ascii').rstrip('=')


def expand_walk_query(query: dict[str, str]) -> dict[str, str]:
    q = dict(query)
    identity = _decode(q.get('c', ''))
    if identity and re.match(r'^\d{5}:', identity):
        q.setdefault('id', identity)
        if not q.get('at') and q.get('enter') != '1' and q.get('o') != '1':
            q['tour'] = '1'
    label = _decode(q.get('n', ''))
    if label:
        q.setdefault('name', label)
    if 'a' in q:
        q.setdefault('area', q['a'])
    return q


def compact_walk_query(query: dict[str, str]) -> dict[str, str]:
    q = expand_walk_query(query)
    if q.get('interior') or q.get('enter') == '1':
        keys = ('interior', 'kind', 'level', 'w', 'd', 'floors', 'name', 'enter', 'lat', 'lon', 'foot', 'campus', 'heading', 'door', 'f', 'area', 'original', 'town', 'built', 'cid', 'dong', 'style', 'floor', 'id')
        return {k: q[k] for k in keys if q.get(k)}
    result: dict[str, str] = {}
    identity = q.get('id', '')
    if identity:
        result['c'] = _encode(identity)
    if q.get('at'):
        result['at'] = q['at'][:80]
    elif identity and q.get('tour') != '1':
        result['o'] = '1'
        result.update({k: q[k][:40] for k in ('lat', 'lon') if q.get(k)})
    if (not identity or len(identity.split(':')) < 4) and q.get('name'):
        result['n'] = _encode(q['name'][:80])
    if q.get('place'):
        result.update({k: q[k][:200] for k in ('place', 'lat', 'lon') if q.get(k)})
    if q.get('tour') == '1' and re.fullmatch(r'\d+(?:\.\d+)?', q.get('area', '')) and float(q['area']) > 0:
        result['a'] = q['area'][:20]
    if re.fullmatch(r'-?\d+', q.get('f', '')) and -20 <= int(q['f']) <= 200 and int(q['f']) not in (0, 1):
        result['f'] = q['f']
    return result
