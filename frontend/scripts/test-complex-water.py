"""Water, loading and GPU-throughput check of the native 3D view; Vite :5173, Edge.

Synthetic complex with a river parcel (지목 천) crossing the neighbourhood, so the
water pass, its reflections and refraction are on screen. No remote APIs.
Reports: main-thread long tasks while loading, frame pacing, and GPU+CPU cost per
frame measured without vsync (frames rendered back to back, then waited on).
Usage: python frontend/scripts/test-complex-water.py [--label after] [--scale 1.5]
"""
import argparse
import atexit
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

args = argparse.ArgumentParser()
args.add_argument('--label', default='after')
args.add_argument('--scale', type=float, default=1.5)
args.add_argument('--base-url', default='http://127.0.0.1:5173')
args.add_argument('--headed', action='store_true')
args.add_argument('--profile', action='store_true')
args.add_argument('--quality', default='')
args.add_argument('--only', default='')
args.add_argument('--webgl', action='store_true')
args.add_argument('--args', default='', help='extra browser flags, space separated')
args.add_argument('--throttle', type=float, default=0, help='busy ms per frame: checks the 60 fps step-down')
opts = args.parse_args()
root = Path(__file__).resolve().parents[2]
out = root / 'tmp' / ('complex-water-' + opts.label)
out.mkdir(parents=True, exist_ok=True)
paths = [root / 'frontend/src/__water3d.tsx', root / 'frontend/__water3d.html']
assert not any(p.exists() for p in paths), 'Water harness already exists'
atexit.register(lambda: [p.unlink(missing_ok=True) for p in paths])
paths[0].write_text('''import React from 'react';
import {createRoot} from 'react-dom/client';
import ComplexHologram from './components/ComplexHologram';
import {ComplexRenderer, QUALITY} from './components/tidewater/ComplexRenderer';
(window as any).__QUALITY = QUALITY;
const resize = ComplexRenderer.prototype.setSize;
const scale = Number(new URLSearchParams(location.search).get('scale') || 0);
if (scale) ComplexRenderer.prototype.setSize = function(w, h) { resize.call(this, w, h, scale); };
const render = ComplexRenderer.prototype.render;
ComplexRenderer.prototype.render = function(...a) { (window as any).__native = this; (window as any).__args = a; return render.apply(this, a); };
createRoot(document.getElementById('root')!).render(<div style={{width:1200,height:760,display:'flex',margin:'10px auto'}}>
  <ComplexHologram complexId="water" complexName="Water fixture" initialTod="day" /></div>);
''', encoding='utf-8')
paths[1].write_text('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#e6e9e6"><div id="root"></div><script type="module" src="/src/__water3d.tsx"></script></body></html>', encoding='utf-8')


def building(x, y, w, d, h, i):
    return dict(rings=[[[x, y], [x + w, y], [x + w, y + d], [x, y + d]]], height=h, base=0,
                floors=round(h / 2.9), height_source='measured', name=f'{101 + i}동', use='공동주택', approved=2020)


def river(x):  # the bank line wanders a little, like a real channel
    return 150 + 18 * __import__('math').sin(x / 90)


xs = list(range(-420, 421, 20))
ring = [[x, river(x)] for x in xs] + [[x, river(x) + 70] for x in reversed(xs)]
wet = lambda x, y: river(x) - 8 < y < river(x) + 78
context = [building(x, y, 18, 14, 14 + (i % 4) * 6, i) for i, (x, y) in enumerate(
    [(x, y) for y in range(-310, 311, 35) for x in range(-310, 311, 35) if abs(x) > 120 or abs(y) > 110])
    if not (wet(x, y) or wet(x + 18, y + 14) or wet(x, y + 14))]
