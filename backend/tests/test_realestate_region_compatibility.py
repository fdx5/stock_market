"""Administrative changes use new memory fixtures, never a stored database."""
import json
import pytest
from app.services import realestate_map as rm


def test_live_region_merge_retains_old_selection_and_district_codes(monkeypatch):
    previous = rm._load_static_regions()
    live = [s for s in previous['sido'] if s['code'] not in ('46', '29', '36')]
    live.append({'code': '12', 'name': '전남광주통합특별시', 'sgg': [{'code': '12110', 'name': '목포시', 'dongs': []}]})
    merged = rm._compatible_regions(live, previous)
    monkeypatch.setattr(rm, '_regions', {'sido': merged})
    assert '46110' in rm._lawd_codes('46', None)
    assert '29110' in rm._lawd_codes('29', None)
    assert '36110' in rm._lawd_codes('36', None)
    assert rm._lawd_codes('12', None) == ['12110']
    assert rm._sgg_index()['46110']['name'] == '목포시'
    assert len({s['code'] for s in merged}) == len(merged)
    assert len(previous['sido']) == 17  # Caller snapshot has not been mutated.


def test_live_names_win_and_retired_district_remains_readable(monkeypatch):
    previous = {'sido': [{'code': '28', 'name': '인천', 'sgg': [{'code': '28110', 'name': '중구', 'dongs': []}]}]}
    live = [{'code': '28', 'name': '인천광역시', 'sgg': [{'code': '28118', 'name': '새 구', 'dongs': []}]}]
    merged = rm._compatible_regions(live, previous)
    assert merged[0]['name'] == '인천광역시'
    assert {g['code'] for g in merged[0]['sgg']} == {'28110', '28118'}
    assert len(live[0]['sgg']) == 1


def test_incomplete_live_pagination_preserves_previous_catalog(monkeypatch):
    old = rm._load_static_regions()
    monkeypatch.setattr(rm, '_regions', old)
    monkeypatch.setattr(rm, '_service_key', lambda: 'fixture')
    monkeypatch.setattr(rm, 'CALL_SPACING_SECONDS', 0)
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'StanReginCd': [{'head': [{'totalCount': 5000}]}, {'row': []}]}
    monkeypatch.setattr(rm.requests, 'get', lambda *a, **k: Response())
    assert not rm._refresh_regions_from_mois()
    assert rm._regions is old and rm._lawd_codes('46', None)


def test_queued_legacy_sido_map_build_reads_existing_codes(monkeypatch):
    previous = rm._load_static_regions()
    live = [s for s in previous['sido'] if s['code'] not in ('46', '29')]
    live.append({'code': '12', 'name': '전남광주통합특별시', 'sgg': [{'code': '12110', 'name': '목포시', 'dongs': []}]})
    monkeypatch.setattr(rm, '_regions', {'sido': rm._compatible_regions(live, previous)})
    monkeypatch.setattr(rm, 'is_configured', lambda: False)
    monkeypatch.setattr(rm, '_status', lambda codes: {})
    monkeypatch.setattr(rm, '_prefetch', lambda codes: None)
    monkeypatch.setattr(rm, '_district', lambda code: {})
    monkeypatch.setattr(rm.realestate_rights, 'merge', lambda complexes, *a, **k: complexes)
    monkeypatch.setattr(rm, '_map_cache', rm.OrderedDict())
    body = json.loads(rm._build_and_remember(('46', None, None, '1y', 100), persist=False))
    assert body['level'] == 'sido' and body['items'] == []
    stored_body = json.dumps({'level': 'sido', 'items': [{'id': '46110:fixture', 'price': 100}]})
    monkeypatch.setattr(rm, '_cached', lambda key: (0, stored_body))
    queued = []
    monkeypatch.setattr(rm, '_schedule_rebuild', lambda key, first=False: queued.append(key))
    assert json.loads(rm.get_map('46', None, None, '1y', 100))['items'][0]['id'] == '46110:fixture'
    assert queued == [('46', None, None, '1y', 100)]
    with pytest.raises(ValueError): rm._lawd_codes('99', None)


def test_actual_refresh_keeps_legacy_queue_keys_when_new_sido_replaces_them(monkeypatch):
    previous = rm._load_static_regions()
    rows = []
    for s in previous['sido']:
        if s['code'] in ('29', '46'):
            continue
        rows.append({'region_cd': s['code'] + '00000000', 'locatadd_nm': s['name']})
        for g in s['sgg']:
            rows.append({'region_cd': g['code'] + '00000', 'locatadd_nm': s['name'] + ' ' + g['name']})
    rows += [{'region_cd': '1200000000', 'locatadd_nm': '전남광주통합특별시'},
             {'region_cd': '1211000000', 'locatadd_nm': '전남광주통합특별시 목포시'}]
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'StanReginCd': [{'head': [{'totalCount': len(rows)}]}, {'row': rows}]}
    monkeypatch.setattr(rm, '_regions', previous)
    monkeypatch.setattr(rm, '_service_key', lambda: 'fixture')
    monkeypatch.setattr(rm.requests, 'get', lambda *a, **k: Response())
    assert rm._refresh_regions_from_mois()
    assert rm._lawd_codes('12', None) == ['12110']
    assert rm._lawd_codes('46', None) == [g['code'] for s in previous['sido'] if s['code'] == '46' for g in s['sgg']]
