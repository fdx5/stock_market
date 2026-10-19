"""Isolated browser QA: source inventory + synthetic traffic; no app startup or DB.

All browser API calls are intercepted. Source modules are parsed, never imported.
Only the read-only architecture builder and in-memory statistics helpers are used.
"""
import ast
import copy
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ['PYTHON_DOTENV_DISABLED'] = '1'
for name in ('TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'REALESTATE_TURSO_DATABASE_URL', 'REALESTATE_TURSO_AUTH_TOKEN'):
    os.environ[name] = ''
from app.services import system_atlas, system_telemetry
from playwright.sync_api import sync_playwright, expect

OUT = ROOT / 'tmp/synapse-20261019'
OUT.mkdir(parents=True, exist_ok=True)
routes = []
for path in (ROOT / 'backend/app/routers').glob('*.py'):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    prefix = ''
    for item in tree.body:
        if isinstance(item, ast.Assign) and isinstance(item.value, ast.Call):
            for kw in item.value.keywords:
                if kw.arg == 'prefix' and isinstance(kw.value, ast.Constant): prefix = str(kw.value.value)
    for item in ast.walk(tree):
        if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)): continue
        for decorator in item.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute): continue
            if decorator.func.attr not in ('get', 'post', 'put', 'patch', 'delete'): continue
            if not decorator.args or not isinstance(decorator.args[0], ast.Constant): continue
            endpoint = SimpleNamespace(__module__='app.routers.' + path.stem, __name__=item.name)
            routes.append(SimpleNamespace(path='/api' + prefix + str(decorator.args[0].value), endpoint=endpoint, methods={decorator.func.attr.upper()}))
graph = system_atlas.architecture(routes)

def fixture():
    now = time.time()
    api, external, traces = [], [], []
    hosts = ['query1.finance.yahoo.com', 'apis.data.go.kr', 'm.stock.naver.com', 'api.resend.com']
    for i, endpoint in enumerate(graph['endpoints']):
        event = {'id': i + 1, 'trace_id': i + 1, 'ts': now - (i % 59), 'method': endpoint['methods'][0],
                 'route': endpoint['path'], 'ms': 34 + (i % 13) * 91, 'status': 503 if i % 29 == 0 else 404 if i % 41 == 0 else 200}
        api.append(event)
        calls = []
        if i % 2 == 0:
            call = {'id': i + 1, 'trace_id': i + 1, 'ts': event['ts'] - .02, 'host': hosts[i % 4], 'route': endpoint['path'], 'method': 'GET', 'ms': event['ms'] / 2, 'status': event['status']}
            calls.append(call); external.append(call)
        traces.append({'request': event, 'calls': calls, 'external_count': len(calls), 'calls_truncated': False})
    groups = {}
    endpoints = []
    for endpoint in graph['endpoints']:
        rows = [e for e in api if e['route'] == endpoint['path']]
        endpoints.append(dict(system_telemetry.stats(rows), path=endpoint['path'], method=endpoint['methods'][0]))
    for node in graph['nodes']:
        paths = {e['path'] for e in graph['endpoints'] if e['group'] == node['id']}
        groups[node['id']] = system_telemetry.stats([e for e in api if e['route'] in paths])
    flows = [dict(system_telemetry.stats(t['calls']), route=t['request']['route'], host=t['calls'][0]['host']) for t in traces if t['calls']]
    return {'at': now, 'active_sessions': 4, 'observed_edges': {},
      'api': dict(system_telemetry.stats(api), window_s=60, window_truncated=False, groups=groups, endpoints=endpoints, recent=api, breakdown=system_telemetry.breakdown(api, now)),
      'external': dict(system_telemetry.stats(external), started_at=now-600, window_s=60, window_truncated=False, groups={}, hosts=[dict(system_telemetry.stats([e for e in external if e['host']==h]),host=h) for h in hosts], flows=flows, recent=external, breakdown=system_telemetry.breakdown(external,now)),
      'traces': traces, 'cache': {'entries':120,'fresh':100,'stale':20,'refreshing':1,'capacity':20000},
      'database': {'mode':'sqlite','separate_realestate':False,'realestate_mode':'sqlite'}}

