"""Fresh-context A/B; identical cached geography, warmup excluded.
JS heap excludes worker heaps, WASM backing stores and GPU allocations.
Constrained Chromium is not physical iPad performance. Run from repo root.
"""
import ast,asyncio,json,argparse,statistics,hashlib
from pathlib import Path
from urllib.parse import urlencode,urlsplit
from playwright.async_api import async_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:4198');p.add_argument('--runs',type=int,default=3);p.add_argument('--profiles',nargs='+',default=['desktop','constrained']);p.add_argument('--cases',nargs='+',default=['ganeung','shindonga']);p.add_argument('--out',default='tmp/hybrid-scene-benchmark.json');a=p.parse_args()
tree=ast.parse(Path(__file__).with_name('audit-3d-landscape.py').read_text(encoding='utf8'))
values={n.targets[0].id:ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in ['hook','CASES']}
values['CASES']['ganeung']=('41','41150','가능동','860','의정부롯데캐슬골드포레','60')
hook=values['hook'].replace('const value=original.apply(this,args);','const start=performance.now();const value=original.apply(this,args);if(window.__hybridMeasure)window.__hybridCpu.push(performance.now()-start);')
init=r"""(()=>{
 const stat=window.__hybridGpu={buffers:0,textures:0,peakBuffers:0,peakTextures:0,uploadBytes:0};
 const wrap=(proto,name,kind,bytes)=>{if(!proto)return;const orig=proto[name];proto[name]=function(...args){const o=orig.apply(this,args),n=bytes(o,args[0]);stat[kind]+=n;stat['peak'+kind[0].toUpperCase()+kind.slice(1)]=Math.max(stat['peak'+kind[0].toUpperCase()+kind.slice(1)],stat[kind]);const destroy=o.destroy.bind(o);let live=true;o.destroy=()=>{if(live){live=false;stat[kind]-=n;}return destroy();};return o;};};
 wrap(window.GPUDevice?.prototype,'createBuffer','buffers',o=>o.size);
 wrap(window.GPUDevice?.prototype,'createTexture','textures',o=>{const fmt=o.format,block=fmt.startsWith('bc')||fmt.startsWith('etc')||fmt.startsWith('astc');const b=block?(fmt.startsWith('bc1')||fmt.startsWith('bc4')?8:16):({'r8unorm':1,'r8uint':1,'rg8unorm':2,'r16float':2,'rg16float':4,'rgba16float':8,'rgba32float':16}[fmt]??4);let n=0;for(let l=0;l<o.mipLevelCount;l++){const w=Math.max(1,o.width>>l),h=Math.max(1,o.height>>l);n+=(block?Math.ceil(w/4)*Math.ceil(h/4):w*h)*b*o.depthOrArrayLayers*o.sampleCount;}return n;});
 if(window.GPUQueue){const orig=GPUQueue.prototype.writeBuffer;GPUQueue.prototype.writeBuffer=function(...a){const d=a[2],unit=d.BYTES_PER_ELEMENT??1;stat.uploadBytes+=(a[4]??(d.byteLength/unit-(a[3]??0)))*unit;return orig.apply(this,a);};}
 const NativeWorker=Worker;window.__liveWorkers=0;window.__peakWorkers=0;window.__workerUrls=new Map();
 window.Worker=class extends NativeWorker{constructor(...a){super(...a);window.__liveWorkers++;window.__workerUrls.set(this,String(a[0]));window.__peakWorkers=Math.max(window.__peakWorkers,window.__liveWorkers);this.__live=true;}terminate(){if(this.__live){this.__live=false;window.__liveWorkers--;window.__workerUrls.delete(this);}return super.terminate();}postMessage(m,...a){if(m?.op==='neighbours')window.__hybridJobs=m.args.jobs;return super.postMessage(m,...a);}};
 window.__hybridFrames=[];window.__loadingFrames=[];window.__longTasks=[];window.__hybridCpu=[];window.__gpuTimes=[];
 new PerformanceObserver(list=>{for(const e of list.getEntries())window.__longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
 let last=0,measuring=false;const frame=t=>{const s=document.querySelector('.re-holo-stage')?.dataset,n=window.__sceneNative;
 if(s?.shownAt&&!window.__hybridShown)window.__hybridShown=Number(s.shownAt);
 const ready=s?.plantsPhase==='complete'&&s.roadsReadyAt&&s.trafficArmedAt&&s.waterReadyAt&&s.walkersReadyAt&&s.parcelActorsReadyAt&&s.boatsReadyAt&&s.ringAt&&n?.ready&&!n.pending&&!n.compiling&&!n.failed;
 if(ready)window.__hybridReady??=t;
 if(last&&s?.selectAt&&!window.__hybridReady)window.__loadingFrames.push(t-last);
 if(last&&window.__hybridMeasure&&measuring){window.__hybridFrames.push(t-last);if(Number(s?.gpuMs)>0)window.__gpuTimes.push(Number(s.gpuMs));}measuring=!!window.__hybridMeasure;
 last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
})();"""
def quantiles(items):
 s=sorted(items);return {f'p{q}':s[min(len(s)-1,int((len(s)-1)*q/100))] if s else None for q in [50,95,99]}
