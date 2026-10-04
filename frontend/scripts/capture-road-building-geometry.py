import ast,asyncio,json,math,re,sys,time
from pathlib import Path
from urllib.parse import urlencode,urlsplit,parse_qs
from playwright.async_api import async_playwright
mod=ast.parse(Path(__file__).with_name('audit-3d-landscape.py').read_text(encoding='utf8'))
v={n.targets[0].id:ast.literal_eval(n.value) for n in mod.body if isinstance(n,ast.Assign) and isinstance(n.value,(ast.Constant,ast.Dict)) and n.targets[0].id in ['hook','CASES']}
async def run():
 async with async_playwright() as pw:
  case=sys.argv[1] if len(sys.argv)>1 else 'luceheim'
  base=sys.argv[2] if len(sys.argv)>2 else 'http://127.0.0.1:4195'
  prefix=sys.argv[3] if len(sys.argv)>3 else ('prod-' if base.startswith('https:') else '')+case
  b=await pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu']);p=await b.new_page(viewport={'width':1440,'height':900});collected={'roads':[],'buildings':[],'responses':[],'errors':[]};jobs=[]
  p.on('pageerror',lambda e:collected['errors'].append(str(e)))
  async def capture(response):
   params=parse_qs(urlsplit(response.url).query);kind=params.get('data',[''])[0]
   if kind not in ['LT_L_N3A0020000','LT_C_BLDGINFO']:return
   try:
    s=await response.text();begin=s.find('{');data=json.JSONDecoder().raw_decode(s[begin:])[0];features=data.get('response',{}).get('result',{}).get('featureCollection',{}).get('features',[])
    collected['roads' if kind.startswith('LT_L') else 'buildings'].extend(features)
    body=data.get('response',{})
    collected['responses'].append({'kind':kind,'page':params.get('page'),'status':body.get('status'),'error':body.get('error'),'features':len(features),'total':body.get('record'),'bbox':params.get('geomFilter')})
    if kind.startswith('LT_L'):
     nums=[float(x) for x in re.findall(r'-?\d+(?:\.\d+)?',params.get('geomFilter',[''])[0])]
     if len(nums)==4 and (abs((nums[3]-nums[1])*110540-1200)<1 or 'center' not in collected):collected['center']=[(nums[0]+nums[2])/2,(nums[1]+nums[3])/2]
   except Exception as e:print(type(e).__name__,flush=True)
  p.on('response',lambda r:jobs.append(asyncio.create_task(capture(r))))
  sido,sgg,dong,lot,name,area=v['CASES'][case]
  await p.goto(base+'/realestate-map?'+urlencode(dict(sido=sido,sgg=sgg,dong=dong,complex=f'{sgg}:{dong}:{lot}:{name}',area=area,**{'3d':'1'})))
  for i in range(90):
   await p.evaluate(v['hook']);await p.wait_for_timeout(500)
   if await p.evaluate("(()=>{const s=document.querySelector('.re-holo-stage')?.dataset,n=window.__sceneNative;return s?.sceneReady==='true'&&s.trafficArmedAt&&s.photoBuildings&&s.ringAt&&s.plantsPhase==='complete'&&n?.ready&&!n.pending&&!n.compiling;})()"):break
  await p.wait_for_timeout(2000)
  if jobs:await asyncio.gather(*jobs)
  collected['state']=await p.evaluate("({...document.querySelector('.re-holo-stage')?.dataset})")
  collected['traffic']=await p.evaluate("()=>{const t=[...window.__sceneNative?.active??[]].find(o=>o.parent?.userData?.traffic)?.parent.userData.traffic;return t?{paths:t.paths,clusters:t.clusters}:null;}")
  collected['surfaces']=await p.evaluate("()=>[...window.__sceneNative?.active??[]].filter(o=>o.name==='road surface'||/pavement|sidewalk|kerb/i.test(o.name)).map(o=>({name:o.name,position:Array.from(o.geometry.attributes.position.array),index:o.geometry.index?Array.from(o.geometry.index.array):null}))")
  collected['buildingSurfaces']=await p.evaluate("()=>{const n=window.__sceneNative,road=[...n.active].find(o=>o.name==='road surface');if(!road)return [];road.updateWorldMatrix(true,false);const out=[];for(const o of n.active){if(o.isInstancedMesh)continue;const category=window.__censusCategory(o);if(!['window/facade','roof'].includes(category)&&!category.startsWith('building '))continue;o.updateWorldMatrix(true,false);const m=road.matrixWorld.clone().invert().multiply(o.matrixWorld).elements,p=o.geometry.attributes.position.array,q=[];for(let k=0;k<p.length;k+=3){const x=p[k],y=p[k+1],z=p[k+2];q.push(m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]);}out.push({category,position:q,index:o.geometry.index?Array.from(o.geometry.index.array):null});}return out;}")
  await p.screenshot(path=f'tmp/{prefix}-roads.png')
  Path(f'tmp/{prefix}-map-geometry.json').write_text(json.dumps(collected,ensure_ascii=False),encoding='utf8');print(json.dumps({'case':case,'state':collected['state'],'responses':collected['responses'],'roads':len(collected['roads']),'paths':len(collected['traffic']['paths']) if collected['traffic'] else None,'errors':collected['errors']},ensure_ascii=True),flush=True)
  await b.close()
asyncio.run(run())
