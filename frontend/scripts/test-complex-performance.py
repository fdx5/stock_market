"""Reproducible 3D performance/lifecycle check; Vite :5173 and Playwright/Edge.

Synthetic buildings and roads, no remote APIs or database writes. Compare reports
from the same machine with --label before/after. --webgl checks the fallback.
"""
import argparse
import atexit
import json
import functools
import http.server
import subprocess
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

args = argparse.ArgumentParser()
args.add_argument('--label', default='after')
args.add_argument('--webgl', action='store_true')
args.add_argument('--base-url', default='http://127.0.0.1:5173')
args.add_argument('--production', action='store_true', help='build an isolated harness and serve it without HMR')
args.add_argument('--stall-detail-seconds',type=float,default=0)
args.add_argument('--missing-feature-marker',action='store_true')
args.add_argument('--fail-webgpu-pipeline',action='store_true',help='verify immediate compatibility fallback after a real pipeline rejection')
args.add_argument('--paused-rail',action='store_true')
args.add_argument('--profile-cpu',action='store_true')
args.add_argument('--trace-stalls',action='store_true')
args.add_argument('--trace-browser',action='store_true',help='diagnose browser tasks during first loading')
args.add_argument('--verify-shaders',action='store_true')
args.add_argument('--cpu-rate',type=float,default=1,help='CDP CPU slowdown rate; match before/after')
args.add_argument('--on-page', action='store_true', help='control: original painting on the page')
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
import {GPU} from './vendor/tidewater/engine/gpu/GPU';
GPU.verifyAsyncShaders=VERIFY_SHADERS;
// Hold resolution constant so adaptive scaling cannot skew the before/after run.
const resize = ComplexRenderer.prototype.setSize;
ComplexRenderer.prototype.setSize = function(w, h) { resize.call(this, w, h, 1.5); };
const original = ComplexRenderer.prototype.render;
ComplexRenderer.prototype.render = function(...args) {
  // The fixture hides its rail explicitly. Reading a rectangle here forced a
  // full page layout inside the first GPU frame and distorted loading results.
  const visible = this.__reviewVisible ??= !this.canvas.parentElement?.closest('[hidden], [style*="display: none"]');
  if (visible) (window as any).__native = this;
  const counts = (window as any).__viewRenders ??= {visible:0,hidden:0};
  counts[visible ? 'visible' : 'hidden']++;
  const t = performance.now();
  original.apply(this, args);
  (window as any).__perf.cpu.push(performance.now() - t);
};
function Review() {
  const [id, select] = useState('perf-a');
  (window as any).__select = select;
  return <div style={{width:1100,height:780,display:'flex',margin:'20px auto'}}>
    <ComplexHologram complexId={id} complexName="Performance fixture" initialTod="day" />
    PAUSED_RAIL
  </div>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
'''.replace('VERIFY_SHADERS','true' if opts.verify_shaders else 'false').replace('PAUSED_RAIL','<div style={{display:"none"}}><ComplexHologram complexId="perf-b" paused complexName="Hidden fixture" initialTod="day" /></div>' if opts.paused_rail else ''), encoding='utf-8')
paths[1].write_text('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/__perf3d.tsx"></script></body></html>', encoding='utf-8')

if opts.production:
    import os
    config = root / ('frontend/vite.perf-task-' + str(os.getpid()) + '.config.mjs')
    build = out / 'build'
    config.write_text('''import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import paintAssetsPlugin from './paintAssetsPlugin.mjs';
export default defineConfig({plugins:[react(),paintAssetsPlugin()],publicDir:false,define:{'import.meta.env.VITE_FILM':'"1"',
'import.meta.env.VITE_STATIC_CDN':'"http://127.0.0.1:5179/__slow3d"','import.meta.env.VITE_PAINT_ON_PAGE':%s},
build:{outDir:%s,rollupOptions:{input:'__perf3d.html'}}});''' % ('"1"' if opts.on_page else 'undefined', json.dumps(str(build))), encoding='utf-8')
    atexit.register(lambda: config.unlink(missing_ok=True))
    subprocess.run(['node', 'node_modules/vite/bin/vite.js', 'build', '--config', config.name], cwd=root/'frontend', check=True, stdout=subprocess.DEVNULL)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith('/__slow3d/3d/detail') and opts.stall_detail_seconds:
                import time
                time.sleep(opts.stall_detail_seconds)
            super().do_GET()
        def translate_path(self, path):
            path=path.replace('/__slow3d/', '/', 1) if path.startswith('/__slow3d/') else path
            result = Path(super().translate_path(path))
            if result.is_file(): return str(result)
            relative = result.relative_to(build)
            return str(root/'frontend/public'/relative)
        def log_message(self, *args): pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 5179), functools.partial(Handler, directory=str(build)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    atexit.register(lambda: (server.shutdown(), server.server_close()))
    opts.base_url = 'http://127.0.0.1:5179'

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
window.__loadingInput = {delays: [], frames: []};
window.__framePhase='loading';window.__frameTimeline=[];
addEventListener('pointermove', e => {
  if (!document.querySelector('.re-holo-stage')?.dataset.shownAt)
    __loadingInput.delays.push(Math.max(0, performance.now() - e.timeStamp));
}, {passive:true});
let prevLoading;
function loadingFrame(t) {
  if(prevLoading!==undefined)__frameTimeline.push({at:t,ms:t-prevLoading,phase:__framePhase});
  if (prevLoading !== undefined && !document.querySelector('.re-holo-stage')?.dataset.shownAt)
    __loadingInput.frames.push(t-prevLoading);
  prevLoading=t;requestAnimationFrame(loadingFrame);
}
requestAnimationFrame(loadingFrame);
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
    const summary=a=>{a.sort((x,y)=>x-y);return {median:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0,max:a[a.length-1]??0,over20:a.filter(x=>x>20).length}};
    resolve({raf:summary(samples),cpu:summary(__perf.cpu),frames:__perf.cpu.length,
      writes:__perf.writes,bytes:__perf.bytes,draws:__perf.draws,passes:__perf.passes,
      liveBytes:__perf.liveBytes,buffers:__perf.buffers,pipelines:__perf.pipelines,
      state:{...document.querySelector('.re-holo-stage').dataset}});
  }}requestAnimationFrame(frame);
})'''

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-webgpu'])
    page = browser.new_page(viewport=dict(width=1280,height=900), device_scale_factor=1)
    if opts.cpu_rate != 1:
        page.context.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate":opts.cpu_rate})
    profiler = page.context.new_cdp_session(page) if opts.profile_cpu else None
    if profiler:
        profiler.send("Profiler.enable")
        profiler.send("Performance.enable")
        profiler.send("Profiler.start")
    if opts.missing_feature_marker:
        page.add_init_script("if (navigator.gpu) Object.defineProperty(navigator.gpu, 'wgslLanguageFeatures', {value:new Set()})")
    if opts.fail_webgpu_pipeline:
        page.add_init_script('''const compile=GPUDevice.prototype.createRenderPipelineAsync;
          GPUDevice.prototype.createRenderPipelineAsync=function(desc){
            return desc.label?.startsWith('complex ') ? Promise.reject(Error('Injected unsupported shader')) : compile.call(this,desc);
          };''')
    if opts.paused_rail:
        page.add_init_script("window.__stages=[];Object.defineProperty(window,'__complexStage',{get(){return __stages[0]},set(s){__stages.push(s)}})")
    page.add_init_script(instrument)
    if opts.trace_stalls:
        page.add_init_script('''window.__slowCalls=[];
          function track(o,n){if(!o?.[n])return;const original=o[n];o[n]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{const ms=performance.now()-t;if(ms>8)__slowCalls.push({name:n,at:t,ms,stack:Error().stack})}}}
          track(window,'createImageBitmap');
          for(const n of ['createTexture','createBuffer','createShaderModule','createRenderPipelineAsync'])track(globalThis.GPUDevice?.prototype,n);
          for(const n of ['copyExternalImageToTexture','writeTexture','submit'])track(globalThis.GPUQueue?.prototype,n);
          for(const n of ['getImageData','drawImage'])track(globalThis.CanvasRenderingContext2D?.prototype,n);
        ''')
    if opts.webgl:
        page.add_init_script("Object.defineProperty(navigator, 'gpu', {value:undefined})")
    errors=[];network_failures=[]
    page.on('requestfailed',lambda req:network_failures.append({'url':req.url.split('?')[0],'failure':req.failure}))
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if (m.type=='error' or 'validation failed' in m.text) and not (opts.fail_webgpu_pipeline and 'Injected unsupported shader' in m.text) else None)
    page.route(opts.base_url + '/api/**',lambda r:r.fulfill(json={**data,'id':'perf-b' if 'perf-b' in r.request.url else 'perf-a'}))
    tracer = page.context.new_cdp_session(page) if opts.trace_browser else None
    trace_events=[];trace_complete=[]
    if tracer:
        tracer.on('Tracing.dataCollected',lambda e:trace_events.extend(e['value']))
        tracer.on('Tracing.tracingComplete',lambda e:trace_complete.append(True))
        tracer.send('Tracing.start',{'categories':'devtools.timeline,disabled-by-default-devtools.timeline,v8,disabled-by-default-v8.compile','transferMode':'ReportEvents'})
    page.goto(opts.base_url + '/__perf3d.html')
    try:
        for i in range(1200):
            if page.evaluate("!!document.querySelector('.re-holo-stage')?.dataset.shownAt"):
                break
            page.mouse.move(50 + (i*17)%1100, 100 + (i*11)%600)
            page.wait_for_timeout(8)
        page.wait_for_function("document.querySelector('.re-holo-stage')?.dataset.shownAt",timeout=45000)
    except Exception:
        print(json.dumps({'errors':errors,'text':page.locator('body').inner_text(),'state':page.evaluate('({...document.querySelector(".re-holo-stage")?.dataset})')},ensure_ascii=False),flush=True)
        page.screenshot(path=str(out/'failure.png'))
        raise
    report={'first':page.evaluate('({...__perf,state:{...document.querySelector(".re-holo-stage").dataset}})')}
    if tracer:
        tracer.send('Tracing.end')
        for _ in range(200):
            if trace_complete: break
            page.wait_for_timeout(25)
        assert trace_complete,'Browser trace did not finish'
        (out/'browser-trace.json').write_text(json.dumps({'traceEvents':trace_events}),encoding='utf8')
    if profiler: report['profileClock']=profiler.send('Performance.getMetrics')
    report['environment'] = {'buildMode': 'production' if opts.production else 'development', 'browser': browser.version, 'fixture': 'complex-perf-v1', 'renderScale': 1.5, 'cpuRate':opts.cpu_rate, 'detailDelay':opts.stall_detail_seconds, 'pausedRail':opts.paused_rail, 'featureMarkerRemoved':opts.missing_feature_marker}
    report['loadingInput'] = page.evaluate('''()=>{
      const summarize=a=>{a.sort((x,y)=>x-y);return {count:a.length,median:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0,max:a[a.length-1]??0,over20:a.filter(x=>x>20).length}};
      return {pointerDelay:summarize(__loadingInput.delays),frames:summarize(__loadingInput.frames)};
    }''')
    first_canvases = page.locator('.re-holo-stage canvas').count()
    page.evaluate("__framePhase='extras'")
    traffic_ready = "()=>{let ready=false;window.__complexStage?.scene.traverse(g=>{if(g.userData.traffic)ready=true});return ready && !!document.querySelector('.re-holo-stage')?.dataset.shownAt}"
    try:
        page.wait_for_function(traffic_ready,timeout=60000)
    except Exception:
        report['errors']=errors
        report['timeout']=page.evaluate('({state:{...document.querySelector(".re-holo-stage").dataset},cpu:__perf.cpu.slice(-120),tasks:__perf.tasks,stage:{busy:__complexStage?.busy,building:__complexStage?.building,tick:__complexStage?.tick.length,onShown:__complexStage?.onShown.length}})')
        (out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
        print(json.dumps(report['timeout']['state']), errors,flush=True)
        raise
    page.evaluate('''()=>{const s=window.__complexStage;s.controls.autoRotate=false;s.intro=null;s.frame();s.controls.update()}''')
    page.wait_for_timeout(2500)
    page.evaluate("__framePhase='overview'");report['overview']=page.evaluate(sample)
    print('overview',json.dumps(report['overview']),flush=True)
    page.evaluate("__framePhase='cameraTransition'")
    page.evaluate('''()=>{const s=window.__complexStage;s.controls.target.set(0,3,100);s.camera.position.set(75,18,110);s.controls.update()}''')
    page.wait_for_timeout(500)
    page.evaluate("__framePhase='street'");report['street']=page.evaluate(sample)
    # Looking away must not continually upload matrices for already-hidden people.
    page.evaluate("__framePhase='cameraTransition'")
    page.evaluate('''()=>{const s=window.__complexStage;s.controls.target.set(0,300,-1500);s.camera.position.set(0,300,-1000);s.controls.update()}''')
    page.wait_for_timeout(500)
    page.evaluate("__framePhase='away'");report['away']=page.evaluate(sample)
    page.evaluate("__framePhase='switchLoading'")
    for n in range(4):
        page.evaluate("__select("+json.dumps('perf-b' if n%2==0 else 'perf-a')+")")
        page.wait_for_function(traffic_ready,timeout=60000)
        page.wait_for_timeout(1700)
    page.evaluate("__framePhase='afterSwitch'");report['afterSwitch']=page.evaluate(sample)
    page.evaluate("__framePhase='interaction'")
    box=page.locator('.re-holo-stage').first.bounding_box()
    page.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.5);page.mouse.down()
    for i in range(90):
        page.mouse.move(box['x']+box['width']*(.5+(i%30-15)/150),box['y']+box['height']*(.5+(i%20-10)/120));page.wait_for_timeout(8)
    page.mouse.up();page.wait_for_timeout(500)
    report['frameTimeline']=page.evaluate('__frameTimeline')
    if profiler:
        (out/'cpu-profile.json').write_text(json.dumps(profiler.send("Profiler.stop")),encoding='utf-8')
    # Capture QA images after the continuous timing record. Screenshot readback
    # itself synchronizes the GPU and must not be attributed to interactive use.
    page.evaluate('''()=>{const s=window.__complexStage;s.controls.target.set(0,3,100);s.camera.position.set(75,18,110);s.controls.update()}''')
    page.wait_for_timeout(500)
    page.screenshot(path=str(out/'street.png'))
    # A reproducible still: fixed camera and shader time, no traffic or walkers,
    # all the actual architecture/ground/trees retained for the visual comparison.
    if not (opts.webgl or opts.fail_webgpu_pipeline):
        page.evaluate('''()=>{window.__freeze=true;const s=window.__complexStage;s.intro=null;s.controls.autoRotate=false;s.frame();s.controls.update();
          s.scene.traverse(o=>{if(o.userData.traffic||o.userData.walkers)o.visible=false});
          for(let i=0;i<5;i++) __native.render(s.scene,s.camera,s.look,20);
        }''')
        page.locator('.re-holo-stage').first.screenshot(path=str(out/'architecture.png'))
    report['viewRenders']=page.evaluate('window.__viewRenders')
    if opts.paused_rail: assert report['viewRenders']['hidden']==0, report['viewRenders']
    report['errors']=errors
    report['networkFailures']=network_failures
    report['canvases']=page.locator('.re-holo-stage canvas').count()
    report['tasks']=page.evaluate('__perf.tasks')
    if opts.trace_stalls: report['slowCalls']=page.evaluate('__slowCalls')
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('first','tasks','frameTimeline','profileClock')},ensure_ascii=False),flush=True)
    assert not errors,errors
    assert report['canvases']==first_canvases, 'canvas count grew after switching complexes'
    assert report['overview']['state']['renderer']==('webgl' if opts.webgl or opts.fail_webgpu_pipeline else 'tidewater-webgpu')
    if opts.fail_webgpu_pipeline:
        assert report['overview']['state'].get('gpuFallback') != 'first-frame-timeout', 'fallback waited for the watchdog'
    (out/'passed.json').write_text(json.dumps({'passed':True}),encoding='utf-8')
    browser.close()
