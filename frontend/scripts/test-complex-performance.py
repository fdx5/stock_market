"""Reproducible 3D performance/lifecycle check; Vite :5173 and Playwright/Edge.

Synthetic buildings and roads, no remote APIs or database writes. Compare reports
from the same machine with --label before/after. --webgl checks the fallback.
"""
import argparse
import atexit
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

args = argparse.ArgumentParser()
args.add_argument('--label', default='after')
args.add_argument('--webgl', action='store_true')
args.add_argument('--base-url', default='http://127.0.0.1:5173')
opts = args.parse_args()
root = Path(__file__).resolve().parents[2]
out = root / 'tmp' / ('complex-perf-' + opts.label + ('-webgl' if opts.webgl else ''))
out.mkdir(parents=True, exist_ok=True)
paths = [root / 'frontend/src/__perf3d.tsx', root / 'frontend/__perf3d.html']
assert not any(p.exists() for p in paths), 'Performance harness already exists'
atexit.register(lambda: [p.unlink(missing_ok=True) for p in paths])
paths[0].write_text('''import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ComplexHologram from './components/ComplexHologram';
import {ComplexRenderer} from './components/tidewater/ComplexRenderer';
// Hold resolution constant so adaptive scaling cannot skew the before/after run.
const resize = ComplexRenderer.prototype.setSize;
ComplexRenderer.prototype.setSize = function(w, h) { resize.call(this, w, h, 1.5); };
const original = ComplexRenderer.prototype.render;
ComplexRenderer.prototype.render = function(...args) {
  (window as any).__native = this;
  const t = performance.now();
  original.apply(this, args);
  (window as any).__perf.cpu.push(performance.now() - t);
};
function Review() {
  const [id, select] = useState('perf-a');
  (window as any).__select = select;
  return <div style={{width:1100,height:780,display:'flex',margin:'20px auto'}}>
    <ComplexHologram complexId={id} complexName="Performance fixture" initialTod="day" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
''', encoding='utf-8')
paths[1].write_text('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/__perf3d.tsx"></script></body></html>', encoding='utf-8')

def building(x, y, w, d, h, i):
    return dict(rings=[[[x,y],[x+w,y],[x+w,y+d],[x,y+d]]],height=h,base=0,
                floors=round(h/2.9),height_source='measured',name=f'{101+i}동',use='공동주택',approved=2020)

data = dict(id='perf-a',name='Performance fixture',address='',built=2020,found=True,
            source='vworld',attribution='Synthetic fixture',
            site=[[[-100,-85],[100,-85],[100,85],[-100,85]]],
            buildings=[building(x,y,32,15,65+(i%3)*12,i) for i,(x,y) in enumerate([(x,y) for y in [-55,0,55] for x in [-75,0,65]])],
            context=[building(x,y,18,14,14+(i%4)*6,i) for i,(x,y) in enumerate([(x,y) for y in range(-310,311,35) for x in range(-310,311,35) if abs(x)>120 or abs(y)>110])],
            roads=[dict(line=[[-360,y],[360,y]],width=14,lanes=4) for y in [-110,110]],
            parcels=[],coverage=dict(buildings=9,with_height=9),vworld=True,error=None,fetched_at='')

