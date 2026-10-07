"""Read-only browser QA using the actual architecture and bounded telemetry fixtures.

TEST_BASE_URL may target Vite, a built preview, or production. Atlas/auth endpoints
are intercepted: no production admin session or application data is required.
"""
import copy
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

os.environ['PYTHON_DOTENV_DISABLED'] = '1'
for key in ('TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'REALESTATE_TURSO_DATABASE_URL', 'REALESTATE_TURSO_AUTH_TOKEN'):
    os.environ[key] = ''
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.main import app
from app.services import api_pulse, system_atlas, system_telemetry
from playwright.sync_api import sync_playwright, expect

OUTPUT = Path(os.environ.get('ATLAS_QA_OUTPUT', str(ROOT / 'tmp/atlas-monitoring-qa')))
OUTPUT.mkdir(parents=True, exist_ok=True)
graph = system_atlas.architecture(app.routes)
now = time.time()
for i, e in enumerate(graph['endpoints']):
    completed = now - 58 + (i % 12) * 5
    duration = 70 + (i % 8) * 190
    token = system_telemetry.begin_request({'route': SimpleNamespace(path=e['path'])})
    if i % 3 == 0:
        system_telemetry.record('apis.data.go.kr' if e['group'] == 'realestate' else 'query1.finance.yahoo.com', 'GET', 503 if i % 21 == 0 else 200, duration / 2)
        system_telemetry._events[-1]['ts'] = completed - .01
    api_pulse.record(e['path'], e['methods'][0], 503 if i % 31 == 0 else 404 if i % 23 == 0 else 200, duration, trace_id=system_telemetry.request_id())
    api_pulse._tail[-1]['ts'] = completed
    system_telemetry.end_request(token)
for i, host in enumerate(['m.stock.naver.com', 'openapi.vworld.kr', 'api.resend.com']):
    system_telemetry.record(host, 'GET', 200, 87 + i * 49)
live = system_atlas.live_snapshot(app.routes)
health = {'at': time.strftime('%Y-%m-%dT%H:%M:%S+09:00'), 'uptime_s': 43620, 'commit': 'fixture-local', 'memory_mb': 482.4,
          'db': {'ok': True, 'ms': 156}, 'gates': [{'name': 'page_view_store', 'calls': 3901, 'busy_rejects': 2,
          'errors': 1, 'avg_wait_ms': 1, 'avg_work_ms': 142, 'open': False, 'last_error': None, 'failures': 0}],
          'threads': [{'name': 'prediction-scheduler', 'count': 1}, {'name': 'realestate-collector', 'count': 1}],
          'errors_last_hour': 1, 'warnings_last_hour': 2, 'logs': [],
          'admin_cache': [{'name': 'visits', 'args': '', 'overdue_s': 4, 'error': None}],
          'realestate': {'configured': True, 'calls_today': 820, 'calls_today_rent': 320, 'queued_districts': 9,
                         'recent_coverage': .94, 'history_coverage': .68, 'collecting': '서울 송파구'}}
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5189')
report = {'base': base, 'nodes': len(graph['nodes']), 'apis': len(graph['endpoints']), 'views': [], 'responsive': [], 'checks': []}
views = ['운영 요약', '서비스', 'API 성능', '외부 연동', '요청 추적', 'DB · 캐시', '전체 구조', '기술 스택']

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1920, 'height': 1200}, device_scale_factor=1)
    context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'fixture-only',expires_at:Date.now()/1000+3600}));")
    state = {'fail': False, 'health_fail': False, 'unauthorized': False, 'empty': False, 'snapshot_calls': 0}
    empty = copy.deepcopy(live)
    blank = system_telemetry.stats([])
    empty['api'].update(blank, groups={}, endpoints=[], recent=[], breakdown=system_telemetry.breakdown([], now))
    empty['external'].update(blank, groups={}, hosts=[], flows=[], recent=[], breakdown=system_telemetry.breakdown([], now))
    empty['traces'] = []
    def api(route):
        path = route.request.url.split('?')[0]
        if '/api/admin/atlas/' in path:
            assert route.request.method == 'GET'
            if state['unauthorized']:
                route.fulfill(status=401, json={'detail': 'fixture expired'}); return
            if (state['fail'] and path.endswith('/snapshot')) or (state['health_fail'] and path.endswith('/health')):
                route.fulfill(status=503, json={'detail': 'fixture offline'}); return
            if path.endswith('/architecture'): route.fulfill(json=graph)
            elif path.endswith('/health'): route.fulfill(json=health)
            elif path.endswith('/snapshot'):
                state['snapshot_calls'] += 1
                data = copy.deepcopy(empty if state['empty'] else live)
                data['at'] = time.time()
                route.fulfill(json=data)
            else: route.fulfill(json={})
        else: route.fulfill(json={'count': 0, 'country': 'KR', 'ok': True, 'events': []})
    context.route('**/api/**', api)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/admin/system-atlas')
    page.get_by_role('button', name='운영 요약', exact=True).click()
    expect(page.locator('.am-command')).to_be_visible(timeout=60000)
    expect(page.locator('.sa-live-badge')).to_have_text('LIVE OBSERVATION')
    nav = page.get_by_role('navigation', name='모니터링 보기')
    def view(name): nav.get_by_role('button', name=name, exact=False).click()
    def shot(name): page.screenshot(path=str(OUTPUT / name), full_page=True)
    try:
        shot('overview-1920.png')
        expect(page.locator('.am-time-column')).to_have_count(12)
        expect(page.locator('.am-service-card')).to_have_count(6)
        page.locator('.am-issue-strip button').filter(has_text='1초 이상 응답').click()
        expect(page.get_by_label('API 상태 필터')).to_have_value('slow')
        view('운영 요약')
        page.locator('.am-issue-strip button').filter(has_text='API 5xx').click()
        expect(page.get_by_label('API 상태 필터')).to_have_value('errors')
        view('운영 요약')
        for name in views:
            view(name)
            expect(nav.get_by_role('button', name=name, exact=False)).to_have_attribute('aria-pressed', 'true')
            shot(f'view-{views.index(name)}.png')
            report['views'].append(name)

        view('서비스')
        page.locator('.am-service-card').filter(has_text='부동산 · 공간 데이터').click()
        expect(page.locator('.sa-inspector-title h2')).to_have_text('부동산 · 공간 데이터')
        page.get_by_role('tab', name='API', exact=True).click()
        page.locator('.sa-inspector .sa-endpoint').first.click()
        expect(page.locator('.sa-dependency-flow')).to_be_visible()

        view('API 성능')
        page.get_by_label('API 서비스 필터').select_option('support')
        assert page.locator('.am-api-table tbody tr').count() > 0
        assert all('후원 · 결제' in s for s in page.locator('.am-api-table tbody tr').all_text_contents())
        page.get_by_label('API 서비스 필터').select_option('all')
        page.get_by_label('API 메서드 필터').select_option('POST')
        assert page.locator('.am-api-table tbody tr').count() > 0
        assert all(s == 'POST' for s in page.locator('.am-api-table .sa-method').all_text_contents())
        page.get_by_label('API 메서드 필터').select_option('all')
        page.get_by_label('API 상태 필터').select_option('errors')
        assert page.locator('.am-api-table tbody tr').count() > 0
        assert all(int(s) > 0 for s in page.locator('.am-api-table tbody tr td:nth-child(6)').all_text_contents())
        page.get_by_label('API 상태 필터').select_option('slow')
        assert page.locator('.am-api-table tbody tr').count() > 0
        page.get_by_label('API 상태 필터').select_option('all')
        page.get_by_role('textbox', name='시스템 검색').fill('/api/support')
        assert page.locator('.am-api-table tbody tr').count() > 0
        assert all('/api/support' in s for s in page.locator('.am-api-table .sa-endpoint-path').all_text_contents())
        page.get_by_role('textbox', name='시스템 검색').fill('no-such-api-fixture')
        expect(page.locator('.am-api-table .sa-empty')).to_contain_text('없습니다')
        report['checks'].append('API service/method/status/slow/search filters')

        view('외부 연동')
        expect(page.locator('.am-host-card')).to_have_count(5)
        page.get_by_label('외부 연동 상태 필터').select_option('errors')
        assert page.locator('.am-host-card').count() > 0
        assert all('오류 관측' in s for s in page.locator('.am-host-card').all_text_contents())
        report['checks'].append('external host failures and observed flows')

        view('요청 추적')
        page.get_by_label('요청 추적 필터').select_option('http')
        expect(page.locator('.am-span').nth(1)).to_be_visible()
        page.locator('.am-trace-list button').last.click()
        assert page.locator('.am-trace-list button[aria-pressed=true]').count() == 1
        expect(page.locator('.am-waterfall .am-overline')).to_contain_text('REQUEST #')
        page.get_by_role('textbox', name='시스템 검색').fill('no-such-trace-fixture')
        expect(page.locator('.am-trace-empty')).to_be_visible()
        report['checks'].append('request selection, waterfall, filters and empty state')

        view('전체 구조')
        expect(page.locator('.sa-node')).to_have_count(len(graph['nodes']))
        page.get_by_role('button', name='선택 영역 집중', exact=True).click()
        expect(page.get_by_role('button', name='선택 영역 집중', exact=True)).to_have_attribute('aria-pressed', 'true')
        page.get_by_role('button', name='선택 영역 집중', exact=True).click()
        page.get_by_role('button', name='지도 확대', exact=True).click()
        expect(page.get_by_role('button', name='125%', exact=True)).to_be_visible()
        page.get_by_role('button', name='125%', exact=True).click()
        page.emulate_media(reduced_motion='reduce')
        assert page.locator('.sa-signal').first.evaluate('e=>getComputedStyle(e).animationName') == 'none'
        page.emulate_media(reduced_motion='no-preference')

        view('운영 요약')
        page.get_by_role('button', name='일시 정지', exact=True).click()
        page.wait_for_timeout(150)
        count = state['snapshot_calls']
        page.wait_for_timeout(3400)
        assert state['snapshot_calls'] == count
        expect(page.locator('.sa-live-badge')).to_have_text('일시 정지')
        expect(page.locator('.am-command h2')).to_have_text('관측 일시 정지')
        page.get_by_role('button', name='관측 재개', exact=True).click()
        state['fail'] = True
        page.get_by_role('button', name='새로고침', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('마지막 성공 값')
        expect(page.locator('.sa-live-badge')).to_have_text('갱신 지연')
        state['fail'] = False
        page.get_by_role('button', name='다시 시도', exact=True).click()
        expect(page.get_by_role('alert')).to_have_count(0)
        state['health_fail'] = True
        page.get_by_role('button', name='새로고침', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('DB·서버 점검 실패')
        expect(page.locator('.am-command h2')).to_contain_text('갱신 상태 확인 필요')
        state['health_fail'] = False
        page.get_by_role('button', name='다시 시도', exact=True).click()
        expect(page.get_by_role('alert')).to_have_count(0)
        state['empty'] = True
        page.get_by_role('button', name='새로고침', exact=True).click()
        expect(page.locator('.am-command h2')).to_have_text('새로운 요청을 기다립니다')
        expect(page.locator('.am-command-health strong')).to_have_text('—')
        shot('no-traffic.png')
        state['empty'] = False
        page.get_by_role('button', name='새로고침', exact=True).click()
        expect(page.locator('.am-command-health strong')).not_to_have_text('—')
        with page.expect_download() as dl:
            page.get_by_role('button', name='관측 스냅샷 JSON 다운로드').click()
        dl.value.save_as(str(OUTPUT / 'snapshot.json'))
        downloaded = json.loads((OUTPUT / 'snapshot.json').read_text(encoding='utf-8'))
        assert 'fixture-only' not in json.dumps(downloaded)
        assert downloaded['snapshot']['traces']
        report['checks'].append('pause/resume, snapshot failure/recovery, health failure, no traffic, export')

        for width in (1920, 1440, 1024, 768, 390, 360):
            page.set_viewport_size({'width': width, 'height': 1000})
            for name in views:
                view(name)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'body overflow: {width}/{name}'
                if width in (1440, 390): shot(f'{width}-view-{views.index(name)}.png')
            view('운영 요약')
            report['responsive'].append(width)
        page.get_by_label('관측 갱신 주기').select_option('10000')
        expect(page.locator('.sa-page-foot')).to_contain_text('HTTP 폴링 10초')
        state['unauthorized'] = True
        page.get_by_role('button', name='새로고침', exact=True).click()
        page.wait_for_url('**/admin')
        assert page.evaluate("localStorage.getItem('admin_session')") is None
        assert not errors, errors
        report.update(result='passed', console_errors=errors)
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
    except Exception:
        shot('failure.png')
        print(json.dumps({'errors': errors, 'body': page.locator('body').inner_text()[:2000]}, ensure_ascii=False))
        raise
    finally:
        browser.close()
