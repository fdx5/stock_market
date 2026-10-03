"""GPU equality for exact packed surfaces, all mip levels, plus corrupt-asset fallback."""
import argparse,atexit,json,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5192');p.add_argument('--bad-surface',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parents[2]
files=[root/f'frontend/__surfacecheck_{os.getpid()}.html',root/f'frontend/src/__surfacecheck_{os.getpid()}.ts']
assert not any(f.exists() for f in files)
atexit.register(lambda:[f.unlink(missing_ok=True) for f in files])
files[0].write_text(f'<html><script type="module" src="/src/{files[1].name}"></script></html>',encoding='utf8')
files[1].write_text('''
import {GPU} from './vendor/tidewater/engine/gpu/GPU.js';
import {Texture} from './vendor/tidewater/engine/gpu/Texture.js';
import {warmMipmaps} from './vendor/tidewater/engine/gpu/Mipmaps.js';
import {packInto,warmPack} from './components/tidewater/texturePack.js';
import {ComplexRenderer} from './components/tidewater/ComplexRenderer.js';
import {paintTextures} from './components/paintClient';
import {preparedSurface} from './components/preparedSurface';
import {paletteFor} from './components/complexScene';
(window as any).check=async(bad:boolean)=>{
 await GPU.init({headless:true});await warmMipmaps(['rgba8unorm']);await warmPack('rgba8unorm','vec4f(A.x, A.y, B.y, B.z)',2);await warmPack('rgba8unorm','A',1);GPU.device.pushErrorScope('validation');
 const results=[];
 const read=async(tex:any,level:number)=>{
  const w=Math.max(1,tex.width>>level),h=Math.max(1,tex.height>>level),row=Math.ceil(w*4/256)*256;
  const copy=new Texture({width:w,height:h,format:'rgba8unorm',mips:false,usage:['sample','render','copySrc']});
  packInto(copy,[{texture:{createView:()=>tex.getGPU().createView({baseMipLevel:level,mipLevelCount:1})}}],'A');
  const b=GPU.device.createBuffer({size:row*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  GPU.getEncoder().copyTextureToBuffer({texture:copy.getGPU()},{buffer:b,bytesPerRow:row},[w,h]);GPU.submit();await b.mapAsync(GPUMapMode.READ);
  const src=new Uint8Array(b.getMappedRange()),out=new Uint8Array(w*h*4);for(let y=0;y<h;y++)out.set(src.subarray(y*row,y*row+w*4),y*w*4);
  b.unmap();b.destroy();copy.destroy();return out;
 };
 for(const job of [{kind:'facade',palette:paletteFor('래미안'),seed:123},{kind:'facade',palette:paletteFor('자이'),seed:991,scale:2},{kind:'plinth',tone:'#8d8a84',seed:13},{kind:'context',style:'apt'},{kind:'context',style:'apt',scale:2}] as any[]){
  const pixels=await preparedSurface(job);if(bad?pixels!==null:!pixels)throw Error('optional surface availability mismatch');
  const maps=await paintTextures(job,async()=>true);if(!maps)throw Error('paint unavailable');
  if(pixels && !maps.normalMap.userData.surfacePixels)throw Error('early optional pixels missed '+JSON.stringify({job,normal:maps.normalMap.userData,rough:maps.rmMap.userData}));
  const material={normalMap:maps.normalMap,roughnessMap:maps.rmMap,metalnessMap:maps.rmMap};
  const original=new Texture({width:maps.normalMap.image.width,height:maps.normalMap.image.height,format:'rgba8unorm',mips:true,usage:['sample','render','copySrc']});
  packInto(original,[{img:maps.normalMap.image,flipY:maps.normalMap.flipY},{img:maps.rmMap.image,flipY:maps.rmMap.flipY}],'vec4f(A.x, A.y, B.y, B.z)');
  const renderer:any=Object.create(ComplexRenderer.prototype);renderer.textures=new Map();renderer.frameNo=0;renderer.shown=true;
  let copies=0;const copy=GPU.queue.copyExternalImageToTexture.bind(GPU.queue);GPU.queue.copyExternalImageToTexture=(...args:any[])=>{copies++;return copy(...args as any)};
  let candidate,frames=0,maxFrameTexels=0;try{
   while(true){renderer.frameNo++;frames++;const ready=renderer.imagesReady(material);maxFrameTexels=Math.max(maxFrameTexels,0.6e6-(renderer.stageBudget??0.6e6));GPU.submit();if(ready)break;if(frames>100)throw Error('staging did not finish');}
   candidate=renderer.packedSurface(material);
  }finally{GPU.queue.copyExternalImageToTexture=copy;}
  if(maxFrameTexels>0.6e6)throw Error('packed pixels exceed shared texel budget');
  if(!candidate || (!bad&&copies!==0) || maps.normalMap.userData.surfacePixels)throw Error('packed upload/lifetime regression');
  const maxima=[];
  for(let level=0;level<candidate.mipLevelCount;level++){const a=await read(original,level),b=await read(candidate,level);let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));if(max)throw Error('packed mip differs '+level+' '+max);maxima.push(max);}
  const peer:any=Object.create(ComplexRenderer.prototype);peer.textures=new Map();peer.frameNo=0;
  const pn=maps.normalMap.clone(),pr=maps.rmMap.clone();if(pixels)pn.userData.surfacePixels=pixels;
  const shared=peer.packedSurface({normalMap:pn,roughnessMap:pr,metalnessMap:pr});
  if(shared!==candidate || pn.userData.surfacePixels)throw Error('shared packed pixels retained or not shared');
  const key='surface/'+pn.userData.surfaceKey+'/'+pn.image.width+'/'+pn.image.height;
  renderer.pool().releaseOwner(renderer);if(peer.pool().peek(key)!==candidate)throw Error('shared texture released before last owner');
  peer.pool().releaseOwner(peer);if(peer.pool().peek(key))throw Error('shared texture retained after last owner');
  results.push({kind:job.kind,scale:job.scale??1,copies,frames,maxFrameTexels,mipMax:maxima,shared:true,lastOwnerReleased:true});
  original.destroy();pn.dispose();pr.dispose();Object.values(maps).forEach((t:any)=>t.dispose());
 }
 const error=await GPU.device.popErrorScope();if(error)throw error;return results;
};
''',encoding='utf8')
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-webgpu']);page=b.new_page();errors=[];intercepted=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 if a.bad_surface:
  def broken(r):intercepted.append(r.request.url);r.fulfill(body=b'not a gzip stream')
  page.context.route(re.compile(r'/3d/surface/.+\.rgba\.gz$'),broken)
 page.goto(a.base+'/'+files[0].name);page.wait_for_function("typeof window.check === 'function'")
 result=page.evaluate('(bad)=>check(bad)',a.bad_surface);assert not errors,errors
 if a.bad_surface:assert intercepted,'Corrupt-surface route was not used'
 print(json.dumps({'maps':result,'corruptFallback':a.bad_surface,'errors':errors}),flush=True);b.close()