health = {'at': '', 'uptime_s': 7200, 'commit': 'isolated-qa', 'memory_mb': 245, 'db': {'ok':True,'ms':8},
          'gates':[], 'threads':[], 'errors_last_hour':0, 'warnings_last_hour':0, 'logs':[], 'admin_cache':[], 'realestate':{}}
state = {'fail':False,'empty':False,'unauthorized':False,'calls':0}
report = {'checks':[], 'responsive':[], 'nodes':0, 'links':0}

def api(route):
    if '/src/api/' in route.request.url:
        route.continue_(); return
    assert route.request.method == 'GET' or '/atlas/' not in route.request.url
    path = route.request.url.split('?')[0]
    if state['unauthorized'] and '/atlas/' in path: route.fulfill(status=401,json={'detail':'expired fixture'}); return
    if path.endswith('/atlas/architecture'): route.fulfill(json=graph)
    elif path.endswith('/atlas/health'): route.fulfill(json=health)
    elif path.endswith('/atlas/snapshot'):
        state['calls'] += 1
        if state['fail']: route.fulfill(status=503,json={'detail':'fixture offline'}); return
        data = fixture()
        if state['empty']:
            for key in ('api','external'):
                data[key].update(system_telemetry.stats([]), recent=[], groups={}, breakdown=system_telemetry.breakdown([],time.time()))
            data['api']['endpoints']=[];data['external'].update(hosts=[],flows=[]);data['traces']=[]
        route.fulfill(json=data)
    else: route.fulfill(json={'ok':True,'count':0,'country':'KR','events':[]})

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge',headless=True)
    context = browser.new_context(viewport={'width':1600,'height':1200},device_scale_factor=1)
    context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'isolated-fixture',expires_at:Date.now()/1000+3600}));")
    context.route('**/api/**',api)
    context.route('https://**/*',lambda route:route.abort())
    page = context.new_page(); errors=[]; shader_errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:shader_errors.append(m.text) if m.type=='error' and ('THREE' in m.text or 'Shader' in m.text) else None)
    try:
        page.goto(os.environ.get('TEST_BASE_URL','http://127.0.0.1:5198')+'/admin/system-atlas')
        expect(page.locator('.sn-scene')).to_have_attribute('data-state','ready',timeout=60000)
        page.wait_for_function("Number(document.querySelector('.sn-scene').dataset.frames)>5",timeout=60000)
        page.screenshot(path=str(OUT/'synapse-desktop.png'),full_page=True)
        report['nodes']=int(page.locator('.sn-scene').get_attribute('data-nodes'))
        report['links']=int(page.locator('.sn-scene').get_attribute('data-links'))
        report['fps']=page.locator('.sn-render-status').inner_text()
        report['checks'].append('source inventory, WebGL shaders, actual-sample journal')
        page.get_by_label('통신 노드 검색').fill('/api/')
        expect(page.locator('.sn-search-results>button').first).to_be_visible()
        page.locator('.sn-search-results>button').first.click()
        expect(page.locator('.sn-node-identity h2')).to_contain_text('/api/')
        page.get_by_role('button',name='인접 연결만',exact=True).click()
        expect(page.get_by_role('button',name='인접 연결만',exact=True)).to_have_attribute('aria-pressed','true')
        page.get_by_label('통신 노드 검색').fill('no-such-connection')
        expect(page.locator('.sn-search-results')).to_contain_text('조건에 맞는 노드가 없습니다')
        page.get_by_role('button',name='필터 해제',exact=True).click()
        page.get_by_role('button',name='인접 연결만',exact=True).click()
        page.get_by_label('신호 로그 필터').select_option('errors')
        assert page.locator('.sn-event').count()>0
        assert all(int(x)>=400 or x=='ERR' for x in page.locator('.sn-event>b').all_text_contents())
        page.locator('.sn-event').first.click()
        expect(page.locator('.sn-telemetry h2')).to_have_text('선택한 통신 경로')
        page.get_by_label('신호 로그 필터').select_option('all')
        report['checks'].append('node search, selection, one-hop isolation, error filter, trace inspection')
        page.get_by_role('button',name='모션 정지',exact=True).click()
        expect(page.locator('.sn-scene')).to_have_attribute('data-motion','false')
        page.get_by_role('button',name='모션 재개',exact=True).click()
        page.emulate_media(reduced_motion='reduce')
        expect(page.get_by_role('button',name='모션 감소',exact=True)).to_be_disabled()
        expect(page.locator('.sn-scene')).to_have_attribute('data-motion','false')
        page.emulate_media(reduced_motion='no-preference')
        page.get_by_label('신호 재생 속도').select_option('3')
        page.get_by_role('button',name='표본 재생',exact=True).click()
        expect(page.locator('.sn-space-foot')).to_contain_text('보존 표본 재생 중')
        page.get_by_label('신경망 그래픽 품질').select_option('eco')
        page.get_by_role('button',name='로그 고정',exact=True).click()
        before=page.locator('.sn-event-list').inner_text()
        page.wait_for_timeout(1300)
        assert page.locator('.sn-event-list').inner_text()==before
        page.get_by_role('button',name='로그 갱신 재개',exact=True).click()
        report['checks'].append('motion/reduced-motion, speed, sample replay, quality, journal freeze')
        page.get_by_role('button',name='관측 정지',exact=True).click()
        page.wait_for_timeout(300)
        count=state['calls'];page.wait_for_timeout(1400);assert state['calls']==count
        expect(page.locator('.sn-scene')).to_have_attribute('data-motion','false')
        page.get_by_role('button',name='관측 재개',exact=True).click()
        state['fail']=True
        expect(page.locator('.sn-live')).to_contain_text('수신 지연',timeout=15000)
        expect(page.locator('.sn-scene')).to_have_attribute('data-motion','false')
        state['fail']=False
        expect(page.locator('.sn-live')).to_contain_text('실제 표본 수신 중',timeout=15000)
        state['empty']=True
        expect(page.locator('.sn-empty')).to_be_visible(timeout=15000)
        page.screenshot(path=str(OUT/'synapse-empty.png'),full_page=True)
        state['empty']=False
        expect(page.locator('.sn-event').first).to_be_visible(timeout=15000)
        report['checks'].append('poll pause/resume, offline retention, recovery, empty telemetry')
        for width in (1920,1440,1024,768,390,360):
            page.set_viewport_size({'width':width,'height':1050})
            page.wait_for_timeout(350)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'overflow {width}'
            if width in (1920,390):page.screenshot(path=str(OUT/f'synapse-{width}.png'),full_page=True)
            report['responsive'].append(width)
        page.set_viewport_size({'width':1600,'height':1200})
        page.locator('.sn-scene canvas').evaluate("c=>c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
        expect(page.locator('.sn-fallback')).to_contain_text('중단',timeout=10000)
        expect(page.locator('.sn-event').first).to_be_visible()
        page.get_by_role('button',name='3D 다시 연결',exact=True).click()
        expect(page.locator('.sn-scene')).to_have_attribute('data-state','ready',timeout=20000)
        report['checks'].append('context-loss fallback and recovery')
        state['unauthorized']=True
        page.wait_for_url('**/admin',timeout=15000)
        report['checks'].append('expired authentication returns to login')
        assert not errors,errors
        assert not shader_errors,shader_errors
        report.update(result='passed',errors=errors,shader_errors=shader_errors)
    except Exception:
        page.screenshot(path=str(OUT/'failure.png'),full_page=True)
        print(json.dumps({'errors':errors,'shader_errors':shader_errors},ensure_ascii=False))
        raise
    finally:
        (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
print(json.dumps(report,ensure_ascii=False))
