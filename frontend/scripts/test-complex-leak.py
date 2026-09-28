"""Opening and closing a complex repeatedly must not leak. Vite :5173 (--port), Edge.

A rail view stays mounted (as on the map page) while a second view is mounted and
unmounted like the detail sheet, N times. After each cycle: JS heap after GC, live
GPU buffers / textures, WebGL contexts not lost, animation-frame callbacks per second
(render loops left running), canvases in the page, and the rail view's frame time.
Usage: python frontend/scripts/test-complex-leak.py [--cycles 8] [--label x]
"""
import argparse
import atexit
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--cycles', type=int, default=8)
ap.add_argument('--label', default='after')
ap.add_argument('--webgl', action='store_true')
ap.add_argument('--port', type=int, default=5173)
ap.add_argument('--host', default='127.0.0.1')
ap.add_argument('--snapshot', action='store_true', help='write a heap snapshot after the cycles')
opts = ap.parse_args()
root = Path(__file__).resolve().parents[2]
out = root / 'tmp' / ('complex-leak-' + opts.label)
out.mkdir(parents=True, exist_ok=True)
paths = [root / 'frontend/src/__leak3d.tsx', root / 'frontend/__leak3d.html']
assert not any(p.exists() for p in paths), 'Leak harness already exists'
atexit.register(lambda: [p.unlink(missing_ok=True) for p in paths])
paths[0].write_text('''import React, {useState, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
const ComplexHologram = lazy(() => import('./components/ComplexHologram'));
function Page() {
  const [sheet, setSheet] = useState<string | null>(null);
  (window as any).__sheet = setSheet;
  return <div style={{display:'flex',gap:10,height:620}}>
    <div style={{width:520,display:'flex'}}><Suspense fallback={null}><ComplexHologram complexId="rail" complexName="Rail" initialTod="day" paused={!!sheet} /></Suspense></div>
    {sheet && <div style={{width:620,display:'flex'}}><Suspense fallback={null}><ComplexHologram key={sheet} complexId={sheet} complexName="Sheet" initialTod="day" /></Suspense></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Page/>);
''', encoding='utf-8')
paths[1].write_text('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/__leak3d.tsx"></script></body></html>', encoding='utf-8')


def building(x, y, w, d, h, i):
    return dict(rings=[[[x, y], [x + w, y], [x + w, y + d], [x, y + d]]], height=h, base=0, floors=round(h / 2.9),
                height_source='measured', name=f'{101 + i}동', use='공동주택', approved=2020)


def data(cid):
    return dict(id=cid, name=cid, address='', built=2020, found=True, source='vworld', attribution='Synthetic',
                site=[[[-100, -85], [100, -85], [100, 85], [-100, 85]]],
                buildings=[building(x, y, 32, 15, 65 + (i % 3) * 12, i) for i, (x, y) in enumerate([(x, y) for y in [-55, 0, 55] for x in [-75, 0, 65]])],
                context=[building(x, y, 18, 14, 14 + (i % 4) * 6, i) for i, (x, y) in enumerate([(x, y) for y in range(-310, 311, 35) for x in range(-310, 311, 35) if abs(x) > 120 or abs(y) > 110])],
                roads=[dict(line=[[-360, y], [360, y]], width=14, lanes=4) for y in [-110, 110]],
                parcels=[dict(ring=[[-900, 150], [900, 150], [900, 650], [-900, 650]], kind='천')],
                coverage=dict(buildings=9, with_height=9), vworld=True, error=None, fetched_at='')


