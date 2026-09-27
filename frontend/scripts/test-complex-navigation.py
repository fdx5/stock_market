"""Real touch regression checks. Run with Vite at 127.0.0.1:5173 and Playwright/Edge.
Only synthetic building data is used; no database or external API writes.
"""
import atexit
import json
import math
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[2]
os.chdir(root)
paths = [root / 'frontend/src/__navigation_test.tsx', root / 'frontend/__navigation_test.html']
assert not any(path.exists() for path in paths), 'Test harness already exists'
atexit.register(lambda: [path.unlink(missing_ok=True) for path in paths])
paths[0].write_text('''import React from 'react';
import {createRoot} from 'react-dom/client';
import ComplexHologram from './components/ComplexHologram';
createRoot(document.getElementById('root')!).render(<div className="re-holo-layer"><ComplexHologram complexId="navigation-test" complexName="터치 조작 검증 단지" caption="3D 건물뷰" initialTod="day" /></div>);
''', encoding='utf-8')
paths[1].write_text('''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/__navigation_test.tsx"></script></body></html>''', encoding='utf-8')

def building(x, y):
    return dict(rings=[[[x,y],[x+30,y],[x+30,y+18],[x,y+18]]], height=65, base=0, floors=22, height_source='measured', name='101동', use='공동주택', approved=2020)
fixture = dict(id='navigation-test', name='터치 조작 검증 단지', address='', built=2020, found=True, source='vworld', attribution='합성 테스트', site=[[[-100,-80],[100,-80],[100,80],[-100,80]]], buildings=[building(-50,-30),building(30,30)], context=[], roads=[], coverage=dict(buildings=2,with_height=2), vworld=True, error=None, fetched_at='')

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu'])
    for width,height in [(390,844),(844,390),(820,1180)]:
        context = browser.new_context(viewport=dict(width=width,height=height), is_mobile=True, has_touch=True, device_scale_factor=1)
        page = context.new_page()
        # Exercise the compatibility canvas too: the same controls drive WebGPU.
        if "--native" not in sys.argv:
            page.add_init_script("Object.defineProperty(navigator, 'gpu', {get:()=>undefined})")
        errors=[]
        page.on('pageerror',lambda e: (errors.append(str(e)),print('PAGE ERROR',str(e),flush=True)))
        page.on('console',lambda m:print(m.type,m.text[:700],flush=True) if m.type=='error' else None)
        page.route('http://127.0.0.1:5173/api/**', lambda route: route.fulfill(json=fixture if '/buildings?' in route.request.url else {}))
        page.goto('http://127.0.0.1:5173/__navigation_test.html', wait_until='domcontentloaded')
        print('LOADED',width,flush=True)
        page.wait_for_function('window.__complexStage?.model && document.querySelector(".re-holo-stage").dataset.shownAt',timeout=45000)
        def state():
            return page.evaluate('''()=>{const s=window.__complexStage;return {position:s.camera.position.toArray(),target:s.controls.target.toArray(),angle:s.controls.getAzimuthalAngle(),distance:s.controls.getDistance(),spin:s.controls.autoRotate}}''')
        canvas=page.locator('.re-holo-stage')
        box=canvas.bounding_box()
        assert box['height']>140,box
        cdp=context.new_cdp_session(page)
        def touch(kind,points):
            cdp.send('Input.dispatchTouchEvent',dict(type=kind,touchPoints=[dict(x=x,y=y,id=i) for i,x,y in points]))
        def gesture(start,end):
            touch('touchStart',start)
            for step in range(1,9):
                touch('touchMove',[(i,x+(end[n][1]-x)*step/8,y+(end[n][2]-y)*step/8) for n,(i,x,y) in enumerate(start)])
                page.wait_for_timeout(20)
            touch('touchEnd',[])
            page.wait_for_timeout(350)
        x=box['x']+box['width']/2; y=box['y']+box['height']/2
        initial=state()
        assert initial['spin'] is False
        gesture([(1,x,y)],[(1,x+55,y+25)])
        moved=state()
        assert math.dist(initial['target'],moved['target'])>1
        assert abs(initial['angle']-moved['angle'])<0.01
        page.get_by_role('button',name='↻ 회전',exact=True).tap()
        gesture([(1,x,y)],[(1,x+55,y)])
        assert abs(state()['angle']-moved['angle'])>0.1
        page.get_by_role('button',name='전체 보기',exact=True).tap()
        before=state()
        gesture([(1,x-25,y),(2,x+25,y)],[(1,x-60,y),(2,x+60,y)])
        assert state()['distance']<before['distance']*0.8
        assert page.locator('.re-holo-tip.is-pinned').count()==0
        distance=state()['distance']
        page.get_by_role('button',name='3D 축소',exact=True).tap()
        assert state()['distance']>distance
        page.get_by_role('button',name='3D 확대',exact=True).tap()
        assert abs(state()['distance']/distance-1)<0.01
        angle=state()['angle']
        page.get_by_role('button',name='3D 오른쪽 회전',exact=True).tap()
        assert abs(state()['angle']-angle)>0.1
        page.get_by_role('button',name='위에서',exact=True).tap()
        assert page.evaluate('window.__complexStage.controls.getPolarAngle()')<0.2
        page.get_by_role('button',name='전체 보기',exact=True).tap()
        assert math.dist(state()['target'],initial['target'])<0.01
        page.wait_for_timeout(3600)
        assert state()['spin'] is False
        for button in page.locator('.re-holo-navigation button').all():
            rect=button.bounding_box()
            assert rect['height']>=44 and rect['width']>=44,rect
            assert rect['x']>=0 and rect['x']+rect['width']<=width+1,rect
            assert rect['y']+rect['height']<=height+1,rect
        assert page.evaluate('window.scrollY')==0
        assert not errors,errors
        Path('tmp').mkdir(exist_ok=True)
        page.screenshot(path=f'tmp/navigation-{width}.png')
        print(f'PASS {width}x{height}: touch pan, rotate, pinch, no false tap, buttons, reset, no auto restart',flush=True)
        if width == 390:
            page.set_viewport_size(dict(width=844,height=390))
            page.wait_for_timeout(300)
            page.get_by_role('button',name='전체 보기',exact=True).tap()
            assert page.evaluate("""()=>{const s=window.__complexStage;for(const x of [-50,60])for(const y of [0,65])for(const z of [-48,30]) {const v=s.camera.position.clone().set(x,y,z).project(s.camera);if(Math.abs(v.x)>1 || Math.abs(v.y)>1)return false;}return true;}""")
            print('PASS orientation change: reset fits every building corner',flush=True)
        context.close()
    browser.close()
