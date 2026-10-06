"""Browser regression: actual source graph, deterministic read-only runtime fixtures.
Requires Vite :5187 and backend/.venv's Playwright. No production network or DB.
"""
import copy
import json
import os
import sys
import time
from pathlib import Path

os.environ['PYTHON_DOTENV_DISABLED'] = '1'
for key in ('TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','REALESTATE_TURSO_DATABASE_URL','REALESTATE_TURSO_AUTH_TOKEN'):
    os.environ[key] = ''
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.main import app
from app.services import system_atlas, api_pulse, system_telemetry
from playwright.sync_api import sync_playwright, expect

output = ROOT / 'tmp/system-atlas-qa'
output.mkdir(parents=True, exist_ok=True)
graph = system_atlas.architecture(app.routes)
for i, endpoint in enumerate(graph['endpoints']):
    from types import SimpleNamespace
    token = system_telemetry.begin_request({'route':SimpleNamespace(path=endpoint['path'])})
    for n in range((i % 4) + 1):
        api_pulse.record(endpoint['path'], endpoint['methods'][0], 503 if i % 31 == 0 else 200, 12 + i * 2 + n * 12,trace_id=system_telemetry.request_id())
    if i % 4 == 0:
        system_telemetry.record('apis.data.go.kr' if endpoint['group']=='realestate' else 'query1.finance.yahoo.com','GET',200,82+i)
    system_telemetry.end_request(token)
for i, host in enumerate(['query1.finance.yahoo.com','m.stock.naver.com','apis.data.go.kr','api.resend.com','openapi.vworld.kr']):
    system_telemetry.record(host,'GET',200,87 + i * 49)
