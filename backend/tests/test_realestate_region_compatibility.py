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
    assert '12110' in rm._lawd_codes('46', None)
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
    stored_body = json.dumps({'level': 'sido', 'items': [{'id': '12110:fixture', 'price': 100}]})
    monkeypatch.setattr(rm, '_cached', lambda key: (0, stored_body))
    queued = []
    monkeypatch.setattr(rm, '_schedule_rebuild', lambda key, first=False: queued.append(key))
    assert json.loads(rm.get_map('46', None, None, '1y', 100))['items'][0]['id'] == '12110:fixture'
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
    assert rm._lawd_codes('46', None) == [('12110' if g['code'] == '46110' else g['code']) for s in previous['sido'] if s['code'] == '46' for g in s['sgg']]


def full_successor(monkeypatch):
    old = rm._load_static_regions()
    gwangju = dict(zip(['29110', '29140', '29155', '29170', '29200'], ['12210', '12240', '12270', '12300', '12330']))
    kids = [{**g, 'code': '12' + g['code'][2:] if s['code'] == '46' else gwangju[g['code']]}
            for s in old['sido'] if s['code'] in ('46', '29') for g in s['sgg']]
    live = [s for s in old['sido'] if s['code'] not in ('46', '29')]
    live.append({'code': '12', 'name': '전남광주통합특별시', 'sgg': kids})
    monkeypatch.setattr(rm, '_regions', {'sido': rm._compatible_regions(live, old)})


def test_old_province_selection_maps_only_its_own_successor_districts(monkeypatch):
    full_successor(monkeypatch)
    jeonnam, gwangju, combined = (set(rm._lawd_codes(code, None)) for code in ('46', '29', '12'))
    assert len(jeonnam) == 22 and len(gwangju) == 5
    assert not jeonnam & gwangju and jeonnam | gwangju == combined
    assert rm._lawd_codes('46', '46110') == ['12110']
    assert rm._lawd_codes('29', '29110') == ['12210']


def test_canonical_scope_uses_new_cache_namespace_and_keeps_old_saved_map(monkeypatch):
    full_successor(monkeypatch)
    key = ('46', None, None, '1y', 100)
    old = (0, rm._version, '{"items":[]}')
    monkeypatch.setattr(rm, '_map_cache', rm.OrderedDict({key: old}))
    reads = []
    monkeypatch.setattr(rm.realestate_store, 'load_map', lambda key: reads.append(key))
    assert rm._cached(key) is None
    assert reads == ['v5:sido:46:1y:100']
    assert rm._map_cache[key] == old
    rm._remember(key, '{"items":[1]}', 100, persist=False)
    assert rm._cached(key)[1] == '{"items":[1]}'
    assert reads == ['v5:sido:46:1y:100']
    assert rm._store_key(('12', None, None, '1y', 100)) == 'v4:sido:12:1y:100'


def test_old_jeonnam_map_has_current_trades_and_excludes_gwangju(monkeypatch):
    import datetime as dt
    full_successor(monkeypatch)
    today = dt.datetime.now(rm.KST).date()
    def trade(name, ago, price):
        day = int((today-dt.timedelta(days=ago)).strftime('%Y%m%d'))
        return [day, 'fixture', name, 'fixture', '1', 84.9, price, 10, 2010, 0]
    districts = {'12110': {'sample': [trade('목포 fixture', 10, 11000), trade('목포 fixture', 400, 10000)]},
                 '12210': {'sample': [trade('광주 fixture', 10, 99000)]}}
    monkeypatch.setattr(rm, 'is_configured', lambda: False)
    monkeypatch.setattr(rm, '_status', lambda codes: {})
    monkeypatch.setattr(rm, '_prefetch', lambda codes: None)
    monkeypatch.setattr(rm, '_district', lambda code: districts.get(code, {}))
    monkeypatch.setattr(rm.realestate_rights, 'merge', lambda complexes, *a, **k: complexes)
    result = rm.build_map('46', None, None, '1y', 100)
    assert result['count'] == 1 and result['items'][0]['sgg_code'] == '12110'
    assert result['items'][0]['change_pct'] == 10
    assert rm.build_map('29', None, None, '1y', 100)['items'][0]['sgg_code'] == '12210'


def test_summary_requests_use_the_same_scoped_current_codes(monkeypatch):
    from app.services import realestate_summary as summary
    full_successor(monkeypatch)
    monkeypatch.setattr(summary, '_cache', {})
    requested = []
    monkeypatch.setattr(summary, '_request', lambda keys, first=False: requested.extend(keys))
    summary.region_summary('sgg', '1y', sido='46')
    assert len(requested) == 22 and ('12110', '1y') in requested
    assert all(code not in rm._lawd_codes('29', None) for code, _ in requested)
