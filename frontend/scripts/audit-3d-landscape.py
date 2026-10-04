"""Read-only actual WebGPU road, marking, lamp and shared tree audit.
Run from repo root: python frontend/scripts/audit-3d-landscape.py --url URL --out tmp/case
Output: screenshots and resource/quality JSON. Requires Playwright and Edge.
"""
import asyncio, json, time, argparse
from urllib.parse import urlencode
from pathlib import Path
from playwright.async_api import async_playwright

hook="async()=>{\n if(window.__censusInstalled)return true;\n const u=performance.getEntriesByType('resource').find(e=>/\\/ComplexRenderer-[^/]+\\.js/.test(e.name))?.name;if(!u)return false;\n const mod=await import(u), C=Object.values(mod).find(v=>typeof v==='function'&&v.prototype?.sync&&v.prototype?.render);if(!C)return false;\n window.__censusFrames=[];\n window.__censusCategory=o=>{const m=Array.isArray(o.material)?o.material[0]:o.material;const d=m?.userData??{};\n if(d.volumeFoliage)return 'tree crowns';if(d.leafCluster)return 'leaf clusters';if(d.bark)return 'tree bark';if(d.foliage)return 'plant cards';if(d.groundDetail)return 'ground';\n if(o.name==='road surface')return 'road surface';if(o.parent?.name==='road markings')return 'road markings';\n if(d.roofDetail)return 'roof';if(d.carPaint||d.carModel)return 'vehicles';if(d.water)return 'water';if(d.interior)return 'window/facade';if(d.detail)return 'building '+d.detail;return 'other';};\n const original=C.prototype.render;\n C.prototype.render=function(...args){\n  window.__sceneNative=this;\n  if(!this.__censusHook){\n   const r=this.renderer,draw=r.drawItems;let current=this;\n   r.drawItems=function(rp,items,pass,role){\n    const b={...this.stats};const result=draw.call(this,rp,items,pass,role);\n    if(window.__captureCensus&&current.__censusCurrent){\n     const f=current.__censusCurrent,label=pass.label||pass.kind,groups={};\n     const rows=this.bundles&&!this.precompiling&&pass.group0?this._drawRows:items.map(it=>({it,geo:it.geometry,o:it.object,instances:it.object.isInstancedMesh?it.object.count:it.geometry.instanceCount??1}));\n     let potential=0;\n     for(const row of rows??[]){const {it,geo,o,instances}=row;const total=geo.index?.count??geo.attributes.position?.count??geo.vertexCount??0;\n      const count=Math.min(it.count,total-it.start),tri=count/3*instances;if(!Number.isFinite(tri)||tri<=0)continue;\n      const src=current.__censusReverse.get(o),category=window.__censusCategory(src??o);groups[category]=(groups[category]??0)+tri;potential+=tri;\n     }\n     f.passes.push({label,kind:pass.kind,role,triangles:this.stats.triangles-b.triangles,draws:this.stats.draws-b.draws,groups,groupTotal:potential});\n    }return result;\n   };this.__censusHook=true;\n  }\n  const capturing=window.__captureCensus;\n  if(capturing){this.__censusReverse=new Map([...this.meshes].map(([s,n])=>[n,s]));this.__censusCurrent={at:performance.now(),passes:[],ready:this.ready,shown:this.shown};}\n  const value=original.apply(this,args);\n  if(capturing){const f=this.__censusCurrent;f.stats={...this.stats};f.shadowStats={...this.shadowStats};window.__censusFrames.push(f);if(window.__censusFrames.length>240)window.__censusFrames.shift();}\n  return value;\n };window.__censusInstalled=true;return true;\n}"
road_hook="()=>{const n=window.__sceneNative;if(!n)return null;const objects=[...n.active];const ground=objects.find(o=>o.material?.userData?.groundDetail);const road=objects.find(o=>o.name==='road surface');if(!ground||!road)return {missing:true};ground.updateWorldMatrix(true,false);road.updateWorldMatrix(true,false);const m=ground.matrixWorld.clone().invert().multiply(road.matrixWorld).elements,p=road.geometry.attributes.position.array,g=ground.geometry.attributes.position.array,{xs,ys}=ground.geometry.userData.grid,row=xs.length;function segment(a,v,up){let lo=0,hi=a.length-1;while(hi-lo>1){const k=(lo+hi)>>1;if(up?a[k]<=v:a[k]>=v)lo=k;else hi=k;}return lo;}let worst=0,hidden=0,count=0;for(let k=0;k<p.length;k+=9){let x=0,y=0,z=0;for(let j=0;j<9;j+=3){x+=p[k+j]/3;y+=p[k+j+1]/3;z+=p[k+j+2]/3;}const X=m[0]*x+m[4]*y+m[8]*z+m[12],Y=m[1]*x+m[5]*y+m[9]*z+m[13],Z=m[2]*x+m[6]*y+m[10]*z+m[14];const i=segment(xs,X,true),j=segment(ys,Y,false),u=(X-xs[i])/(xs[i+1]-xs[i]),v=(Y-ys[j])/(ys[j+1]-ys[j]);if(u<0||u>1||v<0||v>1)continue;const a=(j*row+i)*3+2,b=((j+1)*row+i)*3+2,d=a+3,c=b+3;const height=u+v<=1?g[a]*(1-u-v)+g[d]*u+g[b]*v:g[c]*(u+v-1)+g[b]*(1-u)+g[d]*(1-v);const over=height-Z;worst=Math.max(worst,over);hidden+=over>.01?1:0;count++;}return {triangles:count,hiddenCentroids:hidden,maxBurialM:worst};}"
URL='http://127.0.0.1:4195/realestate-map?sido=11&period=3m&sgg=11680&dong=%EC%88%98%EC%84%9C%EB%8F%99&complex=11680%3A%EC%88%98%EC%84%9C%EB%8F%99%3A795%3A%EA%B0%95%EB%82%A8%EB%8D%B0%EC%8B%9C%EC%95%99%ED%8F%AC%EB%A0%88&area=85&3d=1&sceneBudget=texture'

