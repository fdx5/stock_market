"""Spider crawling, arrival effects, flow journal, actual traffic replay, deduplication, fallback and responsive QA.

Production assets may be tested; all API responses are isolated read-only fixtures.
"""
import copy
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

fixture = Path(__file__).with_name('test-atlas-monitoring.py')
ns = {'__file__': str(fixture)}
exec(compile(fixture.read_text(encoding='utf-8').split('\nwith sync_playwright() as p:')[0], str(fixture), 'exec'), ns)
graph, live, health = ns['graph'], ns['live'], ns['health']
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5195')
output = Path(os.environ.get('NEXUS_QA_OUTPUT', str(ns['ROOT'] / 'tmp/atlas-spider-flow-qa')))
output.mkdir(parents=True, exist_ok=True)
report = {'base':base, 'checks':[], 'responsive':[]}
state = {'empty':False, 'new':False, 'calls':0}

def api(route):
    url = route.request.url.split('?')[0]
    if url.endswith('/atlas/architecture'): route.fulfill(json=graph)
    elif url.endswith('/atlas/health'): route.fulfill(json=health)
    elif url.endswith('/atlas/snapshot'):
        state['calls'] += 1
        data = copy.deepcopy(live); data['at'] = live['at'] + state['calls'] * .01
        if state['empty']:
            data['api'].update(count=0,errors=0,recent=[],groups={},endpoints=[])
            data['external'].update(count=0,errors=0,recent=[],groups={},hosts=[],flows=[])
            data['observed_edges'] = {}; data['traces'] = []
        elif state['new']:
            endpoint = next(e for e in graph['endpoints'] if e['group']=='realestate')
            event = {'id':999999,'trace_id':999999,'ts':live['at'],'route':endpoint['path'],'method':endpoint['methods'][0],'status':200,'ms':225}
            data['api']['recent'].insert(0,event); data['traces'].insert(0,{'request':event,'calls':[],'external_count':0,'calls_truncated':False})
            data['api']['count'] += 1
        route.fulfill(json=data)
    else: route.fulfill(json={'ok':True,'country':'KR','count':0,'events':[]})

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge',headless=True)
    context = browser.new_context(viewport={'width':1920,'height':1200})
    context.add_init_script(f"localStorage.setItem('admin_session',JSON.stringify({{token:'fixture-only',expires_at:Date.now()/1000+3600}}));Date.now=()=>{int(live['at']*1000)};Object.defineProperty(document,'hidden',{{configurable:true,get:()=>Boolean(window.__atlasHidden)}});")
    context.route('**/api/**',api)
    page=context.new_page(); errors=[]; warnings=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:warnings.append(m.text) if m.type=='warning' else None)
    page.goto(base+'/admin/system-atlas'); scene=page.locator('.af-scene')
    try:
        expect(page.get_by_role('button',name='거미 관제',exact=True)).to_have_attribute('aria-pressed','true')
        expect(scene).to_have_attribute('data-state','ready',timeout=60000)
        page.wait_for_function("Number(document.querySelector('.af-scene').dataset.frames)>3",timeout=60000)
        expect(scene).to_have_attribute('data-spiders','1'); expect(scene).to_have_attribute('data-legs','8'); expect(scene).to_have_attribute('data-camera','fixed'); expect(scene).to_have_attribute('data-speed','3')
        expect(page.locator('.af-service-node')).to_have_count(6)
        positions=scene.get_attribute('data-positions'); page.wait_for_timeout(700)
        assert scene.get_attribute('data-positions')!=positions
        expect(page.locator('.af-mission')).to_have_count(0)
        expect(page.get_by_role('heading',name='실시간 흐름 로그')).to_be_visible()
        expect(page.locator('.af-service-kicker')).to_have_count(6)
        assert len(set(page.locator('.af-service-kicker').all_text_contents()))==6
        page.wait_for_function("Number(document.querySelector('.af-scene').dataset.arrivals)>0",timeout=20000)
        expect(page.locator('.af-log-arrival').first).to_be_attached()
        assert page.locator('[data-flow-node][data-impact=on]').count()>0
        assert float(scene.get_attribute('data-max-step'))<24, 'continuous crawling must never jump across the board'
        assert float(scene.get_attribute('data-gait'))>0
        assert '센티널' not in page.locator('.af-command').inner_text()
        journal=page.locator('.af-log-stream')
        assert journal.evaluate('el=>el.scrollHeight>el.clientHeight && el.scrollTop+el.clientHeight>=el.scrollHeight-50')
        assert page.locator('.af-workspace').evaluate('el=>el.clientHeight')<1400
        page.get_by_role('button',name='자동 스크롤 ON').click()
        expect(page.get_by_role('button',name='자동 스크롤 OFF')).to_have_attribute('aria-pressed','false')
        page.get_by_role('button',name='자동 스크롤 OFF').click()
        page.screenshot(path=str(output/'arrival-desktop.png'),full_page=True)
        report['checks'].append('one eight-legged spider crawls continuously with distance-based gait, arrival impact, distinct functional landmarks and accumulating journal')
        for width,height in [(1920,1200),(1440,1100),(1024,1100),(768,1000),(390,1000),(360,1000)]:
            page.set_viewport_size({'width':width,'height':height}); page.wait_for_timeout(700)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            page.screenshot(path=str(output/f'flow-{width}.png'),full_page=True)
            report['responsive'].append(width)
            expect(page.get_by_role('button',name='자동 스크롤 ON')).to_have_attribute('aria-pressed','true')
        page.set_viewport_size({'width':1440,'height':1100})
        page.get_by_role('group',name='관제 서비스 선택').get_by_role('button',name='부동산').click()
        expect(page.locator('.af-service-node[aria-label="부동산 흐름 선택"]')).to_have_attribute('aria-pressed','true')
        expect(page.locator('.af-service-load h2')).to_have_text('부동산 관측')
        page.locator('.af-trace-chips button').first.click()
        expect(page.locator('.af-request-route code')).to_contain_text('/api/')
        page.get_by_role('button',name='모션 정지',exact=True).click()
        expect(scene).to_have_attribute('data-motion','paused'); frozen=scene.get_attribute('data-simulation-time'); loc=scene.get_attribute('data-positions')
        page.wait_for_timeout(1200); assert scene.get_attribute('data-simulation-time')==frozen; assert scene.get_attribute('data-positions')==loc
        page.get_by_role('button',name='모션 재개',exact=True).click(); expect(scene).to_have_attribute('data-motion','running')
        page.get_by_label('거미 이동 속도').select_option('5'); expect(scene).to_have_attribute('data-speed','5')
        report['checks'].append('service isolation, actual request selection and replay, speed control, motion freeze')
        page.get_by_role('group',name='관제 서비스 선택').get_by_role('button',name='전체 흐름').click()
        page.get_by_role('button',name='표본 재생',exact=True).click()
        page.wait_for_function("Number(document.querySelector('.af-scene').dataset.packets)>0",timeout=30000)
        seen=scene.get_attribute('data-seen')
        page.wait_for_function("Number(document.querySelector('.af-scene').dataset.queued)===0&&Number(document.querySelector('.af-scene').dataset.packets)===0",timeout=45000)
        page.wait_for_timeout(3400)
        assert scene.get_attribute('data-seen')==seen
        assert scene.get_attribute('data-packets')=='0', 'identical snapshot must not invent new traffic'
        state['new']=True
        page.wait_for_function("previous=>Number(document.querySelector('.af-scene').dataset.seen)>Number(previous)",arg=seen,timeout=10000)
        state['empty']=True
        page.wait_for_function("Number(document.querySelector('.af-scene').dataset.packets)===0&&Number(document.querySelector('.af-scene').dataset.queued)===0",timeout=10000)
        expect(page.locator('.af-trace-panel h2')).to_have_text('요청 표본 대기',timeout=10000)
        page.wait_for_timeout(700)
        empty_position=scene.get_attribute('data-positions'); page.wait_for_timeout(700)
        assert scene.get_attribute('data-positions')==empty_position
        report['checks'].append('no invented or duplicated traffic, new observed request ingested, empty traffic stops spider and clears signals')
        state['empty']=False
        page.get_by_label('3D 그래픽 품질').select_option('eco'); expect(scene).to_have_attribute('data-state','ready',timeout=60000)
        page.emulate_media(reduced_motion='reduce'); expect(scene).to_have_attribute('data-motion','paused'); expect(page.get_by_role('button',name='모션 감소')).to_be_disabled()
        page.emulate_media(reduced_motion='no-preference'); expect(scene).to_have_attribute('data-motion','running')
        page.evaluate("window.__atlasHidden=true;document.dispatchEvent(new Event('visibilitychange'))")
        frames=scene.get_attribute('data-frames'); page.wait_for_timeout(700); assert scene.get_attribute('data-frames')==frames
        page.evaluate("window.__atlasHidden=false;document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_function("previous=>Number(document.querySelector('.af-scene').dataset.frames)>Number(previous)",arg=frames)
        page.evaluate("window.__loss=document.querySelector('.af-world-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__loss.loseContext()")
        expect(scene).to_have_attribute('data-state','context-lost'); page.wait_for_timeout(500); page.evaluate('window.__loss.restoreContext()')
        expect(scene).to_have_attribute('data-state','ready',timeout=30000)
        page.wait_for_function("Number(document.querySelector('.af-scene').dataset.frames)>2",timeout=30000)
        report['checks'].append('quality, reduced motion, hidden tab, WebGL recovery')
        page.locator('.af-destination').filter(has_text='시세').click()
        expect(page.get_by_role('button',name='외부 연동',exact=True)).to_have_attribute('aria-pressed','true')
        page.get_by_role('button',name='거미 관제',exact=True).click()
        expect(scene).to_have_attribute('data-state','ready',timeout=60000)
        expect(page.get_by_role('group',name='관제 서비스 선택').get_by_role('button',name='전체 흐름')).to_have_attribute('aria-pressed','true')
        for _ in range(2):
            page.get_by_role('button',name='API 성능',exact=True).click(); expect(page.locator('.af-world-canvas')).to_have_count(0)
            page.get_by_role('button',name='거미 관제',exact=True).click(); expect(scene).to_have_attribute('data-state','ready',timeout=60000); expect(page.locator('.af-world-canvas')).to_have_count(1)
        page.get_by_role('button',name='관측 정지',exact=True).click(); expect(scene).to_have_attribute('data-motion','paused')
        page.get_by_role('button',name='관측 재개',exact=True).click(); expect(scene).to_have_attribute('data-motion','running')
        fallback=browser.new_context(viewport={'width':390,'height':900})
        fallback.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'fixture-only',expires_at:Date.now()/1000+3600}));const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args)}")
        fallback.route('**/api/**',api); fp=fallback.new_page(); fp.goto(base+'/admin/system-atlas')
        expect(fp.get_by_role('heading',name='데이터 관제 모드')).to_be_visible(timeout=30000)
        expect(fp.locator('.af-kpis strong').first).to_contain_text(f"{(live['api']['count']+1)/60:.2f}")
        fp.get_by_role('button',name='API 성능',exact=True).click(); expect(fp.locator('.am-api-table')).to_be_visible(); fallback.close()
        assert not errors,errors; assert not any('INVALID_OPERATION' in w for w in warnings),warnings
        report.update(result='passed',page_errors=errors,warnings=warnings)
        (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False))
    except Exception:
        page.screenshot(path=str(output/'failure.png'),full_page=True)
        print(json.dumps({'errors':errors,'body':page.locator('body').inner_text()[:2000]},ensure_ascii=False)); raise
    finally: browser.close()
