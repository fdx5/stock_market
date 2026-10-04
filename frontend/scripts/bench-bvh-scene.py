"""Paired scene-level A/B. Same build/camera/data; alternate the grid/BVH flag.
Browser measured loading, frame times and pointer delay; not physical iPad data.
"""
import ast,asyncio,json,statistics,argparse,time
from pathlib import Path
from urllib.parse import urlencode
from playwright.async_api import async_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:4197');p.add_argument('--runs',type=int,default=3);p.add_argument('--out',default='tmp/bvh-scene-benchmark.json');a=p.parse_args()
tree=ast.parse(Path(__file__).with_name('audit-3d-landscape.py').read_text(encoding='utf8'))
values={n.targets[0].id:ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in ['hook','CASES']}
values['CASES']['ganeung']=('41','41150','\uac00\ub2a5\ub3d9','860','\uc758\uc815\ubd80\ub86f\ub370\uce90\uc2ac\uace8\ub4dc\ud3ec\ub808','60')
init="""(()=>{let last=0;window.__bvhFrames={loading:[],steady:[]};window.__bvhLong=[];window.__bvhPointers=[];
 new PerformanceObserver(l=>{for(const e of l.getEntries())window.__bvhLong.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
 const frame=t=>{const s=document.querySelector('.re-holo-stage')?.dataset,n=window.__sceneNative;
 const ready=s?.plantsPhase==='complete'&&s.roadsReadyAt&&s.trafficArmedAt&&s.waterReadyAt&&s.walkersReadyAt&&s.parcelActorsReadyAt&&s.boatsReadyAt&&s.ringAt&&n?.ready&&!n.pending&&!n.compiling&&!n.failed;
 if(ready&&!window.__bvhReadyAt)window.__bvhReadyAt=t;
 if(last&&s)window.__bvhFrames[window.__bvhReadyAt?'steady':'loading'].push(t-last);last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 document.addEventListener('pointermove',()=>{const t=performance.now();requestAnimationFrame(()=>window.__bvhPointers.push(performance.now()-t));},{passive:true});})();"""
async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu'])
  context=await browser.new_context(viewport={'width':1440,'height':1000});report={'cases':[],'runs':a.runs,'base':a.base}
  for name in ['ganeung','luceheim']:
   sido,sgg,dong,lot,title,area=values['CASES'][name]
   for run in range(-1,a.runs):
    for mode in (['grid','wasm'] if run%2==0 else ['wasm','grid']):
     page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));await page.add_init_script(init)
     url=a.base+'/realestate-map?'+urlencode(dict(sido=sido,period='3m',sgg=sgg,dong=dong,complex=f'{sgg}:{dong}:{lot}:{title}',area=area,**{'3d':'1','bvh':mode,'hour':'12'}))
     await page.goto(url,wait_until='domcontentloaded')
     for _ in range(120):
      await page.evaluate(values['hook'])
      if await page.evaluate('!!window.__bvhReadyAt'):break
      await page.wait_for_timeout(1000)
     else:raise AssertionError(await page.evaluate("({...document.querySelector('.re-holo-stage')?.dataset})"))
     await page.wait_for_timeout(1500)
     box=await page.locator('.re-holo-stage').bounding_box()
     for i in range(25):await page.mouse.move(box['x']+box['width']*(.3+i*.012),box['y']+box['height']*.5);await page.wait_for_timeout(32)
     result=await page.evaluate("""async()=>{const s={...document.querySelector('.re-holo-stage').dataset},summary=a=>{const v=[...a].sort((a,b)=>a-b);return {samples:v.length,p50:v[Math.floor(v.length*.5)]??0,p95:v[Math.floor(v.length*.95)]??0,max:v.at(-1)??0};};
      const road=[...window.__sceneNative.active].filter(o=>o.name==='road surface'||o.parent?.name==='road markings');const geometry=[];
      for(const o of road){const array=o.geometry.attributes.position.array,hash=await crypto.subtle.digest('SHA-256',array.buffer.slice(array.byteOffset,array.byteOffset+array.byteLength));geometry.push({name:o.name,parent:o.parent?.name,triangles:array.length/9,hash:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')});}
      return {state:s,roadReadyMs:Number(s.roadsReadyAt)-Number(s.selectAt),allReadyMs:window.__bvhReadyAt-Number(s.selectAt),frames:Object.fromEntries(Object.entries(window.__bvhFrames).map(([k,v])=>[k,summary(v)])),pointer:summary(window.__bvhPointers),longTasks:window.__bvhLong.filter(e=>e.at>=Number(s.selectAt)&&e.at<=window.__bvhReadyAt),geometry};}""")
     result.update(case=name,run=run,mode=mode,errors=errors);assert not errors,errors
     assert result['state']['roadIndex']==('js-grid' if mode=='grid' else 'rust-wasm-bvh'),result['state']
     if run==0:await page.screenshot(path=f'tmp/bvh-scene-{name}-{mode}.png')
     report['cases'].append(result);Path(a.out).write_text(json.dumps(report,indent=2),encoding='utf8')
     print(json.dumps({k:result[k] for k in ['case','run','mode','roadReadyMs','allReadyMs','frames','pointer']}),flush=True);await page.close()
  report['summary']={}
  for name in ['ganeung','luceheim']:
   report['summary'][name]={}
   for mode in ['grid','wasm']:
    rows=[r for r in report['cases'] if r['case']==name and r['mode']==mode and r['run']>=0]
    report['summary'][name][mode]={k:statistics.median(r[k] for r in rows) for k in ['roadReadyMs','allReadyMs']}
    report['summary'][name][mode]['steadyP50Ms']=statistics.median(r['frames']['steady']['p50'] for r in rows)
   by_run={r['run']:r for r in report['cases'] if r['case']==name and r['mode']=='grid'}
   for r in report['cases']:
    if r['case']==name and r['mode']=='wasm' and r['run']>=0:
     assert [(g['name'],g['hash'])for g in r['geometry']]==[(g['name'],g['hash'])for g in by_run[r['run']]['geometry']],f'geometry changed: {name} {r["run"]}'
  Path(a.out).write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report['summary']),flush=True);await browser.close()
asyncio.run(main())