live = system_atlas.live_snapshot(app.routes)
health = {'at': '2026-10-06T15:30:00+09:00', 'uptime_s': 43620, 'commit': 'fixture-local', 'memory_mb': 482.4,
          'db': {'ok': True, 'ms': 156}, 'gates': [{'name': 'page_view_store', 'calls': 3901, 'busy_rejects': 0,
          'errors': 0, 'avg_wait_ms': 1, 'avg_work_ms': 142, 'open': False, 'last_error': None}],
          'threads': [{'name':'prediction-scheduler','count':1},{'name':'realestate-collector','count':1}],
          'errors_last_hour': 1, 'warnings_last_hour': 2, 'logs': [], 'admin_cache': [], 'realestate': {}}
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5187')

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width':1920,'height':1200}, device_scale_factor=1)
    context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'fixture-only',expires_at:Date.now()/1000+3600}));")
    state = {'fail':False, 'unauthorized':False, 'snapshot_calls':0}
    def api(route):
        path = route.request.url.split('?')[0]
        if '/api/admin/atlas/' in path:
            assert route.request.method == 'GET'
            if state['unauthorized']: route.fulfill(status=401,json={'detail':'fixture expired'}); return
            if state['fail'] and path.endswith('/snapshot'): route.fulfill(status=503,json={'detail':'fixture offline'}); return
            if path.endswith('/architecture'): route.fulfill(json=graph)
            elif path.endswith('/health'): route.fulfill(json=health)
            elif path.endswith('/snapshot'):
                state['snapshot_calls'] += 1
                data = copy.deepcopy(live); data['at'] = time.time()
                route.fulfill(json=data)
            else: route.fulfill(json={})
        else: route.fulfill(json={'count':0, 'country':'KR','ok':True,'events':[]})
    context.route('**/api/**',api)
    page = context.new_page(); errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto(base + '/admin/system-atlas')
    try:
        expect(page.locator('.sa-node')).to_have_count(len(graph['nodes']),timeout=30000)
    except Exception:
        page.screenshot(path=str(output/'failure.png'),full_page=True)
        print(json.dumps({'errors':errors,'body':page.locator('body').inner_text()[:2500]},ensure_ascii=False))
        raise
    expect(page.locator('.sa-live-badge')).to_have_text('LIVE OBSERVATION')
    page.screenshot(path=str(output/'desktop.png'), full_page=True)
    page.get_by_role('button',name='부동산 · 공간 데이터 상세 보기',exact=True).click()
    expect(page.locator('.sa-inspector-title h2')).to_have_text('부동산 · 공간 데이터')
    page.get_by_role('tab',name='API',exact=True).click()
    expect(page.locator('.sa-inspector .sa-endpoint').first).to_be_visible()
    page.locator('.sa-inspector .sa-endpoint').first.click()
    expect(page.locator('.sa-dependency-flow')).to_be_visible()
    page.screenshot(path=str(output/'endpoint-detail.png'),full_page=True)
    page.get_by_role('button',name='API 인벤토리',exact=True).click()
    search=page.get_by_role('textbox',name='시스템 검색')
    search.fill('/api/support')
    expect(page.locator('.sa-inventory .sa-endpoint').first).to_be_visible()
    assert all('/api/support' in text for text in page.locator('.sa-inventory .sa-endpoint-path').all_text_contents())
    search.fill('')
    page.get_by_role('button',name='DB · 캐시',exact=True).click()
    expect(page.locator('.sa-gate-table')).to_be_visible()
    page.get_by_role('button',name='기술 스택',exact=True).click()
    expect(page.locator('.sa-stack-grid')).to_be_visible()
    page.get_by_role('button',name='전체 구조',exact=True).click()
    page.get_by_role('button',name='선택 영역 집중',exact=True).click()
    expect(page.get_by_role('button',name='선택 영역 집중',exact=True)).to_have_attribute('aria-pressed','true')
    page.get_by_role('button',name='선택 영역 집중',exact=True).click()
    page.get_by_role('button',name='지도 확대',exact=True).click()
    expect(page.get_by_role('button',name='125%',exact=True)).to_be_visible()
    page.get_by_role('button',name='125%',exact=True).click()
    page.get_by_role('button',name='일시 정지',exact=True).click()
    count=state['snapshot_calls']; page.wait_for_timeout(3700)
    assert state['snapshot_calls']==count,'pause must stop polling'
    expect(page.locator('.sa-live-badge')).to_have_text('일시 정지')
    page.get_by_role('button',name='관측 재개',exact=True).click()
    expect(page.locator('.sa-live-badge')).to_have_text('LIVE OBSERVATION')
    state['fail']=True; page.get_by_role('button',name='새로고침',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('마지막 성공 값')
    expect(page.locator('.sa-live-badge')).to_have_text('갱신 지연')
    assert page.locator('.sa-node').count()==len(graph['nodes'])
    state['fail']=False; page.get_by_role('button',name='다시 시도',exact=True).click()
    expect(page.get_by_role('alert')).to_have_count(0)
    with page.expect_download() as download:
        page.get_by_role('button',name='관측 스냅샷 JSON 다운로드').click()
    download.value.save_as(str(output/'snapshot.json'))
    downloaded=json.loads((output/'snapshot.json').read_text(encoding='utf-8'))
    assert len(downloaded['architecture']['nodes'])==len(graph['nodes'])
    assert 'fixture-only' not in json.dumps(downloaded)
    for width in (1440,1024,768,390):
        page.set_viewport_size({'width':width,'height':1000})
        page.wait_for_timeout(150)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'body overflow at {width}'
        page.screenshot(path=str(output/f'viewport-{width}.png'),full_page=True)
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('.sa-signal').first.evaluate('e=>getComputedStyle(e).animationName')=='none'
    state['unauthorized']=True
    page.get_by_role('button',name='새로고침',exact=True).click()
    page.wait_for_url('**/admin')
    assert page.evaluate("localStorage.getItem('admin_session')") is None
    assert not errors, errors
    browser.close()
    print(json.dumps({'result':'passed','nodes':len(graph['nodes']),'apis':len(graph['endpoints']),
                      'modules':len(graph['modules']),'screenshots':str(output),'console_errors':errors}))
