"""Read-only production smoke: deployed commit, real 3D, reopen, mobile, devgame controls."""
import argparse, hashlib, json, re
from pathlib import Path
from urllib.parse import urlencode
import requests
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument('--commit', required=True)
p.add_argument('--complex-id', required=True)
p.add_argument('--base', default='https://kospimap.com')
p.add_argument('--out', type=Path, default=Path('tmp/performance-deployment-smoke.json'))
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
health = requests.get(a.base + '/api/health', timeout=30).json()
assert health.get('status') == 'ok' and health.get('commit') == a.commit, health
assets = []
for folder in ['paint/a70f15220b0da77e2021', 'steel']:
    for file in sorted((root / 'frontend/public/3d' / folder).glob('*.png')):
        response = requests.get(a.base + '/3d/' + folder + '/' + file.name, timeout=30)
        response.raise_for_status()
        digest = hashlib.sha256(response.content).hexdigest()
        assert digest == hashlib.sha256(file.read_bytes()).hexdigest(), file.name
        assets.append({'path':folder + '/' + file.name, 'sha256':digest})
report = {'commit':a.commit, 'health':health, 'assets':assets, 'views':[]}
a.out.parent.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu'])
    for name, size, mobile, game in [('desktop', {'width':1280,'height':900}, False, False),
                                      ('mobile-emulation', {'width':390,'height':844}, True, False),
                                      ('devgame', {'width':1280,'height':900}, False, True)]:
        context = browser.new_context(viewport=size, is_mobile=mobile, has_touch=mobile)
        page = context.new_page()
        errors, console_errors, writes = [], [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: console_errors.append(m.text) if m.type=='error' or 'validation failed' in m.text else None)
        page.on('request', lambda r: writes.append(r.url) if '/api/' in r.url and r.method not in ['GET','HEAD','OPTIONS'] else None)
        query = {'sido':'11','sgg':'11680','complex':a.complex_id,'devgame':'1' if game else '0'}
        page.goto(a.base + '/realestate-map?' + urlencode(query), wait_until='domcontentloaded', timeout=60000)
        page.get_by_role('button', name='3D 건물뷰', exact=True).click(timeout=60000)
        ready = '''()=>{const e=document.querySelector('.re-holo-layer .re-holo-stage, .re-holo--expanded .re-holo-stage');return e && e.dataset.shownAt && e.dataset.renderer==='tidewater-webgpu' && !e.querySelector('.re-holo-scan');}'''
        page.wait_for_function(ready, timeout=90000)
        stage = page.locator('.re-holo-layer .re-holo-stage, .re-holo--expanded .re-holo-stage').first
        state = stage.evaluate('(e)=>({...e.dataset})')
        assert state['quality'] == 'high', state
        # Accessible names may include whitespace between icon and text.
        controls = {label:page.get_by_role('button',name=re.compile(label + '$'))
                    for label in ['쿠팡트럭','사이버트럭','스코어']}
        buttons = {label:locator.count() for label,locator in controls.items()}
        result = {'name':name, 'firstView':state, 'buttons':buttons}
        if game:
            assert all(count == 1 for count in buttons.values()), buttons
            page.wait_for_function('()=>[...document.querySelectorAll("button")].some(e=>e.textContent.includes("쿠팡트럭")&&!e.disabled)', timeout=90000)
            assert all(locator.is_enabled() for locator in controls.values())
            controls['스코어'].click()
            page.get_by_role('dialog',name='배송 게임 순위').wait_for()
            page.wait_for_function('()=>!document.querySelector(".re-drive-board")?.textContent.includes("불러오는 중")', timeout=30000)
            assert '순위를 불러오지 못했습니다.' not in page.locator('.re-drive-board').inner_text()
            result['scoreDialog'] = True
            result['remembered'] = page.evaluate('localStorage.getItem("kospimap.devgame")') == '1'
            assert result['remembered']
        else:
            assert not any(buttons.values()), buttons
            box = stage.bounding_box()
            x, y = box['x']+box['width']*.5, box['y']+box['height']*.55
            page.mouse.move(x,y); page.mouse.down(); page.mouse.move(x+35,y+12,steps=8); page.mouse.up()
            page.wait_for_timeout(1000)
            page.keyboard.press('Escape')
            page.wait_for_function('()=>!document.querySelector(".re-holo-layer, .re-holo--expanded")')
            page.get_by_role('button',name='3D 건물뷰',exact=True).click()
            page.wait_for_function(ready,timeout=90000)
            result['closedAndReopened'] = True
        page.screenshot(path=str(a.out.with_name(a.out.stem+'-'+name+'.png')))
        result.update(errors=errors, consoleErrors=console_errors, apiWrites=writes)
        # The app records ordinary activity and uses POST for the nearby lookup.
        # This smoke must not submit any game scores or other mutations.
        unexpected_writes = [url for url in writes if url.split('?')[0].removeprefix(a.base)
                             not in ['/api/activity/event', '/api/realestate/nearby']]
        assert not errors and not console_errors and not unexpected_writes, result
        report['views'].append(result)
        a.out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({'view':name,'passed':True,'buttons':buttons},ensure_ascii=True),flush=True)
        context.close()
    browser.close()
print(json.dumps({'commit':a.commit,'assets':len(assets),'views':len(report['views']),'passed':True}),flush=True)
