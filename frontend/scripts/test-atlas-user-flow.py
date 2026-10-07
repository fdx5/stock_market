"""Read-only browser QA: all API calls use fixtures, including on production."""
import copy
import json
import os
from pathlib import Path

fixture = Path(__file__).with_name('test-atlas-monitoring.py').read_text(encoding='utf-8').split('with sync_playwright() as p:')[0]
exec(compile(fixture, str(Path(__file__).with_name('test-atlas-monitoring.py')), 'exec'))
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:4180')
output = Path(os.environ.get('ATLAS_USER_QA_OUTPUT', str(ROOT / 'tmp/atlas-user-flow-qa')))
output.mkdir(parents=True, exist_ok=True)


def action(i, ago, path, label, group='market', kind='click'):
    return dict(id=i, ts=live['at']-ago, type=kind, path=path, label=label, group=group,
                stock_code='', stock_name='', action=None)


def session(sid, events, online=True):
    return dict(id=sid, first_seen=live['at']-850, last_seen=events[-1]['ts'] if events else live['at']-200,
                last_heartbeat=live['at'] if online else None, online=online,
                active=bool(events and events[-1]['ts'] >= live['at']-90),
                path=events[-1]['path'] if events else '', events=events)


a, b, quiet, old = '11111111aaaaaaaa', '22222222bbbbbbbb', '33333333cccccccc', '44444444dddddddd'
live['behavior'] = dict(window_s=900, capacity=2000, event_count=85, online_count=3, active_count=2, truncated=False,
    sessions=[session(a, [action(1001, 290, '/desk', '마켓 데스크', kind='page_view'),
                        action(1002, 150, '/map', 'KOSPI 맵', kind='page_view'),
                        action(1003, 48, '/stocks', '종목 선택 · 삼성전자'),
                        action(1004, 18, '/news', '뉴스 기사 클릭', 'community')]),
              session(b, [action(1100+i, 240-i*3, '/realestate-map', f'단지 선택 {i}', 'realestate') for i in range(80)]),
              session(quiet, []), session(old, [action(1401, 800, '/global', '해외 종목', kind='page_view')], False)])
live['api']['recent'].append(dict(id=1901, ts=live['at']-1, route='/api/visitors/count', method='GET', status=200, ms=20))
live['external']['recent'].append(dict(id=1902, ts=live['at']-1, host='fixture-db.turso.io', method='POST', status=200, ms=20, target='database'))
state = dict(calls=0, new=False, expired=False, failed=False, empty=False)
report = dict(base=base, checks=[], responsive=[], errors=[])


def api(route):
    path = route.request.url.split('?')[0]
    if '/api/admin/atlas/' in path:
        assert route.request.method == 'GET'
        if path.endswith('/architecture'): route.fulfill(json=graph)
        elif path.endswith('/health'): route.fulfill(json=health)
        elif path.endswith('/snapshot'):
            state['calls'] += 1
            if state['failed']: route.fulfill(status=503, json={'detail': 'fixture offline'}); return
            data = copy.deepcopy(live)
            data['at'] += state['calls']*.001
            if state['new']:
                data['behavior']['sessions'][0]['events'].append(action(2001, 0, '/stock/AAPL', '종목 선택 · Apple'))
                data['behavior']['sessions'][0]['last_seen'] = live['at']
            if state['expired']: data['behavior']['sessions'] = [s for s in data['behavior']['sessions'] if s['id'] != a]
            if state['empty']: data['behavior'].update(sessions=[], event_count=0, online_count=0, active_count=0)
            # Canonical backend order: newest behavior first, quiet presence last.
            by_id = {s['id']: s for s in data['behavior']['sessions']}
            order = [a, b, old, quiet] if state['new'] else [b, a, old, quiet]
            data['behavior']['sessions'] = [by_id[sid] for sid in order if sid in by_id]
            route.fulfill(json=data)
        else: route.fulfill(json={})
    else: route.fulfill(json={'ok': True, 'country': 'KR', 'count': 0, 'events': []})


