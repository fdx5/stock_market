"""Two-finger pinch on a scrolled page zooms toward the point between the fingers.
Vite :5173, Edge. Synthetic complex; the view sits below a spacer and the page is
scrolled, as on a phone. Measures how far the ground point under the pinch midpoint
moves on screen during the pinch (0 = the zoom is anchored there).
Usage: python frontend/scripts/test-complex-pinch.py
"""
import atexit
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
paths = [root / 'frontend/src/__pinch3d.tsx', root / 'frontend/__pinch3d.html']
assert not any(p.exists() for p in paths), 'Pinch harness already exists'
atexit.register(lambda: [p.unlink(missing_ok=True) for p in paths])
paths[0].write_text('''import React from 'react';
import {createRoot} from 'react-dom/client';
import ComplexHologram from './components/ComplexHologram';
createRoot(document.getElementById('root')!).render(<div>
  <div style={{height: 700, background: '#ddd'}}>spacer</div>
  <div style={{width: '100%', height: 520, display: 'flex'}}><ComplexHologram complexId="pinch" complexName="Pinch" initialTod="day" /></div>
  <div style={{height: 1200}} /></div>);
''', encoding='utf-8')
paths[1].write_text('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/__pinch3d.tsx"></script></body></html>', encoding='utf-8')


def building(x, y, w, d, h, i):
    return dict(rings=[[[x, y], [x + w, y], [x + w, y + d], [x, y + d]]], height=h, base=0, floors=round(h / 2.9),
                height_source='measured', name=f'{101 + i}동', use='공동주택', approved=2020)


data = dict(id='pinch', name='Pinch', address='', built=2020, found=True, source='vworld', attribution='Synthetic',
            site=[[[-100, -85], [100, -85], [100, 85], [-100, 85]]],
            buildings=[building(x, y, 32, 15, 65, i) for i, (x, y) in enumerate([(x, y) for y in [-55, 55] for x in [-75, 40]])],
            context=[], roads=[], parcels=[], coverage=dict(buildings=4, with_height=4), vworld=True, error=None, fetched_at='')

# ground (y = floor) point under a viewport pixel of the view
GROUND = '''([cx, cy]) => { const s = window.__complexStage, cam = s.camera, r = s.renderer.domElement.getBoundingClientRect();
  const nx = (cx - r.left) / r.width * 2 - 1, ny = -(cy - r.top) / r.height * 2 + 1;
  const p = cam.position.clone().set(nx, ny, 0.5).unproject(cam), o = cam.position.clone(), d = p.sub(o).normalize();
  const t = (s.floor - o.y) / d.y; return [o.x + d.x * t, o.z + d.z * t]; }'''
# viewport pixel of a ground point
SCREEN = '''([x, z]) => { const s = window.__complexStage, cam = s.camera, r = s.renderer.domElement.getBoundingClientRect();
  const p = cam.position.clone().set(x, s.floor, z).project(cam); return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height]; }'''

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu'])
    ctx = browser.new_context(viewport=dict(width=412, height=860), device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('http://127.0.0.1:5173/api/**', lambda r: r.fulfill(json=data))
    page.goto('http://127.0.0.1:5173/__pinch3d.html')
    page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt", timeout=60000)
    page.evaluate("window.scrollTo(0, 560)")
    page.wait_for_timeout(500)
    page.evaluate("()=>{const s=window.__complexStage;s.controls.autoRotate=false;s.intro=null;s.controls.enableDamping=false;s.controls.update()}")
    rect = page.evaluate("(()=>{const r=document.querySelector('.re-holo-stage').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    cdp = ctx.new_cdp_session(page)
    results = []
    # pinch-out off centre (lower left of the view), then pinch-in (upper right)
    for fx, fy, grow in [(0.3, 0.62, True), (0.7, 0.38, False)]:
        mx, my = rect[0] + rect[2] * fx, rect[1] + rect[3] * fy
        anchor = page.evaluate(GROUND, [mx, my])
        steps = 12
        d0, d1 = (30, 110) if grow else (110, 40)
        def touch(kind, d):
            pts = [] if kind == 'touchEnd' else [dict(x=mx - d / 2, y=my, id=1), dict(x=mx + d / 2, y=my, id=2)]
            cdp.send('Input.dispatchTouchEvent', dict(type=kind, touchPoints=pts))
        touch('touchStart', d0)
        for i in range(1, steps + 1):
            touch('touchMove', d0 + (d1 - d0) * i / steps)
            page.wait_for_timeout(30)
        touch('touchEnd', d1)
        page.wait_for_timeout(300)
        after = page.evaluate(SCREEN, anchor)
        results.append({'grow': grow, 'midpoint': [round(mx), round(my)], 'anchorNowAt': [round(after[0]), round(after[1])],
                        'drift_px': round(((after[0] - mx) ** 2 + (after[1] - my) ** 2) ** 0.5, 1),
                        'dist': round(page.evaluate("window.__complexStage.camera.position.distanceTo(window.__complexStage.controls.target)"), 1)})
    print(json.dumps({'scrollY': page.evaluate('scrollY'), 'results': results, 'errors': errors}, ensure_ascii=False))
    browser.close()
