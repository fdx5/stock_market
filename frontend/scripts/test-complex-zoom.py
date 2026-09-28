"""Wheel zoom keeps working after panning and turning. Vite :5173, Edge, synthetic data.

After each sequence of pans (right drag) and turns (left drag), eight wheel notches at
the view centre should bring the camera ~0.78^8 = 0.14 of the way to the surface there;
a ratio near 1 means zoom stalled. Pans are also checked to move the view.
Usage: python frontend/scripts/test-complex-zoom.py
"""
import atexit
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
paths = [root / 'frontend/src/__zoom3d.tsx', root / 'frontend/__zoom3d.html']
assert not any(p.exists() for p in paths), 'Zoom harness already exists'
atexit.register(lambda: [p.unlink(missing_ok=True) for p in paths])
paths[0].write_text('''import React from 'react';
import {createRoot} from 'react-dom/client';
import ComplexHologram from './components/ComplexHologram';
createRoot(document.getElementById('root')!).render(<div style={{width:1100,height:720,display:'flex',margin:'10px auto'}}>
  <ComplexHologram complexId="zoom" complexName="Zoom" initialTod="day" /></div>);
''', encoding='utf-8')
paths[1].write_text('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/__zoom3d.tsx"></script></body></html>', encoding='utf-8')


def building(x, y, w, d, h, i):
    return dict(rings=[[[x, y], [x + w, y], [x + w, y + d], [x, y + d]]], height=h, base=0, floors=round(h / 2.9),
                height_source='measured', name=f'{101 + i}동', use='공동주택', approved=2020)


data = dict(id='zoom', name='Zoom', address='', built=2020, found=True, source='vworld', attribution='Synthetic',
            site=[[[-100, -85], [100, -85], [100, 85], [-100, 85]]],
            buildings=[building(x, y, 32, 15, 65, i) for i, (x, y) in enumerate([(x, y) for y in [-55, 55] for x in [-75, 40]])],
            context=[building(x, y, 18, 14, 20, i) for i, (x, y) in enumerate([(x, y) for y in range(-300, 301, 60) for x in range(-300, 301, 60) if abs(x) > 130 or abs(y) > 120])],
            roads=[], parcels=[], coverage=dict(buildings=4, with_height=4), vworld=True, error=None, fetched_at='')

# distance from the camera to the surface at the view centre (ground plane or a building)
SURFACE = '''() => { const s = window.__complexStage, c = s.camera, d = c.getWorldDirection(c.position.clone());
  let best = Infinity; if (d.y < 0) best = (s.floor - c.position.y) / d.y;
  for (const m of s.pickables) { const b = new m.geometry.boundingBox.constructor().copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    const ray = { o: c.position, d }; let t0 = 0, t1 = Infinity;
    for (const k of ['x','y','z']) { const inv = 1 / d[k]; let a = (b.min[k] - c.position[k]) * inv, e = (b.max[k] - c.position[k]) * inv; if (a > e) [a, e] = [e, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, e); }
    if (t0 <= t1) best = Math.min(best, t0); }
  return best; }'''

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu'])
    page = browser.new_page(viewport=dict(width=1200, height=800))
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('http://127.0.0.1:5173/api/**', lambda r: r.fulfill(json=data))
    page.goto('http://127.0.0.1:5173/__zoom3d.html')
    page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt", timeout=60000)
    page.evaluate("()=>{const s=window.__complexStage;s.controls.autoRotate=false;s.intro=null;s.controls.update();s.pickables.forEach(m=>m.geometry.computeBoundingBox())}")
    page.wait_for_timeout(3500)  # the intro flight
    r = page.evaluate("(()=>{const b=document.querySelector('.re-holo-stage').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()")
    cx, cy = r
    cam = lambda: page.evaluate("(()=>{const c=window.__complexStage.camera.position;return [c.x,c.y,c.z]})()")

    def drag(button, dx, dy):
        page.mouse.move(cx, cy); page.mouse.down(button=button)
        for i in range(1, 11): page.mouse.move(cx + dx * i / 10, cy + dy * i / 10); page.wait_for_timeout(16)
        page.mouse.up(button=button); page.wait_for_timeout(700)

    def zoom(n=8):
        page.mouse.move(cx, cy)
        before = page.evaluate(SURFACE)
        for _ in range(n): page.mouse.wheel(0, -100); page.wait_for_timeout(120)
        page.wait_for_timeout(600)
        after = page.evaluate(SURFACE)
        return round(after / before, 3), round(before, 1)

    out = {'start': zoom()}
    page.mouse.move(cx, cy)
    for _ in range(8): page.mouse.wheel(0, 100); page.wait_for_timeout(100)  # back out
    page.wait_for_timeout(600)
    seq = [('pan', 'right', 380, 0), ('rotate', 'left', 250, 0), ('pan', 'right', 0, 300), ('rotate', 'left', -150, 60), ('pan', 'right', -500, -200)]
    for name, button, dx, dy in seq:
        c0 = cam(); drag(button, dx, dy); c1 = cam()
        moved = round(sum((a - b) ** 2 for a, b in zip(c0, c1)) ** 0.5, 1)
        z = zoom()
        out[name + f'{dx},{dy}'] = {'moved': moved, 'zoomRatio': z[0], 'surface': z[1]}
        page.mouse.move(cx, cy)
        for _ in range(8): page.mouse.wheel(0, 100); page.wait_for_timeout(100)
        page.wait_for_timeout(600)
    print(json.dumps({'results': out, 'errors': errors}, ensure_ascii=False))
    browser.close()