def frames(items):
 r=quantiles(items);r.update(samples=len(items),over25ms=sum(v>25 for v in items),over50ms=sum(v>50 for v in items),maxMs=max(items,default=0),dropRate25=sum(v>25 for v in items)/max(1,len(items)));return r
async def main():
 rows=[];cache={};out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as pw:
  b=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu'])
  env={'browser':b.version,'platform':'Windows','viewport':[1440,1000],'dpr':2,'runsPerArm':a.runs,'dataPolicy':'cached identical geography; warmup excluded; alternating order; fresh contexts'}
  async def geography(route):
   req=route.request;part=urlsplit(req.url);key=req.method+' '+part.path+'?'+part.query+' '+(req.post_data or '')
   if key not in cache:
    r=await route.fetch(timeout=60000);cache[key]={'status':r.status,'headers':dict(r.headers),'body':await r.body()}
   item=cache[key];await route.fulfill(status=item['status'],headers=item['headers'],body=item['body'])
  for profile in a.profiles:
   for name in a.cases:
    sido,sgg,dong,lot,title,area=values['CASES'][name]
    schedule=list(range(-1,a.runs));attempts={}
    for run in schedule:
     attempts[run]=attempts.get(run,0)+1
     pair=[]
     for mode in (['off','on'] if run%2==0 else ['on','off']):
      context=await b.new_context(viewport={'width':1440,'height':1000},device_scale_factor=2);await context.route('**/api/realestate/**',geography)
      # Serve known geography in-page too. Browser route IPC can otherwise let
      # the existing crossings deadline select different lane-marking inputs.
      snapshots={k.split(' ',2)[1]:{'body':v['body'].decode('utf8'),'status':v['status']} for k,v in cache.items() if k.startswith('GET ') and v['status']==200}
      await context.add_init_script('(()=>{const cache='+json.dumps(snapshots)+';const original=window.fetch;window.fetch=function(input,options){const u=new URL(typeof input==="string"?input:input.url,location.href),r=cache[u.pathname+u.search];if(r&&(!options?.method||options.method==="GET"))return Promise.resolve(new Response(r.body,{status:r.status,headers:{"content-type":"application/json"}}));return original.call(this,input,options);};})();')
      if profile=='constrained':await context.add_init_script("Object.defineProperty(navigator,'deviceMemory',{get:()=>4});Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});")
      page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.add_init_script(init)
      cdp=await context.new_cdp_session(page);await cdp.send('Performance.enable');heaps=[]
      url=a.base+'/realestate-map?'+urlencode(dict(sido=sido,period='3m',sgg=sgg,dong=dong,complex=f'{sgg}:{dong}:{lot}:{title}',area=area,**{'3d':'1','hour':'12','hybrid':mode}))
      await page.goto(url,wait_until='domcontentloaded')
      for _ in range(180):
       await page.evaluate(hook);metrics=await cdp.send('Performance.getMetrics');heaps.append(next(x['value'] for x in metrics['metrics'] if x['name']=='JSHeapUsedSize'))
       if await page.evaluate('!!window.__hybridReady'):break
       await page.wait_for_timeout(500)
      else:raise AssertionError(await page.evaluate("({...document.querySelector('.re-holo-stage')?.dataset})"))
      jobs=await page.evaluate('window.__hybridJobs');jobhash=hashlib.sha256(json.dumps(jobs,sort_keys=True).encode()).hexdigest()
      if run==0 and profile=='desktop':Path(f'tmp/hybrid-jobs-{name}.json').write_text(json.dumps(jobs),encoding='utf8')
      await cdp.send('HeapProfiler.collectGarbage');metrics=await cdp.send('Performance.getMetrics');heap=next(x['value'] for x in metrics['metrics'] if x['name']=='JSHeapUsedSize')
      await page.evaluate('window.__hybridUploadStart=window.__hybridGpu.uploadBytes;window.__hybridMeasure=true;window.__hybridFrames=[];window.__hybridCpu=[];window.__gpuTimes=[];')
      await page.wait_for_timeout(6000)
      result=await page.evaluate("""()=>{window.__hybridMeasure=false;const s={...document.querySelector('.re-holo-stage').dataset},f=window.__hybridFrames;const roots=new Set();for(const o of window.__sceneNative.active)for(let p=o;p;p=p.parent)if(p.userData.instanceCompute)roots.add(p);
       return {state:s,firstShownMs:Number(s.shownAt)-Number(s.selectAt),allReadyMs:window.__hybridReady-Number(s.selectAt),navigationToAllReadyMs:window.__hybridReady,rawFrames:f,rawLoadingFrames:window.__loadingFrames,rawCpu:window.__hybridCpu,rawGpu:window.__gpuTimes,longTasks:window.__longTasks.filter(t=>t.start>=Number(s.selectAt)&&t.start<=window.__hybridReady),gpu:{...window.__hybridGpu},uploadBytesPerFrame:(window.__hybridGpu.uploadBytes-window.__hybridUploadStart)/f.length,instances:[...roots].map(p=>({name:p.name,mode:p.userData.instanceCompute.mode,capacity:p.userData.instanceCompute.capacity,retainedBytes:p.userData.instanceCompute.retainedBytes,wasmMemoryBytes:p.userData.instanceCompute.memory()})),liveWorkers:window.__liveWorkers,peakWorkers:window.__peakWorkers};}""")
      result['frames']=frames(result.pop('rawFrames'));result['loadingFrames']=frames(result.pop('rawLoadingFrames'));result['renderCpuMs']=quantiles(result.pop('rawCpu'));result['gpuFrameMs']=quantiles(result.pop('rawGpu'))
      await page.evaluate('window.__captureCensus=true;window.__censusFrames=[];');await page.wait_for_timeout(1500)
      result.update(await page.evaluate("""async()=>{window.__captureCensus=false;const n=window.__sceneNative,road=[...n.active].filter(o=>o.name==='road surface'||o.parent?.name==='road markings'),geometry=[],orderedGeometry=[];window.__roadGeometry=[];for(const o of road){const a=o.geometry.attributes.position.array,ids=o.geometry.index?.array,tri=[],count=ids?.length??a.length/3;
       for(let i=0;i<count;i+=3){const v=[0,1,2].map(j=>{const at=(ids?ids[i+j]:i+j)*3;return [a[at],a[at+1],a[at+2]].join(',');}),first=v.indexOf([...v].sort()[0]);tri.push([...v.slice(first),...v.slice(0,first)].join('|'));}
       const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tri.sort().join(';'))),ordered=await crypto.subtle.digest('SHA-256',a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength)),hex=h=>[...new Uint8Array(h)].map(v=>v.toString(16).padStart(2,'0')).join('');geometry.push({name:o.name,triangles:count/3,hash:hex(h)});orderedGeometry.push(hex(ordered));window.__roadGeometry.push({name:o.name,position:Array.from(a),index:ids?Array.from(ids):null});}geometry.sort((a,b)=>a.hash.localeCompare(b.hash));
       const census=window.__censusFrames.slice(-60),tri=census.map(r=>r.passes.filter(p=>p.kind==='color').reduce((s,p)=>s+p.triangles,0)).sort((a,b)=>a-b),draw=census.map(r=>r.passes.filter(p=>p.kind==='color').reduce((s,p)=>s+p.draws,0)).sort((a,b)=>a-b),forest=[...n.active].filter(o=>o.name.startsWith('woodland '));
       const result={submittedTriangles:tri[Math.floor(tri.length/2)],colorDraws:draw[Math.floor(draw.length/2)],forestInstances:forest.filter(o=>o.name!=='woodland trunks').reduce((s,o)=>s+o.count,0),forestMeshes:forest.length,geometry,orderedGeometry};window.__censusFrames=[];return result;}"""))
      result.update(jsHeapUsedAfterGcBytes=heap,jsHeapPeakSampledBytes=max(heaps),jobHash=jobhash,profile=profile,case=name,mode=mode,run=run,attempt=attempts[run],errors=errors);assert not errors,errors
      if mode=='on':assert result['state']['geometryCompute']=='rust-wasm' and all(i['mode']=='rust-wasm' for i in result['instances']),result
      if run==0:
       Path(f'tmp/hybrid-roads-{profile}-{name}-{mode}.json').write_text(json.dumps(await page.evaluate('window.__roadGeometry')),encoding='utf8')
       await page.screenshot(path=f'tmp/hybrid-{profile}-{name}-{mode}.png');await page.keyboard.press('Escape');await page.wait_for_timeout(500)
       result['afterModalClose']=await page.evaluate('({gpu:{...window.__hybridGpu},liveWorkers:window.__liveWorkers,stages:document.querySelectorAll(".re-holo-stage").length})')
       # Escape keeps the side panel owner alive; leaving the map closes the last owner.
       await page.evaluate("history.pushState({},'', '/privacy');window.dispatchEvent(new PopStateEvent('popstate'))")
       await page.wait_for_function('!document.querySelector(".re-holo-stage")',timeout=10000)
       try:await page.wait_for_function('window.__liveWorkers===0',timeout=12000)
       except Exception:pass
       result['afterClose']=await page.evaluate('({gpu:{...window.__hybridGpu},liveWorkers:window.__liveWorkers,workerUrls:[...window.__workerUrls.values()],stage:!!document.querySelector(".re-holo-layer,.re-holo--expanded")})')
       # Device-global fallback/LUT resources survive the view; bound that floor.
       assert result['afterClose']['liveWorkers']==0 and result['afterClose']['gpu']['buffers']<=4096 and result['afterClose']['gpu']['textures']<=1048576,result['afterClose']
      pair.append(result);rows.append(result);out.write_text(json.dumps({'environment':env,'rows':rows},indent=2),encoding='utf8')
      print(json.dumps({k:result[k] for k in ['profile','case','mode','run','firstShownMs','allReadyMs','frames','jsHeapUsedAfterGcBytes','uploadBytesPerFrame','submittedTriangles','colorDraws']}),flush=True);await context.unroute_all(behavior='ignoreErrors');await context.close()
     matched=pair[0]['jobHash']==pair[1]['jobHash'] and pair[0]['geometry']==pair[1]['geometry'] and pair[0]['forestInstances']==pair[1]['forestInstances']
     if run>=0 and not matched:
      for r in pair:r.update(requestedRun=run,run=-2,excludedReason='A/B inputs or road triangle geometry differ')
      assert attempts[run]<4,'A/B inputs remain different after retries'
      schedule.append(run);print(json.dumps({'repeatInputMismatch':run,'attempt':attempts[run],'case':name,'profile':profile}),flush=True)
     elif run<0:print(json.dumps({'warmupPairMatched':matched,'case':name,'profile':profile}),flush=True)
  summary=[]
  for profile in a.profiles:
   for name in a.cases:
    for mode in ['off','on']:
     r=[v for v in rows if v['profile']==profile and v['case']==name and v['mode']==mode and v['run']>=0];item={'profile':profile,'case':name,'mode':mode,'runs':len(r)}
     for key in ['firstShownMs','allReadyMs','navigationToAllReadyMs','jsHeapUsedAfterGcBytes','jsHeapPeakSampledBytes','uploadBytesPerFrame','submittedTriangles','colorDraws']:item[key]=statistics.median(v[key] for v in r)
     for key,fields in [('frames',['p50','p95','p99','maxMs','dropRate25','over50ms']),('loadingFrames',['p95','maxMs','dropRate25','over50ms']),('renderCpuMs',['p50','p95']),('gpuFrameMs',['p50','p95']),('gpu',['buffers','textures','peakBuffers','peakTextures'])]:
      item[key]={k:statistics.median(v[key][k] for v in r if v[key][k] is not None) if any(v[key][k] is not None for v in r) else None for k in fields}
     item['longTasks']={'count':statistics.median(len(v['longTasks']) for v in r),'totalMs':statistics.median(sum(t['duration'] for t in v['longTasks']) for v in r)};summary.append(item)
  out.write_text(json.dumps({'environment':env,'rows':rows,'summary':summary,'geographyResponseCount':len(cache)},indent=2),encoding='utf8');print(json.dumps(summary),flush=True);await b.close()
asyncio.run(main())