instrument = '''
window.__perf = {cpu:[], writes:0, bytes:0, passes:0, draws:0, liveBytes:0, buffers:0, pipelines:0, tasks:[]};
new PerformanceObserver(l=>__perf.tasks.push(...l.getEntries().map(x=>({start:x.startTime,ms:x.duration})))).observe({type:'longtask',buffered:true});
const raf = window.requestAnimationFrame;
window.requestAnimationFrame = f => raf(t=>{if (!window.__freeze) f(t)});
if (typeof GPUDevice !== 'undefined') {
  const sizes=new WeakMap(), create=GPUDevice.prototype.createBuffer, destroy=GPUBuffer.prototype.destroy;
  GPUDevice.prototype.createBuffer=function(d) {const b=create.call(this,d);sizes.set(b,d.size);__perf.liveBytes+=d.size;__perf.buffers++;return b;};
  GPUBuffer.prototype.destroy=function() {if(sizes.has(this)){__perf.liveBytes-=sizes.get(this);__perf.buffers--;sizes.delete(this)}return destroy.call(this)};
  const write=GPUQueue.prototype.writeBuffer;
  GPUQueue.prototype.writeBuffer=function(b,o,d,offset,size){__perf.writes++;__perf.bytes+=(size??d.byteLength)*(d.BYTES_PER_ELEMENT??1);return write.apply(this,arguments)};
  const pipeline=GPUDevice.prototype.createRenderPipelineAsync;
  GPUDevice.prototype.createRenderPipelineAsync=function(){__perf.pipelines++;return pipeline.apply(this,arguments)};
  for (const name of ['draw','drawIndexed']) {
    const original=GPURenderPassEncoder.prototype[name];
    GPURenderPassEncoder.prototype[name]=function(){__perf.draws++;return original.apply(this,arguments)};
  }
  const pass=GPUCommandEncoder.prototype.beginRenderPass;
  GPUCommandEncoder.prototype.beginRenderPass=function(){__perf.passes++;return pass.apply(this,arguments)};
}
'''
sample = '''()=>new Promise(resolve=>{
  __perf.cpu=[];__perf.writes=__perf.bytes=__perf.draws=__perf.passes=0;
  const samples=[];let prev=performance.now();
  function frame(now){samples.push(now-prev);prev=now;if(samples.length<180)requestAnimationFrame(frame);else {
    const summary=a=>{a.sort((x,y)=>x-y);return {median:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0}};
    resolve({raf:summary(samples),cpu:summary(__perf.cpu),frames:__perf.cpu.length,
      writes:__perf.writes,bytes:__perf.bytes,draws:__perf.draws,passes:__perf.passes,
      liveBytes:__perf.liveBytes,buffers:__perf.buffers,pipelines:__perf.pipelines,
      state:{...document.querySelector('.re-holo-stage').dataset}});
  }}requestAnimationFrame(frame);
})'''

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu'])
    page = browser.new_page(viewport=dict(width=1280,height=900), device_scale_factor=1)
    page.add_init_script(instrument)
    if opts.webgl:
        page.add_init_script("Object.defineProperty(navigator, 'gpu', {value:undefined})")
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' or 'validation failed' in m.text else None)
    page.route(opts.base_url + '/api/**',lambda r:r.fulfill(json={**data,'id':'perf-b' if 'perf-b' in r.request.url else 'perf-a'}))
    page.goto(opts.base_url + '/__perf3d.html')
    try:
        page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt",timeout=45000)
    except Exception:
        print(json.dumps({'errors':errors,'text':page.locator('body').inner_text(),'state':page.evaluate('({...document.querySelector(".re-holo-stage")?.dataset})')},ensure_ascii=False),flush=True)
        page.screenshot(path=str(out/'failure.png'))
        raise
    report={'first':page.evaluate('({...__perf,state:{...document.querySelector(".re-holo-stage").dataset}})')}
    traffic_ready = "()=>{let ready=false;window.__complexStage?.scene.traverse(g=>{if(g.userData.traffic)ready=true});return ready && !!document.querySelector('.re-holo-stage')?.dataset.shownAt}"
    page.wait_for_function(traffic_ready,timeout=60000)
    page.evaluate('''()=>{const s=window.__complexStage;s.controls.autoRotate=false;s.intro=null;s.frame();s.controls.update()}''')
    page.wait_for_timeout(2500)
    report['overview']=page.evaluate(sample)
    print('overview',json.dumps(report['overview']),flush=True)
    page.evaluate('''()=>{const s=window.__complexStage;s.controls.target.set(0,3,100);s.camera.position.set(75,18,110);s.controls.update()}''')
    page.wait_for_timeout(500)
    report['street']=page.evaluate(sample)
    page.screenshot(path=str(out/'street.png'))
    # Looking away must not continually upload matrices for already-hidden people.
    page.evaluate('''()=>{const s=window.__complexStage;s.controls.target.set(0,300,-1500);s.camera.position.set(0,300,-1000);s.controls.update()}''')
    page.wait_for_timeout(500)
    report['away']=page.evaluate(sample)
    for n in range(4):
        page.evaluate("__select("+json.dumps('perf-b' if n%2==0 else 'perf-a')+")")
        page.wait_for_function(traffic_ready,timeout=60000)
        page.wait_for_timeout(1700)
    report['afterSwitch']=page.evaluate(sample)
    # A reproducible still: fixed camera and shader time, no traffic or walkers,
    # all the actual architecture/ground/trees retained for the visual comparison.
    if not opts.webgl:
        page.evaluate('''()=>{window.__freeze=true;const s=window.__complexStage;s.intro=null;s.controls.autoRotate=false;s.frame();s.controls.update();
          s.scene.traverse(o=>{if(o.userData.traffic||o.userData.walkers)o.visible=false});
          for(let i=0;i<5;i++) __native.render(s.scene,s.camera,s.look,20);
        }''')
        page.locator('.re-holo-stage').screenshot(path=str(out/'architecture.png'))
    report['errors']=errors
    report['canvases']=page.locator('.re-holo-stage canvas').count()
    report['tasks']=page.evaluate('__perf.tasks')
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('first','tasks')},ensure_ascii=False),flush=True)
    assert not errors,errors
    assert report['canvases']==(1 if opts.webgl else 2)
    assert report['overview']['state']['renderer']==('webgl' if opts.webgl else 'tidewater-webgpu')
    browser.close()
