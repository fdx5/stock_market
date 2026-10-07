"""3D lifecycle, visual, interaction and responsive QA with read-only API fixtures."""
import copy
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

fixture_path = Path(__file__).with_name('test-atlas-monitoring.py')
namespace = {'__file__': str(fixture_path)}
exec(compile(fixture_path.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], str(fixture_path), 'exec'), namespace)
graph, live, health = namespace['graph'], namespace['live'], namespace['health']
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5191')
output = Path(os.environ.get('NEXUS_QA_OUTPUT', str(namespace['ROOT'] / 'tmp/atlas-nexus-qa')))
output.mkdir(parents=True, exist_ok=True)
report = {'base': base, 'checks': [], 'screens': []}

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1920, 'height': 1080})
    context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'fixture-only',expires_at:Date.now()/1000+3600}));")
    context.add_init_script("Object.defineProperty(document,'hidden',{configurable:true,get:()=>Boolean(window.__atlasHidden)});")
    def api(route):
        if route.request.url.split('?')[0].endswith('/atlas/architecture'): route.fulfill(json=graph)
        elif route.request.url.split('?')[0].endswith('/atlas/health'): route.fulfill(json=health)
        elif route.request.url.split('?')[0].endswith('/atlas/snapshot'):
            data = copy.deepcopy(live); data['at'] = time.time(); route.fulfill(json=data)
        else: route.fulfill(json={'count': 0, 'country': 'KR', 'ok': True, 'events': []})
    context.route('**/api/**', api)
    page = context.new_page(); errors = []; warnings = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda msg: warnings.append(msg.text) if msg.type == 'warning' else None)
    page.goto(base + '/admin/system-atlas')
    scene = page.locator('.an-scene')
    try:
        expect(page.get_by_role('button', name='3D 관제', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(scene).to_have_attribute('data-state', 'ready', timeout=60000)
        page.wait_for_function("Number(document.querySelector('.an-scene')?.dataset.frames)>3", timeout=60000)
        expect(page.locator('.an-world-canvas')).to_have_count(1)
        expect(scene).to_have_attribute('data-sentinels', '3')
        for width, height in [(1920,1080),(1440,1000),(1024,1000),(768,1000),(390,1000),(360,1000)]:
            page.set_viewport_size({'width':width,'height':height}); page.wait_for_timeout(900)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow: {width}'
            page.screenshot(path=str(output / f'nexus-{width}.png'),full_page=True)
            report['screens'].append({'width':width,'overflow':False})
        page.set_viewport_size({'width':1440,'height':1000})
        page.locator('.an-domains button').filter(has_text='부동산').click()
        expect(page.locator('.an-hud-right h2')).to_have_text('부동산 · 공간 데이터')
        expect(scene).to_have_attribute('data-selected','realestate')
        page.get_by_role('button', name='모션 정지', exact=True).click()
        expect(scene).to_have_attribute('data-motion','paused')
        simulation = scene.get_attribute('data-simulation-time'); page.wait_for_timeout(1700)
        assert scene.get_attribute('data-simulation-time') == simulation
        page.get_by_role('button', name='모션 재개', exact=True).click()
        expect(scene).to_have_attribute('data-motion','running')
        report['checks'].append('animated articulated sentinels, real node selection, motion pause/resume')

        initial_camera = scene.get_attribute('data-camera')
        box = scene.bounding_box(); assert box
        page.mouse.move(box['x']+box['width']*.55,box['y']+box['height']*.48)
        page.mouse.down(); page.mouse.move(box['x']+box['width']*.55+130,box['y']+box['height']*.48+20,steps=12);page.mouse.up()
        page.wait_for_timeout(600)
        assert scene.get_attribute('data-camera') != initial_camera
        page.get_by_role('button',name='시점 초기화',exact=True).click()
        page.wait_for_timeout(1700)
        report['checks'].append('orbit drag and camera reset')

        page.get_by_label('3D 그래픽 품질').select_option('eco')
        expect(scene).to_have_attribute('data-state','ready',timeout=60000)
        page.wait_for_function("Number(document.querySelector('.an-scene')?.dataset.frames)>2",timeout=60000)
        expect(page.locator('.an-world-canvas')).to_have_count(1)
        page.emulate_media(reduced_motion='reduce')
        expect(scene).to_have_attribute('data-motion','paused')
        expect(page.get_by_role('button',name='모션 감소',exact=True)).to_be_disabled()
        reduced_time = scene.get_attribute('data-simulation-time'); page.wait_for_timeout(1500)
        assert scene.get_attribute('data-simulation-time') == reduced_time
        page.emulate_media(reduced_motion='no-preference')
        expect(scene).to_have_attribute('data-motion','running')
        report['checks'].append('quality rebuild, reduced motion, one live canvas')

        page.evaluate("window.__atlasHidden=true;document.dispatchEvent(new Event('visibilitychange'))")
        hidden_frames = scene.get_attribute('data-frames'); page.wait_for_timeout(1200)
        assert scene.get_attribute('data-frames') == hidden_frames
        page.evaluate("window.__atlasHidden=false;document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_function("previous=>Number(document.querySelector('.an-scene').dataset.frames)>Number(previous)", arg=hidden_frames)
        page.evaluate("window.__atlasLoss=document.querySelector('.an-world-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__atlasLoss.loseContext()")
        expect(scene).to_have_attribute('data-state','context-lost')
        expect(page.locator('.an-context-note')).to_be_visible()
        page.wait_for_timeout(600)
        page.evaluate("window.__atlasLoss.restoreContext()")
        expect(scene).to_have_attribute('data-state','ready',timeout=20000)
        page.wait_for_function("Number(document.querySelector('.an-scene').dataset.frames)>2",timeout=30000)
        expect(page.locator('.an-world-canvas')).to_have_count(1)
        expect(page.locator('.an-context-note')).not_to_be_visible()
        report['checks'].append('hidden tab stops rendering, WebGL context recovery')

        page.get_by_role('button',name='상세 분석 열기',exact=True).click()
        expect(page.get_by_role('button',name='서비스',exact=True)).to_have_attribute('aria-pressed','true')
        expect(page.locator('.sa-inspector-title h2')).to_have_text('부동산 · 공간 데이터')
        expect(page.locator('.an-world-canvas')).to_have_count(0)
        for _ in range(3):
            page.get_by_role('button',name='3D 관제',exact=True).click()
            expect(page.locator('.an-scene')).to_have_attribute('data-state','ready',timeout=60000)
            expect(page.locator('.an-world-canvas')).to_have_count(1)
            page.get_by_role('button',name='API 성능',exact=True).click()
            expect(page.locator('.an-world-canvas')).to_have_count(0)
        page.get_by_role('button',name='3D 관제',exact=True).click()
        expect(scene).to_have_attribute('data-state','ready',timeout=60000)
        page.get_by_role('button',name='관측 정지',exact=True).click()
        expect(scene).to_have_attribute('data-motion','paused')
        page.get_by_role('button',name='관측 재개',exact=True).click()
        expect(scene).to_have_attribute('data-motion','running')
        report['checks'].append('analysis handoff, renderer cleanup on navigation, observation pause')
        fallback_context = browser.new_context(viewport={'width':390,'height':900})
        fallback_context.add_init_script("localStorage.setItem('admin_session',JSON.stringify({token:'fixture-only',expires_at:Date.now()/1000+3600}));const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...rest){return type.startsWith('webgl')?null:original.call(this,type,...rest)};")
        fallback_context.route('**/api/**',api)
        fallback = fallback_context.new_page(); fallback.goto(base+'/admin/system-atlas')
        expect(fallback.get_by_role('heading',name='저전력 관제 모드')).to_be_visible(timeout=30000)
        expect(fallback.locator('.an-primary-stat strong')).to_contain_text('2.67')
        fallback.locator('.an-domains button').filter(has_text='부동산').click()
        fallback.get_by_role('button',name='상세 분석 열기',exact=True).click()
        expect(fallback.get_by_role('button',name='서비스',exact=True)).to_have_attribute('aria-pressed','true')
        fallback_context.close()
        report['checks'].append('WebGL unavailable retains telemetry and analysis navigation')
        assert not errors, errors
        assert not any('INVALID_OPERATION' in warning for warning in warnings), warnings
        report.update(result='passed',page_errors=errors,warnings=warnings)
        (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False))
    except Exception:
        page.screenshot(path=str(output/'failure.png'),full_page=True)
        print(json.dumps({'page_errors':errors,'warnings':warnings,'body':page.locator('body').inner_text()[:1500]},ensure_ascii=False))
        raise
    finally:
        browser.close()
