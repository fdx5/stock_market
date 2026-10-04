"""Read-only production diagnostic; GPU probes add work, so this is not a performance benchmark.
The image gate is camera-specific and flags a review, not a proof of missing textures.
"""
import argparse,asyncio,json
from importlib.util import spec_from_file_location,module_from_spec
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image

parser=argparse.ArgumentParser(description="Repeated nearby-complex/time changes with daytime facade and GPU mip review.")
parser.add_argument('--iterations',type=int,default=8)
parser.add_argument('--channel',default='msedge')
parser.add_argument('--renderer',choices=['auto','webgl'],default='auto')
parser.add_argument('--out',type=Path,default=Path('tmp/facade-timeline.json'))
parser.add_argument('--url')
parser.add_argument('--target')
parser.add_argument('--ipad',action='store_true',help='Chromium desktop-iPad navigator profile; not physical Safari validation')
parser.add_argument('--material-swap',action='store_true',help='Replace a visible facade material by a different source with the same version')
parser.add_argument('--expect-broken',action='store_true',help='Record the old release regression before the fix')
args=parser.parse_args()
args.out.parent.mkdir(parents=True,exist_ok=True)
spec=spec_from_file_location('facade_check',Path(__file__).with_name('check-facade-black.py'))
facade_check=module_from_spec(spec);spec.loader.exec_module(facade_check)