CASES={
 'shindonga':('41','41150','신곡동','580','신동아파밀리에','85'),
 'seolbong':('41','41500','갈산동','783','설봉1차푸르지오','127'),
 'paju':('41','41480','문산읍 당동리','947','파주한양수자인리버팰리스아파트','85'),
 'desian':('11','11680','수서동','795','강남데시앙포레','85'),
 'gaepo':('11','11680','개포동','1284','개포자이프레지던스','85'),
 'luceheim':('11','11680','일원동','741','래미안 개포 루체하임','85'),
 'dhgaepo':('11','11680','일원동','743','디에이치자이개포','85'),
 'shindo6':('41','41150','호원동','401-1','신도6','60'),
}
p=argparse.ArgumentParser();p.add_argument('--url',default=URL);p.add_argument('--base',default='http://127.0.0.1:4195');p.add_argument('--case',choices=CASES);p.add_argument('--out',default='tmp/landscape-audit');p.add_argument('--profile',action='store_true');a=p.parse_args();URL=a.url
if a.case:
 sido,sgg,dong,lot,name,area=CASES[a.case];URL=a.base+'/realestate-map?'+urlencode(dict(sido=sido,period='3m',sgg=sgg,dong=dong,complex=f'{sgg}:{dong}:{lot}:{name}',area=area,**{'3d':'1'}))
Path(a.out).parent.mkdir(parents=True,exist_ok=True)