with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width':1920, 'height':1200}, device_scale_factor=1)
    context.add_init_script(f"localStorage.setItem('admin_session',JSON.stringify({{token:'fixture-only',expires_at:Date.now()/1000+3600}}));Date.now=()=>{int(live['at']*1000)};")
    context.route('**/api/**', api)
    page = context.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    try:
        page.goto(base+'/admin/system-atlas')
        watch = page.get_by_role('region', name='접속 세션 행동 관찰')
        scene = page.locator('.af-scene')
        expect(watch).to_be_visible(timeout=60000)
        expect(watch).to_have_attribute('data-mode', 'all')
        expect(page.locator('.aw-lane')).to_have_count(4)
        assert page.locator('.aw-lane').evaluate_all('(rows)=>rows.map(row=>row.dataset.session)') == [b, a, old, quiet]
        expect(page.locator('.aw-session-picker button').first).to_contain_text('22222222')
        expect(page.get_by_label('거미 관찰 대상')).to_have_value('users')
        expect(scene).to_have_attribute('data-state', 'ready', timeout=60000)
        page.wait_for_function("document.querySelector('.af-scene').dataset.recordSessions.includes('22222222')")
        expect(page.locator('.af-log-user')).to_have_count(85)
        assert not any(x in page.locator('.af-log-stream').inner_text() for x in ('visitors/count', 'turso.io', 'CRAWL', 'ARRIVED'))
        assert page.locator('.aw-lane .aw-trail').count() == 82
        page.screenshot(path=str(output/'all-sessions-1920.png'), full_page=True)
        report['checks'].append('all sessions draw real chronological actions by default; visit/DB/spider chatter excluded')

        page.locator(f'.aw-lane[data-session="{a}"] .aw-lane-label').click()
        expect(watch).to_have_attribute('data-mode', 'session')
        expect(page.locator('.aw-lane')).to_have_count(1)
        expect(scene).to_have_attribute('data-scope', 'users:'+a)
        expect(scene).to_have_attribute('data-record-sessions', a)
        expect(page.locator('.af-log-user')).to_have_count(4)
        expect(page.locator('.aw-detail-list button')).to_have_count(4)
        state['new'] = True
        expect(page.locator('.aw-detail-list button')).to_have_count(5, timeout=10000)
        expect(page.locator('.af-log-user')).to_have_count(5)
        expect(scene).to_have_attribute('data-record-sessions', a)
        page.screenshot(path=str(output/'session-focus-1920.png'), full_page=True)
        report['checks'].append('click session isolates diagram, spider and logs; focus persists across live updates')

        page.locator('.aw-lane [data-action="1002"]').click()
        expect(page.locator('.aw-detail-list button')).to_have_count(1)
        expect(page.locator('.aw-detail h3')).to_have_text('선택한 행동')
        expect(page.locator('.aw-detail-list')).to_contain_text('KOSPI 맵')
        page.get_by_role('button', name='전체 기록', exact=True).click()
        expect(page.locator('.aw-detail-list button')).to_have_count(5)
        page.get_by_label('세션 행동 시간 범위').select_option('60')
        expect(page.locator('.aw-lane [data-action]')).to_have_count(3)
        page.get_by_label('세션 행동 시간 범위').select_option('900')
        expect(page.locator('.aw-lane [data-action]')).to_have_count(5)
        report['checks'].append('action-point drilldown and 1/5/15-minute time ranges')

        page.locator('.aw-session-picker button').filter(has_text='33333333').click()
        expect(page.locator('.aw-lane')).to_have_count(1)
        expect(page.locator('.aw-lane')).to_contain_text('접속 유지')
        expect(page.locator('.aw-detail header')).to_contain_text('관측 행동 없음')
        expect(page.locator('.af-log-user')).to_have_count(0)
        expect(scene).to_have_attribute('data-record-sessions', '')
        expect(scene).to_have_attribute('data-packets', '0')
        page.locator('.aw-session-picker button').filter(has_text='22222222').click()
        expect(page.locator('.aw-detail-list button')).to_have_count(80)
        assert page.locator('.aw-detail-list').evaluate('(el)=>el.scrollHeight>el.clientHeight')
        page.get_by_role('button', name='최신 행동 따라가기 ON', exact=True).click()
        page.locator('.aw-detail-list').evaluate('(el)=>el.scrollTop=0')
        page.wait_for_timeout(3400)
        assert page.locator('.aw-detail-list').evaluate('(el)=>el.scrollTop') == 0
        page.get_by_role('button', name='최신 행동 따라가기 OFF', exact=True).click()
        expect(page.locator('.aw-detail-list')).to_have_js_property('scrollTop', page.locator('.aw-detail-list').evaluate('(el)=>el.scrollHeight-el.clientHeight'))
        watch.get_by_role('button', name='전체 세션', exact=True).click()
        expect(page.locator('.aw-lane')).to_have_count(4)
        assert page.locator('.aw-lane').evaluate_all('(rows)=>rows.map(row=>row.dataset.session)') == [a, b, old, quiet]
        expect(page.locator('.aw-session-picker button').first).to_contain_text('11111111')
        report['checks'].append('session chips and chart lanes rank latest actions first; new actions promote a session while pinned focus persists')
        report['checks'].append('quiet connected session stays visible without invented actions; history auto-follow and return to all')

        page.get_by_label('거미 관찰 대상').select_option('system')
        expect(scene).to_have_attribute('data-scope', 'system:all')
        expect(page.locator('.af-log-stream')).to_contain_text('fixture-db.turso.io')
        expect(page.locator('.af-log-stream')).to_contain_text('/api/visitors/count')
        page.locator('.aw-session-picker button').filter(has_text='11111111').click()
        expect(page.get_by_label('거미 관찰 대상')).to_have_value('users')
        expect(scene).to_have_attribute('data-record-sessions', a)
        state['expired'] = True
        expect(page.locator('.aw-lane')).to_have_count(0, timeout=10000)
        expect(watch).to_contain_text('관측 기간이 지났거나 서버가 재시작')
        expect(scene).to_have_attribute('data-record-sessions', '')
        state['expired'] = False
        expect(page.locator('.aw-lane')).to_have_count(1, timeout=10000)
        watch.get_by_role('button', name='전체 세션', exact=True).click()
        report['checks'].append('diagnostics remain available; expired focus never silently switches to another session')

        for width in (1440, 1024, 768, 390, 360):
            page.set_viewport_size({'width':width, 'height':1000})
            page.wait_for_timeout(250)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'page overflow at {width}'
            assert watch.evaluate('(el)=>el.scrollWidth<=el.clientWidth'), f'session panel overflow at {width}'
            page.screenshot(path=str(output/f'all-sessions-{width}.png'), full_page=True)
            report['responsive'].append(width)
        page.emulate_media(reduced_motion='reduce')
        expect(scene).to_have_attribute('data-motion', 'paused')
        page.locator('.aw-session-picker button').filter(has_text='11111111').focus()
        page.keyboard.press('Enter')
        expect(page.locator('.aw-lane')).to_have_count(1)
        report['checks'].append('mobile layouts, keyboard session selection and reduced-motion observation')
        state['empty'] = True
        watch.get_by_role('button', name='전체 세션', exact=True).click()
        expect(page.locator('.aw-lane')).to_have_count(0, timeout=10000)
        expect(watch).to_contain_text('접속 세션을 기다리고')
        expect(scene).to_have_attribute('data-packets', '0')
        assert not report['errors'], report['errors']
        report['result'] = 'passed'
        (output/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
    except Exception:
        page.screenshot(path=str(output/'failure.png'), full_page=True)
        print(json.dumps(report, ensure_ascii=False))
        raise
    finally:
        browser.close()