async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(channel=args.channel,headless=True,args=['--enable-unsafe-webgpu'])
  page=await browser.new_page(viewport={'width':1024,'height':1366} if args.ipad else {'width':1845,'height':1267},device_scale_factor=2 if args.ipad else 1,has_touch=args.ipad)
  if args.ipad:await page.add_init_script("Object.defineProperties(navigator,{platform:{get:()=> 'MacIntel'},maxTouchPoints:{get:()=>5},deviceMemory:{get:()=>undefined},userAgent:{get:()=> 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'}})")
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
  await page.add_init_script("if(typeof GPUAdapter!=='undefined'){const old=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...args){const d=await old.apply(this,args);window.__gpuDev=d;return d;};}")
  await page.goto((args.url or 'https://kospimap.com/realestate-map?sido=41&period=3m&sgg=41150&dong=%ED%98%B8%EC%9B%90%EB%8F%99&complex=41150%3A%ED%98%B8%EC%9B%90%EB%8F%99%3A401-1%3A%EC%8B%A0%EB%8F%846&area=60&3d=1')+'&renderer='+args.renderer,wait_until='domcontentloaded')
  await page.wait_for_function("document.querySelector(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage')?.dataset.shownAt",timeout=90000)
  if args.renderer!='webgl':await page.evaluate(r'''async()=>{const u=performance.getEntriesByType('resource').find(e=>/\/ComplexRenderer-[^/]+\.js/.test(e.name)).name;const m=await import(u);const C=Object.values(m).find(v=>typeof v==='function'&&v.prototype?.sync&&v.prototype?.render);const old=C.prototype.render;C.prototype.render=function(...args){window.__sceneNative=this;window.__sourceScene=args[0];window.__sourceCamera=args[1];return old.apply(this,args)}}''')
  select=page.locator(':is(.re-holo-layer,.re-holo--expanded) .re-holo-nearby')
  await select.wait_for(timeout=90000)
  options=await select.locator('option').evaluate_all('(es)=>es.map(e=>({value:e.value,text:e.textContent}))')
  target=next((o for o in options if (args.target or '\ub274\uc0bc\uc775\ud638\uc6d02') in o['text']),next(o for o in options if o['value']));print('target',target,flush=True)
  await select.select_option(target['value'])
  await page.locator(':is(.re-holo-layer,.re-holo--expanded) input[type=range]').evaluate("e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'12');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
  reports=[]
  for delay in range(args.iterations):
   if delay:await select.select_option('' if delay%2 else target['value'])
   for hour in [22,5,12,18,0,12]:
    await page.locator(':is(.re-holo-layer,.re-holo--expanded) input[type=range]').evaluate("(e,h)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(h));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}",hour)
    await page.wait_for_timeout(500)
   await page.wait_for_timeout(12000)
   if args.material_swap and args.renderer!='webgl':
    swap=await page.evaluate('''()=>{const n=window.__sceneNative;const [o,mesh]=[...n.meshes].find(([o])=>!Array.isArray(o.material)&&!!o.material.userData.interior&&!o.isInstancedMesh);const previous=o.material,next=previous.clone();next.version=previous.version;let changed=0;for(const source of n.meshes.keys()){if(source.material===previous){source.material=next;changed++;}else if(Array.isArray(source.material)&&source.material.includes(previous)){source.material=source.material.map(m=>m===previous?next:m);changed++;}}window.__swap={o,previous,next};return {sameVersion:previous.version===next.version,differentObject:previous!==next,changed};}''')
    await page.wait_for_timeout(25000)
    swap.update(await page.evaluate('''()=>{const {o,next}=window.__swap,n=window.__sceneNative,m=n.meshes.get(o).material;return {matches:m.source===next,nativeAlive:[...n.materials.values()].includes(m),resident:Object.values(m.bindings).filter(b=>b?.texture?.isTexture).every(b=>!!b.texture.gpu)};}'''))
    if args.expect_broken:assert not swap['nativeAlive'],swap
    else:assert swap['matches'] and swap['nativeAlive'] and swap['resident'],swap
   state=await page.locator(':is(.re-holo-layer,.re-holo--expanded) .re-holo-stage').evaluate('(e)=>({...e.dataset})')
   mats=await page.evaluate('''()=>{const n=window.__sceneNative;if(!n)return null;return [...n.materials].filter(([s])=>!!s.userData.interior).map(([s,m])=>({uuid:s.uuid,version:s.version,nativeVersion:m.srcVersion,color:s.color.toArray(),map:s.map&&{version:s.map.version,w:s.map.image?.width,h:s.map.image?.height,released:s.map.userData.released,native:n.textures.get(s.map)&&{w:n.textures.get(s.map).width,h:n.textures.get(s.map).height,format:n.textures.get(s.map).format}},normal:s.normalMap&&{w:s.normalMap.image?.width,h:s.normalMap.image?.height,released:s.normalMap.userData.released},metalness:s.metalness,roughness:s.roughness,retired:n.retired?.length}));}''')
   resources=await page.evaluate('''()=>{const n=window.__sceneNative;if(!n)return null;const set=new Set(n.textures.values());return {pixels:n.canvas.width*n.canvas.height,textureTexels:[...set].reduce((a,t)=>a+t.width*t.height,0),paintDimensions:[...n.materials].filter(([s])=>s.userData.interior).map(([s,m])=>m.bindings.map?.texture).filter(Boolean).map(t=>[t.width,t.height]),materialCount:n.materials.size,sourceIdentity:[...n.meshes].every(([o,m])=>(Array.isArray(m.material)?m.material:[m.material]).every((mat,i)=>mat.source===(Array.isArray(o.material)?o.material[i]:o.material)))};}''')
   if args.ipad and resources:
    assert resources['pixels']<=2005000,resources
    assert all(max(size)<=768 for size in resources['paintDimensions']),resources
   reports.append({'state':state,'materials':mats,'resources':resources,'errors':errors,'swap':swap if args.material_swap and args.renderer!='webgl' else None});args.out.write_text(json.dumps(reports,indent=2),encoding='utf8')
   samples=await page.evaluate('''async()=>{
     const n=window.__sceneNative,d=window.__gpuDev;if(!n||!d)return null;
     const code='@group(0) @binding(0) var image:texture_2d<f32>; @group(0) @binding(1) var<storage,read_write> result:array<vec4f>; @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u){let p=vec2i(id.xy);let dim=textureDimensions(image,0);let at=vec2i((vec2f(p)+0.5)*vec2f(dim)/8.0);result[id.y*8u+id.x]=textureLoad(image,at,0);}';
     const pipe=await d.createComputePipelineAsync({layout:'auto',compute:{module:d.createShaderModule({code}),entryPoint:'main'}}),results=[];
     for(const [s,m] of n.materials){if(!s.userData.interior)continue;
       for(const key of ['map','normalMap','emissiveMap']){const tex=m.bindings[key]?.texture;if(!tex)continue;
         for(const level of [0,Math.min(4,tex.mipLevelCount-1),tex.mipLevelCount-1]){ const out=d.createBuffer({size:1024,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
         const bind=d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:tex.getGPU().createView({baseMipLevel:level,mipLevelCount:1})},{binding:1,resource:{buffer:out}}]});
         const enc=d.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1,1);pass.end();enc.copyBufferToBuffer(out,0,read,0,1024);d.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
         const v=[...new Float32Array(read.getMappedRange())];results.push({uuid:s.uuid,key,mean:[0,1,2,3].map(k=>v.filter((_,i)=>i%4===k).reduce((a,b)=>a+b,0)/64),level,gpuVersion:tex.version,width:tex.width,height:tex.height});read.unmap();read.destroy();out.destroy();}
       }
     }return results;
   }''')
   reports[-1]['samples']=samples;args.out.write_text(json.dumps(reports,indent=2),encoding='utf8')
   shot=args.out.with_name(args.out.stem+f'-{delay}.png')
   await page.screenshot(path=str(shot))
   with Image.open(shot) as im:review=facade_check.inspect_daytime_facades(im)
   reports[-1]['facadeVisualReview']=review
   reports[-1]['screenshot']=str(shot)
   args.out.write_text(json.dumps(reports,indent=2),encoding='utf8')
   print(json.dumps({'iteration':delay,'renderer':state.get('renderer'),'phase':state.get('plantsPhase'),'errors':errors,**review}),flush=True)
  await browser.close()
asyncio.run(main())