async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu'])
  page=await browser.new_page(viewport={'width':1440,'height':900});errors=[]
  await page.add_init_script('''(()=>{
   performance.setResourceTimingBufferSize(5000);
   const phases={loading:[],complete:[]},longTasks=[],pointer=[];let last=0;
   window.__landscapeTiming={phases,longTasks,pointer,native:[]};
   const frame=t=>{const e=document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage');
    if(last&&e){const n=window.__sceneNative;if(n&&(!window.__landscapeTiming.native.length||t-window.__landscapeTiming.native.at(-1).at>100))window.__landscapeTiming.native.push({at:t,ready:n.ready,pending:n.pending,starved:n.starved,compiling:n.compiling,meshes:n.meshes.size,materials:n.materials.size,pipelines:n.renderer.pipelines.size});const a=phases[e.dataset.plantsPhase==='complete'?'complete':'loading'];a.push(t-last);if(a.length>3000)a.shift();
     if(!window.__landscapeTiming.allReadyAt&&e.dataset.plantsPhase==='complete'&&e.dataset.roadsReadyAt&&e.dataset.trafficArmedAt&&e.dataset.photoBuildings&&e.dataset.farGroves!==undefined&&e.dataset.ringAt&&e.dataset.waterReadyAt&&e.dataset.walkersReadyAt&&e.dataset.parcelActorsReadyAt&&e.dataset.boatsReadyAt&&n?.ready&&!n.pending&&!n.compiling&&!n.failed&&!n.starved)window.__landscapeTiming.allReadyAt=t;
    }last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
   try{new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
   document.addEventListener('pointermove',()=>{const t=performance.now();requestAnimationFrame(()=>pointer.push(performance.now()-t));},{passive:true});
  })();''')
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
  if a.profile:
   cdp=await page.context.new_cdp_session(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
  await page.goto(URL,wait_until='domcontentloaded');start=time.monotonic();state={}
  while time.monotonic()-start<150:
   await page.evaluate(hook)
   stage=page.locator(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')
   state=await stage.evaluate('e=>({...e.dataset})') if await stage.count() else {}
   if int(time.monotonic()-start)%10==0:print(json.dumps({'elapsed':round(time.monotonic()-start,1),'state':state,'native':await page.evaluate('({ready:window.__sceneNative?.ready,pending:window.__sceneNative?.pending,starved:window.__sceneNative?.starved,all:window.__landscapeTiming.allReadyAt})')},ensure_ascii=True),flush=True)
   spin=page.get_by_role('button',name='자동 회전',exact=True)
   if await spin.count() and await spin.get_attribute('aria-pressed')=='true':await spin.click()
   if state.get('plantsPhase')=='complete' and state.get('sceneReady')=='true' and await page.evaluate('!!window.__landscapeTiming.allReadyAt'):break
   await page.wait_for_timeout(1000)
  if a.profile:Path(a.out+'-cpu.json').write_text(json.dumps((await cdp.send('Profiler.stop'))['profile']),encoding='utf8')
  await page.locator(':is(.re-holo-layer,.re-holo--expanded) input[type=range]').evaluate("e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'12');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
  await page.get_by_role('button',name='처음',exact=False).first.click();await page.wait_for_timeout(1500)
  await page.wait_for_timeout(5000)
  state=await stage.evaluate('e=>({...e.dataset})')
  await page.screenshot(path=a.out+'.png')
  road_audit=await page.evaluate(road_hook)
  assert road_audit and not road_audit.get('missing') and road_audit['hiddenCentroids']==0,road_audit
  lamp_audit=await page.evaluate('''()=>{
   const n=window.__sceneNative,road=[...n.active].find(o=>o.name==='road surface'),seen=new Set(),lamps=[];
   for(const o of n.active){const root=o.parent;if(root?.userData.streetLamps&&!seen.has(root)){seen.add(root);lamps.push(...root.userData.streetLamps);}}
   const P=road.geometry.attributes.position.array,bad=[];
   for(const l of lamps){for(let k=0;k<P.length;k+=9){
    const ax=P[k],ay=-P[k+2],bx=P[k+3],by=-P[k+5],cx=P[k+6],cy=-P[k+8];
    if(l.x<Math.min(ax,bx,cx)||l.x>Math.max(ax,bx,cx)||l.y<Math.min(ay,by,cy)||l.y>Math.max(ay,by,cy))continue;
    const a=(bx-ax)*(l.y-ay)-(by-ay)*(l.x-ax),b=(cx-bx)*(l.y-by)-(cy-by)*(l.x-bx),c=(ax-cx)*(l.y-cy)-(ay-cy)*(l.x-cx);
    const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-7)continue;
    if(a>=-1e-5&&b>=-1e-5&&c>=-1e-5||a<=1e-5&&b<=1e-5&&c<=1e-5){bad.push(l);break;}
   }}return {lamps:lamps.length,inCarriageway:bad.length,bad};
  }''')
  assert lamp_audit['lamps']>0 and lamp_audit['inCarriageway']==0,lamp_audit
  forest=await page.evaluate('''()=>{const seen=new Set(),out=[];for(const o of window.__sceneNative.active){const g=o.parent;if(g?.userData.forestBudget&&!seen.has(g)){seen.add(g);const b={...g.userData.forestBudget};delete b.roots;out.push(b);}}return out;}''')
  marking_audit=await page.evaluate('''()=>{
   const n=window.__sceneNative,road=[...n.active].find(o=>o.name==='road surface'),P=road.geometry.attributes.position.array,bins=new Map(),cell=12;
   for(let k=0;k<P.length;k+=9){
    const x0=Math.floor(Math.min(P[k],P[k+3],P[k+6])/cell),x1=Math.floor(Math.max(P[k],P[k+3],P[k+6])/cell),y0=Math.floor(Math.min(-P[k+2],-P[k+5],-P[k+8])/cell),y1=Math.floor(Math.max(-P[k+2],-P[k+5],-P[k+8])/cell);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=x+':'+y;let b=bins.get(key);if(!b){b=[];bins.set(key,b);}b.push(k);}
   }
   const onRoad=(x,y)=>{for(const k of bins.get(Math.floor(x/cell)+':'+Math.floor(y/cell))??[]){
    const ax=P[k],ay=-P[k+2],bx=P[k+3],by=-P[k+5],cx=P[k+6],cy=-P[k+8],area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-7)continue;
    const a=(bx-ax)*(y-ay)-(by-ay)*(x-ax),b=(cx-bx)*(y-by)-(cy-by)*(x-bx),c=(ax-cx)*(y-cy)-(ay-cy)*(x-cx),eps=.001*Math.max(Math.hypot(bx-ax,by-ay),Math.hypot(cx-bx,cy-by),Math.hypot(ax-cx,ay-cy));
    if(a>=-eps&&b>=-eps&&c>=-eps||a<=eps&&b<=eps&&c<=eps)return true;
   }return false;};
   let triangles=0,outsideVertices=0,outsideCentroids=0;const examples=[],seen=new Set(),plans=[];
   for(const o of n.active)if(o.parent?.name==='road markings'){
    if(!seen.has(o.parent)){seen.add(o.parent);plans.push(...o.parent.userData.roadMarkings??[]);}
    const p=o.geometry.attributes.position.array;
    for(let k=0;k<p.length;k+=9){triangles++;let x=0,y=0;for(let j=0;j<9;j+=3){x+=p[k+j]/3;y-=p[k+j+2]/3;if(!onRoad(p[k+j],-p[k+j+2])){outsideVertices++;if(examples.length<8)examples.push([p[k+j],-p[k+j+2]]);}}
     if(!onRoad(x,y))outsideCentroids++;
    }
   }
   return {triangles,outsideVertices,outsideCentroids,examples,plannedRoads:plans.length,shortRoadsWithLines:plans.filter(p=>p.length<12&&p.spans.length).length};
  }''')
  assert marking_audit['triangles']>0 and marking_audit['outsideVertices']==0 and marking_audit['outsideCentroids']==0,marking_audit
  assert forest,'shared tree models must actually be drawn'
  for f in forest:
   assert f['minExposedTrunk']>1.5 and f['meshLeaves']>=192,f
   if not f['preserveRoots']:assert f['instanceBytes']<f['cardBufferBytes'],f
  tree_materials=await page.evaluate('''()=>{const m=new Set();let cardTrees=0;for(const o of window.__sceneNative.active){const mat=o.material;if(mat?.userData?.volumeFoliage)m.add(mat);if(mat?.userData?.foliage)cardTrees++;}return {volumeMaterials:m.size,alphaTreeMaterials:[...m].filter(m=>m.alphaTest>0||m.side!==0).length,cardTrees};}''')
  assert tree_materials['volumeMaterials']>0 and tree_materials['alphaTreeMaterials']==0 and tree_materials['cardTrees']==0,tree_materials
  assert not errors,errors
  assert state.get('sceneReady')=='true' and state.get('plantsPhase')=='complete',state
  inventory=await page.evaluate('''()=>{const out=[];for(const o of window.__sceneNative.active){if(o.isInstancedMesh)continue;const p=o.geometry.attributes.position,m=Array.isArray(o.material)?o.material[0]:o.material;let lo=Infinity,hi=-Infinity;for(let i=0;i<p.count;i++){const h=p.getY(i);lo=Math.min(lo,h);hi=Math.max(hi,h);}out.push({name:o.name,category:window.__censusCategory(o),up:[lo,hi],rotation:[o.parent?.rotation.x,o.rotation.x],flags:Object.keys(m?.userData??{})});}return out;}''')
  facade=await page.evaluate('({audit:window.__holoFacadeAudit,names:window.__holoData?.buildings.map(b=>b.name)})')
  Path(a.out+'-facades.json').write_text(json.dumps(facade,ensure_ascii=False,indent=2),encoding='utf-8')
  resources=await page.evaluate('''()=>{
   const n=window.__sceneNative,geometries=new Set(),textures=new Set();let geometryBytes=0,triangles=0;
   for(const o of n.active){const g=o.geometry;if(!geometries.has(g)){geometries.add(g);for(const a of Object.values(g.attributes))geometryBytes+=a.array.byteLength;geometryBytes+=g.index?.array.byteLength??0;triangles+=(g.index?.count??g.attributes.position.count)/3;}}
   let instanceBytes=0;for(const o of n.active)if(o.isInstancedMesh)instanceBytes+=o.instanceMatrix.array.byteLength+(o.instanceColor?.array.byteLength??0);for(const t of n.textures.values())textures.add(t);
   const downloads=performance.getEntriesByType('resource').filter(e=>e.initiatorType==='fetch').sort((a,b)=>b.duration-a.duration).slice(0,15).map(e=>{const u=new URL(e.name);return {host:u.host,path:u.pathname,ms:e.duration,start:e.startTime};});
   return {activeMeshes:n.active.size,uniqueGeometries:geometries.size,geometryAttributeBytes:geometryBytes,instanceAttributeBytes:instanceBytes,uniqueGeometryTriangles:triangles,uniqueNativeTextures:textures.size,draws:n.stats.draws,frameTriangles:n.stats.triangles,shadowStats:n.shadowStats,gpuPassMs:n.timer.ms,downloads};
  }''')
  box=await stage.bounding_box()
  for i in range(50):
   await page.mouse.move(box['x']+box['width']*(.35+i*.006),box['y']+box['height']*.5)
   await page.wait_for_timeout(16)
  timing=await page.evaluate('''()=>{const t=window.__landscapeTiming,summary=a=>{const s=a.slice().sort((a,b)=>a-b);return {samples:s.length,p50:s[Math.floor(s.length*.5)]??null,p95:s[Math.floor(s.length*.95)]??null,p99:s[Math.floor(s.length*.99)]??null,over33ms:s.filter(v=>v>33).length,max:s.at(-1)??null};};const e=document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage');return {allReadyAt:t.allReadyAt??null,selectToAllReadyMs:t.allReadyAt? t.allReadyAt-Number(e.dataset.selectAt):null,frames:Object.fromEntries(Object.entries(t.phases).map(([k,v])=>[k,summary(v)])),pointerToNextAnimationFrameMs:summary(t.pointer),longTasks:t.longTasks,native:t.native};}''')
  Path(a.out+'.json').write_text(json.dumps({'state':state,'errors':errors,'inventory':inventory,'roadAudit':road_audit,'lampAudit':lamp_audit,'markingAudit':marking_audit,'forest':forest,'treeMaterials':tree_materials,'resources':resources,'timing':timing},ensure_ascii=False,indent=2),encoding='utf-8')
  print(json.dumps({'state':state,'errors':errors,'roadAudit':road_audit,'lampAudit':lamp_audit,'markingAudit':marking_audit,'forest':forest},ensure_ascii=True),flush=True)
  await page.get_by_role('button',name='위에서',exact=False).first.click();await page.wait_for_timeout(1000)
  box=await stage.bounding_box();await page.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.5);await page.mouse.wheel(0,-550);await page.wait_for_timeout(1500)
  await page.screenshot(path=a.out+'-above.png')
  await browser.close()

asyncio.run(main())
