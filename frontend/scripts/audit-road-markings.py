"""Read-only actual road and paint geometry audit. Saves no provider request URLs."""
import argparse,ast,asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright

p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--out',required=True);a=p.parse_args()
Path(a.out).parent.mkdir(parents=True,exist_ok=True)
tree=ast.parse(Path(__file__).with_name('audit-3d-landscape.py').read_text(encoding='utf8'))
hook=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='hook' for t in n.targets))
async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu'])
  page=await browser.new_page(viewport={'width':1440,'height':1000});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(a.url,wait_until='domcontentloaded')
  for i in range(150):
   await page.evaluate(hook)
   ready=await page.evaluate("(()=>{const s=document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')?.dataset;return s?.roadsReadyAt&&s.trafficArmedAt&&s.sceneReady==='true'&&s.plantsPhase==='complete';})()")
   if ready:break
   await page.wait_for_timeout(1000)
  await page.locator(':is(.re-holo-layer,.re-holo--expanded) input[type=range]').evaluate("e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'12');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
  await page.get_by_title('\ucc98\uc74c \uc2dc\uc810\uc73c\ub85c',exact=True).click();await page.wait_for_timeout(2000)
  await page.wait_for_function("()=>{const n=window.__sceneNative;return n?.ready&&!n.pending&&!n.compiling&&!n.failed;}",timeout=60000)
  report=await page.evaluate("""()=>{const n=window.__sceneNative,t=[...n.active].find(o=>o.parent?.userData?.traffic)?.parent.userData.traffic;const roads=t?.arms?.roads??t?.paths,seen=new Set(),plans=[];
   for(const o of n.active){const g=o.parent;if(g?.name==='road markings'&&!seen.has(g)){seen.add(g);plans.push(...g.userData.roadMarkings??[]);}}
   const owners=new Set();for(const o of n.active)for(let p=o;p;p=p.parent)if(p.userData.instanceCompute)owners.add(p);
   return {state:{...document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage').dataset},native:{ready:n.ready,pending:n.pending,compiling:n.compiling,failed:n.failed},roads,plans,
    instanceCompute:[...owners].map(p=>({name:p.name,mode:p.userData.instanceCompute.mode,capacity:p.userData.instanceCompute.capacity})),wasmAssets:performance.getEntriesByType('resource').filter(e=>/scene_geometry.*[.]wasm/.test(e.name)).map(e=>e.name),
    paths:t?.paths,clusters:t?.clusters,arms:roads?.map((r,i)=>({road:i,inside:t.internal[i],startTrim:t.trimAt.get(`${i}:true`),endTrim:t.trimAt.get(`${i}:false`)})),
    geometry:[...n.active].filter(o=>o.name==='road surface'||o.parent?.name==='road markings').map(o=>({name:o.name,parent:o.parent?.name,color:o.material.color?.toArray(),position:Array.from(o.geometry.attributes.position.array),roadLevels:o.geometry.attributes.roadLevel?Array.from(o.geometry.attributes.roadLevel.array):null,roadProfileIndices:o.geometry.attributes.roadProfile?Array.from(o.geometry.attributes.roadProfile.array):null,roadProfiles:Object.fromEntries(o.geometry.userData.roadProfiles??[]),index:o.geometry.index?Array.from(o.geometry.index.array):null}))};}""")
  report['errors']=errors;Path(a.out+'.json').write_text(json.dumps(report,indent=2),encoding='utf8')
  await page.screenshot(path=a.out+'.png')
  await page.get_by_title('\uc704\uc5d0\uc11c \ub0b4\ub824\ub2e4\ubcf4\uae30',exact=True).click();await page.wait_for_timeout(1500);await page.screenshot(path=a.out+'-top.png')
  print(json.dumps({'state':report['state'],'roads':len(report['roads'] or []),'plans':len(report['plans']),'inside':sum(bool(x['inside']) for x in report['arms'] or []),'paintMeshes':sum(x['parent']=='road markings' for x in report['geometry']),'errors':errors}))
  assert ready and report['roads'] and report['plans'],{'state':report['state'],'native':report['native']}
  assert report['native']['ready'] and not any(report['native'].get(k) for k in ['pending','compiling','failed']),report['native']
  await browser.close()
asyncio.run(main())