data = dict(id='water', name='Water fixture', address='', built=2020, found=True, source='vworld', attribution='Synthetic',
            site=[[[-100, -85], [100, -85], [100, 85], [-100, 85]]],
            buildings=[building(x, y, 32, 15, 65 + (i % 3) * 12, i) for i, (x, y) in enumerate([(x, y) for y in [-55, 0, 55] for x in [-75, 0, 65]])],
            context=context,
            roads=[dict(line=[[-360, y], [360, y]], width=14, lanes=4) for y in [-110, 110]],
            parcels=[dict(ring=ring, kind='천'), dict(ring=[[-100, -85], [100, -85], [100, 85], [-100, 85]], kind='대')],
            coverage=dict(buildings=9, with_height=9), vworld=True, error=None, fetched_at='')

instrument = '''
window.__tasks = [];
new PerformanceObserver(l => __tasks.push(...l.getEntries().map(x => ({start: +x.startTime.toFixed(0), ms: +x.duration.toFixed(0)})))).observe({type: 'longtask', buffered: true});
'''
FRAMES = '''()=>new Promise(r=>{const s=[];let p=performance.now();function f(n){s.push(n-p);p=n;if(s.length<180)requestAnimationFrame(f);else{s.sort((a,b)=>a-b);r({median:+s[90].toFixed(1),p95:+s[171].toFixed(1),over33:s.filter(x=>x>33.4).length})}}requestAnimationFrame(f)})'''
# Back-to-back frames without vsync: CPU submit + GPU execution per frame.
THROUGHPUT = '''async()=>{const n=window.__native, a=window.__args; const q=n.canvas.getContext('webgpu') && (window.__dev);
  const dev=window.__reviewDevice; const run=async k=>{const t=performance.now(); for(let i=0;i<k;i++) n.render(...a); await dev.queue.onSubmittedWorkDone(); return (performance.now()-t)/k;};
  await run(5); const r=[]; for(let i=0;i<5;i++) r.push(await run(20)); r.sort((x,y)=>x-y); return +r[2].toFixed(2);}'''
