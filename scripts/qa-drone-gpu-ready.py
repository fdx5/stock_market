"""Read-only local GPU readiness diagnostics; fresh muted browser, no DB."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf8')
root=Path(__file__).resolve().parents[1];port=int(sys.argv[1]);label=sys.argv[2]
place=sys.argv[3] if len(sys.argv)>3 else 'mangmi'
out=root/'tmp/drone-gpu-ready'/label;out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio'])
 try:
  page=b.new_page(viewport={'width':1440,'height':1000});page.add_init_script("Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})")
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)[:200]))
  page.goto(f'http://127.0.0.1:{port}/drone-review/{place}',wait_until='domcontentloaded');page.wait_for_function('window.__drone&&window.__holoNative?.shown',timeout=90000)
  page.wait_for_timeout(14000)
  page.evaluate('''()=>{const n=window.__holoNative,r=n.renderer,prep=[],sync=n.sync,buffers=r._frameBuffers;let inSync=false;
   window.__qaPreparations=prep;n.sync=function(...args){inSync=true;try{return sync.apply(this,args);}finally{inSync=false;}};
   r._frameBuffers=function(o,g,mat){if(inSync&&prep.length<100){const source=[...n.meshes].find(([,m])=>m===o)?.[0],state=r.geometries.get(g);
    prep.push({frame:n.frameNo,name:source?.name,group:source?.parent?.name,instanced:!!o.isInstancedMesh,attrs:Object.entries(g.attributes).map(([name,a])=>({name,instanced:!!a.isInstancedBufferAttribute,count:a.count,version:a.version,uploaded:state?.buffers.get(a)?.version})),index:{version:g.index?.version,uploaded:state?.indexVersion}});}
    return buffers.call(this,o,g,mat);};}''')
  page.wait_for_timeout(2500)
  d=page.evaluate('''()=>{const w=window.__drone.world,n=window.__holoNative,r=n.renderer,bad=[];
  const tiles=[...w.tiles.values(),...w.viewTiles.values()].sort((a,b)=>Math.hypot(a.cx,a.cy)-Math.hypot(b.cx,b.cy));
  const placed=tiles.filter(t=>t.survey==='placed').map(t=>({tile:t.key,children:t.surveyGroup?.children.length,ready:n.objectsReady(t.surveyGroup),meshes:t.surveyGroup?.children.map(o=>({inScene:n.meshes.has(o),explain:n.explain(o)}))}));
  for(const t of tiles)for(const group of [t.zup,t.yup])group?.traverseVisible(o=>{
    if(!o.isMesh||o.material?.isShaderMaterial)return;const m=n.meshes.get(o);if(!m){if(bad.length<15)bad.push({tile:t.key,name:o.name,reason:'no native'});return;}
    const mats=Array.isArray(m.material)?m.material:[m.material];
    for(const mat of mats)if(!r.geometryReady(m,mat)&&bad.length<15){const g=r.geometries.get(m.geometry),vl=r._cachedLayout(m,m.geometry,mat);bad.push({tile:t.key,name:o.name,group:group.name,sourceGeometry:m.geometry===o.geometry,reason:'buffers',attrs:vl.buffers.map(({attr})=>{const a=attr.isInterleavedBufferAttribute?attr.data:attr,buf=g?.buffers.get(a);return {name:attr.name,version:a.version,uploaded:buf?.version,same:buf?.array===a.array,count:attr.count};}),index:{version:m.geometry.index?.version,uploaded:g?.indexVersion,same:g?.indexSrc===m.geometry.index?.array}});}
  });const preparationPending=[];
  for(const [o,m]of n.meshes){const mats=Array.isArray(m.material)?m.material:[m.material];
   for(const mat of mats)if(!r.geometryReady(m,mat,true)&&preparationPending.length<12){const state=r.geometries.get(m.geometry),vl=r._cachedLayout(m,m.geometry,mat);
    preparationPending.push({name:o.name,group:o.parent?.name,count:o.count,attrs:vl.buffers.map(({attr})=>{const a=attr.isInterleavedBufferAttribute?attr.data:attr,buf=state?.buffers.get(a);return{instanced:!!(a.isInstancedBufferAttribute||a.isInstancedInterleavedBuffer),count:attr.count,version:a.version,uploaded:buf?.version,same:buf?.array===a.array};})});}
  }const replacements=[];
  for(const [o,m]of n.meshes){const sources=Array.isArray(o.material)?o.material:[o.material],mats=Array.isArray(m.material)?m.material:[m.material];
   if(sources.some((src,i)=>mats[i]?.source!==src||mats[i]?.srcVersion!==src.version)&&replacements.length<12)replacements.push({name:o.name,group:o.parent?.name,sources:sources.map(src=>({name:src.name,version:src.version,allocated:n.materials.get(src)?.srcVersion})),native:mats.map(mat=>({version:mat.srcVersion,source:mat.source?.name})),explain:n.explain(o)});
  }return{stats:w.stats(),placed,bad,preparationPending,replacements,preparations:window.__qaPreparations};}''')
  d['errors']=errors;(out/'report.json').write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(d,ensure_ascii=False))
  page.screenshot(path=str(out/'scene.png'))
 finally:b.close()