instrument = '''
window.__m = {buffers: 0, bufBytes: 0, textures: 0, texBytes: 0, raf: 0, contexts: []};
const raf = window.requestAnimationFrame;
window.requestAnimationFrame = f => { __m.raf++; return raf(f); };
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...a) { const c = getContext.call(this, type, ...a); if (c && /webgl/.test(type) && !__m.contexts.some(r => r.deref() === c)) __m.contexts.push(new WeakRef(c)); return c; };
if (typeof GPUDevice !== 'undefined') {
  const sz = new WeakMap(), cb = GPUDevice.prototype.createBuffer, db = GPUBuffer.prototype.destroy;
  GPUDevice.prototype.createBuffer = function (d) { const b = cb.call(this, d); sz.set(b, d.size); __m.buffers++; __m.bufBytes += d.size; return b; };
  GPUBuffer.prototype.destroy = function () { if (sz.has(this)) { __m.buffers--; __m.bufBytes -= sz.get(this); sz.delete(this); } return db.call(this); };
  const ts = new WeakMap(), ct = GPUDevice.prototype.createTexture, dt = GPUTexture.prototype.destroy;
  GPUDevice.prototype.createTexture = function (d) { const t = ct.call(this, d); const s = d.size, w = s.width ?? s[0], h = s.height ?? s[1] ?? 1, l = s.depthOrArrayLayers ?? s[2] ?? 1;
    const bytes = w * h * l * 4 * (d.mipLevelCount > 1 ? 1.33 : 1); ts.set(t, bytes); __m.textures++; __m.texBytes += bytes; return t; };
  GPUTexture.prototype.destroy = function () { if (ts.has(this)) { __m.textures--; __m.texBytes -= ts.get(this); ts.delete(this); } return dt.call(this); };
}
'''
FRAMES = '''()=>new Promise(r=>{const s=[];let p=performance.now();function f(n){s.push(n-p);p=n;if(s.length<90)requestAnimationFrame(f);else{s.sort((a,b)=>a-b);r(+s[45].toFixed(1))}}requestAnimationFrame(f)})'''

with sync_playwright() as p:
    args = ['--enable-unsafe-webgpu', '--js-flags=--expose-gc']
    browser = p.chromium.launch(channel='msedge', headless=True, args=args)
    page = browser.new_page(viewport=dict(width=1200, height=680))
    page.add_init_script(instrument)
    if opts.webgl:
        page.add_init_script("Object.defineProperty(navigator, 'gpu', {value: undefined})")
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.route(f'http://{opts.host}:{opts.port}/api/**', lambda r: r.fulfill(json=data(r.request.url.split('id=')[-1].split('&')[0] if 'id=' in r.request.url else 'rail')))
    page.goto(f'http://{opts.host}:{opts.port}/__leak3d.html')
    page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt", timeout=60000)
    page.wait_for_timeout(5000)
    cdp = page.context.new_cdp_session(page)

    def measure(tag):
        for _ in range(3):
            cdp.send('HeapProfiler.collectGarbage')
        page.wait_for_timeout(300)
        heap = cdp.send('Runtime.getHeapUsage')['usedSize']
        r0 = page.evaluate('__m.raf'); page.wait_for_timeout(1000); r1 = page.evaluate('__m.raf')
        m = page.evaluate("({buffers:__m.buffers,bufMB:+(__m.bufBytes/1e6).toFixed(1),textures:__m.textures,texMB:+(__m.texBytes/1e6).toFixed(1),"
                          "gl:__m.contexts.map(r=>r.deref()).filter(c=>c&&!c.isContextLost()).length,canvases:document.querySelectorAll('canvas').length})")
        m.update(tag=tag, heapMB=round(heap / 1e6, 1), rafPerSec=r1 - r0, railFrame=page.evaluate(FRAMES))
        print(json.dumps(m), flush=True)
        return m

    rows = [measure('start')]
    for i in range(opts.cycles):
        page.evaluate(f"__sheet('sheet-{i}')")
        page.wait_for_function("document.querySelectorAll('.re-holo-stage').length===2 && document.querySelectorAll('.re-holo-stage')[1].dataset.shownAt", timeout=60000)
        page.wait_for_timeout(4500)  # decoration: walkers, trees, water, traffic
        page.evaluate("__sheet(null)")
        page.wait_for_timeout(1200)
        rows.append(measure(f'cycle{i + 1}'))
    if opts.snapshot:
        chunks = []
        cdp.on('HeapProfiler.addHeapSnapshotChunk', lambda e: chunks.append(e['chunk']))
        cdp.send('HeapProfiler.collectGarbage')
        cdp.send('HeapProfiler.takeHeapSnapshot', {'reportProgress': False})
        (out / 'heap.heapsnapshot').write_text(''.join(chunks), encoding='utf-8')
    (out / 'report.json').write_text(json.dumps({'rows': rows, 'errors': errors}, indent=1), encoding='utf-8')
    print('errors', errors[:5])
    browser.close()