CAM = {
    'overview': '(s)=>{}',
    'river': '(s)=>{s.controls.target.set(60,0,-200);s.camera.position.set(-60,110,-40);}',
    'bank': '(s)=>{s.controls.target.set(60,1,-185);s.camera.position.set(-10,9,-120);}',
    'low': '(s)=>{s.controls.target.set(120,4,-190);s.camera.position.set(-140,3.5,-176);}',
}

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=not opts.headed, args=['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] + opts.args.split())
    page = browser.new_page(viewport=dict(width=1240, height=800), device_scale_factor=1)
    page.add_init_script(instrument)
    if opts.webgl:
        page.add_init_script("Object.defineProperty(navigator, 'gpu', {value: undefined})")
    page.add_init_script("""if (typeof GPUAdapter !== 'undefined') { const o = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function(...a) { const d = await o.apply(this, a); window.__reviewDevice = d; return d; }; }""")
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' or 'validation' in m.text.lower() or 'WGSL' in m.text else None)
    page.route(opts.base_url + '/api/**', lambda r: r.fulfill(json=data))
    if opts.profile:
        cdp = page.context.new_cdp_session(page)
        cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200}); cdp.send('Profiler.start')
    page.goto(f'{opts.base_url}/__water3d.html?scale={opts.scale}')
    page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt", timeout=60000)
    shown = float(page.evaluate("document.querySelector('.re-holo-stage').dataset.shownAt"))
    page.wait_for_function("(()=>{let n=0;window.__complexStage?.scene.traverse(o=>{if(o.material?.userData?.water)n++});return n>0})()", timeout=60000)
    page.wait_for_timeout(5000)
    if opts.profile:
        prof = cdp.send('Profiler.stop')['profile']
        (out / 'load.cpuprofile').write_text(json.dumps(prof), encoding='utf-8')
        nodes = {n['id']: n for n in prof['nodes']}
        dt = {}
        for sid, d in zip(prof['samples'], prof['timeDeltas']):
            n = nodes[sid]['callFrame']; k = f"{n['functionName'] or '(anon)'} {n['url'].split('/')[-1].split('?')[0]}:{n['lineNumber']+1}"
            dt[k] = dt.get(k, 0) + d / 1000
        print('self-time top:', json.dumps(sorted(dt.items(), key=lambda x: -x[1])[:30], ensure_ascii=False, indent=0), flush=True)
    report = {'shownAt': shown, 'state': page.evaluate("({...document.querySelector('.re-holo-stage').dataset})")}
    tasks = page.evaluate('__tasks')
    report['longtasks'] = {'count': len(tasks), 'total': sum(t['ms'] for t in tasks), 'max': max([t['ms'] for t in tasks] or [0]),
                           'afterShown': sum(t['ms'] for t in tasks if t['start'] > shown), 'list': tasks}
    page.evaluate("()=>{const s=window.__complexStage;s.controls.autoRotate=false;s.intro=null;s.controls.update()}")
    if opts.quality:
        page.evaluate(f"()=>window.__native.setQuality({{...__QUALITY.high, ...{opts.quality}}})")
        page.wait_for_timeout(1500)
    for tod in ['day', 'next']:
        if tod != 'day':
            page.locator('button[title^="시간대 바꾸기"]').first.click()
            page.wait_for_timeout(2600)
        for name, js in CAM.items():
            if (tod != 'day' and name not in ('river', 'bank')) or (opts.only and name not in opts.only.split(',')):
                continue
            page.evaluate(f"()=>{{const s=window.__complexStage;s.controls.autoRotate=false;({js})(s);s.controls.update()}}")
            page.wait_for_timeout(900)
            page.locator('.re-holo-stage').screenshot(path=str(out / f'{tod}-{name}.png'))
            if tod == 'day':
                report[name] = {'frames': page.evaluate(FRAMES)} if opts.webgl else {'frames': page.evaluate(FRAMES), 'gpuMs': page.evaluate(THROUGHPUT),
                                'draws': page.evaluate("window.__native.stats.draws"),
                                'passes': page.evaluate("(async()=>{await new Promise(r=>setTimeout(r,1500));return Object.fromEntries(Object.entries(window.__native.timer.ms).map(([k,v])=>[k,+v.toFixed(3)]))})()")}
                print(name, json.dumps(report[name]), flush=True)
    if opts.throttle:
        page.evaluate(f"()=>{{const r=window.__native.render;window.__native.render=function(...a){{const t=performance.now();while(performance.now()-t<{opts.throttle});return r.apply(this,a)}}}}")
        steps = []
        for _ in range(16):
            page.wait_for_timeout(1000)
            steps.append(page.evaluate("(()=>{const d=document.querySelector('.re-holo-stage').dataset;return d.pixelRatio+'/'+d.quality+'/'+d.fps})()"))
        report['throttle'] = steps
        print('throttle', steps, flush=True)
    report['tris'] = page.evaluate('''()=>{const out={};let total=0;window.__complexStage.scene.traverseVisible(o=>{if(!o.isMesh||!o.geometry)return;
      const g=o.geometry;const t=(g.index?g.index.count:(g.attributes.position?.count||0))/3*(o.isInstancedMesh?o.count:1);total+=t;
      let k=o.name||'';let p=o;while(!k&&p.parent){p=p.parent;k=p.name||Object.keys(p.userData||{}).join('+');}
      k=(k||'?')+(o.isInstancedMesh?' [inst '+o.count+']':'')+' '+(o.material?.name||o.material?.type||'');out[k]=(out[k]||0)+t;});
      return {total:Math.round(total),top:Object.entries(out).sort((a,b)=>b[1]-a[1]).slice(0,18).map(([k,v])=>[k,Math.round(v)])}}''')
    print('tris', json.dumps(report['tris'], ensure_ascii=False), flush=True)
    report['finalState'] = page.evaluate("({...document.querySelector('.re-holo-stage').dataset})")
    report['errors'] = errors
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'longtasks'} | {'longtasks': {k: v for k, v in report['longtasks'].items() if k != 'list'}}, ensure_ascii=False), flush=True)
    browser.close()
